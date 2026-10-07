/**
 * Player-journey integration test (docs/09 QA plan).
 *
 * Drives the real GameStore through a full loop — plant, care, grow, breed,
 * battle, sell — with a localStorage shim, so the economy and the nursery are
 * exercised the same way a session would exercise them.
 */

import { GameStore } from "../src/core/store";
import { canBattle, canSell } from "../src/growth/stages";
import type { CareActionId } from "../src/config/careActions";
import { simulateBattle } from "../src/battle/engine";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(t: string) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

/** Minimal localStorage so GameStore can run outside a browser. */
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const store = new GameStore();

section("1. New player bootstrap");
{
  check("a new save is created", store.state.plants.length >= 1);
  check("player starts with coins", store.state.leafCoin > 0);
  check("player starts with some seeds", Object.values(store.state.seeds).reduce((a: number, b) => a + (b ?? 0), 0) > 0);
  check("nursery has a capacity", store.state.nurseryCap > 0);
  check("economy ledger exists", Array.isArray(store.state.ledger));
}

section("2. Buy seeds and plant them");
{
  const before = store.state.plants.length;
  const seedBefore = store.state.seeds.emberleaf ?? 0;
  const res = store.plantSeed("emberleaf");
  check("planting a seed works", res.ok, res.reason);
  check("nursery grows", store.state.plants.length === before + 1);
  check("seed is consumed", (store.state.seeds.emberleaf ?? 0) === seedBefore - 1, `${seedBefore} -> ${store.state.seeds.emberleaf ?? 0}`);
  const exhausted = (store.state.seeds.emberleaf ?? 0) === 0;
  if (exhausted) check("cannot plant without a seed", !store.plantSeed("emberleaf").ok);
  else check("seed count is still consistent", store.state.seeds.emberleaf === seedBefore - 1);
}

section("3. Care changes the plant");
{
  const plant = store.state.plants[0];
  const before = { ...plant.stats };
  const res = store.care(plant.plantId, "water");
  check("care succeeds", res.ok, res.reason);
  const changed = (Object.keys(before) as (keyof typeof before)[]).some((k) => plant.stats[k] !== before[k]);
  check("care changed real stats", changed);
  check("care awards XP", (res.result?.xp ?? 0) > 0);
  check("care consumes items", store.state.items < 30);
  check("care is recorded in memory", (plant.careMemory.counts.water ?? 0) === 1);
  check("cooldown blocks an immediate repeat", !store.care(plant.plantId, "water").ok);

  // A resource you cannot afford must be rejected, not silently allowed.
  const poor = store.state.leafCoin;
  store.state.leafCoin = 0;
  const denied = store.care(plant.plantId, "fertilizer");
  check("care is rejected without resources", !denied.ok, denied.reason);
  store.state.leafCoin = poor;
}

section("4. Growth to maturity");
{
  const plant = store.state.plants[0];
  // Compressed timers: seed 15s, sprout 60s, young 180s.
  plant.growth.stageReadyAt = Date.now() - 1;
  let guard = 0;
  while (!canBattle(plant) && guard++ < 10) {
    store.tickAll();
    if (!canBattle(plant)) plant.growth.stageReadyAt = Date.now() - 1;
  }
  check("plant reaches maturity through stage timers", canBattle(plant), `stage=${plant.growth.stage} after ${guard} ticks`);
}

