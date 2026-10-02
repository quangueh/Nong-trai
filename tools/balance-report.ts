/**
 * Balance pipeline (docs/15 §24, docs/08 §8).
 *
 * Generates a large sample of plants and reports the distribution of build
 * value, ECR, matchup win rate, rarity and timeout rate. This is the nightly CI
 * job that catches balance drift before players do.
 *
 * Run with: npm run balance -- [count]
 */

import { Rng, clamp } from "../src/core/rng";
import { createSeedPlant, breedPlants } from "../src/genetics/genomeGenerator";
import { computeEcr } from "../src/genetics/ecrCalculator";
import { simulateBattle } from "../src/battle/engine";
import { TIER_META, type CombatTier } from "../src/config/balance";
import { RARITY_ORDER, finalRarityWeights, type Rarity } from "../src/config/rarity";
import { SPECIES, type SpeciesId } from "../src/config/species";
import { TRAITS_BY_ID } from "../src/config/traits";
import type { Plant } from "../src/core/types";

const COUNT = Number(process.argv[2] ?? 300);
const SESSIONS = Number(process.argv[3] ?? 4);

const SPECIES_IDS = SPECIES.map((s) => s.id) as SpeciesId[];
const TIERS: CombatTier[] = ["sprout", "bloom", "ancient"];

function parentFor(rng: Rng, tier: CombatTier): Plant {
  const a = createSeedPlant(rng.pick(SPECIES_IDS), "bal", `${rng.next()}a`, 0);
  const b = createSeedPlant(rng.pick(SPECIES_IDS), "bal", `${rng.next()}b`, 0);
  for (const p of [a, b]) {
    p.growth.stage = "mature";
    p.growth.level = Math.round(4 + rng.next() * 40);
    p.tier = tier;
  }
  return a;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

const ratioToBudget: number[] = [];
const ecrs: number[] = [];
const winRates: number[] = [];
const stdDevs: number[] = [];
const rarityCounts = {} as Record<Rarity, number>;
const traitCounts = new Map<string, number>();
const skillEffectCounts = new Map<string, number>();
const skillDeliveryCounts = new Map<string, number>();
const warnings = new Map<string, number>();
let invalid = 0;
let illegal = 0;
let timeouts = 0;
let sims = 0;
const t0 = Date.now();

console.log(`\x1b[1mBalance report\x1b[0m — ${COUNT} plants, ${SESSIONS} sessions/opponent\n`);

const rng = new Rng("balance-pipeline-v1");
for (let i = 0; i < COUNT; i++) {
  const tier = TIERS[i % TIERS.length];
  const p1 = parentFor(rng, tier);
  const p2 = parentFor(rng, tier);
  // Sample the target band from the real rarity table so the reported
  // distribution matches what a player would actually see.
  const roll = rng.next();
  const w = finalRarityWeights(p1.growth.level, p2.growth.level, p1.rarity, p2.rarity);
  let acc = 0;
  let targetRarity: Rarity = "C";
  for (const r of RARITY_ORDER) {
    acc += w[r] / 10000;
    if (roll <= acc) {
      targetRarity = r;
      break;
    }
  }
  const plant = breedPlants(
    p1,
    p2,
    { playerId: "bal", nonce: `${i}`, attempt: i, tier, targetRarity },
    0,
  ).plant;

  // --- validity ---
  const v = plant.validation;
  const budget = TIER_META[plant.tier].budget;
  ratioToBudget.push(v.buildValue / budget);
  if (!v.rankedLegal) illegal++;
  if (invalidCombos(plant).length) invalid++;
  for (const w of v.warnings) warnings.set(w, (warnings.get(w) ?? 0) + 1);

  rarityCounts[plant.rarity] = (rarityCounts[plant.rarity] ?? 0) + 1;
  for (const t of plant.traits) traitCounts.set(t, (traitCounts.get(t) ?? 0) + 1);
  for (const s of plant.skills) {
    skillEffectCounts.set(s.effect, (skillEffectCounts.get(s.effect) ?? 0) + 1);
    skillDeliveryCounts.set(s.delivery, (skillDeliveryCounts.get(s.delivery) ?? 0) + 1);
  }

  // --- simulation (sample a subset for speed) ---
  if (i % Math.max(1, Math.floor(COUNT / 120)) === 0) {
    const report = computeEcr(plant, SESSIONS);
    ecrs.push(report.ecr);
    winRates.push(report.medianWinRate);
    stdDevs.push(report.matchupStdDev);

    // Timeout rate on a live match.
    const p2b = breedPlants(parentFor(rng, tier), parentFor(rng, tier), { playerId: "x", nonce: `${i}t`, attempt: 0, tier }, 0).plant;
    const res = simulateBattle(plant, p2b, { seed: `bal${i}`, maxSeconds: 90, arena: "sunny" });
    if (res.timeouts) timeouts++;
    sims++;
  }
}

function invalidCombos(p: Plant): string[] {
  const out: string[] = [];
  if (p.stats.evasion > 0.6) out.push("evasion_over_cap");
  let lock = 0;
  for (const s of p.skills) {
    if (s.effect === "stun" || s.effect === "root") lock += s.statusDuration * s.statusChance;
  }
  if (lock > 3) out.push("lock_too_long");
  if (p.traits.filter((t) => TRAITS_BY_ID[t]?.rarity === "unstable").length > 1) out.push("too_many_unstable");
  if (!Number.isFinite(p.powerRating) || p.powerRating <= 0) out.push("bad_power");
  return out;
}

// --- report ---------------------------------------------------------------

const line = (label: string, value: string) => console.log(`  ${label.padEnd(30)} ${value}`);

const ecrMed = percentile(ecrs, 50);
const wrMed = percentile(winRates, 50);
const sdMed = percentile(stdDevs, 50);

console.log("\x1b[1mBuild value / tier budget\x1b[0m");
line("p5", percentile(ratioToBudget, 5).toFixed(3));
line("median", percentile(ratioToBudget, 50).toFixed(3));
line("p95", percentile(ratioToBudget, 95).toFixed(3));
line("min / max", `${Math.min(...ratioToBudget).toFixed(3)} / ${Math.max(...ratioToBudget).toFixed(3)}`);
const inBand = ratioToBudget.filter((r) => r >= 0.9 && r <= 1.1).length / ratioToBudget.length;
line("within 0.90-1.10", `${(inBand * 100).toFixed(1)}%`);

console.log("\n\x1b[1mSimulated balance\x1b[0m");
line("plants simulated", String(ecrs.length));
line("ECR median", percentile(ecrs, 50).toFixed(3));
line("ECR p5 / p95", `${percentile(ecrs, 5).toFixed(3)} / ${percentile(ecrs, 95).toFixed(3)}`);
line("median win rate", percentile(winRates, 50).toFixed(3));
line("win rate p5 / p95", `${percentile(winRates, 5).toFixed(3)} / ${percentile(winRates, 95).toFixed(3)}`);
line("matchup std dev (median)", percentile(stdDevs, 50).toFixed(3));
line("timeout rate", `${((timeouts / Math.max(1, sims)) * 100).toFixed(1)}%  (budget < 8%)`);

// ECR subtracts a variance penalty capped at 0.2, and it is currently saturated
// for most plants — so the ECR median above is dominated by matchup variance
// rather than by power. Without this line the ECR verdict reads as a balance
// problem when it is really the open docs/15 §15 variance target showing through.
const penaltyCapped = stdDevs.filter((s) => clamp(s * 1.5, 0, 0.2) >= 0.2).length;
const medianLift = percentile(ecrs, 50) + 0.2;
line("variance penalty saturated", `${penaltyCapped}/${stdDevs.length}  (${((penaltyCapped / stdDevs.length) * 100).toFixed(0)}%)`);
line("ECR median, penalty removed", `${medianLift.toFixed(3)}  <- the power reading`);

console.log("\n\x1b[1mValidity\x1b[0m");
line("invalid combos", `${invalid}  ${invalid === 0 ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
line("not ranked-legal", `${illegal}  ${illegal === 0 ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);

console.log("\n\x1b[1mRarity distribution\x1b[0m");
for (const r of RARITY_ORDER) {
  const n = rarityCounts[r] ?? 0;
  const pct = (n / COUNT) * 100;
  const bar = "█".repeat(Math.round(pct / 1.5));
  console.log(`  ${r.padEnd(4)} ${String(n).padStart(5)}  ${pct.toFixed(2).padStart(6)}%  ${bar}`);
}

console.log("\n\x1b[1mTop traits\x1b[0m");
console.log(
  "  " +
    [...traitCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, n]) => `${TRAITS_BY_ID[id]?.name ?? id}(${n})`)
      .join(", "),
);
console.log("\n\x1b[1mSkill composition\x1b[0m");
console.log("  effects:   " + [...skillEffectCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(", "));
console.log("  deliveries:" + [...skillDeliveryCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}(${n})`).join(", "));

if (warnings.size) {
  console.log("\n\x1b[1mValidator warnings\x1b[0m");
  for (const [w, n] of [...warnings.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${w.padEnd(30)} ${n} (${((n / COUNT) * 100).toFixed(1)}%)`);
  }
}

