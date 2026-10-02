/**
 * Photograph a level-up and an unlock banner.
 *
 * These are states the default seed never reaches, and the previous harness could
 * not produce them: `--unlocks` set the level by writing to state directly, which
 * skips `addBreederXp` and so skips the notice entirely. A screenshot taken that
 * way would show a correct-looking screen with the feature under test missing,
 * which is the failure mode this harness was rebuilt to avoid.
 *
 * The level is gained through the real XP path, one grant at a time, so the notice
 * channel fires the way it does in play.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
await page.addInitScript(() => {
  window.__name = (f) => f;
});

const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(500);

// Plant enough to look like a garden, then level through the real XP path.
await page.evaluate(`(() => {
  const g = window.__game;
  g.store.state.breederLevel = 1;
  g.store.state.breederXp = 0;
  g.navigate("garden");
})()`);
await page.waitForTimeout(400);

// Award XP in one go, through the method the game itself calls, so the notice
// channel and the render subscription fire exactly as they do from a quest
// payout. Starting from level 1 matters: a first jump of several levels is what
// opens a visible batch of species, and a jump from level 8 opens almost none.
await page.evaluate(`(() => {
  const g = window.__game;
  const before = g.store.state.breederLevel;
  g.store.addBreederXp(9000);
  window.__lvBefore = before;
})()`);
await page.waitForTimeout(500);

await page.screenshot({ path: "shots/notice-level.png" });

const report = await page.evaluate(`(() => {
  const host = document.querySelector(".notice-host");
  const cards = [...document.querySelectorAll(".notice")];
  const badge = document.querySelector(".levelbadge");
  return {
    before: window.__lvBefore,
    after: window.__game.store.state.breederLevel,
    notices: cards.length,
    titles: cards.map((c) => (c.querySelector(".notice-title")?.textContent ?? "")),
    speciesChips: document.querySelectorAll(".notice-species-chip").length,
    badgeNum: badge?.querySelector(".levelbadge-num")?.textContent ?? null,
    badgeBar: badge?.querySelector(".levelbadge-bar i")?.getAttribute("style") ?? null,
    badgeTitle: badge?.getAttribute("title") ?? null,
  };
})()`);
console.log(JSON.stringify(report, null, 2));

// And again a few seconds later, to catch the unlock banner on its own.
await page.waitForTimeout(2200);
await page.screenshot({ path: "shots/notice-unlock.png" });

const after = await page.evaluate(`(() => {
  const cards = [...document.querySelectorAll(".notice")];
  return {
    notices: cards.length,
    titles: cards.map((c) => (c.querySelector(".notice-title")?.textContent ?? "")),
    bodies: cards.map((c) => (c.querySelector(".notice-body")?.textContent ?? "")),
    speciesChips: document.querySelectorAll(".notice-species-chip").length,
    speciesSvgs: document.querySelectorAll(".notice-species-icon svg").length,
  };
})()`);
console.log("after wait:", JSON.stringify(after, null, 2));

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();