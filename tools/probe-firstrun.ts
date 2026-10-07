/**
 * First-run funnel: what a brand-new save sees and can do in the first minute.
 * No seeded state, no level bumps — the honest boot.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/probe", { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(`try { sessionStorage.setItem("nong-trai-account-bypass", "1"); } catch {}`);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(900);
await page.screenshot({ path: "shots/probe/firstrun-boot.png" });

const state = await page.evaluate(`(() => {
  const s = (window).__game.store.state;
  return {
    plants: s.plants.length,
    seeds: JSON.stringify(s.seeds),
    coins: s.leafCoin,
    items: s.items,
    crystals: s.geneCrystal,
    plots: s.plots?.length ?? s.plots,
    quests: (s.quests?.list ?? s.quests?.active ?? []).length,
    weather: s.gardenDay?.weather,
    texts: [...document.querySelectorAll(".screen *")].map((n) => n.children.length === 0 && n.textContent?.trim()).filter(Boolean).slice(0, 40),
  };
})()`);
console.log("new-save state:", JSON.stringify(state, null, 1).slice(0, 3000));

// What does the seed stage read like — progress bar, stage label?
await page.waitForTimeout(3000);
await page.screenshot({ path: "shots/probe/firstrun-t3s.png" });
console.log("pageerrors:", errors.length ? errors : "none");
await b.close();
