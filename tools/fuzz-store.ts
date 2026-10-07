/*
 * tools/fuzz-store.ts — hostile-input fuzz over the public GameStore API.
 *
 * Seeded random operation sequences: buy/plant/care/sell/breed/ascend/xp plus
 * deliberately hostile arguments (negative counts, NaN, huge numbers, unknown
 * ids). After every operation the state invariants are re-checked; a violation
 * or a thrown exception prints the failing op index so the sequence can be
 * reproduced by replaying the same seed.
 *
 * Run: npx tsx tools/fuzz-store.ts [seed] [iterations]
 */

// Minimal localStorage shim so the store can persist in-process.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};

const { GameStore } = await import("../src/core/store");
const { SPECIES } = await import("../src/config/species");
const { CARE_ACTIONS } = await import("../src/config/careActions");

const FUZZ_SEED = Number(process.argv[2] ?? 1337) >>> 0;
const ITERS = Number(process.argv[3] ?? 5000);

// Mulberry32 — deterministic so a failure replays exactly.
let rngState = FUZZ_SEED;
function rng(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
// Hostile argument pool: mostly sane values, some attackers.
const hostileNum = (): number =>
  pick([0, 1, 2, 5, -1, -100, 0.5, NaN, Infinity, -Infinity, 1e15, Number.MAX_SAFE_INTEGER, -0]);

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

function invariants(store: InstanceType<typeof GameStore>, opIdx: number): void {
  const s = store.state;
  for (const k of ["leafCoin", "nectar", "pollen", "ember", "geneCrystal", "items", "lifetimeExp"] as const) {
    const v = s[k];
    if (!Number.isFinite(v) || v < 0) fail(`op#${opIdx}: ${k}=${v} (negative or non-finite)`);
  }
  for (const [sp, n] of Object.entries(s.seeds)) {
    if (!Number.isFinite(n) || n < 0) fail(`op#${opIdx}: seeds.${sp}=${n}`);
  }
  if (s.plants.length > s.nurseryCap) fail(`op#${opIdx}: plants ${s.plants.length} > nurseryCap ${s.nurseryCap}`);
  for (const p of s.plants) {
    if (!Number.isFinite(p.growth.level) || p.growth.level < 1) fail(`op#${opIdx}: ${p.plantId} level=${p.growth.level}`);
    if (!Number.isFinite(p.growth.xp)) fail(`op#${opIdx}: ${p.plantId} xp=${p.growth.xp}`);
    for (const [k, v] of Object.entries(p.stats)) {
      if (!Number.isFinite(v)) fail(`op#${opIdx}: ${p.plantId} stats.${k}=${v}`);
    }
  }
}

const store = new GameStore();
const speciesIds = SPECIES.map((s) => s.id);
const actionIds = Object.keys(CARE_ACTIONS) as (keyof typeof CARE_ACTIONS)[];
const ops = [
  () => store.buySeed(pick(speciesIds), Math.floor(hostileNum())),
  () => store.plantSeed(pick(speciesIds)),
  () => {
    const p = store.state.plants[Math.floor(rng() * store.state.plants.length)];
    if (p) store.care(p.plantId, pick(actionIds));
  },
  () => {
    const p = store.state.plants[Math.floor(rng() * store.state.plants.length)];
    if (p) store.sell(p.plantId);
  },
  () => {
    if (store.state.plants.length >= 2) {
      store.breed(pick(store.state.plants).plantId, pick(store.state.plants).plantId);
    }
  },
  () => {
    const p = store.state.plants[Math.floor(rng() * store.state.plants.length)];
    if (p) store.addPlantXp(p, hostileNum());
  },
  () => store.buyPlot(),
  () => store.claimQuest(pick(["q_daily_care", "q_grow", "nope", ""]) as never),
  () => store.awardDrops(pick(["win", "loss", "draw"] as const)),
  () => {
    const p = store.state.plants[Math.floor(rng() * store.state.plants.length)];
    if (p) store.runAscentStage(p.plantId, Math.floor(hostileNum()));
  },
];

console.log(`fuzz-store: seed=${FUZZ_SEED} iters=${ITERS}`);
for (let i = 0; i < ITERS; i++) {
  try {
    pick(ops)();
  } catch (e) {
    fail(`op#${i} threw: ${(e as Error).message}`);
    if (failures > 5) break;
  }
  invariants(store, i);
  // Keep the run bounded: a monster garden is not the thing being fuzzed.
  if (store.state.plants.length > 8) store.state.plants.length = 8;
  if (failures > 5) break;
}

// The state must still serialize after the storm — a save that cannot round-trip
// is a corruption even if every individual field looked fine.
try {
  store.save();
  const reloaded = new GameStore();
  invariants(reloaded, -1);
} catch (e) {
  fail(`save/reload after fuzz threw: ${(e as Error).message}`);
}

console.log(`\nResult: ${failures === 0 ? `${ITERS} ops clean` : `${failures} failures`} (seed ${FUZZ_SEED})`);
process.exit(failures === 0 ? 0 : 1);
