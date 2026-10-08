/** Core data model (docs/06 §4, docs/01 §7, docs/12 §17). */

import type { ElementId } from "../config/elements";
import type { Archetype, BodyGeneId, SkillGeneId, SpeciesId, StatGeneId } from "../config/species";
import type { CombatTier, Stats } from "../config/balance";
import type { Delivery, EffectKind, ModifierId } from "../config/skills";
import type { Mood, StressKind } from "../config/careActions";
import type { MutationTier, Rarity } from "../config/rarity";

/**
 * The stock player name every fresh save starts with.
 *
 * Treated as "no name chosen" rather than as a name: the leaderboard and the
 * account sync both fall through it to the account's email prefix, and signing
 * in replaces it. Shared between the client and the account Worker so the two
 * never disagree about what counts as a placeholder.
 */
export const DEFAULT_PLAYER_NAME = "Nhà Lai Tạo";

export type GrowthStage = "seed" | "sprout" | "young" | "mature" | "awakened";

export const STAGE_ORDER: readonly GrowthStage[] = ["seed", "sprout", "young", "mature", "awakened"];

export const STAGE_LABEL: Record<GrowthStage, string> = {
  seed: "Hạt",
  sprout: "Mầm",
  young: "Non",
  mature: "Trưởng thành",
  awakened: "Thức tỉnh",
};

/** Compressed MVP timers in seconds (docs/12 §3). */
export const STAGE_SECONDS: Record<GrowthStage, number> = {
  seed: 15,
  sprout: 60,
  young: 180,
  mature: 0,
  awakened: 0,
};

export const STAT_LABEL: Record<string, string> = {
  hp: "HP",
  attack: "Công",
  defense: "Thủ",
  speed: "Tốc độ",
  skillPower: "Sức chiêu",
  crit: "Chí mạng",
  evasion: "Né",
  statusPower: "Sức trạng thái",
  elementPower: "Sức hệ",
  growthRate: "Tốc lớn",
  mutationChance: "Tỉ lệ ĐB",
};

export interface ElementAffinity extends Record<ElementId, number> {}

export interface VisualGenes {
  /** Hue in degrees, 0-360. */
  hue: number;
  hueSpread: number;
  saturation: number;
  lightness: number;
  accentHue: number;
  scale: number;
  /** 0-1 how many parts the plant shows. */
  complexity: number;
  pattern: "plain" | "veined" | "mottled" | "spotted" | "gradient" | "rings";
  aura: "none" | "warm_glow" | "spark" | "spore_dust" | "dew" | "shadow_haze" | "halo";
  size: "tiny" | "small" | "normal" | "large" | "colossal";
  eyeCount: number;
  seedShape: "round" | "teardrop" | "angular" | "cluster";
}

export interface SkillModule {
  delivery: Delivery;
  effect: EffectKind;
  elements: ElementId[];
  modifiers: ModifierId[];
}

export interface Skill {
  id: string;
  name: string;
  core: SkillModule;
  /** Convenience mirrors of `core.*` so engine and UI read them directly. */
  delivery: Delivery;
  effect: EffectKind;
  modifiers: ModifierId[];
  level: number;
  masteryXp: number;
  stability: number;
  /** Cooldown in seconds. */
  cooldown: number;
  power: number;
  accuracy: number;
  statusChance: number;
  statusDuration: number;
  energyCost: number;
  windup: number;
  recovery: number;
  budgetCost: number;
  tags: string[];
  evolutionNodes: EvolutionNode[];
  lineage: { inheritedFrom: string[]; fusion: boolean };
}

export interface EvolutionNode {
  id: string;
  label: string;
  description: string;
  unlockedAtLevel: number;
  chosen: boolean;
  effect: Partial<{
    power: number;
    cooldown: number;
    statusChance: number;
    accuracy: number;
    bounce: number;
    lifesteal: number;
  }>;
}

export interface PlantGrowth {
  stage: GrowthStage;
  stageStartedAt: number;
  stageReadyAt: number;
  level: number;
  xp: number;
  careOpportunities: number;
}

export interface PotentialStat {
  softCap: number;
  hardCap: number;
}

export interface CareMemoryEntry {
  action: string;
  at: number;
}