// --- verdict --------------------------------------------------------------
// Hard guarantees the generator must always hold.
const hardChecks: [string, boolean, string][] = [
  ["no invalid gene combinations", invalid === 0, `${invalid}`],
  ["every build ranked-legal", illegal === 0, `${illegal}`],
  [">95% of builds inside +/-10% of budget", inBand > 0.95, `${(inBand * 100).toFixed(1)}%`],
  ["timeout rate under 8%", timeouts / Math.max(1, sims) < 0.08, `${((timeouts / Math.max(1, sims)) * 100).toFixed(1)}%`],
  ["ECR median in 0.35-0.65", ecrMed > 0.35 && ecrMed < 0.65, ecrMed.toFixed(3)],
];
// Tuning targets that docs/15 §24 closes with telemetry-driven playtesting.
const targets: [string, boolean, string][] = [
  ["win rate 47-53% (docs/15 §15)", wrMed > 0.47 && wrMed < 0.53, wrMed.toFixed(3)],
  ["matchup std dev <= 0.09 (docs/15 §15)", sdMed <= 0.09, sdMed.toFixed(3)],
];

const pass = hardChecks.every(([, ok]) => ok);

console.log("\n\x1b[1mVerdict\x1b[0m");
for (const [name, ok, value] of hardChecks) {
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${name.padEnd(42)} ${value}`);
}
console.log("  \x1b[2m-- tuning targets (need playtest telemetry) --\x1b[0m");
for (const [name, ok, value] of targets) {
  console.log(`  ${ok ? "\x1b[32mMET \x1b[0m" : "\x1b[33mOPEN\x1b[0m"} ${name.padEnd(42)} ${value}`);
}

console.log(`\n\x1b[1m${pass ? "\x1b[32mPASS" : "\x1b[31mFAIL"}\x1b[0m — completed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
process.exit(pass ? 0 : 1);
