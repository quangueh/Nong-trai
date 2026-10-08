/** Screenshots of the breeding lab and a live battle, for the UI pass. */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERR", String(e)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game: unknown }).__game), { timeout: 15000 });
await page.waitForTimeout(500);
await page.evaluate(`(async () => {
  const g = window.__game;
  const store = g.store;
  store.state.breederLevel = 60;
  store.state.leafCoin = 90000000;
  store.state.pollen = 500;
  store.state.nurseryCap = 14;
  const { SPECIES } = await import("/src/config/species.ts");
  const step = Math.floor(SPECIES.length / 8);
  for (let i = 0; i < 8; i++) {
    const id = SPECIES[i * step].id;
    store.state.seeds[id] = 4;
    store.plantSeeds(id, 1);
  }
  for (const p of store.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
  g.navigate("breeding");
})()`);
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/lab-1.png" });

// Pick two parents via the real picker sheet.
for (const slotIndex of [0, 1]) {
  await page.evaluate(`(() => { document.querySelectorAll(".slot")[${slotIndex}].click(); })()`);
  await page.waitForSelector(".sheet .pickrow.pickcell:not(.is-blocked)", { timeout: 5000 });
  await page.evaluate(
    `(() => { document.querySelectorAll(".sheet .pickrow.pickcell:not(.is-blocked)")[${slotIndex === 0 ? 0 : 1}]?.click(); })()`,
  );
  await page.waitForTimeout(400);
}
await page.screenshot({ path: "shots/lab-2.png" });

// Arena lobby.
await page.evaluate(`(() => { window.__game.navigate("arena"); })()`);
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/battle-1.png" });

// PvE: Đấu với AI → pick plant → opponent preview → start → mid-battle.
await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Đấu với AI"));
  btn?.click();
})()`);
await page.waitForSelector(".sheet .pickrow.pickcell:not(.is-blocked)", { timeout: 5000 });
await page.evaluate(`(() => { document.querySelector(".sheet .pickrow.pickcell:not(.is-blocked)").click(); })()`);
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/battle-pick.png" });
await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Bắt đầu trận"));
  btn?.click();
})()`);
await page.waitForSelector(".battlefield", { timeout: 8000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: "shots/battle-2.png" });
await page.waitForTimeout(9000);
await page.screenshot({ path: "shots/battle-3.png" });
await b.close();
