import assert from "node:assert/strict";
import { GameStore, seedPackPrice } from "../src/core/store";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { simulateBattle, STANCE_LABEL, type Stance } from "../src/battle/engine";
import { CARE_ACTIONS, type CareActionId } from "../src/config/careActions";
import { applyCare, previewCare, careCooldownLeft } from "../src/growth/care";
import { CURRENCY_IDS } from "../src/core/currency";
import { quoteExchange, costIn, LEAF_VALUE, EXCHANGE_DAILY_CAP, type ExchangeQuote } from "../src/economy/exchange";
import { saveSlotKey, setActiveAccountId } from "../src/core/saveSlot";
import { renderPlantSvg } from "../src/render/plantRenderer";

// Isolate persistence and time: the tests never touch a real browser or account.
const memory = new Map<string, string>();
let refuseWrites = false;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (refuseWrites) throw new Error("QuotaExceededError");
    memory.set(key, String(value));
  },
  removeItem: (key: string) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
} });
const realNow = Date.now;
const fixedNow = Date.UTC(2026, 9, 10, 5);
Date.now = () => fixedNow;
let passed = 0;
let failed = 0;
function test(name: string, run: () => void): void {
  memory.clear();
  refuseWrites = false;
  setActiveAccountId(null);
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  } finally {
    refuseWrites = false;
  }
}
const snapshot = (store: GameStore) => JSON.stringify(store.state);
function fresh(): GameStore {
  const store = new GameStore();
  store.state.leafCoin = 100_000;
  store.state.items = 1_000;
  store.state.geneCrystal = 100;
  return store;
}
function mature(id: string) {
  const plant = createSeedPlant("thornroot", "technical", id, fixedNow);
  plant.growth.level = 20;
  plant.growth.stage = "mature";
  plant.tier = "bloom";
  return plant;
}

