import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 15000 });
await page.evaluate(`(async () => {
  const g = window.__game; const s = g.store;
  s.state.breederLevel=60; s.state.leafCoin=9e7;
  const { SPECIES } = await import("/src/config/species.ts");
  for (let i=0;i<6;i++){ const id=SPECIES[i*1400].id; s.state.seeds[id]=4; s.plantSeeds(id,1); }
  for (const p of s.state.plants){ p.growth.stage="mature"; p.growth.level=25; }
  g.navigate("garden");
})()`);
await page.waitForTimeout(900);
await page.screenshot({ path: ".shots-tmp/garden-rim.png", clip: { x: 0, y: 280, width: 390, height: 420 } });
await b.close(); console.log("done");
