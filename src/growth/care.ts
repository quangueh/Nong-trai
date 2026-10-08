/**
 * Care system (docs/12 §7-§9). Every gain factors gene affinity, remaining
 * potential, care memory (anti-spam), stress, mood and a seeded random. This is
 * why two players caring for the same plant get different results.
 */

import { Rng, clamp, round2 } from "../core/rng";
import type { Plant } from "../core/types";
import { CARE_ACTIONS, MOOD_EFFECTS, type CareActionId, type GrowthStatId } from "../config/careActions";
import { ELEMENTS, type ElementId } from "../config/elements";
import { TRAITS, TRAIT_ELEMENTS, type TraitDef } from "../config/traits";
import type { Archetype } from "../config/species";

export interface CareResult {
  ok: boolean;
  reason?: string;
  gains: { stat: string; amount: number; label: string }[];
  xp: number;
  /**
   * Levels the plant gained from this action, zero if it did not level.
   *
   * Reported rather than announced here, because this module knows nothing about
   * notices or the breeder. The store reads it and does both.
   */
  levels?: number;
  moodChanged?: string;
  mutation?: { trait?: string; label: string; detail: string };
  traitsUnlocked: string[];
  logLines: string[];
}

const STAGE_GAIN: Record<string, number> = {
  seed: 1.4,
  sprout: 1.25,
  young: 1.1,
  mature: 1.0,
  awakened: 1.05,
};

export function remainingPotential(plant: Plant, stat: string): number {
  const cur = statValue(plant, stat);
  const pot = plant.potential[stat];
  if (!pot || !pot.softCap) return 1;
  return clamp((pot.softCap - cur) / pot.softCap, 0.15, 1);
}

/** Anti-spam looks back 24h — `counts` is a lifetime counter, not a window. */
const CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

function windowCount(plant: Plant, actionId: string, now: number): number {
  return careWindowCount(plant, actionId, now);
}

/* A small shared rest between any two actions — the per-action cooldown alone
   let players rotate water→sunlight→water with zero delay and never wait out
   the 45s a single action was supposed to cost. */
const SHARED_REST_MS = 6_000;

/**
 * Seconds×1000 until `actionId` may run on this plant — the single source of
 * truth both `applyCare` and the garden UI read, so the button never says
 * "ready" for an action the engine would refuse.
 */
export function careCooldownLeft(plant: Plant, actionId: CareActionId, now: number): number {
  const action = CARE_ACTIONS[actionId];
  const lastSame = plant.careMemory.lastUse?.[actionId]
    ?? (plant.careMemory.lastAction?.id === actionId ? plant.careMemory.lastAction!.at : 0);
  const ownLeft = lastSame ? action.cooldownSeconds * 1000 - (now - lastSame) : 0;
  const lastAny = plant.careMemory.lastAction;
  const sharedLeft = lastAny && lastAny.id !== actionId ? SHARED_REST_MS - (now - lastAny.at) : 0;
  return Math.max(0, ownLeft, sharedLeft);
}

/**
 * How much one gain "point" moves the underlying stat — combat stats are 1:1,
 * crit/evasion add 1/200 per point and the farm stats 1/100 (see applyStatGain).
 * Cap checks must run in *points* or a decimal hard cap never binds.
 */
function pointDelta(stat: string): number {
  if (stat === "crit" || stat === "evasion") return 1 / 200;
  if (stat === "growthRate" || stat === "mutationChance") return 1 / 100;
  return 1;
}

/** Hard cap in stat units: per-plant potential, bounded by the global floors. */
function statHardCap(plant: Plant, stat: string): number {
  if (stat === "growthRate") return 0.9;
  if (stat === "mutationChance") return 0.45;
  const global = stat === "crit" || stat === "evasion" ? 0.6 : Infinity;
  return Math.min(plant.potential[stat]?.hardCap ?? Infinity, global);
}

/** Cap headroom expressed in gain points, so preview and apply agree exactly.
    Floor, not round: a partial point of room must not be granted as a full one. */
function capRoomPoints(plant: Plant, stat: string): number {
  return Math.max(0, Math.floor((statHardCap(plant, stat) - statValue(plant, stat)) / pointDelta(stat) + 1e-6));
}

/** How many times this action ran inside the rolling 24h anti-spam window. */
export function careWindowCount(plant: Plant, actionId: string, now: number): number {
  return plant.careMemory.recent.filter((e) => e.action === actionId && now - e.at < CARE_WINDOW_MS).length;
}

