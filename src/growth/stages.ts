/** Growth stage progression + offline progress (docs/12 §3, §14). */

import { STAGE_SECONDS, STAGE_ORDER, type GrowthStage, type Plant } from "../core/types";
import { gainXp } from "./care";

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
    plant.growth.stageReadyAt = next === "mature" ? boundary : boundary + STAGE_SECONDS[next] * 1000;
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
