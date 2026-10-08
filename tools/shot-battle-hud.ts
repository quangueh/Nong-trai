/** Battle HUD capture: the skill row mid-fight — energy meter, cooldown
   sweeps and cost chips, while the battle is actually running. */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
mkdirSync("shots/p7", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 160)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 20000 });
await page.waitForTimeout(400);
await page.evaluate(`(() => {
  const g = window.__game;
  g.store.state.breederLevel = 30;
  g.store.state.leafCoin = 500000;
  for (const id of ["thornroot", "emberleaf", "voltvine", "gloomcap"]) {
    g.store.state.seeds[id] = 4;
    g.store.plantSeed(id);
  }
  for (const p of g.store.state.plants) {
    p.growth.stage = "mature"; p.growth.level = 30; p.locks.manual = false;
  }
  g.navigate("arena");
})()`);
await page.waitForTimeout(700);
// Pick a fighter then start vs AI — the real buttons.
await page.evaluate(`(() => {
  const pick = [...document.querySelectorAll("button")].find((x) => /Đấu với AI/.test(x.textContent || ""));
  pick?.click();
})()`);
await page.waitForTimeout(600);
// If a fighter sheet/roster opened, confirm the first plant.
await page.evaluate(`(() => {
  const card = document.querySelector(".sheet .plantcard, .sheet [role=dialog] .plantcard") || document.querySelector(".roster-card");
  if (card) card.click();
  const start = [...document.querySelectorAll("button")].find((x) => /Bắt đầu|Đánh|Xác nhận/.test(x.textContent || "") && !x.disabled);
  start?.click();
})()`);
await page.waitForTimeout(4000);
await page.screenshot({ path: "shots/p7/battle-hud.png" });
// Verify meter wired: read the number + width.
const meter = await page.evaluate(`(() => {
  const m = document.querySelector(".energymeter");
  if (!m) return null;
  return {
    num: m.querySelector(".em-num")?.textContent,
    fill: (m.querySelector(".em-track i")).style.width,
    visible: m.getBoundingClientRect().width > 0,
  };
})()`);
console.log("energymeter:", JSON.stringify(meter));
await b.close();
