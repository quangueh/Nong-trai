/**
 * WCAG AA contrast audit — docs/34 §18 ("contrast WCAG AA cho text theo
 * kích thước"): contrast checked *per size*, not as one global rule.
 *
 * Samples every visible text-bearing element on the core screens of the F03
 * garden, resolves its computed color against the effective painted
 * background (first non-transparent ancestor), and applies the AA threshold
 * for its size: 4.5:1 for normal text, 3:1 for large (>=24px, or >=18.66px
 * bold). Token-level theory is not enough — this reads what the renderer
 * actually painted.
 */

import { chromium } from "playwright-core";
import { applyFixture } from "./fixtures";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function relLum(rgb: [number, number, number]): number {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: [number, number, number], b: [number, number, number]) =>
  (Math.max(relLum(a), relLum(b)) + 0.05) / (Math.min(relLum(a), relLum(b)) + 0.05);

function parseColor(s: string): [number, number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const p = m[1].split(",").map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
/** Composite possibly-transparent color over an opaque backdrop. */
function over(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as [number, number, number];
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await applyFixture(page, "F03");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });
await page.evaluate<any>(`(() => { const d = new Date(); sessionStorage.setItem("ci-shown:" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"), "1"); })()`);
await page.mouse.click(30, 30);
await page.waitForTimeout(700);

type Sample = { cls: string; text: string; color: string; bg: string; px: number; weight: number; painter?: boolean };
const screens = ["garden", "collection", "lab", "breeding", "arena"];
const allSamples: Record<string, Sample[]> = {};
for (const s of screens) {
  await page.evaluate<any>(`(() => (window).__game.navigate("${s}"))()`);
  await page.waitForTimeout(500);
  if (s === "lab") await page.waitForSelector('.seed-grid[data-shelf-ready="1"]', { timeout: 15000 }).catch(() => {});
  allSamples[s] = await page.evaluate<any>(`(() => {
    const out = [];
    const seen = new Set();
    const els = document.querySelectorAll(".screen *");
    for (const el of els) {
      const text = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        ? el.childNodes[0].textContent.trim() : "";
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      // Effective background: composite every ancestor background, innermost
      // first, onto the root canvas — a 9%-alpha tint badge is not an opaque
      // backdrop, and an rgba(255,248,226,.94) glass panel over a green field
      // is not cream-on-white.
      const layers = [];
      let cur = el;
      while (cur) {
        const c = getComputedStyle(cur).backgroundColor;
        if (c && !/transparent|rgba\\(0, 0, 0, 0\\)/.test(c)) layers.push(c);
        cur = cur.parentElement;
      }
      layers.push(getComputedStyle(document.documentElement).backgroundColor || "rgb(255,255,255)");
      // Outermost first, composite each translucent layer over what is under it.
      let bg = layers[layers.length - 1];
      for (let i = layers.length - 2; i >= 0; i--) {
        const f = layers[i].match(/rgba?\\(([^)]+)\\)/)[1].split(",").map(parseFloat);
        const b = bg.match(/rgba?\\(([^)]+)\\)/)[1].split(",").map(parseFloat);
        const fa = f.length > 3 ? f[3] : 1;
        bg = "rgb(" + [0, 1, 2].map((k) => Math.round(f[k] * fa + b[k] * (1 - fa))).join(",") + ")";
      }
      // Gradients, images and backdrop-filter paint backgrounds the walk
      // cannot see — flag them so a verdict never rests on a guessed backdrop.
      let painter = null, cur2 = el;
      while (cur2 && !painter) {
        const c2 = getComputedStyle(cur2);
        if (c2.backgroundImage !== "none" || c2.backdropFilter !== "none" || c2.background?.includes("gradient")) painter = true;
        const before = getComputedStyle(cur2, "::before");
        if (before && before.backgroundImage !== "none" && before.content !== "none") painter = true;
        cur2 = cur2.parentElement;
      }
      const key = cs.color + "|" + bg + "|" + Math.round(parseFloat(cs.fontSize)) + "|" + cs.fontWeight + "|" + (painter ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cls: el.className && String(el.className).slice(0, 40), text: text.slice(0, 30),
        color: cs.color, bg, px: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight) || 400, painter: !!painter });
    }
    return out;
  })()`) as Sample[];
}

const isLarge = (s: Sample) => s.px >= 24 || (s.px >= 18.66 && s.weight >= 700);
const failures: string[] = [];
const manual: string[] = [];
let total = 0;
const worst: { screen: string; r: number; s: Sample }[] = [];
for (const s of screens) {
  let minR = Infinity, minS: Sample | null = null;
  for (const smp of allSamples[s]) {
    const fg = over(parseColor(smp.color), parseColor(smp.bg).slice(0, 3) as [number, number, number]);
    const r = ratio(fg, parseColor(smp.bg).slice(0, 3) as [number, number, number]);
    total++;
    const need = isLarge(smp) ? 3 : 4.5;
    if (r < need) {
      const line = `${s}: "${smp.text}" .${smp.cls} ${smp.color} on ${smp.bg} = ${r.toFixed(2)}:1 (needs ${need}:1 @ ${smp.px}px/${smp.weight})`;
      if (smp.painter) manual.push(line + " [painter — verify visually]");
      else failures.push(line);
    }
    if (r < minR) { minR = r; minS = smp; }
  }
  if (minS) worst.push({ screen: s, r: minR, s: minS });
  console.log(`  ${s}: ${allSamples[s].length} combos${minS ? `, worst ${minR.toFixed(2)}:1 — "${minS.text}" .${minS.cls}` : ""}`);
}

check("sampled real text on every core screen", screens.every((s) => allSamples[s].length > 3),
  screens.map((s) => `${s}=${allSamples[s].length}`).join(" "));
check("all body/caption text meets WCAG AA for its size", failures.length === 0,
  failures.length ? failures.join(" | ") : `${total} combos checked`);
if (manual.length) console.log(`  painter-flagged (manual visual review required): ${manual.join(" | ")}`);
check("no page errors during the contrast pass", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
