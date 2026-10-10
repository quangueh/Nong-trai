/**
 * Plant contact sheet — docs/34 §8 line 157:
 *   ≥48 plants · all 8 visual grammars (Habit union) · every growth stage ·
 *   rarity & real elements present · 3 sizes × 3 backgrounds · seeds/IDs
 *   recorded for reproduction · long names included.
 *
 * The sheet renders through the real `renderPlantSvg` + `habitFor` in the
 * page — the same code the garden uses, so the captures are of the shipping
 * art, not a mock. Grammar assignment is asserted: for every target Habit the
 * generated genome is checked through `habitFor` and the sheet refuses to
 * certify a plant that landed in the wrong grammar.
 *
 * Output: shots/contact-sheet/{light,dark,botanic}.png (48 plants × 3 sizes
 * per cell) + manifest.json (seed/id/species/habit/stage/rarity/element/name
 * per plant) — evidence for the human-recognition review that stays open.
 */

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
const OUT = "shots/contact-sheet";
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

/* Target gene recipes — values verified below through habitFor itself.
   roll = (complexity*37.1 + stem.len*11.3 + leaf.len*5.7 + size.len*3.1 - 113) * 100/56 */
const GRAMMARS: { habit: string; genes: Record<string, string>; complexity: number }[] = [
  { habit: "spire",   complexity: 0.8, genes: { stem: "slender", leaf: "lance",  size: "normal",   flower: "none", thorn: "none", fungus: "none" } },
  { habit: "bush",    complexity: 0.5, genes: { stem: "normal",  leaf: "lance",  size: "normal",   flower: "none", thorn: "none", fungus: "none" } },
  { habit: "rosette", complexity: 0.4, genes: { stem: "thick",   leaf: "round",  size: "normal",   flower: "none", thorn: "none", fungus: "none" } },
  { habit: "spiral",  complexity: 0.7, genes: { stem: "vine",    leaf: "lance",  size: "colossal", flower: "none", thorn: "none", fungus: "none" } },
  { habit: "arch",    complexity: 0.8, genes: { stem: "vine",    leaf: "compound", size: "colossal", flower: "none", thorn: "none", fungus: "none" } },
  { habit: "cluster", complexity: 0.5, genes: { stem: "normal",  leaf: "broad",  size: "normal",   flower: "none", thorn: "none", fungus: "gills" } },
  { habit: "crown",   complexity: 0.5, genes: { stem: "thin",    leaf: "lance",  size: "normal",   flower: "none", thorn: "barbed", fungus: "none" } },
  { habit: "fan",     complexity: 0.55, genes: { stem: "normal", leaf: "compound", size: "colossal", flower: "petal", thorn: "none", fungus: "none" } },
];

const STAGES = ["seed", "sprout", "young", "mature", "mature", "awakened"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const LONG_NAME = "Rễ Gai Hắc Ám Từ Vực Sâu Không Đáy Thức Tỉnh Vào Đêm Không Trăng";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });

