/**
 * One garden per account, not one per browser.
 *
 * The bug: the save lived at a single fixed localStorage key, so it was scoped to the
 * origin rather than to the account. Two accounts on one machine shared a garden - the
 * second one began life looking at the first one's plants - and the second account's play
 * was then pushed up as the *first* account's cloud backup. That is worse than showing
 * the wrong data, because it destroys the first account's.
 *
 * The checks are about the slot system on its own, without a Worker or a network. What
 * matters is entirely local: which key gets written, and what a second account can see.
 *
 * Every "starts from scratch" assertion is made against a *measured* baseline rather than
 * against zero. A new garden is not empty - it comes with a starter plant, starter coins
 * and starter seed - so "Bob has none of Alice's plants" means "Bob's garden equals a
 * brand new one", and that is what is checked.
 */

import { GameStore } from "../src/core/store";
import {
  ACTIVE_ACCOUNT_KEY,
  clearSlot,
  getActiveAccountId,
  onSlotChange,
  restoreActiveAccount,
  saveSlotKey,
  setActiveAccountId,
  slotHasSave,
} from "../src/core/saveSlot";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const GUEST = "mutant-sprout-save-v1";

/** What a brand new account is given, measured rather than assumed. */
function pristine() {
  mem.clear();
  setActiveAccountId(null);
  const s = new GameStore();
  const shape = { coins: s.state.leafCoin, plants: s.state.plants.length, seeds: { ...s.state.seeds } };
  // Constructing a store writes a fresh garden out, so measuring the baseline leaves a
  // save in the guest slot. Dropped here, or the later "Alice did not touch the guest
  // slot" check would be reading this setup rather than anything Alice did.
  clearSlot(null);
  return shape;
}
const FRESH = pristine();

/** True when a garden is indistinguishable from a new one. */
function isPristine(s: GameStore): boolean {
  return (
    s.state.plants.length === FRESH.plants &&
    s.state.leafCoin === FRESH.coins &&
    Object.entries(FRESH.seeds).every(([k, v]) => (s.state.seeds[k] ?? 0) === (v ?? 0))
  );
}

/* --- 1. keys --------------------------------------------------------------- */

check("the guest slot keeps its original key", saveSlotKey(null) === GUEST, saveSlotKey(null));
check("an account gets a different key", saveSlotKey("pl_abc") !== GUEST);
check("two accounts get different keys", saveSlotKey("pl_abc") !== saveSlotKey("pl_xyz"));
check(
  "the same account always gets the same key",
  saveSlotKey("pl_abc") === saveSlotKey("pl_abc"),
  "otherwise a returning player would orphan their own garden",
);
check("an empty id is the guest slot", saveSlotKey("") === GUEST);
check(
  "the key does not contain the account id in the clear",
  !saveSlotKey("pl_secret_123").includes("pl_secret_123"),
);

/* --- 2. a save is invisible to another account ----------------------------- */

setActiveAccountId("pl_alice");
const alice = new GameStore();
alice.state.leafCoin = 12_345;
alice.state.seeds.thornroot = 3;
alice.plantSeed("thornroot");
// Read after planting rather than assuming: planting spends a seed, so the number to
// remember is whatever is left, not what was put in.
const aliceSeedLeft = alice.state.seeds.thornroot ?? 0;
const aliceCoins = alice.state.leafCoin;
const alicePlants = alice.state.plants.length;
alice.save();
check("Alice's garden was written somewhere", slotHasSave("pl_alice"));
check("and not into the guest slot", !slotHasSave(null));
check("Alice is no longer pristine", !isPristine(alice));

// Bob signs in on the same browser.
setActiveAccountId("pl_bob");
const bob = new GameStore();
check("Bob's garden is indistinguishable from a new one", isPristine(bob), `coins ${bob.state.leafCoin}, ${bob.state.plants.length} plants`);
check("Bob has none of Alice's coins", bob.state.leafCoin !== aliceCoins, `${bob.state.leafCoin} vs ${aliceCoins}`);
check("Bob has none of Alice's plants", bob.state.plants.length !== alicePlants);

