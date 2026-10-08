/** Baseline screenshots: every route, desktop + mobile, for the redesign audit. */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/baseline", { recursive: true });

const b = await chromium.launch();

for (const vp of [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game: unknown }).__game), { timeout: 15000 });
  await page.evaluate(`(async () => {
    const g = window.__game; const store = g.store;
    store.state.breederLevel = 60; store.state.leafCoin = 9e7; store.state.nurseryCap = 14;
    const { SPECIES } = await import("/src/config/species.ts");
    for (let i = 0; i < 8; i++) { const id = SPECIES[i*Math.floor(SPECIES.length/8)].id; store.state.seeds[id] = 4; store.plantSeeds(id, 1); }
    for (const p of store.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
  })()`);
  for (const route of ["garden", "collection", "breeding", "arena", "ascent", "lab", "leaderboard"]) {
    await page.evaluate(`window.__game.navigate("${route}")`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/baseline/${vp.name}-${route}.png` });
  }
  await page.close();
}
await b.close();
console.log("baseline done");
