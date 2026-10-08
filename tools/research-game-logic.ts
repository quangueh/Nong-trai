/** Reproducible diagnostics for the design review; no player saves or services. */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Rng } from "../src/core/rng";
import type { Plant } from "../src/core/types";
import { BREEDER_LEVEL_CAP, breederXpForPlantLevel } from "../src/core/store";
import { SPECIES } from "../src/config/species";
import { BENCHMARK_ROSTER, TIER_META } from "../src/config/balance";
import { RARITY_ORDER, emptyPity, finalRarityWeights, rarityWeightsForLevel, type Rarity } from "../src/config/rarity";
import { breedPlants, createSeedPlant, validateGenome } from "../src/genetics/genomeGenerator";
import { createBenchmarkPlant } from "../src/genetics/benchmarkRoster";
import { computeEcr } from "../src/genetics/ecrCalculator";
import { applyCare, gainXp, xpRequired } from "../src/growth/care";
import { CARE_ACTIONS, type CareActionId } from "../src/config/careActions";
import { simulateBattle } from "../src/battle/engine";
import { sellPrice } from "../src/economy/shop";
import { CURRENCY_IDS } from "../src/core/currency";
import { EMBER_DAILY_CAP } from "../src/core/drops";

const seed = "logic-research-2026-10-08-v1";
const rng = new Rng(seed);
const round = (n: number) => Math.round(n * 10000) / 10000;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rarityCounts = (): Record<Rarity, number> => ({ C: 0, B: 0, A: 0, S: 0, SS: 0, SSS: 0 });
const parent = (species: string, nonce: string, level: number) => {
  const p = createSeedPlant(species, "research", nonce, 0);
  p.growth.stage = "mature";
  p.growth.level = level;
  return p;
};
const xpToLevel = (level: number) => {
  let xp = 0;
  for (let i = 1; i < level; i++) xp += xpRequired(i);
  return xp;
};

const rarityTransitions = [];
for (const tier of ["seedling", "ancient"] as const) {
  for (const target of RARITY_ORDER) {
    const realized = rarityCounts();
    let inheritedTraits = 0;
    const scores: number[] = [];
    for (let i = 0; i < 100; i++) {
      const a = parent(rng.pick(SPECIES).id, `a:${tier}:${target}:${i}`, tier === "ancient" ? 40 : 5);
      const b = parent(rng.pick(SPECIES).id, `b:${tier}:${target}:${i}`, a.growth.level);
      a.traits = ["evade_reflex", "thick_bark"];
      b.traits = ["second_wind", "thick_bark"];
      const result = breedPlants(a, b, { playerId: "research", nonce: `${tier}:${target}:${i}`, attempt: i, tier, targetRarity: target }, 0);
      realized[result.plant.rarity]++;
      inheritedTraits += result.report.inheritedTraits.length;
      scores.push(result.plant.rarityScore);
    }
    rarityTransitions.push({ tier, target, sample: 100, realized, meanScore: round(mean(scores)), inheritedTraitReportTotal: inheritedTraits });
  }
}

const rarityOdds = [1, 10, 30, 60, 100].map((level) => ({
  level,
  baseSSSPercent: rarityWeightsForLevel(level).SSS / 100,
  finalSSSPercent: finalRarityWeights(level, level, "C", "C").SSS / 100,
}));
const hardPity = finalRarityWeights(100, 100, "SSS", "SSS", {
  breederLevel: BREEDER_LEVEL_CAP, geneDiversity: 1,
  pity: { ...emptyPity(), sinceSSS: 1000, totalBreeds: 1000 },
});

const inheritance = [5, 15, 30, 60, 100].map((level) => {
  const p = createSeedPlant("thornroot", "research", `xp:${level}`, 0);
  const inheritedXp = Math.round(level * 6) + 50;
  gainXp(p, inheritedXp);
  return { parentLevel: level, inheritedXp, childLevel: p.growth.level, childXp: p.growth.xp, oneParentCumulativeXp: xpToLevel(level), fractionOfOneParentXp: round(inheritedXp / xpToLevel(level)) };
});

