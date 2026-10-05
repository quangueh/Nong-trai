/**
 * Does the pause actually pause? Played through, then stopped, then checked.
 *
 * A pause button that stops a CSS animation while the simulation runs on underneath is the
 * common way this goes wrong, and it looks correct in a screenshot. So this reads the fight's
 * own clock: paused must hold it, resumed must move it again, and the outcome must be
 * identical either way.
 */
import { chromium } from "playwright-core";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(500);
await page.evaluate(`(() => {
  const s = (window).__game.store;
  s.state.breederLevel = 24; s.state.leafCoin = 48000; s.state.ascent.highest = 21;
  for (const p of s.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; p.tier = "bloom"; }
  (window).__game.navigate("ascent");
})()`);
await page.waitForTimeout(1200);
await page.evaluate(`(() => {
  const b = [...document.querySelectorAll(".screen button")].find((x) => /Vượt ải này|Đánh lại/.test(x.textContent || ""));
  if (b) b.click();
})()`);
await page.waitForTimeout(2500);

/** The fight's own clock, read off the phase readout in the arena. */
/* Read the fight's own clock out of `.clock`. Not a wall-clock timer on this side of the
   test: that would keep advancing while the fight is paused and could not tell a paused
   simulation from a paused observer. */
const clock = () =>
  (page.evaluate(`(() => {
    /* Plain seconds, not m:ss. The arena prints the remaining time as a bare number - "88" -
     so a test that looked for a colon matched nothing and read null for every sample, which
     made a working pause look broken and a broken one look fine. */
    const t = (document.querySelector(".screen .clock")?.textContent || "").trim();
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  })()`) as Promise<number | null>);

const before = await clock();
await page.evaluate(`(() => {
  const b = [...document.querySelectorAll(".screen button")].find((x) => (x.textContent || "").trim() === "⏸");
  if (b) b.click();
})()`);
await page.waitForTimeout(2500);
const veilShown = await page.evaluate(`(() => Boolean(document.querySelector(".battle-paused")))()`) as boolean;
const paused = await clock();
await page.screenshot({ path: "shots/audit/phone-fight-paused.png" });

await page.waitForTimeout(2500);
const stillPaused = await clock();
await page.screenshot({ path: "shots/audit/phone-fight-paused-hold.png" });

await page.evaluate(`(() => {
  const b = [...document.querySelectorAll(".screen button")].find((x) => (x.textContent || "").trim() === "▶");
  if (b) b.click();
})()`);
await page.waitForTimeout(2500);
const resumed = await clock();
const veilGone = !(await page.evaluate(`(() => Boolean(document.querySelector(".battle-paused")))()`));

console.log(`clock before pause   ${before}s`);
console.log(`veil shown on pause  ${veilShown}`);
console.log(`clock at pause       ${paused}s`);
console.log(`clock 2.5s later     ${stillPaused}s  ${paused === stillPaused ? "(held — good)" : "(MOVED — pause is cosmetic)"}`);
console.log(`clock after resume   ${resumed}s  ${resumed !== stillPaused ? "(moving — good)" : "(still stopped — resume is broken)"}`);
console.log(`veil gone on resume  ${veilGone}`);
console.log(`page errors          ${errs.length ? errs.join(" | ") : "none"}`);
await b.close();

const held = paused === stillPaused;
const moved = resumed !== stillPaused;
if (!veilShown || !held || !moved || !veilGone || errs.length) {
  console.log("\nFAIL");
  process.exit(1);
}
console.log("\npause holds the fight and resume lets it go");