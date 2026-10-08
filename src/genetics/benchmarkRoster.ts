/**
 * Fixed benchmark plants (docs/15 §14). These are the measuring sticks for ECR
 * and the balance pipeline. They are hand-built, deterministic, and never roll.
 */

import type { Plant, Stats } from "../core/types";
import type { BenchmarkId, CombatTier } from "../config/balance";
import { ELEMENTS, type ElementId } from "../config/elements";
import { STAT_GENES, SKILL_GENES } from "../config/species";
import { TIER_META } from "../config/balance";
import { BENCHMARK_TRAITS, type SkillFactory } from "./benchmarkTraits";
import { fitToBudget, estimatePower, validateGenome } from "./genomeGenerator";

function blankStats(partial: Partial<Stats>): Stats {
  return {
    hp: 280,
    attack: 48,
    defense: 44,
    speed: 38,
    skillPower: 42,
    crit: 0.1,
    evasion: 0.08,
    ...partial,
  };
}

/**
 * @param tier Battle tier the benchmark should be priced at. ECR is only
 *             meaningful within a tier, so callers pass the subject's tier.
 */
export function createBenchmarkPlant(id: BenchmarkId, tier: CombatTier = "bloom", powerScaleOverride?: number): Plant {
  const now = 0;
  const spec = BENCHMARK_TRAITS[id];
  // Re-price the hand-tuned shape for the requested tier. The ratios between
  // stats are the benchmark's identity; the absolute scale follows the tier.
  const tierScale = TIER_META[tier].reference;
  const baseScale = TIER_META.bloom.reference;
  const scaleStats = (s: Stats): Stats => ({
    hp: Math.round(s.hp * (tierScale.hp / baseScale.hp)),
    attack: Math.round(s.attack * (tierScale.attack / baseScale.attack)),
    defense: Math.round(s.defense * (tierScale.defense / baseScale.defense)),
    speed: Math.round(s.speed * (tierScale.speed / baseScale.speed)),
    skillPower: Math.round(s.skillPower * (tierScale.skillPower / baseScale.skillPower)),
    crit: s.crit,
    evasion: s.evasion,
  });

  const elementGenes = {} as Record<ElementId, number>;
  for (const el of ELEMENTS) elementGenes[el] = 0;
  for (const [el, share] of Object.entries(spec.elements) as [ElementId, number][]) {
    elementGenes[el] = share;
  }

  const sg = {} as Record<string, number>;
  for (const g of STAT_GENES) sg[g] = 0.5;
  Object.assign(sg, spec.statGenes ?? {});

  const skg = {} as Record<string, number>;
  for (const g of SKILL_GENES) skg[g] = 0.4;

  const archetype = {
    tank: 0,
    burst: 0,
    sustain: 0,
    control: 0,
    tempo: 0,
    counter: 0,
    ...spec.archetype,
  };
  const archTotal = Object.values(archetype).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(archetype) as (keyof typeof archetype)[]) {
    archetype[k] = archetype[k] / archTotal;
  }

  const powerScale = powerScaleOverride ?? tierScale.skillPower / baseScale.skillPower;
  const mk: SkillFactory = (skillId, name, delivery, effect, elements, power, cooldown, statusChance, statusDuration) => ({
    id: `bm_${skillId}`,
    name,
    core: { delivery, effect, elements, modifiers: [] },
    delivery,
    effect,
    modifiers: [],
    level: 5,
    masteryXp: 0,
    stability: 0.9,
    cooldown,
    power: Math.round(power * powerScale * 10) / 10,
    accuracy: 0.9,
    statusChance: statusChance ?? 0,
    statusDuration: statusDuration ?? 0,
    /* Sustain skills pay energy like the player's own (skillGenerator prices
       heal/shield at 18±) — a benchmark that casts for free measures a rigged
       fight: the subject spent real energy while the yardstick spent none. */
    energyCost: effect === "heal" || effect === "shield" ? 18 : 0,
    windup: 0.4,
    recovery: 0.3,
    budgetCost: 30,
    tags: [delivery, effect, ...elements],
    evolutionNodes: [],
    lineage: { inheritedFrom: [], fusion: false },
  });

  const plant: Plant = {
    plantId: `bm_${id}`,
    ownerId: "benchmark",
    name: spec.name,
    generation: 5,
    baseLineage: ["thornroot"],
    rarity: "A",
    rarityScore: 50,
    dna: {
      lineage: ["thornroot"],
      elementGenes,
      bodyGenes: {
        stem: "thick",
        leaf: "broad",
        root: "deep",
        flower: "none",
        fruit: "none",
        thorn: "barbed",
        fungus: "none",
        aura: "none",
        pattern: "veined",
        size: "normal",
      },
      statGenes: sg as never,
      skillGenes: skg as never,
      mutationGenes: { instability: 0.15, rarityLuck: 0.1, wildness: 0.2, purity: 0.8 },
      archetype: archetype as never,
      seed: `bench-${id}`,
    },
    visual: {
      hue: 110,
      hueSpread: 10,
      saturation: 0.5,
      lightness: 0.45,
      accentHue: 40,
      scale: 1,
      complexity: 0.5,
      pattern: "plain",
      aura: "none",
      size: "normal",
      eyeCount: 0,
      seedShape: "round",
    },
    growth: { stage: "mature", stageStartedAt: now, stageReadyAt: now, level: 20, xp: 0, careOpportunities: 0 },
    stats: scaleStats(blankStats(spec.stats)),
    potential: {},
    growthStats: { growthRate: 0.5, careEfficiency: 0.6, mutationChance: 0.08, breedingPower: 0.6, stability: 0.8 },
    hidden: { temperament: 0.5, wildness: 0.2, genePurity: 0.8, latentPower: 0.5, mutationDebt: 0 },
    skills: spec.skills(mk, powerScale),
    traits: spec.traits,
    mutations: [],
    parents: { a: null, b: null },
    archetype: archetype as never,
    tier,
    battleRecord: { wins: 0, losses: 0, draws: 0, scars: 0, streak: 0, bestStreak: 0 },
    careMemory: { recent: [], counts: {}, lastUse: {}, lastAction: null },
    stress: {},
    mood: "calm",
    powerRating: 500,
    validation: {
      buildValue: 190,
      tierBudget: TIER_META[tier].budget,
      ecr: 0.5,
      synergyTax: 0,
      invalidCombos: [],
      warnings: [],
      rankedLegal: true,
    },
    locks: { favorite: false, manual: true, battle: false, breeding: false, transaction: false },
    economy: { purchaseCost: 0, investedMaterialValue: 0, careCycles: 0, expectedSellPrice: 0 },
    createdAt: now,
    updatedAt: now,
  };

  // Benchmarks must sit at the same tier budget as the plants they measure,
  // otherwise ECR compares a priced build against an unpriced dummy.
  fitToBudget(plant);
  plant.validation = validateGenome(plant);
  plant.powerRating = Math.round(estimatePower(plant));
  return plant;
}
