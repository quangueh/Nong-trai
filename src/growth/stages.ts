/** Growth stage progression + offline progress (docs/12 §3, §14). */

import { STAGE_SECONDS, STAGE_ORDER, type GrowthStage, type Plant } from "../core/types";
import { clamp } from "../core/rng";
import { gainXp } from "./care";

/**
 * How long `stage` lasts for this plant. `growthStats.growthRate` — trained via
 * sunlight/music/serum care — tilts the wait around a neutral 0.5 baseline:
 * fresh genomes (≈0.4–0.7) stay within ±5% of the old flat pace, while a plant
 * deliberately trained to the 0.9 cap grows ~20% faster. That is what
 * "Tốc lớn" was always supposed to mean.
 */
export function stageDurationMs(stage: GrowthStage, plant: Plant): number {
  const gr = plant.growthStats?.growthRate ?? 0.5;
  return Math.round(STAGE_SECONDS[stage] * 1000 * clamp(1.25 - gr * 0.5, 0.75, 1.25));
}

/**
 * Honest "time to mature" range, in minutes, for the seed cards — the species
 * sheet's `growMinutes` is flavour text that the engine never read, so a card
 * promising "20 phút" while the plant actually popped in ~4 was a lie. This is
 * the same clock `stageDurationMs` runs on: seed+sprout+young, swung across
 * the growth-rate band the genomes actually get.
 */
export function growRangeMinutes(): [number, number] {
  const s = (STAGE_SECONDS.seed + STAGE_SECONDS.sprout + STAGE_SECONDS.young) / 60;
  return [Math.max(1, Math.round(s * 0.75)), Math.round(s * 1.25)];
}

export function tickGrowth(plant: Plant, now: number): { stageChanged: boolean; newStage?: GrowthStage; readyToHarvest: boolean } {
  if (plant.growth.stage === "mature" || plant.growth.stage === "awakened") {
    return { stageChanged: false, readyToHarvest: true };
  }
  /*
   * Catch up every boundary that elapsed, not just the first. The old
   * single-step version stamped `stageStartedAt = now`, so a player gone for
   * two stages' worth of time came back to a plant restarted at 0% of the next
   * stage — the overshoot was discarded. Anchoring each new stage to the
   * boundary that passed carries the overshoot forward: offline time advances
   * growth exactly as online time does.
   */
  let changed = false;
  let finalStage: GrowthStage | undefined;
  while (plant.growth.stage !== "mature" && plant.growth.stage !== "awakened" && now >= plant.growth.stageReadyAt) {
    const boundary = plant.growth.stageReadyAt;
    const idx = STAGE_ORDER.indexOf(plant.growth.stage);
    const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 2, idx + 1)];
    plant.growth.stage = next;
    plant.growth.stageStartedAt = boundary;
    plant.growth.stageReadyAt = next === "mature" ? boundary : boundary + stageDurationMs(next, plant);
    gainXp(plant, 40 + Math.random() * 40); // stage-up XP; small jitter is fine, not battle-critical
    plant.updatedAt = now;
    changed = true;
    finalStage = next;
  }
  if (changed) {
    // One entry for however many boundaries crossed: the toast announces where
    // the plant ended up, not every stage it skipped past while the player was away.
    return { stageChanged: true, newStage: finalStage, readyToHarvest: finalStage === "mature" };
  }
  return { stageChanged: false, readyToHarvest: false };
}

export function stageProgress(plant: Plant, now: number): number {
  if (plant.growth.stage === "mature" || plant.growth.stage === "awakened") return 1;
  const total = plant.growth.stageReadyAt - plant.growth.stageStartedAt;
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, (now - plant.growth.stageStartedAt) / total));
}

export function canBattle(plant: Plant): boolean {
  return plant.growth.stage === "mature" || plant.growth.stage === "awakened";
}

export function canBreed(plant: Plant): boolean {
  return canBattle(plant) && !plant.locks.breeding && !plant.locks.battle;
}

export function canSell(plant: Plant): boolean {
  if (!canBattle(plant)) return false;
  if (plant.locks.favorite || plant.locks.manual || plant.locks.battle || plant.locks.breeding || plant.locks.transaction) return false;
  return true;
}

/** Attempt awaken (docs/01 §9). */
export function tryAwaken(plant: Plant, now: number): { ok: boolean; reason: string } {
  if (plant.growth.stage !== "mature") return { ok: false, reason: "Cây chưa trưởng thành" };
  if (plant.growth.level < 10) return { ok: false, reason: "Cần cấp 10" };
  if (plant.battleRecord.wins < 3) return { ok: false, reason: "Cần thắng 3 trận" };
  if (plant.dna.mutationGenes.instability < 0.2) return { ok: false, reason: "Gene quá ổn định" };
  plant.growth.stage = "awakened";
  plant.growth.stageStartedAt = now;
  plant.growth.stageReadyAt = now;
  plant.rarityScore = Math.min(100, plant.rarityScore + 8);
  return { ok: true, reason: "Cây thức tỉnh!" };
}