/**
 * What a care action is expected to yield — the decision-facing half of
 * `applyCare`, run without the random roll and without touching the plant.
 *
 * Spending items and coins on a button that says only "Tưới nước" is a blind
 * purchase; the interesting part of tending — which stat this plant actually
 * needs, and how much room its genes still leave for it — was invisible until
 * after the spend. The estimate is the midpoint of the same ±15% roll the real
 * action makes, so the preview can promise "~12 HP" and the action may pay
 * 10–14: honest about the shape, silent about the exact number.
 */
export interface CarePreview {
  gains: { stat: string; amount: number; label: string }[];
  /** Final mutation chance after this action's own bonus, 0–0.6. */
  mutationChance: number;
  affinityElement?: ElementId;
}

export function previewCare(plant: Plant, actionId: CareActionId, now = Date.now()): CarePreview {
  const action = CARE_ACTIONS[actionId];
  const stageMult = STAGE_GAIN[plant.growth.stage] ?? 1;
  const mood = MOOD_EFFECTS[plant.mood] ?? MOOD_EFFECTS.calm;
  const count24h = windowCount(plant, actionId, now);
  const memoryFactor = clamp(1 - count24h * 0.14, 0.4, 1);
  const stressFactor = 1 - stressForAction(plant, actionId);

  const gains: CarePreview["gains"] = [];
  const est = (stat: GrowthStatId, weight: number): void => {
    if (weight <= 0) return;
    const expected =
      action.baseGain * stageMult * weight * (0.5 + geneAffinityFor(plant, stat)) *
      remainingPotential(plant, stat) * memoryFactor * stressFactor * mood.gain;
    /* The same cap-room arithmetic `applyCare` uses — in points, not stat units —
       so the promised gain is what the plant can actually absorb. */
    const room = capRoomPoints(plant, stat);
    if (room <= 0) return;
    gains.push({ stat, amount: Math.min(Math.max(1, Math.round(expected)), room), label: statLabel(stat) });
  };
  for (const [stat, weight] of Object.entries(action.primary)) est(stat as GrowthStatId, weight);
  for (const [stat, weight] of Object.entries(action.secondary)) est(stat as GrowthStatId, weight * 0.5);

  const mutationChance = clamp(
    plant.growthStats.mutationChance +
      (actionId === "fertilizer" ? 0.05 : 0) +
      (actionId === "gene_serum" ? 0.16 : 0) +
      (actionId === "moonlight" ? 0.14 : 0) +
      mood.mutation,
    0,
    0.6,
  );

  return { gains, mutationChance, affinityElement: action.affinity?.element as ElementId | undefined };
}

function statValue(plant: Plant, stat: string): number {
  const s = plant.stats as unknown as Record<string, number>;
  if (stat in s) return s[stat];
  /* Farm-side stats live in growthStats — without this lookup the preview saw
     growthRate/mutationChance as 0 and promised gains the apply step could
     never deliver past the 0.9/0.45 clamps. */
  const g = plant.growthStats as unknown as Record<string, number>;
  const v = g[stat];
  return typeof v === "number" ? v : 0;
}

