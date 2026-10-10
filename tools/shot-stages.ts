/**
 * Render one species at all 5 growth stages side by side — for judging whether
 * the solver's stem-height shrink reads as "the plant got smaller".
 * Usage: npx tsx tools/shot-stages.ts [speciesId] [--out shots]
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const val = (f: string, d: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const OUT = resolve(val("--out", "shots"));
mkdirSync(OUT, { recursive: true });
const species = args[0] && !args[0].includes("=") ? args[0] : "emberleaf";

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;

const { GameStore } = await import("../src/core/store");
const { renderPlantSvg } = await import("../src/render/plantRenderer");

const store = new GameStore();
(store.state as any).nectar = 10_000_000;
store.state.leafCoin = 10_000_000;
(store.state as any).pollen = 10_000_000;
(store.state as any).ember = 10_000_000;
store.state.seeds[species as never] = 5;
const res = store.plantSeed(species as never);
if (!res.ok) throw new Error(res.reason);
const p = store.get(res.plantId!)!;
p.locks.manual = false;
p.growth.level = 20;

const stages = ["seed", "sprout", "young", "mature", "awakened"] as const;
const svgs: string[] = [];
for (const s of stages) {
  p.growth.stage = s;
  svgs.push(`<div style="display:inline-block;text-align:center">${renderPlantSvg(p, 180)}<div style="font:12px monospace">${s}</div></div>`);
}
const html = `<!doctype html><body style="background:#1a2410;display:flex;gap:8px;align-items:flex-end;padding:20px">${svgs.join("")}</body>`;
writeFileSync(`${OUT}/stages-${species}.html`, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 300 } });
await page.setContent(html);
await page.screenshot({ path: `${OUT}/stages-${species}.png` });
await browser.close();
console.log(`shots/stages-${species}.png`);
