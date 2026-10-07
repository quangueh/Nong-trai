/**
 * Run the UI audit inside the browser.
 *
 * `tools/ui-audit.ts` is a console tool: it declares `window.__audit` and returns
 * findings for the page as it stands. Running it with `tsx` fails at `window is not
 * defined`, which is the tool working as designed rather than a bug — but it means the
 * audit only gets run when someone remembers to paste it somewhere.
 *
 * This drives it, so it runs in CI instead. The new elements it has to look at — the
 * protocol chips, the cost notice, the Google section — are the ones most likely to
 * fail a tap-target or contrast check, since none of them existed when the thresholds
 * were written.
 */
import { chromium } from "playwright-core";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 1000 } });
await page.addInitScript(() => {
  window.__name = (f) => f;
});
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });

// The audit module, loaded through vite so it is the real TS source.
await page.evaluate(`(async () => {
  const m = await import("/tools/ui-audit.ts");
  void m;
})()`);

const seed = `(() => {
  const g = window.__game;
  g.store.state.breederLevel = 60;
  g.store.state.leafCoin = 5_000_000;
  g.store.state.nurseryCap = 24;
  const ids = Object.keys(g.store.state.seeds).filter((id) => (g.store.state.seeds[id] || 0) > 0);
  let n = 0;
  for (const id of ids) {
    g.store.state.seeds[id] = 20;
    const r = g.store.plantSeed(id);
    if (r.ok && r.plantId) n++;
    if (n >= 3) break;
  }
  for (const p of g.store.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 25;
    p.locks.manual = false;
  }
  g.navigate("breeding");
})()`;
await page.evaluate(seed);
await page.waitForTimeout(700);

for (const [slot, card] of [[0, 0], [1, 1]] as const) {
  await page.locator(".slot").nth(slot).click();
  await page.waitForTimeout(350);
  await page.locator(".sheet .pickrow").nth(card).click();
  await page.waitForTimeout(350);
}
await page.waitForTimeout(400);

// `__audit` prints to the console and stashes its own text in `__auditResult`, so the
// string is read from there rather than from a return value. Reading a return value
// gave null: the module returns nothing, and looking for one made a working audit look
// like it had produced no findings at all.
await page.evaluate(`(async () => {
  const run = (window).__audit;
  if (typeof run !== "function") throw new Error("audit module did not register __audit");
  await run();
})()`);

const report = (await page.evaluate(`(() => (window).__auditResult ?? "(no result)" )()`)) as string;
console.log(report);

const fails = (report.match(/FAIL/g) ?? []).length;
const warns = (report.match(/WARN/g) ?? []).length;
console.log(`\naudit: ${fails} failures, ${warns} warnings`);
if (fails > 0) process.exitCode = 1;

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no page errors");
await b.close();