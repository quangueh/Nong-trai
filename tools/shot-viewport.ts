/**
 * Viewport-sized captures, never fullPage.
 *
 * Every screenshot taken before this one was `fullPage: true`, and that is exactly
 * how a 2,299px-tall layout with its navigation bar 2,299px down looked perfectly
 * fine in a PNG. So this harness refuses fullPage: the question it answers is "what
 * does a player see", and a full-page capture answers a different one.
 */
import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 460, height: 820 } });
await page.addInitScript(() => { window.__name = (f) => f; });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(600);

const nav = await page.evaluate(`(() => {
  const n = document.querySelector(".bottomnav");
  if (!n) return "no nav";
  const r = n.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.bottom <= window.innerHeight + 1 && r.top >= 0 };
})()`);
console.log("bottom nav:", JSON.stringify(nav));

await page.screenshot({ path: "shots/vp-garden.png" });

// The plant detail sheet — the thing that was invisible.
await page.evaluate(`(() => { document.querySelector(".plantcard")?.click(); })()`);
await page.waitForTimeout(450);
const sheet = await page.evaluate(`(() => {
  const s = document.querySelector(".sheet");
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { top: Math.round(r.top), h: Math.round(r.height), inView: r.top < window.innerHeight && r.bottom <= window.innerHeight + 1 };
})()`);
console.log("detail sheet:", JSON.stringify(sheet));
await page.screenshot({ path: "shots/vp-detail.png" });

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();