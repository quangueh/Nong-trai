/**
 * Species-registry report.
 *
 * Not a test — `tools/test-species.ts` asserts all of this. This dumps it in a
 * form a human can read: what the registry actually looks like, and whether the
 * shop and the garden are drawing from it evenly.
 *
 * Run: npx tsx tools/diag-species.ts
 */

import { writeFileSync } from "node:fs";
import {
  SPECIES,
  SPECIES_TOTAL,
  speciesAffinity,
  STARTER_IDS,
} from "../src/config/species";
import { ELEMENTS } from "../src/config/elements";
import { dominantElement } from "../src/config/elements";
import { createSeedPlant, breedPlants, genomeSignature, type BreedingContext } from "../src/genetics/genomeGenerator";
import { nameKey } from "../src/genetics/names";
import { unlockedTier, featuredSpecies, queryCatalogue } from "../src/economy/shop";

const words = (s: string) => s.split(" ").map((w) => w.toLowerCase());
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;

console.log(`\n=== REGISTRY ===`);
console.log(`species:        ${SPECIES.length} (declared ${SPECIES_TOTAL})`);
console.log(`unique ids:     ${new Set(SPECIES.map((s) => s.id)).size}`);
console.log(`unique names:   ${new Set(SPECIES.map((s) => nameKey(s.name))).size} (accent-insensitive)`);
console.log(`unique blurbs:  ${new Set(SPECIES.map((s) => s.blurb)).size}`);
console.log(
  `name quality:   ${SPECIES.filter((s) => new Set(words(s.name)).size !== words(s.name).length).length} repeat a word, ` +
    `${SPECIES.filter((s) => /\d/.test(s.name)).length} with a digit, ` +
    `${SPECIES.filter((s) => s.name.length > 26).length} over 26 chars`,
);

writeFileSync(
  "shots/species-names.txt",
  SPECIES.map((s) => [s.id, s.tier, s.archetype, s.name, s.blurb].join("\t")).join("\n"),
  "utf8",
);
console.log(`\nfull list -> shots/species-names.txt`);

console.log(`\n=== DISTRIBUTION ===`);
const byArchetype = new Map<string, number>();
const byElement = new Map<string, number>();
for (const s of SPECIES) {
  byArchetype.set(s.archetype, (byArchetype.get(s.archetype) ?? 0) + 1);
  const dom = dominantElement(speciesAffinity(s.id)).id;
  byElement.set(dom, (byElement.get(dom) ?? 0) + 1);
}
for (const [k, v] of [...byArchetype].sort()) console.log(`  ${k.padEnd(9)} ${String(v).padStart(4)}`);
console.log("");
for (const [k, v] of [...byElement].sort()) console.log(`  ${k.padEnd(9)} ${String(v).padStart(4)}  ${"█".repeat(Math.round(v / 6))}`);

console.log(`\n=== PRICE BY TIER ===`);
for (const t of [0, 1, 2, 3, 4]) {
  const rows = SPECIES.filter((s) => s.tier === t);
  const prices = rows.map((s) => s.seedPrice).sort((a, b) => a - b);
  const p50 = prices[Math.floor(prices.length / 2)];
  const at = (lvl: number) => (lvl >= TIER_UNLOCK_FOR(t) ? `unlocked at lvl ${lvl}` : "locked");
  console.log(
    `  tier ${t}  n=${String(rows.length).padStart(3)}  ` +
      `min ${String(prices[0]).padStart(3)}  p50 ${String(p50).padStart(3)}  max ${String(prices[prices.length - 1]).padStart(3)}  ` +
      `distinct ${String(new Set(prices).size).padStart(2)}`,
  );
  void at;
}

function TIER_UNLOCK_FOR(t: number): number {
  return [1, 8, 18, 30, 45][t] ?? 0;
}

console.log(`\n=== CATALOGUE BY LEVEL ===`);
for (const lvl of [1, 8, 12, 18, 30, 45, 60]) {
  const res = queryCatalogue({ playerId: "diag", breederLevel: lvl, perPage: 24 });
  console.log(
    `  level ${String(lvl).padStart(2)}  tier <= ${unlockedTier(lvl)}  ` +
      `${String(res.total).padStart(4)} species visible  ${res.pages} pages`,
  );
}

console.log(`\n=== FEATURED SHELF ===`);
for (const day of [20_000, 20_001, 20_002]) {
  const picks = featuredSpecies("diag-player", day, 12, 10);
  console.log(`  day ${day}: ${picks.map((s) => s.name).join(" · ")}`);
}

console.log(`\n=== BREEDING UNIQUENESS (generator only, no store) ===`);
const parents = STARTER_IDS.map((id) => {
  const p = createSeedPlant(id, "diag", `p${id}`, 0);
  p.growth.stage = "mature";
  p.growth.level = 25;
  return p;
});

const sigs = new Set<string>();
const names = new Map<string, number>();
const REQUESTS = 500;
let drawn = 0;
for (let i = 0; i < REQUESTS; i++) {
  const a = parents[i % parents.length];
  const b = parents[(i * 3 + 1) % parents.length];
  if (a.plantId === b.plantId) continue;
  const ctx: BreedingContext = {
    playerId: "diag",
    nonce: "n",
    attempt: i,
    tier: "bloom",
    targetRarity: "A",
    breederLevel: 1,
  };
  const child = breedPlants(a, b, ctx, 0).plant;
  drawn++;
  sigs.add(genomeSignature(child));
  const k = nameKey(child.name);
  names.set(k, (names.get(k) ?? 0) + 1);
}
const worstName = [...names.entries()].sort((x, y) => y[1] - x[1])[0];
console.log(`  children drawn:       ${drawn} (of ${REQUESTS} pairings; the rest paired a parent with itself)`);
console.log(`  distinct genomes:     ${sigs.size} (${pct(sigs.size, drawn)})`);
console.log(`  distinct names:       ${names.size} (${pct(names.size, drawn)})`);
console.log(`  most repeated name:   ${worstName?.[1]}x "${worstName?.[0]}"`);
console.log(
  `  note:                 the store adds a salt walk on top, so the shipped`,
);
console.log(`                        guarantee is 100% — see test-species.ts §8.`);

console.log(`\n  worst offenders:`);
for (const [n, c] of [...names.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)) {
  if (c > 1) console.log(`    ${c}x  ${n}`);
}
console.log("");

void ELEMENTS;