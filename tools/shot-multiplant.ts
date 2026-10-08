/**
 * Garden + seed-picker screenshot with a spread of species planted, to check
 * the fuller foliage pass and the multi-plant stepper.
 */
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
  store.state.nurseryCap = 14;
  const { SPECIES } = await import("/src/config/species.ts");
  const ids = [];
  const step = Math.floor(SPECIES.length / 10);
  for (let i = 0; i < 10; i++) {
    const id = SPECIES[i * step].id;
    store.state.seeds[id] = 6;
    store.plantSeeds(id, 1);
  }
  const stages = ["seed", "sprout", "young", "mature", "awakened"];
  store.state.plants.forEach((p, i) => {
    p.growth.stage = stages[i % stages.length];
    p.growth.level = 15;
  });
  g.navigate("garden");
})()`);
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/garden-new.png" });

await page.evaluate(`(() => {
  const e = document.querySelector(".empty-plot");
  if (e) e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
})()`);
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/picker-new.png" });

// Bump the stepper up and plant a batch to see the batch ceremony.
await page.evaluate(`(() => {
  const btn = [...document.querySelectorAll(".seed-qty .btn")].find((x) => x.textContent === "+");
  for (let i = 0; i < 3; i++) btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
})()`);
await page.waitForTimeout(200);
await page.evaluate(`(() => {
  const cta = document.querySelector(".seed-cta");
  cta?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
})()`);
await page.waitForTimeout(800);
await page.screenshot({ path: "shots/batch-new.png" });
await b.close();
