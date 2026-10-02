/**
 * Why did ECR median move?
 *
 * ECR is `winRate*0.4 + damage*0.2 + survival*0.2 + control*0.2 - variancePenalty`,
 * and `variancePenalty` is capped at 0.2. If most plants hit that cap, ECR gets
 * dragged down by variance alone and the median stops saying anything about
 * power. This separates the two so the balance report's ECR line can be read
 * correctly instead of guessed at.
 *
 * Run: npx tsx tools/diag-ecr.ts
 */

import { Rng } from "../src/core/rng";
import { createSeedPlant, breedPlants } from "../src/genetics/genomeGenerator";
import { computeEcr } from "../src/genetics/ecrCalculator";
import { SPECIES } from "../src/config/species";
import type { CombatTier } from "../src/config/balance";
import { clamp } from "../src/core/rng";

const SPECIES_IDS = SPECIES.map((s) => s.id);
const TIERS: CombatTier[] = ["sprout", "bloom", "ancient"];
const N = 120;

function parentFor(rng: Rng, tier: CombatTier): ReturnType<typeof createSeedPlant> {
  const a = createSeedPlant(rng.pick(SPECIES_IDS), "ecrdiag", `${rng.next()}a`, 0);
  const b = createSeedPlant(rng.pick(SPECIES_IDS), "ecrdiag", `${rng.next()}b`, 0);
  for (const p of [a, b]) {
    p.growth.stage = "mature";
    p.growth.level = Math.round(4 + rng.next() * 40);
    p.tier = tier;
  }
  return a;
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const rng = new Rng("ecr-diag-v1");
const ecrs: number[] = [];
const ecrNoPenalty: number[] = [];
const penalties: number[] = [];
const stdDevs: number[] = [];
const winRates: number[] = [];
let capped = 0;

for (let i = 0; i < N; i++) {
  const tier = TIERS[i % TIERS.length];
  const child = breedPlants(
    parentFor(rng, tier),
    parentFor(rng, tier),
    { playerId: "ecrdiag", nonce: `${i}`, attempt: i, tier, targetRarity: "A" },
    0,
  ).plant;

  const r = computeEcr(child);
  ecrs.push(r.ecr);
  stdDevs.push(r.matchupStdDev);
  winRates.push(r.medianWinRate);

  const penalty = clamp(r.matchupStdDev * 1.5, 0, 0.2);
  penalties.push(penalty);
  if (penalty >= 0.2) capped++;
  ecrNoPenalty.push(clamp(r.ecr + penalty, 0, 1));
}

console.log(`\n=== ECR decomposition over ${N} random-registry breeds ===`);
console.log(`  median ECR (as shipped):   ${median(ecrs).toFixed(3)}`);
console.log(`  median ECR (+ penalty back): ${median(ecrNoPenalty).toFixed(3)}`);
console.log(`  median variance penalty:   ${median(penalties).toFixed(3)}  (cap 0.2)`);
console.log(`  plants hitting the cap:    ${capped}/${N}  (${((capped / N) * 100).toFixed(0)}%)`);
console.log(`  median matchup std dev:    ${median(stdDevs).toFixed(3)}`);
console.log(`  median win rate:           ${median(winRates).toFixed(3)}`);

console.log(`\n  reading:`);
const lift = median(ecrNoPenalty) - median(ecrs);
console.log(`    the variance penalty alone accounts for ${lift.toFixed(3)} of ECR.`);
if (capped / N > 0.5) {
  console.log(`    most plants are at the cap, so the ECR median is dominated by`);
  console.log(`    matchup variance (the open docs/15 target), not by power level.`);
}
console.log("");