export function applyCare(plant: Plant, actionId: CareActionId, now: number, playerResources: { items: number; geneCrystal: number; leafCoin: number }): CareResult {
  const action = CARE_ACTIONS[actionId];
  const res: CareResult = { ok: false, gains: [], xp: 0, levels: 0, traitsUnlocked: [], logLines: [] };

  // Cooldown — per-action clock plus the small shared rest between any two actions.
  const cooldownLeft = careCooldownLeft(plant, actionId, now);
  if (cooldownLeft > 0) {
    res.reason = `Cây cần nghỉ thêm ${Math.ceil(cooldownLeft / 1000)}s`;
    return res;
  }

  // Resources.
  const itemCost = action.cost.items ?? 0;
  const crystalCost = action.cost.geneCrystal ?? 0;
  const coinCost = action.cost.leafCoin ?? 0;
  if (playerResources.items < itemCost) {
    res.reason = "Không đủ vật tư";
    return res;
  }
  if (playerResources.geneCrystal < crystalCost) {
    res.reason = "Không đủ GeneCrystal";
    return res;
  }
  if (playerResources.leafCoin < coinCost) {
    res.reason = "Không đủ LeafCoin";
    return res;
  }

  const rng = new Rng(`${plant.dna.seed}|${actionId}|${now}|${plant.economy.careCycles}`);
  const stageMult = STAGE_GAIN[plant.growth.stage] ?? 1;
  const mood = MOOD_EFFECTS[plant.mood] ?? MOOD_EFFECTS.calm;

  // Anti-spam memory factor: each repeat of the same action WITHIN 24H reduces
  // gains — the old lifetime counter punished careful players forever.
  const count24h = windowCount(plant, actionId, now);
  const memoryFactor = clamp(1 - count24h * 0.14, 0.4, 1);

  // Stress reduces gains.
  const relevantStress = stressForAction(plant, actionId);
  const stressFactor = 1 - relevantStress;

  const gains = new Map<string, number>();

  const rollGain = (stat: GrowthStatId, weight: number, tag: string) => {
    if (weight <= 0) return;
    const geneAffinity = geneAffinityFor(plant, stat);
    const potentialFactor = remainingPotential(plant, stat);
    const baseGain = action.baseGain * stageMult;
    const growth = baseGain * weight * (0.5 + geneAffinity) * potentialFactor * memoryFactor * stressFactor * mood.gain;
    const finalGain = Math.max(1, Math.round(growth * rng.float(0.85, 1.15)));
    // Respect the hard cap — measured in gain points, the same unit preview uses.
    const room = capRoomPoints(plant, stat);
    if (room <= 0) return;
    addGain(gains, stat, Math.min(finalGain, room));
    void tag;
  };

  for (const [stat, weight] of Object.entries(action.primary)) rollGain(stat as GrowthStatId, weight, "primary");
  for (const [stat, weight] of Object.entries(action.secondary)) rollGain(stat as GrowthStatId, weight * 0.5, "secondary");

  // Surprise roll: small chance to bump an unrelated stat (docs/12 §9).
  if (rng.bool(0.12)) {
    const surprisePool: GrowthStatId[] = ["attack", "speed", "skillPower", "defense", "evasion", "crit"];
    const pickStat = rng.pick(surprisePool);
    if (pickStat && !gains.has(pickStat) && capRoomPoints(plant, pickStat) > 0) {
      addGain(gains, pickStat, 1);
      res.logLines.push(`Bất ngờ: +1 ${statLabel(pickStat)}`);
    }
  }

  // Apply gains.
  for (const [stat, amount] of gains) {
    applyStatGain(plant, stat, amount);
    res.gains.push({ stat, amount, label: statLabel(stat) });
  }

  // Affinity nudge.
  if (action.affinity) {
    const el = action.affinity.element as ElementId;
    plant.dna.elementGenes[el] = round2(clamp((plant.dna.elementGenes[el] ?? 0) + action.affinity.delta, 0, 1));
  }

  // Stress & memory.
  updateStressForAction(plant, actionId, now);
  plant.careMemory.counts[actionId] = (plant.careMemory.counts[actionId] ?? 0) + 1;
  plant.careMemory.recent.push({ action: actionId, at: now });
  if (plant.careMemory.recent.length > 30) plant.careMemory.recent.shift();
  plant.careMemory.lastUse = { ...(plant.careMemory.lastUse ?? {}), [actionId]: now };
  plant.careMemory.lastAction = { id: actionId, at: now };
  plant.economy.careCycles++;

  // Mutation roll: fertilizer/serum/moonlight can mutate (docs/01 §6).
  const mutationBase = plant.growthStats.mutationChance + (actionId === "fertilizer" ? 0.05 : 0) + (actionId === "gene_serum" ? 0.16 : 0) + (actionId === "moonlight" ? 0.14 : 0);
  const mutationChance = clamp(mutationBase + mood.mutation, 0, 0.6);
  if (rng.bool(mutationChance)) {
    const mut = rollMicroMutation(plant, rng, actionId);
    if (mut) {
      res.mutation = mut;
      if (mut.trait) res.traitsUnlocked.push(mut.trait);
    }
  }

  // XP & level.
  const xp = Math.round(8 + rng.next() * 7);
  res.xp = xp;
  // Handed back to the store, which is the only layer that can announce it and pay the
  // breeder. Tending is the most frequent thing a player does, so it is the last place
  // that can be allowed to level a plant up silently.
  res.levels = gainXp(plant, xp);

  // Mood drift.
  const nextMood = rollMood(plant, rng, actionId);
  if (nextMood && nextMood !== plant.mood) {
    res.moodChanged = `${moodLabel(plant.mood)} → ${moodLabel(nextMood)}`;
    plant.mood = nextMood;
  }

  // Build a couple of log lines for the UI.
  for (const g of res.gains) res.logLines.push(`+${g.amount} ${g.label}`);
  if (actionId === "gene_serum" && rng.bool(0.4)) {
    plant.hidden.mutationDebt = round2(clamp(plant.hidden.mutationDebt + 0.08, 0, 1));
  }

  plant.updatedAt = now;
  res.ok = true;
  return res;
}

