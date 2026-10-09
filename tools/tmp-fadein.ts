import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(700);
await page.evaluate(`(() => {
  const g = window.__game;
  g.store.state.breederLevel = 14; g.store.state.leafCoin = 2_400_000;
  const ids = Object.keys(g.store.state.seeds).filter((id) => (g.store.state.seeds[id] || 0) > 0);
  let n = 0;
  for (const id of ids) { g.store.state.seeds[id] = 25; const r = g.store.plantSeed(id); if (r.ok) n++; if (n >= 8) break; }
  for (const p of g.store.state.plants) { p.growth.stage = "mature"; p.growth.level = 18; p.locks.manual = false; }
  g.navigate("garden");
})()`);
await page.waitForTimeout(900);
await page.evaluate(`document.querySelectorAll(".sheet").forEach(e => e.remove())`);
await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` });
const res = await page.evaluate(`(() => {
  const fadein = document.querySelector(".fadein");
  const fr = fadein.getBoundingClientRect();
  const out = [];
  // find the deepest overflowing ancestor chain
  for (const n of document.querySelectorAll(".fadein, .fadein *")) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const r = n.getBoundingClientRect();
      out.push({ cls: (n.getAttribute("class") || n.tagName).toString().slice(0, 40), sw: n.scrollWidth, cw: n.clientWidth, left: Math.round(r.left), right: Math.round(r.right), ow: getComputedStyle(n).overflowX });
    }
  }
  // children of fadein whose rect exceeds it
  const kids = [];
  for (const n of fadein.querySelectorAll("*")) {
    const r = n.getBoundingClientRect();
    if (r.right > fr.right + 1 || r.left < fr.left - 1) kids.push((n.getAttribute("class")||n.tagName).toString().slice(0,40) + " dr=" + Math.round(r.right - fr.right) + " dl=" + Math.round(fr.left - r.left));
  }
  return { fadein: { w: Math.round(fr.width), sw: fadein.scrollWidth }, overflowing: out.slice(0, 8), kidsBleed: kids.slice(0, 10) };
})()`);
console.log(JSON.stringify(res, null, 1));
await b.close();