const progressionBatch = [5, 15, 30].map((target) => ({
  targetLevel: target,
  oneBatchBreederXp: breederXpForPlantLevel(target),
  incrementalBreederXp: Array.from({ length: target - 1 }, (_, i) => breederXpForPlantLevel(i + 2)).reduce((a, b) => a + b, 0),
}));

const careProfiles: { name: string; actions: CareActionId[] }[] = [
  { name: "durability", actions: ["water", "fertilizer"] },
  { name: "damage", actions: ["sunlight", "pruning"] },
  { name: "skill", actions: ["music", "moonlight"] },
];
const careTrials = careProfiles.map((profile) => {
  const samples = [];
  for (let sample = 0; sample < 30; sample++) {
    const p = parent("thornroot", `care:${profile.name}:${sample}`, 1);
    const before = structuredClone(p);
    const costs = { leafCoin: 0, items: 0, geneCrystal: 0 };
    let phantomGains = 0;
    for (let step = 0; step < 160; step++) {
      const action = profile.actions[step % profile.actions.length];
      const old = structuredClone(p.growthStats);
      // A fixed future clock avoids real-clock neglect influencing these samples.
      const res = applyCare(p, action, 4_102_444_800_000 + step * 600_000, { leafCoin: 1e9, items: 1e9, geneCrystal: 1e9 });
      if (!res.ok) throw new Error(`Unexpected care refusal: ${res.reason}`);
      const cost = CARE_ACTIONS[action].cost;
      costs.leafCoin += cost.leafCoin ?? 0;
      costs.items += cost.items ?? 0;
      costs.geneCrystal += cost.geneCrystal ?? 0;
      for (const gain of res.gains) {
        if (gain.stat === "growthRate" && p.growthStats.growthRate === old.growthRate) phantomGains++;
        if (gain.stat === "mutationChance" && p.growthStats.mutationChance === old.mutationChance) phantomGains++;
      }
    }
    const v = validateGenome(p);
    const opponent = createBenchmarkPlant("balanced_neutral", p.tier);
    const beforeWins: number[] = [];
    const afterWins: number[] = [];
    for (let session = 0; session < 8; session++) {
      const cfg = { seed: `care-battle:${sample}:${session}`, maxSeconds: 90, arena: "sunny" as const };
      beforeWins.push(simulateBattle(before, opponent, cfg).winner === "a" ? 1 : 0);
      afterWins.push(simulateBattle(p, opponent, cfg).winner === "a" ? 1 : 0);
    }
    samples.push({ beforeBudgetRatio: validateGenome(before).buildValue / TIER_META[p.tier].budget, budgetRatio: v.buildValue / TIER_META[p.tier].budget, legal: v.rankedLegal, beforeWinRate: mean(beforeWins), afterWinRate: mean(afterWins), phantomGains, costs, level: p.growth.level, traitCount: p.traits.length });
  }
  return { profile: profile.name, plants: samples.length, actionsPerPlant: 160, medianBeforeBudgetRatio: round(median(samples.map((s) => s.beforeBudgetRatio))), medianBudgetRatio: round(median(samples.map((s) => s.budgetRatio))), rankedLegal: samples.filter((s) => s.legal).length, beforeWinRate: round(mean(samples.map((s) => s.beforeWinRate))), afterWinRate: round(mean(samples.map((s) => s.afterWinRate))), averagePhantomGains: round(mean(samples.map((s) => s.phantomGains))), costsPerPlant: samples[0].costs, medianLevel: median(samples.map((s) => s.level)), medianTraitCount: median(samples.map((s) => s.traitCount)) };
});

