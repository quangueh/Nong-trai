/**
 * Viewport sweep — docs/34 §16: the seven required viewports across the core
 * screens, plus the landscape-phone axis the spec calls out separately.
 *
 *   viewports — 320×740, 390×844, 430×932, 768×1024, 1366×768, 1920×1080,
 *               844×390 landscape
 *   screens   — garden, collection, breeding, arena, ascent, leaderboard, lab
 *   overlays  — plant detail sheet + settings sheet on the smallest and one
 *               mid viewport, because an overlay that fits the viewport it was
 *               designed on is not the same as one that fits all of them
 *   fixture   — F09 (60-char Vietnamese names, large balances) seeded once per
 *               viewport so text pressure is real in every capture
 *
 * Automated per-capture checks: no horizontal overflow, bottom nav inside the
 * viewport, no page errors. Output: shots/viewport-sweep/<w>x<h>/<screen>.png
 * plus a JSON report — the captures are evidence for human review, the checks
 * are the gate.
 */

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { applyFixture } from "./fixtures";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
const OUT = "shots/viewport-sweep";

const VIEWPORTS = [
  { w: 320, h: 740, tag: "se" },
  { w: 390, h: 844, tag: "iphone12" },
  { w: 430, h: 932, tag: "iphone15" },
  { w: 768, h: 1024, tag: "ipad" },
  { w: 1366, h: 768, tag: "laptop" },
  { w: 1920, h: 1080, tag: "desktop" },
  { w: 844, h: 390, tag: "landscape" },
] as const;

const SCREENS = ["garden", "collection", "breeding", "arena", "ascent", "leaderboard", "lab"] as const;

interface ShotReport {
  viewport: string; screen: string; file: string;
  hOverflowPx: number; navInView: boolean | "n/a"; errors: number;
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const reports: ShotReport[] = [];
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const tag = `${vp.w}x${vp.h}-${vp.tag}`;
  console.log(`\n${tag}`);
  mkdirSync(`${OUT}/${tag}`, { recursive: true });
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await applyFixture(page, "F09");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });
  /* The check-in sheet auto-opens ~900ms after boot unless the "seen today"
     flag is set — set it before the attempt fires (same dayKey the store
     uses: local YYYY-MM-DD). */
  await page.evaluate<any>(`(() => {
    const d = new Date();
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    sessionStorage.setItem("ci-shown:" + key, "1");
  })()`);
  await page.waitForTimeout(700);
  /* The sign-in gate may also sit over a seeded account — dismiss it the way
     a player would. */
  await page.evaluate<any>(`(() => {
    document.querySelector(".gate-skip")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  })()`);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  for (const screen of SCREENS) {
    await page.evaluate<any>(`(() => (window).__game.navigate("${screen}"))()`);
    await page.waitForTimeout(650);
    const file = `${OUT}/${tag}/${screen}.png`;
    await page.screenshot({ path: file });
    const m = await page.evaluate<any>(`(() => {
      const doc = document.documentElement;
      const nav = document.querySelector(".bottomnav, .dock, nav");
      const nr = nav?.getBoundingClientRect();
      return {
        hOverflow: doc.scrollWidth - window.innerWidth,
        navInView: nr ? (nr.bottom <= window.innerHeight + 1 && nr.bottom > 0) : null,
      };
    })()`);
    reports.push({ viewport: tag, screen, file, hOverflowPx: Math.max(0, m.hOverflow), navInView: m.navInView ?? "n/a", errors: errs.length });
  }

  /* Overlay captures on the two sizes where they matter most. */
  if (vp.tag === "se" || vp.tag === "iphone15") {
    await page.evaluate<any>(`(() => (window).__game.navigate("garden"))()`);
    await page.waitForTimeout(400);
    await page.evaluate<any>(`(() => { document.querySelector(".plot-card, .plantcard, [data-plant-id]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`);
    await page.waitForTimeout(500);
    const sheetOpen = await page.evaluate<any>(`(() => {
      const s = document.querySelector(".sheet, [role=dialog]");
      if (!s) return false;
      const r = s.getBoundingClientRect();
      return r.width > 40 && r.top < window.innerHeight;
    })()`);
    if (sheetOpen) await page.screenshot({ path: `${OUT}/${tag}/overlay-detail.png` });
    check(`${tag} plant detail sheet opens inside the viewport`, sheetOpen === true);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);

    await page.evaluate<any>(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Cài đặt/.test(x.title ?? "") || /Cài đặt/.test(x.getAttribute("aria-label") ?? ""));
      b?.click();
    })()`);
    await page.waitForTimeout(500);
    const setOpen = await page.evaluate<any>(`(() => !!document.querySelector(".sheet, [role=dialog]"))()`);
    if (setOpen) await page.screenshot({ path: `${OUT}/${tag}/overlay-settings.png` });
    check(`${tag} settings sheet opens`, setOpen === true);
    await page.keyboard.press("Escape").catch(() => {});
  }

  const bad = reports.filter((r) => r.viewport === tag);
  const worstOverflow = Math.max(...bad.map((r) => r.hOverflowPx));
  check(`${tag} no horizontal overflow on any screen`, worstOverflow <= 1, `worst=${worstOverflow}px`);
  const navOff = bad.filter((r) => r.navInView === false).length;
  check(`${tag} bottom nav inside the viewport everywhere`, navOff === 0, `${navOff} screens off`);
  check(`${tag} no page errors`, bad.every((r) => r.errors === 0), `${errs.length} errors${errs.length ? ": " + errs[0] : ""}`);

  await page.close();
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(reports, null, 2));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed — captures in ${OUT}/`);
process.exit(failed === 0 ? 0 : 1);