function stressForAction(plant: Plant, actionId: CareActionId): number {
  const s = plant.stress;
  switch (actionId) {
    case "water":
      return (s.overwater ?? 0) * 0.8;
    case "sunlight":
      return (s.heat ?? 0) * 0.8;
    case "fertilizer":
      return (s.overfeed ?? 0) * 0.8;
    case "gene_serum":
      return (s.mutationDebt ?? 0) * 0.6;
    default:
      return 0;
  }
}

function updateStressForAction(plant: Plant, actionId: CareActionId, now: number) {
  const s = plant.stress;
  // Neglect grows over time — measured off the caller's clock, not Date.now(),
  // so the same care sequence replays deterministically in tests and probes.
  if (now - plant.updatedAt > 120_000) s.neglect = clamp((s.neglect ?? 0) + 0.1, 0, 1);
  switch (actionId) {
    case "water":
      s.overwater = clamp((s.overwater ?? 0) + 0.08, 0, 1);
      break;
    case "sunlight":
      s.heat = clamp((s.heat ?? 0) + 0.08, 0, 1);
      break;
    case "fertilizer":
      s.overfeed = clamp((s.overfeed ?? 0) + 0.1, 0, 1);
      break;
    case "gene_serum":
      s.mutationDebt = clamp((s.mutationDebt ?? 0) + 0.12, 0, 1);
      break;
    default:
      break;
  }
  // Gentle decay of unrelated stress.
  for (const k of Object.keys(s) as (keyof typeof s)[]) {
    if (k === "overwater" && actionId !== "water") s[k] = clamp((s[k] ?? 0) - 0.03, 0, 1);
    if (k === "heat" && actionId !== "sunlight") s[k] = clamp((s[k] ?? 0) - 0.03, 0, 1);
    if (k === "overfeed" && actionId !== "fertilizer") s[k] = clamp((s[k] ?? 0) - 0.03, 0, 1);
  }
}

function rollMicroMutation(plant: Plant, rng: Rng, actionId: CareActionId): CareResult["mutation"] | undefined {
  const rareChance = clamp(0.04 + (plant.dna.mutationGenes.rarityLuck) * 0.12 + (actionId === "moonlight" ? 0.1 : 0), 0, 0.4);
  const wantRareTrait = rng.bool(rareChance);
  const used = new Set(plant.traits);
  const pool = TRAITS_POOL(plant, wantRareTrait).filter((t) => !used.has(t.id));
  if (!pool.length) {
    return { label: "Đột biến nhỏ", detail: "Màu lá chuyển sắc lạ." };
  }
  // Favor element/skill relevant traits.
  const chosen = rng.weighted(pool, (t) => {
    let w = 1;
    if (traitMatchesArchetype(t, plant)) w += 1.5;
    if (traitMatchesElement(t, plant)) w += 1.2;
    if (traitMatchesSkill(t, plant)) w += 1.0;
    return w;
  });
  plant.traits.push(chosen.id);
  plant.growthStats.stability = round2(clamp(plant.growthStats.stability - 0.05, 0.1, 1));
  return { trait: chosen.id, label: "Đột biến nhỏ!", detail: `Mở đặc tính ${chosen.name}` };
}

function TRAITS_POOL(_plant: Plant, rare: boolean): TraitDef[] {
  return TRAITS.filter((t) => (rare ? t.rarity !== "common" : t.rarity === "common"));
}


function traitMatchesArchetype(t: TraitDef, plant: Plant): boolean {
  const entries = (Object.keys(plant.archetype) as Archetype[]).sort((a, b) => plant.archetype[b] - plant.archetype[a]);
  return t.fits.includes(entries[0]);
}

function traitMatchesElement(t: TraitDef, plant: Plant): boolean {
  const best = ELEMENTS.slice().sort((a, b) => (plant.dna.elementGenes[b] ?? 0) - (plant.dna.elementGenes[a] ?? 0))[0];
  const el = TRAIT_ELEMENTS[t.id];
  return el?.includes(best) ?? false;
}


function traitMatchesSkill(t: TraitDef, plant: Plant): boolean {
  return plant.skills.some((s) => t.tags.some((tag) => s.tags.includes(tag)));
}

function addGain(map: Map<string, number>, stat: string, amount: number) {
  map.set(stat, (map.get(stat) ?? 0) + amount);
}