const mirrorBias = [];
for (const tier of ["seedling", "bloom", "ancient"] as const) {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  for (let i = 0; i < 120; i++) {
    const p = createBenchmarkPlant(BENCHMARK_ROSTER[i % BENCHMARK_ROSTER.length], tier);
    const result = simulateBattle(p, structuredClone(p), { seed: `mirror:${tier}:${i}`, maxSeconds: 90, arena: "sunny" });
    if (result.winner === "a") aWins++;
    else if (result.winner === "b") bWins++;
    else draws++;
  }
  mirrorBias.push({ tier, battles: 120, aWins, bWins, draws });
}

const matchupIds = ["tank_physical", "burst_fast", "sustain_heal", "control_lock", "tempo_onhit", "counter_reflect"] as const;
const matchupMatrix = matchupIds.map((id) => ({
  id,
  opponents: matchupIds.map((foeId) => {
    const a = createBenchmarkPlant(id, "bloom");
    const b = createBenchmarkPlant(foeId, "bloom");
    let score = 0;
    const firstSkills: number[] = [];
    const durations: number[] = [];
    for (let i = 0; i < 24; i++) {
      const reversed = i % 2 !== 0;
      const result = simulateBattle(reversed ? b : a, reversed ? a : b, { seed: `matrix:${[id, foeId].sort().join(":")}:${i}`, maxSeconds: 90, arena: "sunny" });
      const subjectSide = reversed ? "b" : "a";
      score += result.winner === subjectSide ? 1 : result.winner === "draw" ? 0.5 : 0;
      const first = result.events.find((event) => event.type === "SKILL_CAST_STARTED" && event.side === subjectSide);
      if (first) firstSkills.push(first.t);
      durations.push(result.durationSeconds);
    }
    return { id: foeId, winScore: round(score / 24), medianDuration: round(median(durations)), medianFirstSkill: round(median(firstSkills)), noSkillBattles: 24 - firstSkills.length };
  }),
}));

const economics = RARITY_ORDER.map((rarity) => {
  const prices: number[] = [];
  for (let i = 0; i < 60; i++) {
    const a = parent("thornroot", `price-a:${rarity}:${i}`, 15);
    const b = parent("emberleaf", `price-b:${rarity}:${i}`, 15);
    const result = breedPlants(a, b, { playerId: "research", nonce: `price:${rarity}:${i}`, attempt: i, tier: "bloom", targetRarity: rarity }, 0);
    result.plant.growth.stage = "mature";
    prices.push(sellPrice(result.plant));
  }
  return { target: rarity, medianChildSell: median(prices) };
});
const plainParents = [parent("thornroot", "opportunity-a", 15), parent("emberleaf", "opportunity-b", 15)];
const parentsSale = plainParents.reduce((sum, p) => sum + sellPrice(p), 0);

const identitySample: Plant = createBenchmarkPlant("balanced_neutral", "bloom");
const identityEcr = Array.from({ length: 12 }, (_, i) => {
  const p = structuredClone(identitySample);
  p.plantId = `same-build:${i}`;
  return computeEcr(p, 12).ecr;
});

const defenseProbe = [1, 2, 4].map((factor) => {
  const p = createBenchmarkPlant("balanced_neutral", "bloom");
  p.stats.defense *= factor;
  let score = 0;
  for (let i = 0; i < 160; i++) {
    const foe = createBenchmarkPlant("balanced_neutral", "bloom");
    const reverse = i % 2 !== 0;
    const result = simulateBattle(reverse ? foe : p, reverse ? p : foe, { seed: `defense-probe:${i}`, maxSeconds: 90, arena: "sunny" });
    score += result.winner === (reverse ? "b" : "a") ? 1 : result.winner === "draw" ? 0.5 : 0;
  }
  return { factor, defense: p.stats.defense, buildValue: validateGenome(p).buildValue, winScore: round(score / 160) };
});

