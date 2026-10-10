/**
 * ACT-01/02/04/05 domain + queue contracts for the visible gardener
 * (docs/27 §7). DOM behaviour lives in test-gardener-actor.ts; this suite
 * proves the event adapter and the bounded queue.
 */

import assert from "node:assert/strict";
import { GameStore } from "../src/core/store";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import type { GardenerWorkEvent } from "../src/core/types";
import { MAX_AGE_MS, MAX_JOBS, createQueue, drainQueue, enqueueWork, nextJob, pruneQueue } from "../src/ui/gardenerQueue";

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
const fixedNow = Date.UTC(2026, 9, 10, 5);
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
  // A new save already contains the starter plants — fixtures own the garden.
  store.state.plants = [];
  store.state.leafCoin = 100_000;
  store.state.items = 1_000;
  store.state.nurseryCap = 24;
  return store;
}

function addPlant(store: GameStore, i: number): void {
  const p = createSeedPlant("thornroot", "gardener", `gp-${i}`, fixedNow - 86_400_000);
  p.growth.stage = "mature";
  store.state.plants.push(p);
}

function fakeEvent(i: number, source: "live" | "catchup" = "live"): GardenerWorkEvent {
  return { id: `gw:fake:${i}`, plantId: `p-${i}`, action: "water", occurredAt: fixedNow, source, seq: i };
}

/* --- ACT-01: one success → one unique event; rejected → nothing --------- */

test("tick emits exactly one event per performed action, ids unique", () => {
  const store = fresh();
  for (let i = 0; i < 5; i++) addPlant(store, i);
  store.grantAutoCare(15 * 60_000, fixedNow);
  const got: GardenerWorkEvent[] = [];
  store.onGardenerWork((e) => got.push(e));
  const did = store.autoCareTick(fixedNow);
  assert.equal(did, 5);
  assert.equal(got.length, 5);
  assert.equal(new Set(got.map((e) => e.id)).size, 5, "event ids must be unique");
  assert.deepEqual([...got].map((e) => e.plantId).sort(), store.state.plants.map((p) => p.plantId).sort());
  for (const e of got) {
    assert.equal(e.source, "live");
    assert.equal(e.occurredAt, fixedNow);
    assert.ok(["water", "sunlight", "fertilizer", "music", "pruning"].includes(e.action));
  }
});

test("expired buff: tick performs nothing and emits nothing", () => {
  const store = fresh();
  addPlant(store, 0);
  const got: GardenerWorkEvent[] = [];
  store.onGardenerWork((e) => got.push(e));
  assert.equal(store.autoCareTick(fixedNow), 0);
  assert.equal(got.length, 0);
});

test("rejected actions emit nothing — cooldown round publishes zero events", () => {
  const store = fresh();
  addPlant(store, 0);
  store.grantAutoCare(15 * 60_000, fixedNow);
  const got: GardenerWorkEvent[] = [];
  store.onGardenerWork((e) => got.push(e));
  // One action lands; the shared rest between any two actions makes the very
  // next tick at the same instant do nothing — and publish nothing.
  assert.equal(store.autoCareTick(fixedNow), 1);
  const before = got.length;
  assert.equal(store.autoCareTick(fixedNow), 0);
  assert.equal(got.length, before);
});

test("battle-locked plant is skipped and emits nothing for itself", () => {
  const store = fresh();
  addPlant(store, 0);
  addPlant(store, 1);
  store.state.plants[0]!.locks.battle = true;
  store.grantAutoCare(15 * 60_000, fixedNow);
  const got: GardenerWorkEvent[] = [];
  store.onGardenerWork((e) => got.push(e));
  assert.equal(store.autoCareTick(fixedNow), 1);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.plantId, store.state.plants[1]!.plantId);
});

test("catchup marks events as catchup source", () => {
  const store = fresh();
  addPlant(store, 0);
  store.grantAutoCare(16 * 60_000, fixedNow - 16 * 60_000);
  const got: GardenerWorkEvent[] = [];
  store.onGardenerWork((e) => got.push(e));
  store.autoCareCatchUp(fixedNow - 16 * 60_000, fixedNow);
  assert.ok(got.length > 0);
  assert.ok(got.every((e) => e.source === "catchup"));
});

