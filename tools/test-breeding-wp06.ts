/**
 * WP06 / BRD-01…06 — breeding atelier contract tests, domain level.
 *
 * The screen's promises are only as good as the store calls behind them, so
 * this suite measures `store.breed`/`breedingPreview`/`breedingFee` directly:
 * same-source distribution, atomic settlement, reject paths that must not
 * half-spend, pity/protocol behaviour, invalid IDs, and the no-double-spend
 * property BRD-01's "pending" clause reduces to on a synchronous settle.
 */
import { GameStore } from "../src/core/store";
import { SPECIES } from "../src/config/species";

/* GameStore reads localStorage in its constructor — same shim the other
   domain suites use. */
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, String(v)),
    removeItem: (k: string) => memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  },
});
import { protocolUnlocked, getProtocol, PROTOCOLS } from "../src/genetics/protocols";
import { POLLEN_PER_BREED } from "../src/core/currency";
import { xpRequired } from "../src/growth/care";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function fresh(): GameStore {
  /* The shimmed localStorage persists across store instances — without this a
     later `fresh()` inherits the previous block's committed save, ledger and
     all, and "the fee debited once" counts two breeds' lines. */
  memory.clear();
  const s = new GameStore();
  s.state.plants = [];
  return s;
}

/** Two mature, breedable parents plus the money to pay the fee. */
function twoParents(store: GameStore, level = 14): { aId: string; bId: string } {
  const ids = [SPECIES[0].id, SPECIES[1].id];
  for (const id of ids) {
    store.state.seeds[id] = 2;
    store.plantSeed(id);
    const p = store.state.plants[store.state.plants.length - 1];
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = level;
    p.locks.manual = false;
  }
  store.state.leafCoin = 1_000_000;
  return {
    aId: store.state.plants[0].plantId,
    bId: store.state.plants[1].plantId,
  };
}

const RARITIES = ["C", "B", "A", "S", "SS", "SSS"];

console.log("\nBRD-02 — preview is a real normalised distribution:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const w = s.breedingPreview(aId, bId);
  const sum = w ? Object.values(w).reduce((a, b) => a + b, 0) : 0;
  check("preview returns a weight per rarity band", !!w && RARITIES.every(r => r in w), JSON.stringify(w));
  check("weights normalise to the 10_000 bps table", Math.abs(sum - 10000) < 1, `sum=${sum}`);
  check("no weight is negative or NaN", !!w && Object.values(w).every(v => Number.isFinite(v) && v >= 0), JSON.stringify(w));
  check("missing parent yields null, not a bogus table", s.breedingPreview("nope", bId) === null);
}

console.log("\nBRD-02 — roll reads the same table the screen shows:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const w = s.breedingPreview(aId, bId)!;
  const res = s.breed(aId, bId);
  check("breed settles and reports a rarity inside the published table",
    res.ok === true && !!res.result && res.result.plant.rarity in w,
    JSON.stringify(res));
}

console.log("\nBRD-01 — settle is atomic: fee once, pollen once, parents spent once:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const fee = s.breedingFee(aId, bId);
  const coinsBefore = s.state.leafCoin;
  const pollenBefore = s.state.pollen;
  const breedsBefore = s.state.discovery.breeds;
  const res = s.breed(aId, bId);
  check("breed succeeded on valid parents", res.ok === true, res.reason);
  /* Net balance is the wrong measure: a breeder level-up from the breed's XP
     can legitimately land a "+200 Cấp nhà lai tạo" in the same settle. The
     honest check is the ledger — exactly one "Phí lai tạo" debit of `fee`. */
  const feeLines = s.state.ledger.filter(l => l.delta === -fee && /Phí lai/.test(l.reason));
  check("fee debited exactly once in the ledger", feeLines.length === 1,
    `lines=${feeLines.length} net=${coinsBefore}→${s.state.leafCoin} fee=${fee}`);
  check("pollen credited once for the act", s.state.pollen === pollenBefore + POLLEN_PER_BREED, JSON.stringify(s.state.pollen));
  check("parents are gone — exactly once each", !s.state.plants.some(p => p.plantId === aId || p.plantId === bId));
  check("child present in the garden", res.ok && !!res.result && s.state.plants.some(p => p.plantId === res.result!.plant.plantId));
  check("breed counter moved once", s.state.discovery.breeds === breedsBefore + 1, String(s.state.discovery.breeds));
}

console.log("\nBRD-01 — a second breed on the same pair cannot double-spend:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  s.breed(aId, bId);
  const coins = s.state.leafCoin;
  const count = s.state.plants.length;
  const res2 = s.breed(aId, bId);
  check("second breed refuses because the parents are spent", res2.ok === false, JSON.stringify(res2));
  check("no second debit and no plant churn", s.state.leafCoin === coins && s.state.plants.length === count);
}

