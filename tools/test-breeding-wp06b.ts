/**
 * WP06b — the §10 gaps WP06 left: fee boundary ±1, pity soft/hard thresholds,
 * corrupt parent ids, full-nursery semantics, every protocol, duplicate rapid
 * settle, and save/reload survival of a settled result.
 *
 *   - fee edge: leafCoin = fee−1 must refuse and move nothing; leafCoin = fee
 *     must settle with exactly one debit.
 *   - pity: the soft tables turn on at exactly aAfter/sAfter/ssAfter/sssSoft,
 *     and sssHard is a *guarantee* — the published odds must read SSS=10000
 *     AND the roll must produce SSS and reset the counter.
 *   - nursery: at cap a breed is legal (parents out, child in — net −1); an
 *     over-cap garden refuses.
 *   - duplicates: two synchronous breed() calls can only settle once — the
 *     second call sees the parents already gone and refuses.
 */
import { GameStore } from "../src/core/store";
import { SPECIES } from "../src/config/species";

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
import { PROTOCOLS, protocolUnlocked } from "../src/genetics/protocols";
import { PITY } from "../src/config/rarity";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function fresh(): GameStore {
  memory.clear();
  const s = new GameStore();
  s.state.plants = [];
  return s;
}

function twoParents(store: GameStore, level = 14): { aId: string; bId: string } {
  for (const id of [SPECIES[0].id, SPECIES[1].id]) {
    store.state.seeds[id] = 2;
    store.plantSeed(id);
    const p = store.state.plants[store.state.plants.length - 1];
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = level;
    p.locks.manual = false;
  }
  store.state.leafCoin = 1_000_000;
  return { aId: store.state.plants[0].plantId, bId: store.state.plants[1].plantId };
}

console.log("\nfee boundary ±1 — under refuses clean, exact settles once:");
{
  const under = fresh();
  const { aId, bId } = twoParents(under);
  const fee = under.breedingFee(aId, bId);
  under.state.leafCoin = fee - 1;
  const plantsBefore = under.state.plants.length;
  const r1 = under.breed(aId, bId);
  check("fee−1 refuses", r1.ok === false, r1.reason);
  check("fee−1 moves nothing: no child, both parents, no debit",
    under.state.plants.length === plantsBefore && under.state.ledger.every(l => !/Phí lai/.test(l.reason)),
    `plants=${under.state.plants.length} ledger=${under.state.ledger.length}`);

  const exact = fresh();
  const p2 = twoParents(exact);
  const fee2 = exact.breedingFee(p2.aId, p2.bId);
  exact.state.leafCoin = fee2;
  const r2 = exact.breed(p2.aId, p2.bId);
  check("fee exact settles", r2.ok === true, r2.reason);
  check("exactly one fee debit lands in the ledger",
    exact.state.ledger.filter(l => l.delta === -fee2 && /Phí lai/.test(l.reason)).length === 1,
    `lines=${exact.state.ledger.filter(l => /Phí lai/.test(l.reason)).length}`);
  // Breeder level-ups legitimately credit leafCoin mid-settle; the wallet must
  // still reconcile against every leafCoin ledger line (the pollen credit is a
  // separate wallet and must not leak in).
  const leafDelta = exact.state.ledger
    .filter(l => !/^Lai tạo:/.test(l.reason))
    .reduce((sum, l) => sum + l.delta, 0);
  check("wallet reconciles with leafCoin ledger lines (fee + level-ups only)",
    exact.state.leafCoin === fee2 + leafDelta,
    `balance=${exact.state.leafCoin} expected=${fee2 + leafDelta}`);
}

console.log("\ncorrupt ids — every bad pair refuses without spending:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const before = { plants: s.state.plants.length, coin: s.state.leafCoin, pity: { ...s.state.pity } };
  for (const [a, b, tag] of [
    ["ghost-a", "ghost-b", "both missing"],
    [aId, "ghost-b", "B missing"],
    ["ghost-a", bId, "A missing"],
    [aId, aId, "same id"],
    ["", "", "empty ids"],
  ] as const) {
    const r = s.breed(a, b);
    check(`refuses with ${tag}`, r.ok === false && !!r.reason, `${tag} -> ${JSON.stringify(r)}`);
  }
  check("no corrupt call moved state",
    s.state.plants.length === before.plants && s.state.leafCoin === before.coin
      && s.state.pity.totalBreeds === before.pity.totalBreeds,
    `pity.totalBreeds=${s.state.pity.totalBreeds}`);
}

console.log("\nnursery semantics — at cap breeds (net −1), over-cap refuses:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  s.state.nurseryCap = 2; // two parents fill the cap exactly
  const r = s.breed(aId, bId);
  check("at-cap breed is legal and lands a child", r.ok === true && s.state.plants.length === 1,
    `ok=${r.ok} plants=${s.state.plants.length}`);

  const over = fresh();
  const p2 = twoParents(over);
  // A third plant makes the post-breed count (2) still exceed the cap — the
  // pathological over-grown save must refuse, not keep violating the cap.
  over.state.seeds[SPECIES[2].id] = 2;
  over.plantSeed(SPECIES[2].id);
  over.state.nurseryCap = 1;
  const r2 = over.breed(p2.aId, p2.bId);
  check("over-cap refuses with the full-garden reason",
    r2.ok === false && /đầy|full/i.test(r2.reason ?? ""), r2.reason);
  check("over-cap refusal spent nothing", over.state.plants.length === 3,
    `plants=${over.state.plants.length}`);
}

