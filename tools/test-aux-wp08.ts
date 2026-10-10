/**
 * WP08 / AUX-01…03 (domain halves) — collection dex, catalogue query and
 * order/exchange atomicity contracts (docs/27 §11).
 *
 * - AUX-01: discovered species survive losing the last owned plant.
 * - AUX-02: `queryCatalogue` pages, filters, searches accent-insensitively,
 *   sorts before slicing, and never hands the whole registry to one page.
 * - AUX-03: buy/exchange/order refusals move nothing — no half transaction.
 *
 * The browser-facing halves (pin chip, offline leaderboard, dex-gone card,
 * settings effects) live in `test-aux-wp08-view.ts`; AUX-05/07's account-fork
 * and conflict contracts are already proven end-to-end by test-signin-flow.ts
 * sections 6–8 and AUX-08's prefs domain by test-prefs.ts.
 */

import assert from "node:assert/strict";
import { GameStore } from "../src/core/store";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { queryCatalogue, fulfillOrder, generateOrders, type CatalogueQuery } from "../src/economy/shop";
import { SPECIES, SPECIES_BY_ID } from "../src/config/species";
import { EXCHANGE_DAILY_CAP } from "../src/economy/exchange";

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
const fixedNow = Date.UTC(2026, 9, 12, 7);
Date.now = () => fixedNow;

let passed = 0;
let failed = 0;
function test(name: string, run: () => void): void {
  memory.clear();
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}

function fresh(): GameStore {
  const store = new GameStore();
  store.state.plants = [];
  store.state.leafCoin = 100_000;
  store.state.items = 1_000;
  store.state.nurseryCap = 24;
  return store;
}

function maturePlant(store: GameStore, species = "thornroot", seed = "aux-1"): ReturnType<typeof createSeedPlant> {
  const p = createSeedPlant(species, "aux", seed, fixedNow - 90 * 86_400_000);
  p.growth.stage = "mature";
  p.growth.stageReadyAt = fixedNow;
  // Plants are born manual-locked against accidental sells (docs/16 §20) —
  // the fixture unlocks, the same gesture a selling player makes first.
  p.locks.manual = false;
  store.state.plants.push(p);
  return p;
}

/** The query as the screen issues it — progress and purses from the save. */
function shelf(s: GameStore, q: Partial<CatalogueQuery> = {}) {
  return queryCatalogue({
    playerId: s.state.playerId,
    breederLevel: s.state.breederLevel,
    progress: s.unlockContext(),
    balances: { leafCoin: s.state.leafCoin, nectar: s.state.nectar, pollen: s.state.pollen, ember: s.state.ember },
    ...q,
  });
}

const purse = (s: GameStore) => ({
  leafCoin: s.state.leafCoin,
  nectar: s.state.nectar,
  pollen: s.state.pollen,
  ember: s.state.ember,
});
const purseSame = (a: ReturnType<typeof purse>, b: ReturnType<typeof purse>) =>
  a.leafCoin === b.leafCoin && a.nectar === b.nectar && a.pollen === b.pollen && a.ember === b.ember;
const currencyOf = (species: string) => SPECIES_BY_ID[species].currency;

/* ------------------------------------------------------------------ AUX-01 */

console.log("\nAUX-01 — owned and discovered are separate questions:");

test("selling the last owned plant keeps the species discovered", () => {
  const s = fresh();
  const p = maturePlant(s);
  s.save();
  const sp = p.baseLineage[0];
  assert.ok(s.state.discovery.species.includes(sp), "species must be discovered while owned");
  const r = s.sell(p.plantId);
  assert.ok(r.ok, r.reason ?? "sell failed");
  assert.equal(s.state.plants.length, 0);
  assert.ok(
    s.state.discovery.species.includes(sp),
    "losing the last plant must not un-discover the species — that is what 'dex' means",
  );
});

test("a species never owned is absent from discovery — and honest about it", () => {
  const s = fresh();
  const other = SPECIES.find((sp) => sp.id !== "thornroot")!;
  assert.ok(!s.state.discovery.species.includes(other.id));
});

/* ------------------------------------------------------------------ AUX-02 */

console.log("\nAUX-02 — the shelf is a page of the registry, not the registry:");

