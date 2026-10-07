/**
 * Quick-action dock screenshots.
 *
 * `tools/shot.ts` walks the default screens; this one exercises the states the
 * dock adds that no screen shot covers: unarmed vs armed, the context chips,
 * the per-card cooldown marks, and the mobile thumb-zone layout.
 *
 * Usage:
 *   npx tsx tools/shot-qabar.ts            # desktop + mobile set
 *   npx tsx tools/shot-qabar.ts --out shots
 *   npx tsx tools/shot-qabar.ts --url http://localhost:5175
 */
import { chromium, type Browser } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const val = (f: string, d: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OUT = resolve(val("--out", "shots"));
const URL = val("--url", "http://localhost:5175");
mkdirSync(OUT, { recursive: true });

/** A garden with plants at mixed stages and plenty of supplies to care with. */
const SEED = () => {
  const g = (window as unknown as { __game: any }).__game;
  const s = g.store;
  s.state.leafCoin = 900000;
  s.state.geneCrystal = 400;
  s.state.items = 900;
  s.state.breederLevel = 60;
  s.state.nurseryCap = 24;
  const species = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud"];
  for (const sp of species) s.buySeed(sp, 8);
  let guard = 0;
  while (s.state.plants.length < 6 && guard++ < 30) {
    if (!s.plantSeed(species[s.state.plants.length % species.length]).ok) break;
  }
  // A realistic mix: some growing, some mature — so the chips have both
  // "cây sẵn sàng đấu" and tendable plants to count.
  s.state.plants.forEach((p: any, i: number) => {
    if (i % 2 === 0) {
      p.growth.stage = "mature";
      p.growth.stageReadyAt = Date.now();
      p.growth.level = 30;
    }
    p.locks.manual = false;
  });
  s.save();
  g.navigate("garden");
};

const click = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel);
  el?.click();
  return el ? el.textContent : null;
};

async function run(browser: Browser, tag: string, w: number, h: number): Promise<void> {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() => {
    (window as unknown as { __name?: (f: unknown) => unknown }).__name = (f) => f;
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate(SEED);
  await page.waitForTimeout(500);

  const info = (await page.evaluate(`(() => {
    const bar = document.querySelector(".qabar");
    const dock = document.querySelector(".qadock");
    const nav = document.querySelector(".bottomnav");
    const r = (n) => n ? n.getBoundingClientRect() : null;
    return {
      buttons: [...document.querySelectorAll(".qabtn")].map((b) => b.textContent.trim()),
      chips: [...document.querySelectorAll(".qachip")].map((c) => c.textContent.trim()),
      bar: r(bar), dock: r(dock), nav: r(nav),
      docH: document.documentElement.scrollHeight, viewH: window.innerHeight,
    };
  })()`)) as {
    buttons: string[]; chips: string[];
    bar: DOMRect | null; dock: DOMRect | null; nav: DOMRect | null;
    docH: number; viewH: number;
  };
  console.log(`  [${tag}] buttons: ${info.buttons.join(" | ")}`);
  console.log(`  [${tag}] chips: ${info.chips.join(" | ") || "(none)"}`);
  if (info.bar && info.nav) {
    const overlap = Math.max(0, info.bar.bottom - info.nav.top);
    console.log(`  [${tag}] dock bottom ${Math.round(info.bar.bottom)} vs nav top ${Math.round(info.nav.top)} — overlap ${Math.round(overlap)}px`);
  }
  await page.screenshot({ path: `${OUT}/qabar-${tag}-idle.png` });

  // Arm the water tool: the dock should show the selected state, a status chip
  // naming the tool, a "Tưới tất cả" action chip, and outlines on tendable cards.
  console.log(`  [${tag}] arm water ->`, await page.evaluate(`(${click.toString()})(".qabtn[data-tool='water']")`));
  await page.waitForTimeout(350);
  const armed = (await page.evaluate(`(() => {
    return {
      chips: [...document.querySelectorAll(".qachip")].map((c) => c.textContent.trim()),
      canTend: document.querySelectorAll(".plantcard.can-tend").length,
      cooling: document.querySelectorAll(".plantcard.cooling").length,
      armed: [...document.querySelectorAll(".qabtn.armed")].map((b) => b.textContent.trim()),
    };
  })()`)) as { chips: string[]; canTend: number; cooling: number; armed: string[] };
  console.log(`  [${tag}] armed: ${armed.armed.join("|")} — can-tend ${armed.canTend}, cooling ${armed.cooling}`);
  console.log(`  [${tag}] chips: ${armed.chips.join(" | ")}`);
  await page.screenshot({ path: `${OUT}/qabar-${tag}-armed.png` });

  // Tap the first tendable card: water applies in place, card flashes.
  const applied = (await page.evaluate(`(() => {
    const card = document.querySelector(".plantcard.can-tend");
    if (!card) return null;
    card.click();
    return card.querySelector(".plant-name, .name")?.textContent ?? "plant";
  })()`)) as string | null;
  await page.waitForTimeout(300);
  console.log(`  [${tag}] watered: ${applied ?? "nothing tendable"}`);
  await page.screenshot({ path: `${OUT}/qabar-${tag}-applied.png` });

  if (errors.length) console.log(`  [${tag}] PAGE ERRORS:`, errors);
  await page.close();
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  await run(browser, "desktop", 1180, 900);
  await run(browser, "mobile", 390, 844);
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