// Bob plays, and it must not touch Alice's slot.
bob.state.leafCoin = 999;
bob.save();
check("Bob's save left Alice's slot in place", localStorage.getItem(saveSlotKey("pl_alice")) !== null);
setActiveAccountId("pl_alice");
const aliceBack = new GameStore();
check("Alice's coins survived Bob signing in and playing", aliceBack.state.leafCoin === aliceCoins, `${aliceBack.state.leafCoin} vs ${aliceCoins}`);
check("Alice's plants survived", aliceBack.state.plants.length === alicePlants);
check("Alice's seeds survived", (aliceBack.state.seeds.thornroot ?? 0) === aliceSeedLeft, `${String(aliceBack.state.seeds.thornroot)} vs ${aliceSeedLeft}`);

/* --- 3. the guest garden is never consumed --------------------------------- */

mem.clear();
setActiveAccountId(null);
const guest = new GameStore();
guest.state.leafCoin = 777;
guest.state.seeds.emberleaf = 5;
guest.save();

// Sign in, play as somebody, sign out again.
setActiveAccountId("pl_carol");
const carol = new GameStore();
carol.state.leafCoin = 5;
carol.save();
check("Carol's garden is not the guest's", carol.state.leafCoin === 5);
setActiveAccountId(null);
const guestBack = new GameStore();
check("the guest garden is still there after signing in and out", guestBack.state.leafCoin === 777, `${guestBack.state.leafCoin}`);
check("with its seed stock", (guestBack.state.seeds.emberleaf ?? 0) === 5);
check("and Carol's coins did not leak into it", guestBack.state.leafCoin !== 5);

/* --- 4. switching accounts reloads the store ------------------------------- */

// The wiring the app performs, exercised here: the slot module announces the change and
// the store re-reads. Without the reload the store would keep the old garden in memory
// and write it over the new account's slot on the very next save - the silent version of
// the bug this whole file is about.
let reloads: (string | null)[] = [];
const stop = onSlotChange((id) => reloads.push(id));

setActiveAccountId("pl_alice");
const live = new GameStore();
live.state.leafCoin = 42;
live.save();
check("Alice's garden is what is loaded", live.state.leafCoin === 42, `${live.state.leafCoin}`);
const before = reloads.length;

setActiveAccountId("pl_dave");
check("switching accounts announces the change", reloads.length === before + 1, `${reloads.length - before} calls`);
check("and names the account that was switched to", reloads[reloads.length - 1] === "pl_dave", `${String(reloads[reloads.length - 1])}`);

setActiveAccountId("pl_dave");
check("announcing the same account again is silent", reloads.length === before + 1, `${reloads.length - before} calls`);

live.reload();
check("after the reload the store holds Dave's new garden", live.state.leafCoin === FRESH.coins, `coins ${live.state.leafCoin}`);
check("and none of Alice's", live.state.leafCoin !== 42);

// The unsubscribe, which app.ts does not need but a test or a screen teardown might.
stop();
setActiveAccountId("pl_grace");
check("an unsubscribed listener stops hearing", reloads.length === before + 1, `${reloads.length - before} calls`);

/* --- 5. the chosen account survives a reload ------------------------------- */

setActiveAccountId("pl_erin");
check("the active account is recorded in memory", getActiveAccountId() === "pl_erin");
check("and written to storage", mem.get(ACTIVE_ACCOUNT_KEY) === "pl_erin", `${String(mem.get(ACTIVE_ACCOUNT_KEY))}`);
// A fresh page load has no memory of it and must read it back. Simulated by clearing only
// the in-memory value's source of truth is not possible, so the storage read is checked
// directly - which is the half that can actually regress.
check("a fresh load reads it back", restoreActiveAccount() === "pl_erin", `got ${String(restoreActiveAccount())}`);

setActiveAccountId(null);
check("signing out forgets it", getActiveAccountId() === null);
check("and removes it from storage", !mem.has(ACTIVE_ACCOUNT_KEY));
check("and a fresh load comes back as a guest", restoreActiveAccount() === null);

/* --- 6. clearing ---------------------------------------------------------- */

mem.clear();
setActiveAccountId(null);
const hostGarden = new GameStore();
hostGarden.state.leafCoin = 31337;
hostGarden.save();
check("the guest slot has a save", slotHasSave(null));

setActiveAccountId("pl_frank");
const frank = new GameStore();
frank.state.leafCoin = 4242;
frank.save();
check("Frank has a save", slotHasSave("pl_frank"));
clearSlot("pl_frank");
check("clearing removes his slot", !slotHasSave("pl_frank"));
setActiveAccountId(null);
check("and leaves the guest slot alone", slotHasSave(null));
const hostAgain = new GameStore();
check("with its contents intact", hostAgain.state.leafCoin === 31337, `${hostAgain.state.leafCoin}`);

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
