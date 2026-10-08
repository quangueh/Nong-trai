import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 380, height: 760 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 15000 });
await page.evaluate(`(async () => {
  const g = window.__game; const store = g.store;
  store.state.breederLevel = 60; store.state.leafCoin = 9e7; store.state.nurseryCap = 14;
  const { SPECIES } = await import("/src/config/species.ts");
  for (let i = 0; i < 4; i++) { const id = SPECIES[i*1000].id; store.state.seeds[id] = 4; store.plantSeeds(id, 1); }
  for (const p of store.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
  g.navigate("breeding");
})()`);
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/m-lab.png" });
await page.evaluate(`(() => { window.__game.navigate("arena"); })()`);
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/m-arena.png", fullPage: true });
await b.close();
