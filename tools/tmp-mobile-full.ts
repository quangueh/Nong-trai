import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
mkdirSync("shots/mobile-full", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 100)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 20000 });
await page.evaluate(`(async () => {
  const s = window.__game.store;
  s.state.breederLevel = 40; s.state.leafCoin = 9e6; s.state.pollen = 8888; s.state.nectar = 7777; s.state.ember = 66;
  s.state.nurseryCap = 12;
  const { SPECIES } = await import("/src/config/species.ts");
  for (let i = 0; i < 12 && s.state.plants.length < 12; i++) { const id = SPECIES[i*1100].id; s.state.seeds[id]=8; s.plantSeeds(id,1); }
  for (const p of s.state.plants) { p.growth.stage="mature"; p.growth.level=20; }
})()`);
await page.waitForTimeout(400);
// dismiss auth sheet if present
await page.evaluate(`[...document.querySelectorAll("button, a")].find(x=>x.textContent.includes("Chơi không cần"))?.click()`);
await page.waitForTimeout(300);

const scan = `(() => {
  const out = []; const vw = innerWidth, vh = innerHeight;
  // right-edge clips
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".scene-mist, [aria-hidden='true'], svg")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > vh) continue;
    let scroll = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === "auto" || ox === "scroll") { scroll = true; break; }
    }
    if (scroll) continue;
    const txt = (el.textContent||"").replace(/\\s+/g," ").slice(0,30);
    if (r.right > vw + 1) {
      if (!txt && r.width > 200) continue;
      out.push("R→ " + el.tagName+"."+String(el.className||"").split(" ")[0]+" '"+txt+"' r="+Math.round(r.right));
    }
    if (r.left < -1 && r.width < vw) {
      out.push("←L " + el.tagName+"."+String(el.className||"").split(" ")[0]+" '"+txt+"' l="+Math.round(r.left));
    }
    if (out.length >= 8) break;
  }
  // bottom-nav occlusion: any interactive element's center hidden under the nav?
  const nav = document.querySelector(".bottomnav");
  if (nav) {
    const nr = nav.getBoundingClientRect();
    for (const el of document.querySelectorAll("button, a, input, select")) {
      if (nav.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < nr.top + 4) continue;
      if (r.top > nr.bottom) continue;
      // visible part under nav
      const cy = Math.min(r.bottom - 2, nr.top + 8);
      const hit = document.elementFromPoint(r.left + r.width/2, cy);
      if (hit && nav.contains(hit)) {
        out.push("NAV che: " + el.tagName+"."+String(el.className||"").split(" ")[0]+" '"+(el.textContent||"").slice(0,25)+"'");
      }
    }
  }
  return out.slice(0, 12);
})()`;

async function shot(name, fn, waitMs = 450) {
  if (fn) await fn();
  await page.waitForTimeout(waitMs);
  const found = await page.evaluate(scan);
  console.log(`${name}:`, found.length ? "\n   " + found.join("\n   ") : "clean");
  await page.screenshot({ path: `shots/mobile-full/${name}.png` });
}

const nav = async (r) => page.evaluate(`window.__game.navigate("${r}")`);
const clickTxt = async (sel, s) => page.evaluate(`[...document.querySelectorAll("${sel}")].find(x=>x.textContent.includes(${JSON.stringify(s)}))?.click()`);

// main screens + scroll positions
for (const r of ["garden","collection","breeding","arena","lab"]) {
  await shot(r, () => nav(r));
  await shot(r+"-btm", () => page.evaluate(`document.querySelector(".screen")?.scrollTo(0,99999)`), 300);
  await page.evaluate(`document.querySelector(".screen")?.scrollTo(0,0)`);
}

// arena subs
await shot("arena-vuotai", () => clickTxt(".seg button", "Vượt ải"));
await shot("arena-xh", () => clickTxt(".seg button", "Xếp hạng"));

// sheets: settings, plant detail, picker
await nav("garden"); await page.waitForTimeout(300);
await shot("sheet-settings", () => page.evaluate(`[...document.querySelectorAll(".iconbtn")].find(x=>x.getAttribute("aria-label")==="Cài đặt")?.click()`));
await page.keyboard.press("Escape"); await page.waitForTimeout(250);
await shot("sheet-plant", () => page.evaluate(`document.querySelector(".plot")?.click()`), 500);
await page.keyboard.press("Escape"); await page.waitForTimeout(250);

// picker via breeding slot
await nav("breeding"); await page.waitForTimeout(300);
await shot("sheet-picker", () => page.evaluate(`document.querySelector(".slot")?.click()`), 500);
await page.keyboard.press("Escape"); await page.waitForTimeout(250);

// battle — pick AI, go through picker, watch mid-fight
await nav("arena"); await page.waitForTimeout(300);
await clickTxt("button", "Đấu với AI");
await page.waitForTimeout(400);
await page.evaluate(`[...document.querySelectorAll(".sheet button, .picker button, [class*='sheet'] button")].find(x=>x.closest("[class*='sheet'], .scrim"))?.click()`);
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/mobile-full/pick-opponent.png" });
// pick first plant in picker if sheet still open
await page.evaluate(`(() => { const sh = document.querySelector(".sheet, .scrim"); if (!sh) return; const btns=[...sh.querySelectorAll("button")]; const t=btns.find(b=>b.querySelector("svg")||b.textContent.includes("Lực")); t?.click(); })()`);
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/mobile-full/pre-fight.png" });
// click "Ra trận"/start
await page.evaluate(`[...document.querySelectorAll("button")].find(x=>/Ra trận|Đánh|Bắt đầu|Vào trận/.test(x.textContent))?.click()`);
await page.waitForTimeout(2500);
const clipFight = await page.evaluate(scan);
console.log("battle-mid:", clipFight.length ? "\n   " + clipFight.join("\n   ") : "clean");
await page.screenshot({ path: "shots/mobile-full/battle-mid.png" });
await b.close();
console.log("DONE");