test("seq is monotonic across ticks", () => {
  const store = fresh();
  for (let i = 0; i < 3; i++) addPlant(store, i);
  store.grantAutoCare(15 * 60_000, fixedNow);
  const seqs: number[] = [];
  store.onGardenerWork((e) => seqs.push(e.seq));
  store.autoCareTick(fixedNow);
  store.autoCareTick(fixedNow + 12_000);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i]! > seqs[i - 1]!);
});

test("unsubscribe stops delivery; throwing listener cannot break the tick", () => {
  const store = fresh();
  addPlant(store, 0);
  store.grantAutoCare(15 * 60_000, fixedNow);
  const got: GardenerWorkEvent[] = [];
  const unsub = store.onGardenerWork((e) => got.push(e));
  store.onGardenerWork(() => {
    throw new Error("broken listener");
  });
  assert.equal(store.autoCareTick(fixedNow), 1); // did not throw
  assert.equal(got.length, 1);
  unsub();
  store.autoCareTick(fixedNow + 12_000);
  assert.equal(got.length, 1, "no delivery after unsubscribe");
});

test("work events never persist into the save", () => {
  const store = fresh();
  addPlant(store, 0);
  store.grantAutoCare(15 * 60_000, fixedNow);
  store.onGardenerWork(() => {});
  store.autoCareTick(fixedNow);
  const saved = JSON.stringify(store.state);
  assert.ok(!saved.includes("gw:"), "event ids must not appear in persisted state");
});

test("gardener care still lands in the quest care stream", () => {
  const store = fresh();
  addPlant(store, 0);
  store.grantAutoCare(15 * 60_000, fixedNow);
  const before = store.state.plants[0]!.careMemory.counts?.water ?? 0;
  store.autoCareTick(fixedNow);
  const after = store.state.plants[0]!.careMemory.counts?.water ?? 0;
  assert.equal(after - before, 1);
});

/* --- ACT-04: bounded queue --------------------------------------------- */

test("queue caps at MAX_JOBS and folds the overflow into the summary", () => {
  const q = createQueue();
  const t = 1_000;
  let jobs = 0;
  for (let i = 0; i < 10; i++) if (enqueueWork(q, fakeEvent(i), t)) jobs++;
  assert.equal(jobs, MAX_JOBS);
  assert.equal(q.jobs.length, MAX_JOBS);
  assert.equal(q.summarized, 6);
});

test("duplicate event id cannot enqueue twice", () => {
  const q = createQueue();
  const ev = fakeEvent(1);
  assert.ok(enqueueWork(q, ev, 1_000));
  assert.equal(enqueueWork(q, { ...ev }, 1_001), null);
  assert.equal(q.jobs.length, 1);
  assert.equal(q.summarized, 0);
});

test("jobs older than MAX_AGE fold into the summary rather than replaying", () => {
  const q = createQueue();
  enqueueWork(q, fakeEvent(1), 1_000);
  enqueueWork(q, fakeEvent(2), 1_000);
  const folded = pruneQueue(q, 1_000 + MAX_AGE_MS + 1);
  assert.equal(folded, 2);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.summarized, 2);
});

test("catchup events summarize except a single illustration", () => {
  const q = createQueue();
  let illustrated = 0;
  for (let i = 0; i < 6; i++) {
    const job = enqueueWork(q, fakeEvent(i, "catchup"), 1_000);
    if (job) {
      illustrated++;
      assert.equal(job.illustration, true);
      nextJob(q); // performed, out of the way for the next arrival
    }
  }
  assert.equal(illustrated, 1, "exactly one catch-up job may be acted out");
  assert.equal(q.catchupSummarized, 5);
});

test("catchup illustration still respects a full queue", () => {
  const q = createQueue();
  for (let i = 0; i < MAX_JOBS; i++) enqueueWork(q, fakeEvent(i), 1_000);
  assert.equal(enqueueWork(q, fakeEvent(99, "catchup"), 1_000), null);
  assert.equal(q.catchupSummarized, 1);
});

test("drainQueue folds every pending job, keeps performed work done", () => {
  const q = createQueue();
  for (let i = 0; i < 4; i++) enqueueWork(q, fakeEvent(i), 1_000);
  nextJob(q);
  const folded = drainQueue(q);
  assert.equal(folded, 3);
  assert.equal(q.jobs.length, 0);
  assert.equal(q.summarized, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
