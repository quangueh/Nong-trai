import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 460, height: 820 } });
await page.addInitScript(() => { window.__name = (f) => f; });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(500);
await page.evaluate(`(() => { document.querySelector('.topbar .btn.ghost[title]').click(); })()`);
await page.waitForTimeout(400);
const r = await page.evaluate(`(() => {
  const o = document.querySelector(".overlay");
  const s = document.querySelector(".sheet");
  const g = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); const cs = getComputedStyle(n);
    return { z: cs.zIndex, pos: cs.position, top: Math.round(b.top), h: Math.round(b.height), display: cs.display }; };
  return { overlay: g(o), sheet: g(s), order: [...document.querySelector(".shell").children].map((n) => n.className) };
})()`);
console.log(JSON.stringify(r, null, 2));
await b.close();