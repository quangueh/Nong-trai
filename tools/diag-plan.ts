export {};

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
const { GameStore } = await import("../src/core/store");
const { solveGrowthLadder } = await import("../src/render/plantRenderer");
const { SPECIES } = await import("../src/config/species");

const store = new GameStore();
store.state.nurseryCap = 60;
store.state.leafCoin = 10_000_000;
(store.state as any).nectar = 10_000_000;
(store.state as any).pollen = 10_000_000;
(store.state as any).ember = 10_000_000;

const ORDER = ["seed", "sprout", "young", "mature", "awakened"];
let checked = 0, planReg = 0;
const bad: string[] = [];
for (const sp of SPECIES) {
  if (checked % 2000 === 0) console.log(`...${checked} @ ${sp.id}`);
  for (let t = 0; t < 2; t++) {   // 2 instances per species — enough signal, half the time
    store.state.seeds[sp.id as never] = 1;
    const res = store.plantSeed(sp.id as never);
    if (!res.ok) break;
    const p = store.get(res.plantId!)!;
    p.locks.manual = false;
    const solved = solveGrowthLadder(p as any);
    const hs = ORDER.map((s) => solved[s]?.height ?? 0);
    checked++;
    if (hs.some((h, i) => i > 0 && h < hs[i - 1] - 0.5)) {
      planReg++;
      if (bad.length < 20) bad.push(`${sp.id} ${sp.name} ${p.plantId.slice(-7)}: ${hs.map((h) => h.toFixed(1)).join(" -> ")}`);
    }
    store.state.plants.splice(store.state.plants.indexOf(p), 1);
  }
}
console.log(`checked ${checked} instances; ${planReg} plan-height regressions`);
for (const b of bad) console.log("  " + b);
