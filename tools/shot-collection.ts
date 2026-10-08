import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 15000 });
await page.evaluate(`(async () => {
  const g = window.__game; const store = g.store;
  store.state.breederLevel = 60; store.state.leafCoin = 9e7;
  const { SPECIES } = await import("/src/config/species.ts");
  for (let i = 0; i < 8; i++) { const id = SPECIES[i*997].id; store.state.seeds[id]=4; store.plantSeeds(id,1); }
  for (const p of store.state.plants) { p.growth.stage="mature"; p.growth.level=20; }
  g.navigate("collection");
})()`);
await page.waitForTimeout(700);
await page.screenshot({ path: ".shots-tmp/col-mine.png" });
await page.evaluate(`[...document.querySelectorAll(".seg button")].find(b=>b.textContent.includes("Bộ sưu tập"))?.click()`);
await page.waitForTimeout(500);
await page.screenshot({ path: ".shots-tmp/col-dex.png" });
await b.close(); console.log("done");
