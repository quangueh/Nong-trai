import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const profile = args.find(arg => !arg.startsWith("--")) ?? "core";
if (!["core", "browser", "all"].includes(profile)) throw new Error("Profile must be core, browser or all");
const timeoutArg = args.find(arg => arg.startsWith("--timeout="));
const timeoutMs = timeoutArg ? Number(timeoutArg.split("=")[1]) : 300_000;
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("Timeout must be >=1000ms");
const filter = args.find(arg => arg.startsWith("--filter="))?.slice("--filter=".length);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportDir = join(root, "artifacts", "technical-tests", stamp);
mkdirSync(reportDir, { recursive: true });
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
type Job = { name: string; script: string; args?: string[]; browser?: boolean; direct?: boolean };
type Result = { name: string; status: "passed" | "failed" | "timeout" | "blocked" | "cancelled"; exitCode: number | null; durationMs: number; log: string; detail?: string };
const jobs: Job[] = readdirSync(join(root, "tools"))
  .filter(name => /^test-.*\.ts$/.test(name)).sort()
  .map(name => ({ name: name.slice(0, -3), script: join(root, "tools", name), browser: /from\s+["']playwright-core["']/.test(readFileSync(join(root, "tools", name), "utf8")) }))
  .filter(job => profile === "all" || (profile === "browser" ? job.browser : !job.browser));
/* Spec (docs/34 §17.2): fuzz ≥5 seeds ×2000 ops on domain paths that changed.
   The seeds are fixed so a failure reproduces by rerunning with the same arg. */
if (profile !== "browser") for (const seed of [1337, 42, 20261010, 777, 999999]) {
  jobs.push({ name: `fuzz-store-${seed}`, script: join(root, "tools", "fuzz-store.ts"), args: [String(seed), "2000"] });
}
if (profile !== "browser") {
  for (const config of ["tsconfig.json", "tsconfig.tools.json", "worker/tsconfig.json"]) {
    jobs.unshift({ name: `typecheck-${config.replace(/[/\.]/g, "-")}`, script: join(root, "node_modules/typescript/bin/tsc"), args: ["-p", config, "--noEmit"], direct: true });
  }
  jobs.push({ name: "production-build", script: join(root, "node_modules/vite/bin/vite.js"), args: ["build"], direct: true });
}
const selected = jobs.filter(job => !filter || job.name.includes(filter));
if (!selected.length) throw new Error("Filter matched no suites");
const results: Result[] = [];
let interrupted = false;
let stopActive: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  interrupted = true;
  stopActive?.();
});
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim();
const dirty = spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).stdout;
function report(): void {
  writeFileSync(join(reportDir, "report.json"), JSON.stringify({ startedAt: stamp, profile, timeoutMs, head, dirty, node: process.version, platform: process.platform, plannedSuites: selected.length, completed: results.length === selected.length, results }, null, 2));
  const rows = results.map(result => `| ${result.name} | ${result.status} | ${(result.durationMs / 1000).toFixed(1)} | ${result.log ? `[log](${result.name}.log)` : result.detail ?? ""} |`);
  writeFileSync(join(reportDir, "report.md"), [
    "# Technical Test Run", "", `Profile: ${profile}. HEAD: ${head}. Node: ${process.version}.`, "",
    `Finished: ${results.length}/${selected.length}. Passed: ${results.filter(result => result.status === "passed").length}.`, "",
    "| Suite | Status | Seconds | Evidence |", "| --- | --- | --- | --- |", ...rows, "",
    "A timeout/blocked run is not an assertion failure. Static import reachability is not runtime coverage.",
  ].join("\n"));
}

// Each suite gets a separate process, avoiding module singleton/global mock leakage.
async function run(job: Job): Promise<Result> {
  const started = Date.now();
  const log = join(reportDir, `${job.name}.log`);
  const stream = createWriteStream(log);
  const child = spawn(process.execPath, [...(job.direct ? [] : [tsx]), job.script, ...(job.args ?? [])], {
    cwd: root, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  let timedOut = false;
  let launchError: string | undefined;
  const stopChild = () => {
    // taskkill is process cleanup only; never used for filesystem operations.
    if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { child.kill("SIGKILL"); }
    }
  };
  stopActive = stopChild;
  const timer = setTimeout(() => { timedOut = true; stopChild(); }, timeoutMs);
  const exitCode = await new Promise<number | null>(resolveExit => {
    child.once("error", error => { launchError = error.message; });
    child.once("close", code => resolveExit(code));
  });
  clearTimeout(timer);
  stopActive = undefined;
  await new Promise<void>(done => stream.end(done));
  return { name: job.name, status: interrupted ? "cancelled" : timedOut ? "timeout" : exitCode === 0 && !launchError ? "passed" : "failed", exitCode, durationMs: Date.now() - started, log, detail: launchError };
}

let browserBlock: string | undefined;
if (selected.some(job => job.browser)) {
  try {
    const response = await fetch("http://localhost:5173/src/main.ts", { signal: AbortSignal.timeout(5_000) });
    const body = await response.text();
    if (!response.ok || !body.includes("/src/") || !body.includes("init")) {
      browserBlock = "Expected this project's Vite server at localhost:5173; start npm run dev -- --port 5173 --strictPort";
    }
  } catch {
    browserBlock = "Vite server not reachable at localhost:5173; start npm run dev -- --port 5173 --strictPort";
  }
}
console.log(`Technical ${profile}: ${selected.length} suites. Reports: ${reportDir}`);
for (const job of selected) {
  if (interrupted) break;
  console.log(`RUN ${job.name}`);
  const result: Result = job.browser && browserBlock
    ? { name: job.name, status: "blocked", exitCode: null, durationMs: 0, log: "", detail: browserBlock }
    : await run(job);
  results.push(result);
  report();
  console.log(`${result.status.toUpperCase()} ${job.name} (${(result.durationMs / 1000).toFixed(1)}s)${result.detail ? `: ${result.detail}` : ""}`);
}
const bad = results.filter(result => result.status !== "passed");
console.log(`${results.length - bad.length}/${results.length} suites passed; ${bad.length} not passed. ${join(reportDir, "report.json")}`);
process.exitCode = interrupted ? 130 : bad.length ? 1 : 0;