export interface CareMemory {
  recent: CareMemoryEntry[];
  /** Lifetime counts — quests and economy read these; the anti-spam penalty
      reads `recent` (a rolling window) instead, or repeats would punish a
      player forever. */
  counts: Record<string, number>;
  /** Per-action last-use stamps — the cooldown clock. `recent` caps at 30
      entries, so a long cooldown could fall out of the window otherwise. */
  lastUse: Record<string, number>;
  lastAction: { id: string; at: number } | null;
}

export interface StressMap extends Partial<Record<StressKind, number>> {}

export interface MutationEntry {
  at: number;
  tier: MutationTier;
  label: string;
  detail: string;
}

export interface PlantLocks {
  favorite: boolean;
  manual: boolean;
  battle: boolean;
  breeding: boolean;
  transaction: boolean;
}

export interface PlantEconomy {
  purchaseCost: number;
  investedMaterialValue: number;
  careCycles: number;
  expectedSellPrice: number;
}

export interface PlantValidation {
  buildValue: number;
  tierBudget: number;
  ecr: number;
  synergyTax: number;
  invalidCombos: string[];
  warnings: string[];
  rankedLegal: boolean;
}

export interface Plant {
  plantId: string;
  ownerId: string;
  name: string;
  generation: number;
  baseLineage: SpeciesId[];
  rarity: Rarity;
  rarityScore: number;
  dna: Dna;
  visual: VisualGenes;
  growth: PlantGrowth;
  stats: Stats;
  potential: Record<string, PotentialStat>;
  growthStats: { growthRate: number; careEfficiency: number; mutationChance: number; breedingPower: number; stability: number };
  hidden: { temperament: number; wildness: number; genePurity: number; latentPower: number; mutationDebt: number };
  skills: Skill[];
  traits: string[];
  mutations: MutationEntry[];
  parents: { a: string | null; b: string | null };
  archetype: Record<Archetype, number>;
  tier: CombatTier;
  /**
   * This plant's fighting history.
   *
   * `streak` and `bestStreak` are what turn a win into a reason to fight again: the
   * reward scales with the run, so losing one is a thing to go and win back rather than
   * a number that only ever goes up. Read `battleStreakBonus` for the multiplier so the
   * screen and the payout cannot disagree about it.
   */
  battleRecord: {
    wins: number;
    losses: number;
    draws: number;
    scars: number;
    /** Consecutive wins. Reset by a loss or a draw. */
    streak: number;
    /** The longest run this plant has had, kept so the number on screen can rise. */
    bestStreak: number;
  };
  careMemory: CareMemory;
  stress: StressMap;
  mood: Mood;
  powerRating: number;
  validation: PlantValidation;
  locks: PlantLocks;
  economy: PlantEconomy;
  createdAt: number;
  updatedAt: number;
}

export type { Stats } from "../config/balance";

export interface Dna {
  lineage: SpeciesId[];
  elementGenes: ElementAffinity;
  bodyGenes: Record<BodyGeneId, string>;
  statGenes: Record<StatGeneId, number>;
  skillGenes: Record<SkillGeneId, number>;
  mutationGenes: { instability: number; rarityLuck: number; wildness: number; purity: number };
  archetype: Record<Archetype, number>;
  seed: string;
}

export function emptyArchetype(): Record<Archetype, number> {
  return { tank: 0, burst: 0, sustain: 0, control: 0, tempo: 0, counter: 0 };
}

export function normaliseArchetype(a: Record<Archetype, number>): Record<Archetype, number> {
  const total = Object.values(a).reduce((x, y) => x + y, 0) || 1;
  const out = emptyArchetype();
  for (const k of Object.keys(out) as Archetype[]) out[k] = a[k] / total;
  return out;
}

export function dominantArchetype(a: Record<Archetype, number>): Archetype {
  let best: Archetype = "tank";
  let bestValue = -1;
  for (const k of Object.keys(a) as Archetype[]) {
    if (a[k] > bestValue) {
      bestValue = a[k];
      best = k;
    }
  }
  return best;
}

export function emptyCareMemory(): CareMemory {
  return { recent: [], counts: {}, lastUse: {}, lastAction: null };
}

export function emptyStress(): StressMap {
  return { overwater: 0, heat: 0, overfeed: 0, mutationDebt: 0, battleFatigue: 0, neglect: 0 };
}