try {
  for (const count of [-1, 0, 0.5, NaN, Infinity, -Infinity]) {
    test(`purchase rejects ${String(count)} atomically`, () => {
      const store = fresh();
      const before = snapshot(store);
      assert.equal(store.buySeed("thornroot", count).ok, false);
      assert.equal(snapshot(store), before);
    });
  }
  for (const count of [1, 9, 10, 11, 100]) {
    test(`purchase ${count}: charged exactly once and seeds conserved`, () => {
      const store = fresh();
      const coins = store.state.leafCoin;
      const seeds = store.state.seeds.thornroot ?? 0;
      assert.equal(store.buySeed("thornroot", count).ok, true);
      assert.equal(store.state.leafCoin, coins - seedPackPrice("thornroot", count));
      assert.equal(store.state.seeds.thornroot, seeds + count);
    });
  }
  test("insufficient funds do not change seeds, ledger or quest progress", () => {
    const store = fresh();
    store.state.leafCoin = 0;
    const before = snapshot(store);
    assert.equal(store.buySeed("thornroot", 1).ok, false);
    assert.equal(snapshot(store), before);
  });
  test("batch planting respects both capacity and seed conservation", () => {
    const store = fresh();
    store.state.seeds.thornroot = 10;
    const remaining = store.state.nurseryCap - store.state.plants.length;
    let emits = 0;
    const stop = store.subscribe(() => emits++);
    const result = store.plantSeeds("thornroot", 10);
    stop();
    assert.equal(result.ok, true);
    assert.equal(result.plantIds.length, Math.min(10, remaining));
    assert.equal(new Set(result.plantIds).size, result.plantIds.length);
    assert.equal(store.state.seeds.thornroot, 10 - result.plantIds.length);
    // Quest advancement can commit separately; emissions must stay batch-bounded.
    assert.ok(emits >= 1 && emits <= 2, `unexpected ${emits} emissions for one batch`);
    const full = snapshot(store);
    assert.equal(store.plantSeeds("thornroot", 1).ok, false);
    assert.equal(snapshot(store), full);
  });
  for (const scenario of ["same-parent", "battle-lock", "immature", "no-money"] as const) {
    test(`breeding ${scenario} rejection preserves complete state`, () => {
      const store = fresh();
      const a = mature("parent-a");
      const b = mature("parent-b");
      store.state.plants = [a, b];
      if (scenario === "battle-lock") a.locks.battle = true;
      if (scenario === "immature") a.growth.stage = "seed";
      if (scenario === "no-money") store.state.leafCoin = 0;
      const before = snapshot(store);
      assert.equal(store.breed(a.plantId, scenario === "same-parent" ? a.plantId : b.plantId).ok, false);
      assert.equal(snapshot(store), before);
    });
  }
  test("breeding spends two parents once and creates one owned child", () => {
    const store = fresh();
    const a = mature("parent-a");
    const b = mature("parent-b");
    store.state.plants = [a, b];
    const fee = store.breedingFee(a.plantId, b.plantId);
    const coins = store.state.leafCoin;
    const ledgerStart = store.state.ledger.length;
    const breeds = store.state.pity.totalBreeds;
    assert.equal(store.breed(a.plantId, b.plantId).ok, true);
    assert.equal(store.state.plants.length, 1);
    assert.ok(![a.plantId, b.plantId].includes(store.state.plants[0].plantId));
    // Inherited XP can grant breeder level-up coins; inspect the fee separately.
    const charges = store.state.ledger.slice(ledgerStart).filter(entry => entry.reason === "Phí lai tạo");
    assert.equal(charges.length, 1);
    assert.equal(charges[0].delta, -fee);
    assert.ok(store.state.leafCoin >= coins - fee);
    assert.equal(store.state.pity.totalBreeds, breeds + 1);
    const after = snapshot(store);
    assert.equal(store.breed(a.plantId, b.plantId).ok, false);
    assert.equal(snapshot(store), after);
  });
  test("exchange quote and inverse price obey independent integer arithmetic", () => {
    for (const from of CURRENCY_IDS) for (const to of CURRENCY_IDS) {
      if (from === to || to === "ember") continue;
      for (let amount = 1; amount <= 400; amount++) {
        const quote: ExchangeQuote = quoteExchange(from, to, amount)!;
        const expected: number = Number(BigInt(amount) * BigInt(LEAF_VALUE[from]) * 4n / (5n * BigInt(LEAF_VALUE[to])));
        assert.equal(quote.out, expected, `${from}->${to} input=${amount}`);
        assert.ok(quote.out * LEAF_VALUE[to] <= amount * LEAF_VALUE[from]);
      }
      for (let price = 1; price <= 100; price++) {
        const cost: number = costIn(price, to, from)!;
        assert.ok(quoteExchange(from, to, cost)!.out >= price);
        if (cost > 1) assert.ok(quoteExchange(from, to, cost - 1)!.out < price);
      }
    }
  });
  test("exchange boundary and reload do not reset daily allowance", () => {
    const store = fresh();
    assert.equal(store.exchangeCurrency("leafCoin", "nectar", EXCHANGE_DAILY_CAP).ok, true);
    assert.equal(store.exchangeAllowanceLeft(), 0);
    const before = snapshot(store);
    assert.equal(store.exchangeCurrency("leafCoin", "nectar", 1).ok, false);
    assert.equal(snapshot(store), before);
    assert.equal(new GameStore().exchangeAllowanceLeft(), 0);
  });
  test("exchange round trip cannot print money", () => {
    const store = fresh();
    store.state.nectar = 0;
    const before = store.state.leafCoin;
    const first = store.exchangeCurrency("leafCoin", "nectar", 100);
    assert.equal(first.out, 80);
    assert.equal(store.exchangeCurrency("nectar", "leafCoin", first.out!).out, 64);
    assert.equal(store.state.leafCoin, before - 36);
  });
  test("save reload preserves plant identity, wallet and server timestamp", () => {
    const store = fresh();
    store.state.plants = [mature("persisted")];
    store.importState(structuredClone(store.state), fixedNow - 60_000);
    const loaded = new GameStore();
    assert.equal(loaded.savedAt, fixedNow - 60_000);
    assert.deepEqual(loaded.state.plants, store.state.plants);
    assert.equal(loaded.state.leafCoin, store.state.leafCoin);
  });
  test("malformed save recovers without borrowing another account", () => {
    memory.set(saveSlotKey("account-a"), "{bad json");
    memory.set(saveSlotKey("account-b"), JSON.stringify({ ...fresh().state, name: "private-b" }));
    setActiveAccountId("account-a");
    const store = new GameStore();
    assert.notEqual(store.state.name, "private-b");
    assert.ok(Number.isFinite(store.state.leafCoin));
    assert.ok(Array.isArray(store.state.plants));
  });
  test("storage write failure is visible and recovers on next successful save", () => {
    const store = fresh();
    refuseWrites = true;
    assert.doesNotThrow(() => store.save());
    assert.equal(store.saveFailed, true);
    refuseWrites = false;
    store.save();
    assert.equal(store.saveFailed, false);
    assert.ok(memory.has(saveSlotKey(null)));
  });
  for (const action of Object.keys(CARE_ACTIONS) as CareActionId[]) {
    test(`care ${action}: preview is pure and cooldown refusal is atomic`, () => {
      const plant = mature(`care-${action}`);
      const before = structuredClone(plant);
      previewCare(plant, action, fixedNow);
      assert.deepEqual(plant, before);
      const first = applyCare(plant, action, fixedNow, { items: 100_000, geneCrystal: 100_000, leafCoin: 100_000 });
      assert.equal(first.ok, true);
      const after = structuredClone(plant);
      assert.equal(applyCare(plant, action, fixedNow, { items: 100_000, geneCrystal: 100_000, leafCoin: 100_000 }).ok, false);
      assert.deepEqual(plant, after);
      const duration = CARE_ACTIONS[action].cooldownSeconds * 1000;
      assert.equal(careCooldownLeft(plant, action, fixedNow + duration - 1), 1);
      assert.equal(careCooldownLeft(plant, action, fixedNow + duration), 0);
    });
  }
  for (let seed = 0; seed < 24; seed++) {
    test(`battle seed=${seed}: replay, snapshot purity, ordered finite events`, () => {
      const a = mature(`a-${seed}`);
      const b = mature(`b-${seed}`);
      const input = structuredClone([a, b]);
      const stances = Object.keys(STANCE_LABEL) as Stance[];
      const config = { seed: `technical-${seed}`, maxSeconds: 30, arena: "indoor" as const, stances: { a: stances[seed % 4], b: stances[(seed + 1) % 4] } };
      const result = simulateBattle(a, b, config);
      assert.deepEqual(simulateBattle(a, b, config), result);
      assert.deepEqual([a, b], input);
      assert.equal(result.events.filter(event => event.type === "BATTLE_FINISHED").length, 1);
      assert.ok(result.durationSeconds <= 30 + 0.1);
      for (const side of [result.a, result.b]) {
        for (const value of Object.values(side)) assert.ok(Number.isFinite(value));
        assert.ok(side.hp >= 0 && side.hpPct >= 0 && side.hpPct <= 100);
      }
      result.events.forEach((event, index) => {
        assert.ok(Number.isFinite(event.t) && event.t >= 0);
        if (event.amount !== undefined) assert.ok(Number.isFinite(event.amount));
        if (index) {
          assert.ok(event.seq > result.events[index - 1].seq);
          assert.ok(event.t >= result.events[index - 1].t);
        }
      });
    });
  }
  test("plant rendering is deterministic and does not mutate game data", () => {
    for (let seed = 0; seed < 24; seed++) {
      const plant = mature(`render-${seed}`);
      const before = structuredClone(plant);
      for (const size of [64, 160, 320]) {
        const svg = renderPlantSvg(plant, size);
        assert.equal(renderPlantSvg(plant, size), svg);
        assert.ok(svg.includes("<svg") && svg.includes("</svg>"));
        assert.ok(!/NaN|Infinity|undefined/.test(svg));
      }
      assert.deepEqual(plant, before);
    }
  });
} finally {
  Date.now = realNow;
}
console.log(`Technical contracts: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
