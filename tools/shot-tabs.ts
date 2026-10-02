/** Photograph the three new garden tabs. */
import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 1000 } });
await page.addInitScript(() => { window.__name = (f) => f; });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(400);
await page.evaluate(`(() => {
  const g = window.__game;
  g.store.state.nurseryCap = 24; g.store.state.breederLevel = 20; g.store.state.leafCoin = 8800;
  while (g.store.state.plants.length > 7) g.store.state.plants.pop();
  g.navigate("garden");
})()`);
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/tab-plots.png", fullPage: true });
for (const [label, file] of [["Hôm nay", "tab-today"], ["Túi hạt", "tab-seeds"]]) {
  await page.locator(".tabs .tab", { hasText: label }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/${file}.png`, fullPage: true });
}
const info = await page.evaluate(`(() => ({
  tabs: [...document.querySelectorAll(".tabs .tab")].map((t) => t.textContent),
  plots: document.querySelectorAll(".plots .plot").length,
}))()`);
console.log(JSON.stringify(info));
console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();