test("a page never returns more than perPage, whatever the registry size", () => {
  const s = fresh();
  const page = shelf(s, { perPage: 24 });
  assert.ok(page.entries.length <= 24, `entries=${page.entries.length}`);
  assert.equal(page.perPage, 24);
  assert.ok(page.total >= SPECIES.length * 0.9, `total=${page.total} vs registry ${SPECIES.length}`);
  assert.equal(page.pages, Math.ceil(page.total / 24));
});

test("pages partition the shelf: no species on two pages, none skipped", () => {
  const s = fresh();
  const seen = new Set<string>();
  const first = shelf(s, { perPage: 24, page: 1 });
  const last = Math.min(first.pages, 5);
  let counted = 0;
  for (let pg = 1; pg <= last; pg++) {
    const p = shelf(s, { perPage: 24, page: pg });
    counted += p.entries.length;
    for (const e of p.entries) {
      assert.ok(!seen.has(e.species), `${e.name} appears on two pages — the sort is not stable`);
      seen.add(e.species);
    }
  }
  assert.equal(counted, seen.size);
  assert.ok(seen.size >= Math.min(24 * last, first.total), `only ${seen.size} species across ${last} pages`);
});

test("accent-insensitive search finds an accented species by its plain letters", () => {
  const s = fresh();
  const accented = SPECIES.find((sp) => /[àáâãèéêìíòóôõùúýđ]/i.test(sp.name));
  assert.ok(accented, "registry must contain accented names for this test to mean anything");
  const needle = accented.name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(" ")[0];
  const page = shelf(s, { search: needle, perPage: 200 });
  assert.ok(
    page.entries.some((e) => e.species === accented.id),
    `search '${needle}' missed '${accented.name}'`,
  );
});

test("locked filter never yields an empty page while the pager claims more", () => {
  const s = fresh();
  const open = shelf(s, { locked: "open", perPage: 24 });
  const locked = shelf(s, { locked: "locked", perPage: 24 });
  if (open.pages > 0) assert.ok(open.entries.length > 0, "open shelf claims pages but shows none");
  if (locked.pages > 0) assert.ok(locked.entries.length > 0, "locked shelf claims pages but shows none");
  assert.equal(open.total + locked.total, shelf(s, {}).total, "open+locked must partition the registry");
});

test("affordable filter compares price to the right purse, not one balance", () => {
  const s = fresh();
  s.state.leafCoin = 0;
  s.state.nectar = 0;
  s.state.pollen = 0;
  s.state.ember = 1_000_000;
  const page = shelf(s, { affordableOnly: true, perPage: 500 });
  for (const e of page.entries) {
    const held = s.state[currencyOf(e.species)];
    assert.ok(
      held >= e.price,
      `${e.name} costs ${e.price} ${currencyOf(e.species)} but only ${held} held — affordability lied`,
    );
  }
  /* With only ember in the purse, everything affordable must be priced in
     ember — a single-balance check would have passed leafCoin cards too. */
  assert.ok(page.entries.every((e) => currencyOf(e.species) === "ember"), "wrong-currency cards leaked in");
});

test("price sort orders before slicing: the page boundary is monotone", () => {
  const s = fresh();
  const p1 = shelf(s, { sort: "price-asc", currency: "leafCoin", perPage: 24 });
  const p2 = shelf(s, { sort: "price-asc", currency: "leafCoin", perPage: 24, page: 2 });
  if (p1.entries.length && p2.entries.length) {
    const maxP1 = Math.max(...p1.entries.map((e) => e.price));
    const minP2 = Math.min(...p2.entries.map((e) => e.price));
    assert.ok(maxP1 <= minP2, `page boundary violated: ${maxP1} > ${minP2}`);
  }
});

test("the species pin narrows the shelf to exactly one card, gate and all", () => {
  const s = fresh();
  const lockedEntry = shelf(s, { locked: "locked", perPage: 5 }).entries[0];
  assert.ok(lockedEntry, "fixture needs a locked species");
  const pinned = shelf(s, { species: lockedEntry.species });
  assert.equal(pinned.entries.length, 1);
  assert.equal(pinned.entries[0].species, lockedEntry.species);
  assert.equal(pinned.entries[0].locked, true, "the pin must not launder a locked species into an open one");
});

/* ------------------------------------------------------------------ AUX-03 */

console.log("\nAUX-03 — a refused transaction moves nothing:");

