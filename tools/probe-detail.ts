import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 460, height: 820 } });
await page.addInitScript(() => { window.__name = (f) => f; });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(600);
const base = await page.evaluate(`(() => {
  const shell = document.querySelector(".shell");
  const screen = document.querySelector(".screen");
  return {
    docScrolls: document.documentElement.scrollHeight > window.innerHeight,
    docHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    shellH: Math.round(shell.getBoundingClientRect().height),
    shellPos: getComputedStyle(shell).position,
    screenOverflowY: getComputedStyle(screen).overflowY,
    screenH: Math.round(screen.getBoundingClientRect().height),
  };
})()`);
console.log("layout:", JSON.stringify(base, null, 2));

// Tap a planted plot near the top and see where the sheet lands.
const pos = await page.evaluate(`(() => {
  const card = document.querySelector(".plantcard");
  if (!card) return "no plant";
  card.click();
  return "clicked";
})()`);
console.log(pos);
await page.waitForTimeout(500);
const sheet = await page.evaluate(`(() => {
  const s = document.querySelector(".sheet");
  if (!s) return null;
  const b = s.getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), visible: b.top < window.innerHeight && b.bottom > 0, scrollY: window.scrollY };
})()`);
console.log("detail sheet:", JSON.stringify(sheet));
await page.screenshot({ path: "shots/detail-check.png" });
await b.close();