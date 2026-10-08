/** docs/23 §10 — the 12-plant human-review sheet: one plant per silhouette
 *  family at full size, so a reviewer judges shape before the change is
 *  multiplied across the catalogue. */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { SPECIES } from "../src/config/species";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { renderPlantSvg } from "../src/render/plantRenderer";
import { habitFor } from "../src/render/plantGeometry";
import type { Plant } from "../src/core/types";
import type { SpeciesId } from "../src/config/species";

mkdirSync("shots/art-bench", { recursive: true });

const plants: Plant[] = [];
const seen = new Set<string>();
for (let i = 0; i < SPECIES.length && seen.size < 8; i += 97) {
  const sp = SPECIES[i % SPECIES.length];
  const p = createSeedPlant(sp.id as SpeciesId, `rev:${i}`, `rev-${i}`, i * 31);
  p.growth.stage = "mature";
  p.growth.level = 40;
  const h = habitFor(p.dna.bodyGenes, p.visual.complexity);
  if (seen.has(h)) continue;
  seen.add(h);
  plants.push(p);
}
for (let i = 3000; plants.length < 12 && i < SPECIES.length; i += 131) {
  const sp = SPECIES[i % SPECIES.length];
  const p = createSeedPlant(sp.id as SpeciesId, `rev:${i}`, `rev-${i}`, i * 31);
  p.growth.stage = "awakened";
  p.growth.level = 60;
  plants.push(p);
}

const cells = plants
  .map((p, i) => {
    const h = habitFor(p.dna.bodyGenes, p.visual.complexity);
    return `<div class="cell"><div class="art">${renderPlantSvg(p, 300)}</div><div class="cap">#${i} ${p.name}<br><b>${h}</b> · ${p.growth.stage}</div></div>`;
  })
  .join("");
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:20px;font:12px system-ui;background:linear-gradient(180deg,#dcefc8,#b9dd9c)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.cell{text-align:center}.art{background:rgba(255,253,241,.55);border-radius:16px;border:1px solid rgba(38,53,29,.14)}
.cap{margin-top:6px;color:#33452b}
</style><div class="grid">${cells}</div>`;
writeFileSync("shots/art-bench/review12.html", html);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto("file:///" + process.cwd().replace(/\\/g, "/") + "/shots/art-bench/review12.html");
await page.screenshot({ path: "shots/art-bench/review12.png", fullPage: true });
await b.close();
console.log("review12 done");