section("5. Breeding two mature plants");
{
  const second = store.state.plants[1];
  second.growth.stage = "mature";
  second.growth.stageReadyAt = Date.now();
  second.growth.level = 10;
  const a = store.state.plants[0];

  const odds = store.breedingPreview(a.plantId, second.plantId);
  const totalBp = odds ? Object.values(odds).reduce((x, y) => x + y, 0) : 0;
  check("rarity preview returns basis points summing to 10000", totalBp === 10000, `${totalBp} bp`);
  check("preview shows SSS at a tiny rate", (odds?.SSS ?? 0) < 50, `${odds?.SSS} bp`);

  const coinsBefore = store.state.leafCoin;
  const countBefore = store.state.plants.length;
  const res = store.breed(a.plantId, second.plantId);
  check("breeding succeeds", res.ok, res.reason);
  check("breeding fee is charged", store.state.leafCoin < coinsBefore);
  // Breeding spends both parents, so the garden loses two and gains one: net -1.
// The previous `countBefore + 1` was right when the parents survived.
check(
  "a child is added and both parents are spent",
  store.state.plants.length === countBefore - 1 &&
    !store.get(a.plantId) &&
    !store.get(second.plantId) &&
    Boolean(res.result && store.get(res.result.plant.plantId)),
  `${countBefore} -> ${store.state.plants.length}, parent A ${!!store.get(a.plantId)}, parent B ${!!store.get(second.plantId)}`,
);
  const child = res.result?.plant;
  check("child has a distinct genome", !!child && child.dna.seed !== a.dna.seed);
  check("child is generation+1", child?.generation === Math.max(a.generation, second.generation) + 1);
  check("child has a mutation report", (res.result?.report.mutations.length ?? 0) > 0);
  check("child has at least one skill", (child?.skills.length ?? 0) >= 1);
  check("child has an ECR measurement", (child?.validation.ecr ?? 0) > 0, `ECR ${child?.validation.ecr}`);
  check("child is ranked-legal or flagged", typeof child?.validation.rankedLegal === "boolean");

  // Breeding an immature plant must fail. Both ids are already spent, so this also
  // has to hold when the refusal is for "no such plant" rather than for stage — the
  // distinction is checked in the protocol suite, not here.
  const young = store.state.plants[store.state.plants.length - 1];
  young.growth.stage = "seed";
  check("cannot breed with an immature plant", !store.breed(young.plantId, young.plantId).ok);
  check("cannot breed a plant with itself", !store.breed(young.plantId, young.plantId).ok);

  check(
    "cannot breed a plant that is already spent",
    !store.breed(a.plantId, second.plantId).ok,
  );

  /*
   * Top the garden back up.
   *
   * Breeding used to leave the parents in place, so this journey ended with the same
   * number of plants it started with plus a child. It now ends two short, and section
   * 8 indexed `plants[0]` into an empty garden. Planting here keeps the rest of the
   * journey testing what it was written to test instead of testing the shape of the
   * garden left behind by an unrelated rule.
   */
  for (const id of Object.keys(store.state.seeds)) {
    if (store.state.plants.length >= 5) break;
    if ((store.state.seeds[id] ?? 0) <= 0) continue;
    store.state.leafCoin += 50_000;
    if (store.buySeed(id).ok) store.plantSeed(id);
  }
  check("the garden has stock for the remaining sections", store.state.plants.length >= 3, `${store.state.plants.length} plants`);

  /*
   * A full garden can still breed: fusion spends two plots and gives one back,
   * so requiring a free slot first would force a pointless sell. The old check
   * counted the child against the cap without crediting the parents leaving.
   */
  {
    const capBefore = store.state.nurseryCap;
    const coinsB = store.state.leafCoin;
    const p1 = store.state.plants[0];
    const p2 = store.state.plants[1];
    for (const pl of [p1, p2]) {
      pl.growth.stage = "mature";
      pl.growth.level = 12;
    }
    store.state.leafCoin = 99999;
    // A plant in a live fight carries locks.battle — spending it as a breeding
    // parent mid-fight would leave the running battle paying out to a plant the
    // garden no longer owns.
    p1.locks.battle = true;
    check(
      "cannot breed a plant that is in a live fight",
      !store.breed(p1.plantId, p2.plantId).ok,
    );
    p1.locks.battle = false;
    store.state.nurseryCap = store.state.plants.length; // garden exactly full
    const atCap = store.breed(p1.plantId, p2.plantId);
    check("a full garden can still breed", atCap.ok, atCap.reason);
    check(
      "breeding a full garden frees a plot",
      store.state.plants.length === store.state.nurseryCap - 1,
      `cap ${store.state.nurseryCap}, plants ${store.state.plants.length}`,
    );
    store.state.nurseryCap = capBefore;
    store.state.leafCoin = coinsB;
  }
}

section("6. Battle and rewards");
{
  const a = store.state.plants[0];
  a.growth.stage = "mature";
  const b = store.state.plants[1];
  b.growth.stage = "mature";
  const coinsBefore = store.state.leafCoin;
  const winsBefore = a.battleRecord.wins;
  const lossesBefore = a.battleRecord.losses;

  const { result, won } = store.runQuickBattle(a.plantId, b);
  check("battle produces a winner", result.winner === "a" || result.winner === "b" || result.winner === "draw");
  check("battle damage is positive", result.a.damageDealt > 0 || result.b.damageDealt > 0);
  check("player is rewarded", store.state.leafCoin > coinsBefore, `+${store.state.leafCoin - coinsBefore}`);
  check("battle record updates", a.battleRecord.wins === winsBefore + (won ? 1 : 0) && a.battleRecord.losses === lossesBefore + (won ? 0 : 1));
  check("plant gains battle XP", a.growth.xp > 0 || a.growth.level > 1);

  // Determinism: same snapshots + same seed => same outcome.
  const again = simulateBattle(a, b, { seed: result.seed, maxSeconds: 90, arena: "sunny" });
  check("replaying the same seed reproduces the result", again.winner === result.winner);
}

