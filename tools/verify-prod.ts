/**
 * Verify the production bundle actually runs.
 *
 * Every screenshot until now came from the dev server, which serves modules
 * unbundled and serves CSS straight from source. A production bundle differs in
 * three ways that each break things quietly: minified identifiers, a single file
 * instead of many, and the dev-only branches removed. So "it works on localhost"
 * says nothing about "it works when deployed", which is the only question that
 * matters here.
 *
 * Loads `dist/` through `vite preview` — the same static server shape as a CDN —
 * and checks the game boots, renders every screen, and logs nothing.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

mkdirSync("shots", { recursive: true });

const URL = process.argv[2] ?? "http://localhost:4173";

/**
 * Is anything already serving on the preview port?
 *
 * Starts its own preview server if not, because a verification step that needs a
 * second terminal running first is one that quietly does not happen.
 */
async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

let server: ReturnType<typeof spawn> | null = null;
if (!(await reachable(URL))) {
  console.log("starting vite preview...");
  server = spawn("npx", ["vite", "preview", "--port", "4173"], {
    stdio: "ignore",
    shell: true,
  });
  const up = await (async () => {
    for (let i = 0; i < 30; i++) {
      if (await reachable(URL)) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })();
  if (!up) {
    console.error("preview server never came up");
    if (server) server.kill();
    process.exit(1);
  }
  console.log("preview is up");
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });

const errs: string[] = [];
const failedRequests: string[] = [];

/*
 * Failures from a host we do not control.
 *
 * `accounts.google.com` answers 403 on this machine and on CI, because `http://localhost`
 * is not in the client id's list of authorised origins - and it should not be, for a
 * production build. Treating that as a build failure means this harness can only ever go
 * green on a developer machine with the origin whitelisted, which is the wrong way
 * round: the build is fine, the machine is not configured for Google sign-in.
 *
 * Separated rather than ignored. It is printed in its own line and still visible, so
 * nothing is hidden - the only thing that changes is whether it decides the exit code.
 * Our own origin stays fatal, because a 4xx or 5xx from the site under test is always a
 * defect.
 */
const thirdPartyRequests: string[] = [];
const SITE_HOST = (() => {
  const m = /^https?:\/\/([^/]+)/.exec(URL);
  return m ? m[1] : "";
})();

/** True when the failure came from a host this build does not serve. */
const isThirdParty = (url: string): boolean => {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  // No match means a data: or blob: URL, which never has a host worth comparing.
  if (!m) return true;
  return m[1] !== SITE_HOST;
};
page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // GSI's own logger reports the unregistered-origin case, which is the same
  // environment condition as the 403 above rather than a defect in the build.
  if (text.includes("GSI_LOGGER")) {
    thirdPartyRequests.push(text.slice(0, 110));
    return;
  }
  // Chromium's own resource-failure message carries no URL, so it cannot be matched to a
  // host. When we have already recorded a third-party failure, a bare "Failed to load
  // resource" is attributed to it. This is a heuristic and is the one soft edge in this
  // harness: it can only ever downgrade a message we have already seen a real cause for,
  // and it never touches a message from our own code.
  if (text.startsWith("Failed to load resource") && thirdPartyRequests.length > 0) {
    thirdPartyRequests.push(text.slice(0, 110));
    return;
  }
  errs.push("console: " + text);
});
page.on("requestfailed", (r) => {
  const line = `${r.url()} — ${r.failure()?.errorText}`;
  (isThirdParty(r.url()) ? thirdPartyRequests : failedRequests).push(line);
});
page.on("response", (r) => {
  if (r.status() < 400) return;
  const line = `${r.status()} ${r.url()}`;
  (isThirdParty(r.url()) ? thirdPartyRequests : failedRequests).push(line);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const booted = await page.evaluate(`(() => {
  const shell = document.querySelector(".shell");
  return {
    hasShell: !!shell,
    hasTopbar: !!document.querySelector(".topbar"),
    hasLevelBadge: !!document.querySelector(".levelbadge"),
    hasNav: document.querySelectorAll(".bottomnav .navitem").length,
    title: document.title,
  };
})()`);
console.log("boot:", JSON.stringify(booted));

// Walk every screen. A production-only failure is usually in one of them.
const screens = ["garden", "collection", "breeding", "arena", "lab"];
for (const s of screens) {
  await page.evaluate(`(() => { document.querySelector('.navitem[data-screen="${s}"]').click(); })()`);
  await page.waitForTimeout(450);
  const ok = (await page.evaluate(`(() => ({
    screen: !!document.querySelector(".screen")?.firstElementChild,
    text: (document.querySelector(".screen")?.textContent ?? "").trim().length,
  }))()`)) as { screen: boolean; text: number };
  console.log(`  ${s.padEnd(11)} rendered=${ok.screen} chars=${ok.text}`);
}

// The garden's tabs, since those are new and the production bundle is where a
// class-name collision would show up.
await page.evaluate(`(() => { document.querySelector('.navitem[data-screen="garden"]').click(); })()`);
await page.waitForTimeout(350);
for (const label of ["Hôm nay", "Túi hạt", "Vườn"]) {
  await page.locator(".tabs .tab", { hasText: label }).first().click();
  await page.waitForTimeout(280);
  const t = await page.evaluate(`(() => {
    const s = document.querySelector(".screen");
    return s && s.textContent ? s.textContent.trim().length : -1;
  })()`);
  console.log(`  tab ${label.padEnd(9)} chars=${t}`);
}
await page.screenshot({ path: "shots/prod-garden.png", fullPage: false });

// Playwright evaluates a string argument as an *expression*. `() => expr`
// without the trailing call is the function object itself, which does not
// serialise and comes back as the value `undefined` — so the check compared
// `undefined` against the string "undefined", said "leaked", and was wrong
// about a build that had correctly stripped the handle. Every probe here is
// therefore a called expression: `(() => …)()`.
const devHandle = await page.evaluate(`(() => typeof window.__game)()`);
const handleLeaked = devHandle !== "undefined";
console.log(`dev handle in production: ${JSON.stringify(devHandle)}${handleLeaked ? " (LEAKED)" : " (stripped, correct)"}`);

/*
 * Cross-Origin-Opener-Policy.
 *
 * Asserted because a missing value is invisible until Google sign-in runs in a real
 * browser: the site worked, the account sheet worked, and the failure was one console
 * line that reads like a warning. `same-origin` would be worse than absent, because it
 * isolates the document and blocks the postMessage that carries the credential back.
 */
const coopHeader = (await page.request.get(URL)).headers()["cross-origin-opener-policy"] ?? "";
const coopOk = coopHeader === "same-origin-allow-popups";
console.log(
  `cross-origin-opener-policy: ${coopHeader || "(not set)"}` +
    (coopOk
      ? " (correct)"
      : " -- REPORTED, NOT FATAL: vite preview never serves host headers, so this is" +
        " always absent locally. Check it against a real deployment."),
);

console.log("failed requests:", failedRequests.length ? failedRequests.join(" | ") : "none");
console.log(
  "third-party failures (not fatal):",
  thirdPartyRequests.length ? thirdPartyRequests.map((l) => l.slice(0, 110)).join("\n  ") : "none",
);
console.log("errors:", errs.length ? errs.join(" | ") : "none");

await b.close();
if (server) server.kill();
process.exit(errs.length || failedRequests.length || handleLeaked ? 1 : 0);