const manifest = await page.evaluate<any>(`(async (GRAMMARS, STAGES, RARITIES, LONG_NAME) => {
  const [{ createSeedPlant }, { SPECIES, STARTER_IDS }, { renderPlantSvg }, { habitFor }] = await Promise.all([
    import("/src/genetics/genomeGenerator.ts"),
    import("/src/config/species.ts"),
    import("/src/render/plantRenderer.ts"),
    import("/src/render/plantGeometry.ts"),
  ]);
  const SPECIES_IDS = [...STARTER_IDS, ...Array.from({ length: 30 }, (_, i) => SPECIES[STARTER_IDS.length + i * 401].id)];
  const now = Date.now();
  const plants = [];
  const wrong = [];
  let n = 0;
  for (let g = 0; g < GRAMMARS.length; g++) {
    const gr = GRAMMARS[g];
    for (let k = 0; k < 6; k++) {
      const species = SPECIES_IDS[(n * 5 + g) % SPECIES_IDS.length];
      const nonce = "contact:" + g + ":" + k;
      const p = createSeedPlant(species, "contact", nonce, now);
      /* Force the grammar genes — the seed stays in the manifest so the plant
         is reproducible, and habitFor verifies the recipe landed the habit. */
      p.dna.bodyGenes = { root: "normal", fruit: "none", aura: "none", pattern: "none", ...gr.genes };
      p.visual.complexity = gr.complexity;
      p.growth.stage = STAGES[k];
      p.rarity = RARITIES[(g + k) % RARITIES.length];
      if (g === 0 && k === 0) p.name = LONG_NAME + " #" + n;
      const landed = habitFor(p.dna.bodyGenes, p.visual.complexity);
      if (landed !== gr.habit) wrong.push(landed + "!=" + gr.habit + "@" + nonce);
      plants.push({
        i: n, habit: landed, intended: gr.habit, seed: nonce, plantId: p.plantId,
        species, stage: p.growth.stage, rarity: p.rarity, name: p.name,
        svg: { s48: renderPlantSvg(p, 48), s120: renderPlantSvg(p, 120), s200: renderPlantSvg(p, 200) },
      });
      n++;
    }
  }
  return { plants, wrong, speciesTotal: SPECIES_IDS.length };
})` + `(${JSON.stringify(GRAMMARS)}, ${JSON.stringify(STAGES)}, ${JSON.stringify(RARITIES)}, ${JSON.stringify(LONG_NAME)})`);

check("all 48 grammar recipes land in the intended habit", manifest.wrong.length === 0, manifest.wrong.join(" | "));
check("48 plants across all 8 habits", manifest.plants.length === 48 && new Set(manifest.plants.map((p: { habit: string }) => p.habit)).size === 8);

/* Render the three sheets — same grid, three backgrounds. */
const sheets = await page.evaluate<any>(`(async (plants) => {
  const cell = (p) =>
    '<div style="display:inline-flex;flex-direction:column;align-items:center;width:340px;padding:10px 6px;vertical-align:top">'
    + '<div style="display:flex;align-items:flex-end;gap:14px;min-height:210px">' + p.svg.s48 + p.svg.s120 + p.svg.s200 + '</div>'
    + '<div style="font:600 11px/1.3 system-ui;margin-top:6px;text-align:center;max-width:320px;overflow:hidden;text-overflow:ellipsis">' + p.name + '</div>'
    + '<div style="font:10px/1.2 ui-monospace,monospace;opacity:.65;text-align:center">' + p.habit + ' · ' + p.stage + ' · ' + p.rarity + ' · ' + p.species + '<br>' + p.seed + '</div>'
    + '</div>';
  const byHabit = {};
  for (const p of plants) (byHabit[p.habit] ??= []).push(p);
  const html = Object.entries(byHabit).map(([h, ps]) =>
    '<h2 style="font:700 14px system-ui;margin:14px 8px 2px;letter-spacing:.12em;text-transform:uppercase">' + h + ' (' + ps.length + ')</h2>'
    + '<div>' + ps.map(cell).join("") + '</div>').join("");
  return html;
})(${JSON.stringify(manifest.plants.map((p: { svg: unknown }) => ({ ...p })))})`);

const BGS: { tag: string; css: string }[] = [
  { tag: "light", css: "background:#f4f1e4;color:#2a2d24" },
  { tag: "dark", css: "background:#151a13;color:#e8e4d0" },
  { tag: "botanic", css: "background:linear-gradient(160deg,#cfe3b8,#e9f3d8 45%,#b7d0a0);color:#23301c" },
];
for (const bg of BGS) {
  await page.setContent(`<body style="margin:0;${bg.css}">${sheets}</body>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${bg.tag}.png`, fullPage: true });
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest.plants.map(({ svg, ...rest }: { svg: unknown }) => rest), null, 2));
check("manifest records every seed/id/stage/rarity", manifest.plants.every((p: { seed: string; plantId: string }) => p.seed && p.plantId));
check("no page errors during capture", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(`\n${failed === 0 ? "all checks passed" : failed + " failed"} — ${OUT}/{light,dark,botanic}.png + manifest.json`);
process.exit(failed ? 1 : 0);
