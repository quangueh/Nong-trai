/**
 * Screenshot the generated main-line quest cards — the new seed→plant→care→finale
 * chain with dynamic acquire hints (price, currency, gate).
 * Usage: npx tsx tools/shot-genquest.ts [--url http://localhost:5199]
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const val = (f: string, d: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OUT = resolve(val("--out", "shots"));
const URL = val("--url", "http://localhost:5199");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// Claim the fixed main line so the generated chain opens, and give the player
// enough currency/level that the picker's "open gate" preference can fire.
await page.evaluate(() => {
  const g = (window as unknown as { __game: any }).__game;
  const s = g.store;
  // Skip any gate/sheet overlay.
  document.querySelectorAll(".overlay, .sheet").forEach((n) => n.remove());
  s.state.breederLevel = 10;
  s.state.leafCoin = 500_000;
  s.state.nectar = 50_000;
  for (const id of ["main_01_plant", "main_02_care3", "main_03_win", "main_04_stage1", "main_05_breeder3", "main_06_breed", "main_07_stage5", "main_08_level5"]) {
    s.state.quests.entries[id] = { status: "claimed", progress: 1, claimedAt: Date.now() };
  }
  // Give the player stage 5 so some gates are met.
  s.state.ascent.highestStage = 5;
  s.commit();
});

// Reload so the quest engine re-derives views, then open the quests tab.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  document.querySelectorAll(".overlay, .sheet").forEach((n) => n.remove());
});

// Click the quests garden sub-tab — look for a tab labeled "Nhiệm vụ".
const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll("button, [role=tab]")];
  const t = els.find((e) => /nhiệm vụ/i.test(e.textContent ?? ""));
  if (t) { (t as HTMLElement).click(); return true; }
  return false;
});
await page.waitForTimeout(600);
console.log("quests tab clicked:", clicked);

const cards = await page.evaluate(() =>
  [...document.querySelectorAll(".quest-card")].slice(0, 8).map((c) => c.textContent?.slice(0, 220)),
);
console.log(JSON.stringify(cards, null, 1).slice(0, 4000));

await page.screenshot({ path: `${OUT}/genquest-mobile.png`, fullPage: false });
// Wider shot for the desktop card layout too.
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/genquest-desktop.png` });

console.log("page errors:", errs.length ? errs : "none");
await browser.close();
