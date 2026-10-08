/**
 * P7 acceptance pass — the final gate from docs/21 §P7 + docs/23 §10.
 *
 * One script, four sweeps, and it prints a verdict table instead of a pile of
 * PNGs nobody diffs:
 *
 *   1. Viewports 320 / 768 / 1280 / 1920 × the five tabs — horizontal-overflow
 *      and clipped-nav detection, plus a screenshot per cell.
 *   2. 200% zoom at 1280 — same checks (CSS px 640, so layout must hold).
 *   3. Preference matrix — solid / reduced-motion / lite-quality captures.
 *   4. Keyboard pass — Tab walk on the garden, every focused element must show
 *      a visible outline.
 *
 * Run: npx tsx tools/p7-acceptance.ts   (dev server must be up on :5173)
 */
import { chromium, type Page } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("shots/p7", { recursive: true });

interface Issue {
  where: string;
  what: string;
}
const issues: Issue[] = [];
const note = (where: string, what: string) => issues.push({ where, what });

const ROUTES = ["garden", "collection", "breeding", "arena", "lab"] as const;

/** Seeds a mid-game state so screens have real content, not empty states. */
const SEED = `(async () => {
  const g = window.__game;
  const store = g.store;
  store.state.breederLevel = 60;
  store.state.leafCoin = 9000000;
  store.state.pollen = 500;
  store.state.nectar = 4000;
  store.state.nurseryCap = 14;
  if (store.state.plants.length < 8) {
    const { SPECIES } = await import("/src/config/species.ts");
    const step = Math.floor(SPECIES.length / 8);
    for (let i = 0; i < 8; i++) {
      const id = SPECIES[i * step].id;
      store.state.seeds[id] = 4;
      store.plantSeeds(id, 1);
    }
  }
  for (const p of store.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
})()`;

async function checkLayout(page: Page, where: string): Promise<void> {
  const res = await page.evaluate(`(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth > de.clientWidth + 1;
    /* A nav that has left the viewport is the classic "it looked fine in the
       fullPage screenshot" failure — measure where it actually is. */
    const nav = document.querySelector(".bottomnav, .topnav");
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const navBad = navRect ? navRect.bottom < 0 || navRect.top > innerHeight + 1 : false;
    /* Any element poking past the right edge that is not intentionally
       off-canvas. Excused: content inside a horizontal scroller (its overflow
       is the feature), fixed chrome, and pure decoration — an element with no
       text and pointer-events:none clipped by a hidden-overflow ancestor is
       atmosphere, not a bug (the mist band bleeds ±6% by design). */
    let poke = 0;
    for (const el of document.querySelectorAll(".screen *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= innerWidth + 4) continue;
      if (el.closest(".sheet, .overlay, .toast")) continue;
      let excused = false;
      for (let a = el.parentElement; a && !a.classList.contains("screen"); a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto" || ox === "scroll") { excused = true; break; }
      }
      if (!excused && !el.textContent.trim() && getComputedStyle(el).pointerEvents === "none") excused = true;
      if (!excused) {
        poke++;
        if (poke <= 3) console.log("   poke:", el.tagName, el.className.toString().slice(0, 60), "right", Math.round(r.right));
      }
      if (poke > 6) break;
    }
    return { overflow, navBad, poke, sw: de.scrollWidth, cw: de.clientWidth };
  })()`);
  if (res.overflow) note(where, `horizontal overflow scrollWidth=${res.sw} > ${res.cw}`);
  if (res.navBad) note(where, "nav outside viewport");
  if (res.poke) note(where, `${res.poke} elements poke past right edge`);
}

async function visitAll(page: Page, tag: string, shot: boolean): Promise<void> {
  for (const r of ROUTES) {
    await page.evaluate(`window.__game.navigate("${r}")`);
    await page.waitForTimeout(450);
    await checkLayout(page, `${tag}/${r}`);
    if (shot) await page.screenshot({ path: `shots/p7/${tag}-${r}.png` });
  }
}

const b = await chromium.launch();