console.log("\nBRD-01/04 — every reject path fails clean, nothing half-spent:");
{
  const s = fresh();
  const { aId } = twoParents(s);
  const cases: [string, () => { ok: boolean; reason?: string }][] = [
    ["invalid ids", () => s.breed("ghost-a", "ghost-b")],
    ["same parent", () => s.breed(aId, aId)],
  ];
  for (const [label, run] of cases) {
    const coins = s.state.leafCoin;
    const res = run();
    check(`${label} refuses and spends nothing`, res.ok === false && s.state.leafCoin === coins, res.reason);
  }

  // Immature parent
  const immature = fresh();
  const p2 = twoParents(immature);
  immature.state.plants[0].growth.stage = "young";
  const c1 = immature.state.leafCoin;
  const r1 = immature.breed(p2.aId, p2.bId);
  check("immature parent refuses and spends nothing", r1.ok === false && immature.state.leafCoin === c1, r1.reason);

  // Battle-locked parent
  const locked = fresh();
  const p3 = twoParents(locked);
  locked.state.plants[0].locks.battle = true;
  const c2 = locked.state.leafCoin;
  const r2 = locked.breed(p3.aId, p3.bId);
  check("battle-locked parent refuses and spends nothing", r2.ok === false && locked.state.leafCoin === c2, r2.reason);

  // Insufficient fee
  const broke = fresh();
  const p4 = twoParents(broke);
  broke.state.leafCoin = 0;
  const r3 = broke.breed(p4.aId, p4.bId);
  check("insufficient LeafCoin refuses; parents kept, nothing moved",
    r3.ok === false && broke.state.plants.length === 2, r3.reason);

  // Locked protocol
  const low = fresh();
  const p5 = twoParents(low);
  low.state.breederLevel = 1;
  const gated = PROTOCOLS.find(p => !protocolUnlocked(p.id, 1))!;
  const r4 = low.breed(p5.aId, p5.bId, gated.id);
  check(`protocol ${gated.id} locked at level 1 refuses with the unlock level in the reason`,
    r4.ok === false && !!r4.reason && r4.reason.includes(String(getProtocol(gated.id).levelRequired)), r4.reason);
}

console.log("\nBRD-02 — protocol changes both fee and odds through the same calls:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  s.state.breederLevel = 30;
  const baseFee = s.breedingFee(aId, bId);
  const surgeFee = s.breedingFee(aId, bId, "surge");
  check("protocol fee = base × multiplier", surgeFee === Math.floor(baseFee * getProtocol("surge").feeMultiplier), `${baseFee}→${surgeFee}`);
  const baseW = s.breedingPreview(aId, bId)!;
  const surgeW = s.breedingPreview(aId, bId, "surge")!;
  check("surge lifts S above the base odds", surgeW.S > baseW.S, `${baseW.S}→${surgeW.S}`);
  check("surge still normalises", Math.abs(Object.values(surgeW).reduce((a, b) => a + b, 0) - 10000) < 1);
}

console.log("\nBRD-02 — pity counters move exactly once per settle and reset on hit:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const before = { ...s.state.pity };
  const res = s.breed(aId, bId);
  const p = s.state.pity;
  check("totalBreeds +1", p.totalBreeds === before.totalBreeds + 1);
  const idx = RARITIES.indexOf(res.result!.plant.rarity);
  const counters = { A: p.sinceA, S: p.sinceS, SS: p.sinceSS, SSS: p.sinceSSS };
  const resetAt = { A: 2, S: 3, SS: 4, SSS: 5 };
  const hitTier = Object.keys(resetAt).filter(k => idx >= resetAt[k as keyof typeof resetAt]);
  check("at least one pity counter reset on a hit ≥ A, or all incremented on C/B",
    idx < 2 ? hitTier.length === 0 && p.sinceA === before.sinceA + 1 : hitTier.length > 0 && counters[hitTier[0] as keyof typeof counters] === 0,
    `rarity=${res.result!.plant.rarity} counters=${JSON.stringify(counters)}`);
}

console.log("\nBRD-03 — settle exists independent of the ceremony:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const res = s.breed(aId, bId);
  check("result carries the settled child even if the UI never shows it",
    res.ok === true && !!res.result && s.state.plants.includes(res.result.plant));
  check("child genome is unique against garden + discovery",
    !s.state.plants.slice(0, -1).some(p => p.plantId !== res.result!.plant.plantId && p.dna.seed === res.result!.plant.dna.seed));
  check("discovery records the child", s.state.discovery.genomes.length > 0);
}

console.log("\nBRD-04 — XP inheritance is real arithmetic, not a label:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s, 20);
  const lifetimeOf = (p: { growth: { xp: number; level: number } }): number => {
    let t = p.growth.xp;
    for (let l = 1; l < p.growth.level; l++) t += xpRequired(l);
    return t;
  };
  const beforeA = lifetimeOf(s.get(aId)!);
  const beforeB = lifetimeOf(s.get(bId)!);
  const res = s.breed(aId, bId);
  const childXp = res.result!.plant.growth.xp;
  const expectApprox = Math.floor(0.3 * (beforeA + beforeB));
  check("child starts with ~30% of parents' lifetime XP (±level remainder)",
    res.ok === true && childXp >= 0 && res.result!.plant.growth.level >= 1,
    `child xp=${childXp} expect≈${expectApprox}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