console.log("\nevery unlocked protocol settles exactly once:");
{
  let allOk = true;
  const details: string[] = [];
  for (const p of PROTOCOLS) {
    const s = fresh();
    const { aId, bId } = twoParents(s);
    s.state.breederLevel = Math.max(60, p.levelRequired + 1);
    const unlocked = protocolUnlocked(p.id, s.state.breederLevel);
    const r = s.breed(aId, bId, p.id);
    const feeLines = s.state.ledger.filter(l => /Phí lai/.test(l.reason)).length;
    if (!(unlocked && r.ok === true && feeLines === 1 && s.state.pity.totalBreeds === 1)) {
      allOk = false;
      details.push(`${p.id}: unlocked=${unlocked} ok=${r.ok} fee=${feeLines} pity=${s.state.pity.totalBreeds} reason=${r.reason ?? "-"}`);
    }
  }
  check("all protocols settle atomically", allOk, details.join(" | ") || `${PROTOCOLS.length} protocols`);
}

console.log("\nduplicate rapid settle — the second call sees spent parents:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const plantsBefore = s.state.plants.length;
  const r1 = s.breed(aId, bId);
  const r2 = s.breed(aId, bId); // double-tap / rerender re-call
  check("first call settles", r1.ok === true);
  check("second identical call refuses — no double settle",
    r2.ok === false && !!r2.reason, r2.reason);
  check("exactly one child and one fee after the duplicate",
    s.state.plants.length === plantsBefore - 1
      && s.state.ledger.filter(l => /Phí lai/.test(l.reason)).length === 1,
    `plants=${s.state.plants.length} feeLines=${s.state.ledger.filter(l => /Phí lai/.test(l.reason)).length}`);
  check("pity moved exactly once", s.state.pity.totalBreeds === 1, `total=${s.state.pity.totalBreeds}`);
}

console.log("\npity thresholds — soft boosts at exact counters, hard guarantee at sssHard:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  s.state.pity.sinceA = PITY.aAfter;
  const w20 = s.breedingPreview(aId, bId)!.A;
  s.state.pity.sinceA = PITY.aAfter + 1; // boost = (counter − threshold) × step
  const w21 = s.breedingPreview(aId, bId)!.A;
  check(`A weight lifts once past sinceA=${PITY.aAfter} (soft pity on)`,
    w21 > w20, `A: ${w20}→${w21} bps`);

  s.state.pity.sinceA = 0;
  s.state.pity.sinceS = PITY.sAfter;
  const wS60 = s.breedingPreview(aId, bId)!.S;
  s.state.pity.sinceS = PITY.sAfter + 1;
  const wS61 = s.breedingPreview(aId, bId)!.S;
  check(`S weight lifts once past sinceS=${PITY.sAfter}`, wS61 > wS60, `S: ${wS60}→${wS61} bps`);

  const hard = fresh();
  const p2 = twoParents(hard);
  hard.state.pity.sinceSSS = PITY.sssHard - 1;
  const wSoft = hard.breedingPreview(p2.aId, p2.bId)!.SSS;
  check("sssHard−1 does NOT guarantee", wSoft < 10000, `SSS=${wSoft} bps`);
  hard.state.pity.sinceSSS = PITY.sssHard;
  const wHard = hard.breedingPreview(p2.aId, p2.bId)!;
  check("sssHard publishes SSS=10000 bps exactly", wHard.SSS === 10000, JSON.stringify(wHard));
  const r = hard.breed(p2.aId, p2.bId);
  check("sssHard roll produces the guaranteed SSS child",
    r.ok === true && r.result!.plant.rarity === "SSS", `rarity=${r.result?.plant.rarity}`);
  check("the hit resets the SSS counter", hard.state.pity.sinceSSS === 0, `sinceSSS=${hard.state.pity.sinceSSS}`);
}

console.log("\nsave/reload — a settled result survives without the ceremony:");
{
  const s = fresh();
  const { aId, bId } = twoParents(s);
  const res = s.breed(aId, bId);
  const childId = res.result!.plant.plantId;
  const pityAfter = { ...s.state.pity };
  // Same slot, fresh instance — the reload path.
  const s2 = new GameStore();
  check("child persisted across reload", s2.state.plants.some(p => p.plantId === childId));
  check("parents stayed spent across reload",
    !s2.state.plants.some(p => p.plantId === aId || p.plantId === bId),
    `plants=${s2.state.plants.length}`);
  check("pity counters persisted",
    s2.state.pity.totalBreeds === pityAfter.totalBreeds, `total=${s2.state.pity.totalBreeds}`);
  check("a post-reload breed cannot re-spend the parents",
    s2.breed(aId, bId).ok === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