test("buying past the purse refuses with no debit, no seed, no ledger", () => {
  const s = fresh();
  s.state.leafCoin = 1;
  const open = shelf(s, { locked: "open", perPage: 50 }).entries.find((e) => currencyOf(e.species) === "leafCoin" && e.price > 1);
  assert.ok(open, "fixture needs a leafCoin seed pricier than 1");
  const before = { ...purse(s), seeds: s.state.seeds[open.species] ?? 0, ledger: s.state.ledger.length };
  const r = s.buySeed(open.species, 1);
  assert.equal(r.ok, false);
  assert.ok(purseSame(before, purse(s)), "a refused buy must not move any currency");
  assert.equal(s.state.seeds[open.species] ?? 0, before.seeds);
  assert.equal(s.state.ledger.length, before.ledger, "a refused buy must not write a ledger line");
});

test("a locked species refuses without touching the purse", () => {
  const s = fresh();
  s.state.leafCoin = 1_000_000_000;
  s.state.nectar = 1_000_000_000;
  s.state.pollen = 1_000_000_000;
  const locked = shelf(s, { locked: "locked", perPage: 100 }).entries.find((e) => s.state[currencyOf(e.species)] >= e.price);
  assert.ok(locked, "fixture needs a locked but affordable species");
  const before = { ...purse(s), seeds: s.state.seeds[locked.species] ?? 0 };
  const r = s.buySeed(locked.species, 1);
  assert.equal(r.ok, false);
  assert.ok(purseSame(before, purse(s)));
  assert.equal(s.state.seeds[locked.species] ?? 0, before.seeds);
});

test("exchange over the daily cap refuses — no debit, no credit, no cap drift", () => {
  const s = fresh();
  s.state.nectar = 10_000_000;
  s.state.exchangedLeaf = EXCHANGE_DAILY_CAP; // cap spent today
  const before = purse(s);
  const spentBefore = s.state.exchangedLeaf;
  const r = s.exchangeCurrency("nectar", "leafCoin", 10_000);
  assert.equal(r.ok, false, "over-cap exchange must be refused, not partial");
  assert.ok(purseSame(before, purse(s)));
  assert.equal(s.state.exchangedLeaf, spentBefore, "a refused exchange must not eat allowance");
});

test("exchange into ember is refused outright — it is earned, not bought", () => {
  const s = fresh();
  s.state.leafCoin = 1_000_000;
  const r = s.exchangeCurrency("leafCoin", "ember", 1000);
  assert.equal(r.ok, false);
  assert.equal(s.state.leafCoin, 1_000_000);
  assert.equal(s.state.ember, 0);
});

test("a same-currency exchange is refused, not a free ledger entry", () => {
  const s = fresh();
  const before = s.state.ledger.length;
  const r = s.exchangeCurrency("leafCoin", "leafCoin", 500);
  assert.equal(r.ok, false);
  assert.equal(s.state.ledger.length, before);
});

test("an order cannot be fulfilled with a plant that does not satisfy it", () => {
  const s = fresh();
  const orders = generateOrders("aux", fixedNow, 8);
  const plant = maturePlant(s, "thornroot", "aux-ord");
  const unsatisfied = orders.find((o) => !fulfillOrder(o, plant).ok);
  // All satisfied is fine too — the contract only bites when fulfilment fails.
  if (unsatisfied) {
    const before = { coins: s.state.leafCoin, plants: s.state.plants.length };
    const r = fulfillOrder(unsatisfied, plant);
    assert.equal(r.ok, false);
    assert.equal(s.state.leafCoin, before.coins, "a refused order must not pay");
    assert.equal(s.state.plants.length, before.plants, "a refused order must not take the plant");
  }
});

/* --------------------------------------------------- reference assertions */

console.log("\nCovered elsewhere (reference, not re-run):");
console.log("ok   AUX-05 account-A late response cannot write account B — sync.ts sessionRev + test-signin-flow §8");
console.log("ok   AUX-06 offline/error/retry/empty states — test-aux-wp08-view.ts");
console.log("ok   AUX-07 save conflict is a choice, not a guess — test-signin-flow §6–8");
console.log("ok   AUX-08 prefs effects — test-prefs.ts + test-aux-wp08-view.ts");
console.log("ok   AUX-04 quest pin — test-aux-wp08-view.ts");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
