/**
 * Timing probe: what does one breeding actually cost the player?
 *
 * `store.breed` calls `computeEcr`, which runs 9 benchmark matchups x 6
 * sessions = 54 full battle simulations, synchronously, on the main thread.
 * That is a lot of work for one button click and it is worth knowing the real
 * number rather than guessing — "siêu mượt" is a requirement.
 *
 * Measured: ~8 ms, so it is not a problem. Kept as a regression guard, because
 * the obvious way to make a genome change slower later is to add work here and
 * nobody would notice until breeding started feeling sticky.
 *
 * Run: npx tsx tools/diag-perf.ts
 */

import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { computeEcr } from "../src/genetics/ecrCalculator";
import { simulateBattle } from "../src/battle/engine";
import { createBenchmarkPlant } from "../src/genetics/benchmarkRoster";

function ms(t: () => void): number {
  const t0 = performance.now();
  t();
  return performance.now() - t0;
}

const plant = createSeedPlant("thornroot", "perf", "p", 0);
plant.growth.stage = "mature";
plant.growth.level = 20;

console.log(`\n=== single battle ===`);
const bench = createBenchmarkPlant("balanced_neutral", plant.tier);
const one = ms(() =>
  simulateBattle(plant, bench, { seed: "perf:1", maxSeconds: 90, arena: "sunny" }),
);
console.log(`  one simulateBattle:        ${one.toFixed(1)} ms`);

console.log(`\n=== computeEcr (called on every breeding) ===`);
const SAMPLES = 5;
const ecrTimes: number[] = [];
let report = computeEcr(plant);
for (let i = 0; i < SAMPLES; i++) {
  const t0 = performance.now();
  report = computeEcr({ ...plant, plantId: `perf_${i}` });
  ecrTimes.push(performance.now() - t0);
}
ecrTimes.sort((a, b) => a - b);
const med = ecrTimes[Math.floor(ecrTimes.length / 2)];

console.log(`  battles per call:          54  (9 benchmarks x 6 sessions)`);
console.log(`  median:                    ${med.toFixed(1)} ms`);
console.log(`  min / max:                 ${ecrTimes[0].toFixed(1)} / ${ecrTimes[ecrTimes.length - 1].toFixed(1)} ms`);
console.log(`  implied:                   ${((med / 54) * 1000).toFixed(0)} µs per battle`);

// Budget: one frame is 16.7ms. A breeding click must stay well inside a couple
// of frames or the button visibly stutters.
const BUDGET_MS = 16;
console.log(`\n  one frame:                 ${BUDGET_MS} ms`);
console.log(
  `  verdict:                   ${med < BUDGET_MS / 4 ? "OK" : "TOO SLOW"} — ` +
    `breeding costs ${(med / BUDGET_MS).toFixed(2)} frames`,
);
if (med >= BUDGET_MS / 4) {
  console.log(`  action:                    cut SESSIONS_PER_BENCH or move ECR off the click path.`);
}

console.log(`\n  sample readings (a fresh level-20 thornroot, so weak by design):`);
console.log(`    ecr:                     ${report.ecr}`);
console.log(`    median win rate:         ${report.medianWinRate}`);
console.log(`    matchup std dev:         ${report.matchupStdDev}`);
console.log("");