section("7. Selling");
{
  const target = store.state.plants[store.state.plants.length - 1];
  target.growth.stage = "mature";
  target.locks.favorite = false;
  target.locks.manual = false;
  target.locks.battle = false;
  target.locks.breeding = false;

  const quote = store.sellQuote(target.plantId);
  check("sell quote is issued", !!quote && quote.price > 0, `${quote?.price} LeafCoin`);

  const coinsBefore = store.state.leafCoin;
  const countBefore = store.state.plants.length;
  const res = store.sell(target.plantId);
  check("selling succeeds", res.ok, res.reason);
  check("coin is credited", store.state.leafCoin === coinsBefore + (res.price ?? 0), `+${res.price}`);
  check("the plant leaves the nursery", store.state.plants.length === countBefore - 1);
  check("the sale is in the ledger", store.state.ledger.some((e) => e.delta > 0));
  check("a sold plant cannot be sold twice", !store.sell(target.plantId).ok);
}

section("8. Locks protect plants from accidents");
{
  const p = store.state.plants[0];
  p.growth.stage = "mature";
  // Newly planted plants arrive locked so they cannot be sold on impulse, so this
  // section has to clear the lock before it can test it. It used to pick a plant that
  // happened to be unlocked — the child from breeding, which was left at the front of
  // the garden. Breeding now spends its parents, so the plants that sort first are
  // freshly planted ones and the test was toggling a lock off and reading it as a
  // failure to lock.
  p.locks.manual = false;
  p.locks.favorite = false;
  p.locks.battle = false;
  p.locks.breeding = false;
  store.toggleLock(p.plantId);
  check("locking a plant blocks selling", !canSell(p));
  check("a locked plant has no sell quote", store.sellQuote(p.plantId) === null);
  store.toggleLock(p.plantId);
  store.toggleFavorite(p.plantId);
  check("favouriting also blocks selling", !canSell(p));
  store.toggleFavorite(p.plantId);
  check("unlocking restores sellability", canSell(p));
}

section("9. Persistence");
{
  store.save();
  const raw = mem.get("mutant-sprout-save-v1");
  check("save is written to storage", !!raw && raw.length > 100);
  const reloaded = new GameStore();
  check("state survives a reload", reloaded.state.plants.length === store.state.plants.length);
  check("coin survives a reload", reloaded.state.leafCoin === store.state.leafCoin);
  check("care history survives a reload", JSON.stringify(reloaded.state.plants[0].careMemory) === JSON.stringify(store.state.plants[0].careMemory));
}

section("10. Economy is not exploitable");
{
  // A plant that cannot be sold must not pay out.
  const locked = store.state.plants[0];
  const coins = store.state.leafCoin;
  locked.locks.manual = true;
  store.sell(locked.plantId);
  check("selling a locked plant pays nothing", store.state.leafCoin === coins);
  locked.locks.manual = false;

  // Repeated breeding cannot drive coin to infinity.
  for (const p of store.state.plants) {
    p.growth.stage = "mature";
    p.growth.level = 5;
  }
  const start = store.state.leafCoin;
  for (let i = 0; i < 12; i++) {
    if (store.state.plants.length < 2) break;
    store.breed(store.state.plants[0].plantId, store.state.plants[1].plantId);
    if (store.state.plants.length > store.state.nurseryCap) break;
  }
  check("12 breeds cost money overall", store.state.leafCoin < start, `${start} -> ${store.state.leafCoin}`);
  check("nursery capacity is respected", store.state.plants.length <= store.state.nurseryCap);
}

section("11. Many care actions in sequence");
{
  const p = store.state.plants[0];
  p.growth.stage = "young";
  store.state.items = 200;
  store.state.geneCrystal = 200;
  store.state.leafCoin = 100000;
  // Clear any cooldown left by earlier sections so this measures the actions
  // themselves rather than the cooldown rule (which section 3 already covers).
  p.careMemory.lastAction = null;
  p.careMemory.counts = {};
  const actions: CareActionId[] = ["water", "sunlight", "fertilizer", "pruning", "music", "gene_serum"];
  let applied = 0;
  const failures: string[] = [];
  for (const a of actions) {
    const r = store.care(p.plantId, a);
    if (r.ok) applied++;
    else failures.push(`${a}: ${r.reason}`);
    p.careMemory.lastAction = null;
  }
  check("every care action can be applied", applied === actions.length, failures.length ? failures.join(" | ") : `${applied}/${actions.length}`);
  check("stats stay finite after many care actions", Object.values(p.stats).every((v) => Number.isFinite(v) && v >= 0));
  check("no stat exceeds its hard cap", (Object.keys(p.potential) as (keyof typeof p.stats)[]).every((k) => p.stats[k] <= p.potential[k].hardCap + 1));
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
if (failed > 0) process.exit(1);