const supportEnergyProbe = [0, 18, 26].map((cost) => {
  let score = 0;
  let casts = 0;
  const firstCastTimes: number[] = [];
  for (let i = 0; i < 120; i++) {
    const p = createBenchmarkPlant("sustain_heal", "bloom");
    for (const skill of p.skills) skill.energyCost = cost;
    const foe = createBenchmarkPlant("balanced_neutral", "bloom");
    const reverse = i % 2 !== 0;
    const side = reverse ? "b" : "a";
    const result = simulateBattle(reverse ? foe : p, reverse ? p : foe, { seed: `support-probe:${i}`, maxSeconds: 90, arena: "sunny" });
    score += result.winner === side ? 1 : result.winner === "draw" ? 0.5 : 0;
    const first = result.events.find((event) => event.type === "SKILL_CAST_STARTED" && event.side === side);
    if (first) { casts++; firstCastTimes.push(first.t); }
  }
  return { cost, samples: 120, winScore: round(score / 120), battlesWithAnyCast: casts, medianFirstCast: firstCastTimes.length ? median(firstCastTimes) : null };
});

const inheritedXpCandidate = [15, 30, 60, 100].map((level) => {
  const totalInvestment = xpToLevel(level) * 2;
  const inherited = Math.floor(totalInvestment * 0.3);
  const p = createSeedPlant("thornroot", "research", `xp-candidate:${level}`, 0);
  gainXp(p, inherited);
  return { parentLevel: level, preservedFractionOfCombinedXp: 0.3, inherited, childLevel: p.growth.level };
});

const catalogueCosts = CURRENCY_IDS.map((currency) => {
  const prices = SPECIES.filter((species) => species.currency === currency).map((species) => species.seedPrice);
  return { currency, speciesCount: prices.length, minPrice: Math.min(...prices), medianPrice: median(prices), maxPrice: Math.max(...prices), emberDaysAtDailyCap: currency === "ember" ? { cheapest: Math.ceil(Math.min(...prices) / EMBER_DAILY_CAP), median: Math.ceil(median(prices) / EMBER_DAILY_CAP) } : null };
});

const report = {
  seed,
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sampleCounts: { forcedRarityBreeds: 1200, saleQuoteBreeds: 360, carePlants: 90, careActions: 14400, diagnosticBattles: 4800 },
  caveats: ["Synthetic diagnostics, not observed player telemetry", "Care grants simulated with abundant resources; costs are measured, not deducted", "Current engine retains the known stance/cooldown/trait issues", "Benchmark matrix is not a random-player population"],
  rarityTransitions, rarityOdds, hardPityAt1000: hardPity,
  inheritance, inheritedXpCandidate, progressionBatch, careTrials, mirrorBias, matchupMatrix,
  defenseProbe, supportEnergyProbe, catalogueCosts,
  economics: { parentSaleTotal: parentsSale, fusionFee: Math.floor(parentsSale * 0.2), irreversibleOpportunityCost: parentsSale + Math.floor(parentsSale * 0.2), children: economics },
  identicalBuildEcr: { samples: identityEcr, min: Math.min(...identityEcr), max: Math.max(...identityEcr) },
  speedPayoff: [20, 40, 60, 80, 90, 100, 110].map((speed) => {
    /* Mirrors the engine's diminishing-returns curve (s/(s+K), anchored at
       speed 60 → 1.2s, asymptotic 0.9s floor) — the old linear 2.2−s/60 hit a
       hard wall at speed 102 and paid nothing past it. */
    const K = 60;
    const rate = (1 + speed / (speed + K)) / 1.5;
    const interval = Math.max(0.4, Math.min(2.4, 1.2 / rate));
    return { speed, interval, attacksPerSecond: round(1 / interval) };
  }),
};
const serialized = JSON.stringify(report, null, 2);
if (process.argv[2]) {
  writeFileSync(process.argv[2], `${serialized}\n`, "utf8");
  console.log(JSON.stringify({ output: process.argv[2], seed, sampleCounts: report.sampleCounts }, null, 2));
} else console.log(serialized);
