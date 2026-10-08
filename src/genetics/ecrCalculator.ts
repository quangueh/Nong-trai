/**
 * Effective Combat Rating via batch simulation (docs/15 §14).
 *
 * A plant's ECR is measured, not asserted: we run it against a fixed roster of
 * benchmark plants and blend win rate, damage, survival and control into a
 * single number with a variance penalty. This is what matchmaking reads.
 */

import { clamp, round2 } from "../core/rng";
import type { Plant } from "../core/types";
import { simulateBattle, type BattleConfig, type BattleResult } from "../battle/engine";
import { createBenchmarkPlant } from "./benchmarkRoster";import type { BenchmarkId } from "../config/balance";

const BENCHMARKS: BenchmarkId[] = [
  "tank_physical",
  "tank_status",
  "burst_fast",
  "sustain_heal",
  "poison_dot",
  "control_lock",
  "tempo_onhit",
  "counter_reflect",
  "balanced_neutral",
];

const SESSIONS_PER_BENCH = 6;

/** Everything that decides a fight, canonically ordered — the measurement seed. */
function combatKey(plant: Plant): string {
  return JSON.stringify({
    stats: plant.stats,
    skills: plant.skills.map((s) => [s.id, s.power]),
    traits: [...plant.traits].sort(),
    arch: plant.archetype,
    tier: plant.tier,
  });
}

export interface EcrReport {
  ecr: number;
  medianWinRate: number;
  minMatchupWinRate: number;
  maxMatchupWinRate: number;
  matchupStdDev: number;
  timeToKillP50: number;
  matchups: { id: BenchmarkId; winRate: number }[];
}

export function computeEcr(plant: Plant, sessions = SESSIONS_PER_BENCH): EcrReport {
  const matchups: { id: BenchmarkId; winRate: number; ttks: number[] }[] = [];
  const allTtks: number[] = [];

  // Benchmarks are priced at the subject's tier — ECR is only meaningful
  // within a tier, never across the roster.
  for (const benchId of BENCHMARKS) {
    const bench = createBenchmarkPlant(benchId, plant.tier);
    let wins = 0;
    let played = 0;
    const ttks: number[] = [];
    for (let s = 0; s < sessions; s++) {
      // Alternate sides so neither position is favoured.
      const subjectFirst = s % 2 === 0;
      const a = subjectFirst ? plant : bench;
      const b = subjectFirst ? bench : plant;
      const cfg: BattleConfig = {
        /* Seeded by the BUILD, not the plant's id — two genomes with identical
           combat data must measure the same ECR, and a purely visual repaint
           must not move it (docs/20 §4.4). Identity comes from stats, skills,
           traits, archetype and tier — nothing else. */
        seed: `ecr:${combatKey(plant)}:${benchId}:${s}`,
        maxSeconds: 90,
        arena: "sunny",
      };
      const res: BattleResult = simulateBattle(a, b, cfg);
      const subjectWon = subjectFirst ? res.winner === "a" : res.winner === "b";
      if (subjectWon) wins++;
      played++;
      const subjectHpPct = subjectFirst ? res.a.hpPct : res.b.hpPct;
      const subjectDmg = subjectFirst ? res.a.damageDealt : res.b.damageDealt;
      // Survival time proxy: how much of the match it lasted while taking damage.
      const ttk = clamp((subjectHpPct / 100) * 60 + (subjectDmg > 0 ? 30 : 0), 0, 90);
      ttks.push(ttk);
    }
    const winRate = wins / Math.max(1, played);
    matchups.push({ id: benchId, winRate, ttks });
    allTtks.push(...ttks);
  }

  const winRates = matchups.map((m) => m.winRate);
  const medianWinRate = median(winRates);
  const minMatchupWinRate = Math.min(...winRates);
  const maxMatchupWinRate = Math.max(...winRates);
  const matchupStdDev = round2(stdDev(winRates));
  const timeToKillP50 = round2(percentile(allTtks, 50));

  // Weighted ECR (docs/15 §14).
  const winRateScore = medianWinRate;
  const damageScore = clamp(0.5 + (medianWinRate - 0.5) * 0.6, 0, 1);
  const survivalScore = clamp(0.5 + (timeToKillP50 / 90 - 0.5) * 0.4, 0, 1);
  const controlScore = clamp(0.5 + (plant.archetype.control - 0.16) * 1.2, 0, 1);
  // Variance penalty punishes hyper-polar plants (win some, lose some).
  const variancePenalty = clamp(matchupStdDev * 1.5, 0, 0.2);

  const ecr = clamp(
    winRateScore * 0.4 + damageScore * 0.2 + survivalScore * 0.2 + controlScore * 0.2 - variancePenalty,
    0.05,
    0.95,
  );

  return {
    ecr: round2(ecr),
    medianWinRate: round2(medianWinRate),
    minMatchupWinRate: round2(minMatchupWinRate),
    maxMatchupWinRate: round2(maxMatchupWinRate),
    matchupStdDev,
    timeToKillP50,
    matchups: matchups.map((m) => ({ id: m.id, winRate: round2(m.winRate) })),
  };
}

/** Quick power rating that doesn't need a full sim (used in lists). */
export function quickPower(plant: Plant): number {
  return Math.round(plant.powerRating);
}

function median(values: number[]): number {
  if (!values.length) return 0.5;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
