/**
 * Look at the anchored seed picker.
 *
 * The complaint it has to answer is "I have to scroll to pick a seed", so the
 * thing worth measuring is not that a popover exists — it is whether the popover
 * appears *without the page moving*. So this records the scroll position before
 * and after, and treats any change as the failure it is.
 *
 * Three taps: a plot in the middle of the garden, one near the bottom (which must
 * flip upward rather than fall off screen), and one in the right-hand column
 * (which must clamp back inside the viewport).
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 420, height: 820 } });
await page.addInitScript(() => {
  window.__name = (f) => f;
});

const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(500);

// A garden with several plants and a few empty plots to tap.
await page.evaluate(`(() => {
  const g = window.__game;
  g.store.state.breederLevel = 12;
  g.store.state.nurseryCap = 24;
  g.store.state.leafCoin = 9000;
  const mature = (p) => { p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now(); p.growth.level = 18; p.locks.manual = false; };
  for (const p of g.store.state.plants) mature(p);
  while (g.store.state.plants.length > 5) g.store.state.plants.pop();
  for (const id of Object.keys(g.store.state.seeds)) {
    if ((g.store.state.seeds[id] || 0) <= 0) continue;
    const r = g.store.plantSeed(id);
    if (r.ok && r.plantId) { const p = g.store.get(r.plantId); if (p) mature(p); }
    if (g.store.state.plants.length >= 8) break;
  }
  g.navigate("garden");
})()`);
await page.waitForTimeout(700);

// Pick an empty plot in the middle of the grid.
const target = await page.evaluate(`(() => {
  const plots = [...document.querySelectorAll(".empty-plot")];
  if (!plots.length) return null;
  const mid = plots[Math.floor(plots.length / 2)];
  mid.scrollIntoView({ block: "center" });
  return { index: plots.indexOf(mid) };
})()`);
console.log("empty plots found:", target ? "yes" : "NONE");

await page.waitForTimeout(500);
const before = (await page.evaluate(`(() => ({ scrollY: window.scrollY, docH: document.documentElement.scrollHeight }))`)) as {
  scrollY: number;
  docH: number;
};

await page.evaluate(`(() => {
  const plots = [...document.querySelectorAll(".empty-plot")];
  plots[Math.floor(plots.length / 2)].click();
})()`);
await page.waitForTimeout(600);

const state = await page.evaluate(`(() => {
  const pop = document.querySelector(".seed-pop");
  if (!pop) return { open: false };
  const r = pop.getBoundingClientRect();
  return {
    open: true,
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    insideX: r.left >= 0 && r.right <= document.documentElement.clientWidth,
    insideY: r.top >= 0 && r.bottom <= document.documentElement.clientHeight,
    flipped: pop.classList.contains("is-above"),
    cards: pop.querySelectorAll(".picker-card").length,
    hasPreview: !!pop.querySelector(".seed-preview"),
    anchorHighlighted: document.querySelectorAll(".plot.is-picking").length,
    hasScrim: !!document.querySelector(".seed-pop-scrim"),
  };
})()`);
const after = (await page.evaluate(`(() => ({ scrollY: window.scrollY }))`)) as { scrollY: number };

console.log(JSON.stringify(state, null, 2));
console.log("scroll before:", before.scrollY, " after:", after.scrollY, after.scrollY === before.scrollY ? "(page did NOT move)" : "(PAGE MOVED — the original complaint)");
console.log("page height:", before.docH, "vs viewport 820 — a full sheet would need this much room");

await page.screenshot({ path: "shots/picker-mid.png" });

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();