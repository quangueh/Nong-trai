/**
 * F08/F10 — the fault cases the account/failure fixtures demand (docs/34 §3):
 *
 *   quota    — localStorage refuses writes: save() must not throw, must flag
 *              saveFailed, must warn exactly once, and the game keeps running.
 *   heals    — when storage recovers, the next save writes and clears the flag.
 *   slots    — account A's save never bleeds into account B's slot or the
 *              anonymous slot (save isolation across account switching).
 *   audio    — a browser with no AudioContext at all still boots and plays.
 *
 * The ads-blocked, dismissed, no-fill and duplicate-callback shapes are already
 * contracts in test-ads-contracts.ts; offline/error UI states are in
 * test-aux-wp08-view.ts (AUX-06); PWA update/caching is in test-service-worker.ts.
 * This suite covers what those do not.
 */

import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { GameStore } from "../src/core/store";
import { saveSlotKey, setActiveAccountId } from "../src/core/saveSlot";

/* ---------------------------------------------------------------- storage */

const memory = new Map<string, string>();
let writeFails = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (writeFails) {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      }
      memory.set(k, String(v));
    },
    removeItem: (k: string) => memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  },
});

let passed = 0;
let failed = 0;
function test(name: string, run: () => void | Promise<void>): Promise<void> | void {
  const done = (ok: boolean, detail = "") => {
    if (ok) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
  };
  try {
    const r = run();
    if (r instanceof Promise) return r.then(() => done(true)).catch((e) => done(false, String(e)));
    done(true);
  } catch (e) { done(false, e instanceof Error ? e.message : String(e)); }
}
const section = (t: string) => console.log(`\n${t}`);

/* ==================================================================== */

section("F10 — quota: a save refused by storage does not kill the game");
{
  const s = new GameStore();
  const warns: string[] = [];
  s.onNotice((n) => { if (/Không lưu được/.test(n.title)) warns.push(n.title); });
  writeFails = true;
  test("save() throws nothing when setItem throws", () => {
    s.save();
  });
  test("saveFailed is raised so the UI can say so", () => {
    assert.equal(s.saveFailed, true);
  });
  test("the player is warned once — and not again per save", () => {
    s.save();
    s.save();
    assert.equal(warns.length, 1, `warnings pushed: ${warns.length}`);
  });
  test("the game still plays while storage is dead", () => {
    s.state.leafCoin = 999999;
    s.buySeed("thornroot" as never, 1);
    assert.ok(s.state.leafCoin < 999999);
  });
}

section("F10 — storage heals: the next good write clears the flag");
{
  const s = new GameStore();
  writeFails = true;
  s.save();
  assert.equal(s.saveFailed, true);
  writeFails = false;
  s.save();
  test("a successful save after the outage clears saveFailed", () => {
    assert.equal(s.saveFailed, false);
  });
  test("and the save is really on disk this time", () => {
    const raw = memory.get(saveSlotKey(null));
    assert.ok(raw && JSON.parse(raw).leafCoin !== undefined);
  });
}

section("F08 — save isolation: account A never writes into B's slot");
{
  memory.clear();
  setActiveAccountId(null);
  const anon = new GameStore();
  anon.state.leafCoin = 11111;
  anon.save();
  test("anonymous play writes the anonymous slot", () => {
    assert.ok(memory.has(saveSlotKey(null)));
  });
  test("and not any account slot", () => {
    assert.equal([...memory.keys()].filter((k) => k !== saveSlotKey(null)).length, 0, JSON.stringify([...memory.keys()]));
  });

  setActiveAccountId("acc-a");
  const a = new GameStore();
  a.state.leafCoin = 22222;
  a.save();
  test("account A writes its own slot", () => {
    assert.ok(memory.has(saveSlotKey("acc-a")));
  });
  test("the anonymous slot is untouched by A's session", () => {
    assert.equal(JSON.parse(memory.get(saveSlotKey(null))!).leafCoin, 11111);
  });

  setActiveAccountId("acc-b");
  const b = new GameStore();
  b.state.leafCoin = 33333;
  b.save();
  test("account B gets a third, separate slot", () => {
    assert.equal(JSON.parse(memory.get(saveSlotKey("acc-b"))!).leafCoin, 33333);
    assert.equal(JSON.parse(memory.get(saveSlotKey("acc-a"))!).leafCoin, 22222);
  });
  setActiveAccountId(null);
}

/* ==================================================================== */
/* F10 — no AudioContext at all: the app must still boot and be playable. */

section("F10 — a browser with no AudioContext still boots and plays");
{
  const base = process.env.TEST_BASE_URL ?? "http://localhost:5173";
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(`delete window.AudioContext; delete window.webkitAudioContext;`);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const state = await page.evaluate<any>(`(() => {
    const g = (window).__game;
    return {
      hasGame: !!g,
      plants: g ? g.store.state.plants.length : -1,
    };
  })()`);
  await test("the game boots without any audio stack", () => {
    assert.equal(state.hasGame, true);
    assert.ok(state.plants >= 0, `plants=${state.plants}`);
  });
  await test("calls into the music layer are safe no-ops", async () => {
    await page.evaluate<any>(`(() => { const m = (window).__game.music; m.start(); m.setMood("battle"); m.stop(); m.start(); })()`);
    await page.waitForTimeout(400);
    const after = await page.evaluate<any>(`(() => (window).__game.music.stats())()`);
    assert.equal(after.liveSources ?? 0, 0);
  });
  await test("zero page errors across the whole no-audio boot", () => {
    assert.deepEqual(errors, [], errors.join(" | "));
  });
  await page.screenshot({ path: "shots/f10-no-audio.png" });
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