function geneAffinityFor(plant: Plant, stat: GrowthStatId): number {
  const map: Partial<Record<GrowthStatId, number>> = {
    hp: plant.dna.statGenes.hp,
    attack: plant.dna.statGenes.attack,
    defense: plant.dna.statGenes.defense,
    speed: plant.dna.statGenes.speed,
    skillPower: plant.dna.statGenes.skillPower,
    crit: plant.dna.statGenes.crit,
    evasion: plant.dna.statGenes.evasion,
    growthRate: plant.dna.statGenes.speed * 0.6,
  };
  return map[stat] ?? 0.5;
}

function applyStatGain(plant: Plant, stat: string, amount: number) {
  const s = plant.stats as unknown as Record<string, number>;
  if (stat in s) {
    if (stat === "crit" || stat === "evasion") s[stat] = round2(clamp(s[stat] + amount / 200, 0.01, 0.6));
    else s[stat] = Math.round(s[stat] + amount);
    return;
  }
  /*
   * Farm-side stats live in growthStats. mutationChance feeds the mutation roll
   * on the next care action; growthRate shortens the next stage (stages.ts).
   * Both are point-per-percent: +1 announced is +1% applied. Caps keep a
   * dedicated gardener from saturating the farm economy.
   */
  const g = plant.growthStats;
  if (stat === "mutationChance") g.mutationChance = round2(clamp(g.mutationChance + amount / 100, 0, 0.45));
  else if (stat === "growthRate") g.growthRate = round2(clamp(g.growthRate + amount / 100, 0, 0.9));
}

/**
 * Add experience to a plant.
 *
 * Returns how many levels it gained - zero, one, or several when a big payout crosses
 * several thresholds at once. This used to return nothing, which is why levelling a plant
 * up was invisible: the loop below did the work and told nobody, so a player watching
 * their fighter climb from 4 to 9 over a run of fights saw a number move and had no way
 * to know it was a thing that happened.
 *
 * The level itself still comes from XP alone; nothing here reads or writes the breeder.
 */
export function gainXp(plant: Plant, xp: number): number {
  const from = plant.growth.level;
  // Floored, because this counter is printed and every grant in the game is a whole
  // number. Nothing produces a fraction today - verified over ninety care actions - but a
  // fractional bar would show something like "55.257805070693934" if any future source
  // ever did, and the floor makes that impossible rather than merely unlikely. A
  // non-finite or negative grant would leave the bar at NaN or "-50" forever, and
  // neither is a gain - refuse it before the counter moves.
  plant.growth.xp = Math.floor(plant.growth.xp + (Number.isFinite(xp) ? Math.max(0, xp) : 0));
  // The requirement is recomputed on every step, not hoisted out of the loop.
  //
  // It used to be read once before the loop and subtracted unchanged each time, which
  // meant every level of a plant cost exactly what its first level cost: the curve was
  // flat in practice even though `xpRequired` grows, and a plant at level 40 levelled as
  // cheaply as one at level 1. Read once, the growing curve is decoration.
  while (plant.growth.level < 100) {
    const req = xpRequired(plant.growth.level);
    if (plant.growth.xp < req) break;
    plant.growth.xp -= req;
    plant.growth.level++;
    // Level up nudges potential caps. Caps for crit/evasion live in decimals
    // (0.08, not 8) — Math.round(0.0824) is 0, which would zero the cap on the
    // first level-up instead of nudging it. Round to the cap's own scale.
    for (const key of Object.keys(plant.potential)) {
      const p = plant.potential[key];
      const nudge = (v: number) => (v < 1 ? Math.round(v * 1.03 * 10000) / 10000 : Math.round(v * 1.03));
      p.softCap = nudge(p.softCap);
      p.hardCap = nudge(p.hardCap);
    }
  }
  return plant.growth.level - from;
}

export function xpRequired(level: number): number {
  return Math.round(40 * Math.pow(level, 1.45) + 60);
}

function rollMood(plant: Plant, rng: Rng, actionId: CareActionId): Plant["mood"] | null {
  const stress = plant.stress;
  const totalStress = (Object.values(stress) as (number | undefined)[]).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (actionId === "gene_serum" && rng.bool(0.5)) return "unstable";
  if (totalStress > 1.2) return "tired";
  if (plant.hidden.wildness > 0.6 && rng.bool(0.3)) return "wild";
  if (rng.bool(0.15)) return "excited";
  return null;
}

function moodLabel(m: string): string {
  const map: Record<string, string> = { calm: "Bình tĩnh", excited: "Hào hứng", wild: "Hoang dã", tired: "Mệt mỏi", unstable: "Mất ổn" };
  return map[m] ?? m;
}

export function statLabel(stat: string): string {
  const map: Record<string, string> = {
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
  return map[stat] ?? stat;
}
