/**
 * Art benchmark (docs/23 §10): a deterministic contact sheet for the plant
 * renderer. 48 plants across habits/elements/rarities/stages, each at
 * 96/160/320px on a neutral ground — the artefact a review can judge
 * silhouette, material and LOD by before changes are multiplied across the
 * catalogue.
 *
 *   npx tsx tools/art-bench.ts            → shots/art-bench.html + .png
 *
 * Deterministic by construction: species are picked at fixed strides and the
 * renderer's RNG is seeded off the plant id, so a re-run diffs meaningfully.
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { SPECIES } from "../src/config/species";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { renderPlantSvg } from "../src/render/plantRenderer";
import { habitFor } from "../src/render/plantGeometry";
import { RARITY_ORDER } from "../src/config/rarity";
import type { Plant } from "../src/core/types";
import type { SpeciesId } from "../src/config/species";

const N = 48;
const SIZES = [96, 160, 320];
const STAGES = ["young", "mature", "awakened"] as const;

mkdirSync("shots/art-bench", { recursive: true });

const plants: Plant[] = [];
for (let i = 0; i < N; i++) {
  const sp = SPECIES[(i * 397) % SPECIES.length];
  const p = createSeedPlant(sp.id as SpeciesId, `bench:${i}`, `bench-${i}`, i * 13);
  p.growth.stage = STAGES[i % STAGES.length];
  p.growth.level = 1 + ((i * 7) % 100);
  /*
   * Bench coverage, not gameplay truth: a fresh seed is always rarity C, so
   * the tier and gene spread are pinned directly to sweep the renderer's
   * envelope — rarity rims, complexity extremes, mutation density.
   */
  p.rarity = RARITY_ORDER[i % RARITY_ORDER.length];
  p.visual.complexity = Math.min(1, Math.max(0.2, 0.2 + ((i % 8) / 8) * 0.9));
  plants.push(p);
}

const cells = plants
  .map((p, i) => {
    const imgs = SIZES.map(
      (s) => `<div class="cell"><div class="art">${renderPlantSvg(p, s)}</div><div class="cap">${s}px</div></div>`,
    ).join("");
    return `<div class="row">
      <div class="meta"><b>#${i} ${p.name}</b><span>${p.rarity} · ${p.growth.stage} · ${habitFor(p.dna.bodyGenes, p.visual.complexity)} · ⚔${p.powerRating}</span></div>
      <div class="imgs">${imgs}</div>
    </div>`;
  })
  .join("");

const html = `<!doctype html><meta charset="utf-8"><style>
  body { margin:0; padding:24px; font:12px system-ui; background:linear-gradient(180deg,#dcefc8,#b9dd9c); }
  .row { display:flex; align-items:center; gap:16px; margin-bottom:14px; }
  .meta { width:210px; flex:none } .meta b { display:block } .meta span { color:#435636 }
  .imgs { display:flex; gap:14px; align-items:flex-end }
  .cell { text-align:center } .cap { color:#435636; font-size:10px; margin-top:2px }
  .art { background:rgba(255,253,241,.5); border-radius:14px; border:1px solid rgba(38,53,29,.12) }
</style><h2>Plant renderer — art benchmark (48 plants × 96/160/320px)</h2>${cells}`;

writeFileSync("shots/art-bench/sheet.html", html);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1360, height: 900 } });
await page.goto("file:///" + process.cwd().replace(/\\/g, "/") + "/shots/art-bench/sheet.html");
await page.screenshot({ path: "shots/art-bench/sheet.png", fullPage: true });
await b.close();

// Quick machine checks while the sheet renders: rarity spread + svg sanity.
const rarities = new Set(plants.map((p) => p.rarity));
const stages = new Set(plants.map((p) => p.growth.stage));
const allSvg = plants.every((p) => renderPlantSvg(p, 160).includes("<svg"));
const habits = plants.reduce<Record<string, number>>((m, p) => {
  const h = habitFor(p.dna.bodyGenes, p.visual.complexity);
  m[h] = (m[h] ?? 0) + 1;
  return m;
}, {});
console.log(`art-bench: ${plants.length} plants · rarities ${[...rarities].sort((a, b) => RARITY_ORDER.indexOf(a as never) - RARITY_ORDER.indexOf(b as never)).join("/")} · stages ${[...stages].join("/")} · all-svg ${allSvg}`);
console.log(`habits: ${Object.entries(habits).map(([h, n]) => `${h}×${n}`).join(" ")}`);
console.log("sheet → shots/art-bench/sheet.png");