// ---- 1. viewport sweep -----------------------------------------------------
for (const w of [320, 768, 1280, 1920]) {
  const page = await b.newPage({ viewport: { width: w, height: Math.round(w * 0.72) } });
  page.on("pageerror", (e) => note(`vp${w}`, `pageerror: ${String(e).slice(0, 120)}`));
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate(SEED);
  await page.waitForTimeout(400);
  await visitAll(page, `vp${w}`, true);
  await page.close();
  console.log(`viewport ${w}: done`);
}

// ---- 2. 200% zoom ----------------------------------------------------------
{
  // deviceScaleFactor is not zoom: a real 200% zoom halves CSS px. Emulate by
  // halving the viewport — same layout pressure, honest measure.
  const page = await b.newPage({ viewport: { width: 640, height: 500 } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate(SEED);
  await page.waitForTimeout(400);
  await visitAll(page, "zoom200", true);
  await page.close();
  console.log("zoom 200%: done");
}

// ---- 3. preference matrix ---------------------------------------------------
{
  const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate(SEED);
  await page.waitForTimeout(300);

  const modes: [string, string][] = [
    ["solid", `document.documentElement.dataset.solid = "1"`],
    ["motion-reduce", `document.documentElement.dataset.motion = "reduce"`],
    ["quality-lite", `document.documentElement.dataset.quality = "lite"`],
  ];
  for (const [name, js] of modes) {
    await page.evaluate(js);
    await page.evaluate(`window.__game.navigate("garden")`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/p7/pref-${name}.png` });
    await checkLayout(page, `pref-${name}`);
    /* Verify the pref actually did something measurable: solid kills
       backdrop-filter, reduce kills running animations. */
    const check = await page.evaluate(`(() => {
      const solid = document.documentElement.dataset.solid === "1";
      const blur = getComputedStyle(document.querySelector(".card") || document.body).backdropFilter;
      const animating = document.getAnimations().filter((a) => a.playState === "running").length;
      return { solid, blur, animating };
    })()`);
    if (name === "solid" && check.blur !== "none" && check.blur !== "")
      note("pref-solid", `card still has backdrop-filter: ${check.blur}`);
    if (name === "motion-reduce" && check.animating > 4)
      note("pref-reduce", `${check.animating} animations still running`);
    await page.evaluate(`(() => {
      delete document.documentElement.dataset.solid;
      delete document.documentElement.dataset.motion;
      delete document.documentElement.dataset.quality;
    })()`);
  }
  await page.close();
  console.log("prefs: done");
}

// ---- 4. keyboard pass -------------------------------------------------------
{
  const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate(SEED);
  await page.evaluate(`window.__game.navigate("garden")`);
  await page.waitForTimeout(400);

  let noFocus = 0;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    const vis = await page.evaluate(`(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return "body";
      const cs = getComputedStyle(a);
      const hasRing = cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" && cs.outlineColor !== "transparent";
      const hasShadow = cs.boxShadow !== "none";
      return hasRing || hasShadow ? "ok" : "invisible";
    })()`);
    if (vis === "invisible") {
      const who = await page.evaluate(`document.activeElement ? document.activeElement.className + "|" + document.activeElement.tagName : "?"`);
      noFocus++;
      if (noFocus <= 4) note("keyboard", `focused element has no visible indicator: ${who}`);
    }
  }
  await page.screenshot({ path: "shots/p7/keyboard.png" });
  await page.close();
  console.log(`keyboard: ${noFocus} unfocused-visible stops`);
}

await b.close();

// ---- verdict ---------------------------------------------------------------
console.log("\n=== P7 VERDICT ===");
if (!issues.length) {
  console.log("clean — no overflow, nav in view, prefs effective, focus visible");
} else {
  for (const i of issues) console.log(`  ✗ [${i.where}] ${i.what}`);
}
writeFileSync("shots/p7/report.json", JSON.stringify({ issues, at: new Date().toISOString() }, null, 2));
process.exit(issues.length ? 1 : 0);
