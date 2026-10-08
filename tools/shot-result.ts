import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 15000 });
await page.evaluate(`(async () => {
  const g = window.__game; const store = g.store;
  store.state.breederLevel = 60; store.state.leafCoin = 9e7; store.state.nurseryCap = 14;
  const { SPECIES } = await import("/src/config/species.ts");
  for (let i = 0; i < 4; i++) { const id = SPECIES[i*1000].id; store.state.seeds[id] = 4; store.plantSeeds(id, 1); }
  for (const p of store.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
  g.navigate("arena");
})()`);
await page.waitForTimeout(500);
await page.evaluate(`(() => { [...document.querySelectorAll("button")].find(b => b.textContent.includes("Đấu với AI"))?.click(); })()`);
await page.waitForSelector(".sheet .pickrow:not(.is-blocked)");
await page.evaluate(`(() => { document.querySelector(".sheet .pickrow:not(.is-blocked)").click(); })()`);
await page.waitForTimeout(400);
await page.evaluate(`(() => { [...document.querySelectorAll("button")].find(b => b.textContent.includes("Bắt đầu trận"))?.click(); })()`);
await page.waitForSelector(".battlefield");
// crank speed: click the ⏩ button until 4x
await page.evaluate(`(() => { const s=[...document.querySelectorAll("button")].find(b=>b.textContent.includes("1x")); s?.click(); s?.click(); })()`);
await page.waitForSelector(".result-banner", { timeout: 60000 });
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/battle-result.png" });
await b.close();
