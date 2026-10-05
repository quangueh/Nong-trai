/**
 * Win streaks: the multiplier, and the promises made about it on screen.
 *
 * A streak is only worth having if three things hold at once, and each is a promise the
 * arena screen now makes in words:
 *
 *   1. It grows on a win and only on a win. A draw is the outcome that gets lost in the
 *      implementation - if it kept the streak, taking draws would be the safe play and
 *      the arena becomes about avoiding a fight.
 *   2. It is bounded. Past the cap, another win pays nothing more. Without this the
 *      correct strategy is to lose on purpose every sixth fight, which is not a game.
 *   3. The screen, the receipt and the payout all read the same number. A bonus printed
 *      in one place and computed in another is how a player is promised 1.30x and paid
 *      1.00x, and the only way to catch it is to compare the two in one place.
 *
 * The multiplier is read through the exported function rather than recomputed here. A
 * copy of the table in the test would pass while the game paid something else, which is
 * the exact failure this file exists to prevent.
 */

import { GameStore } from "../src/core/store";
import {
  advanceStreak,
  battleStreakBonus,
  streakCoinPreview,
  STREAK_CAP,
  STREAK_STEP,
  type BattleRecordLike,
} from "../src/core/streak";

/* `GameStore` reads and writes localStorage in its constructor, so the migration checks
   at the bottom need one. A real save, round-tripped through the same key the game
   uses, rather than a hand-built object: the point is that a file an older build wrote
   loads, and only the real load path can prove that. */
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

function fresh(): BattleRecordLike {
  return { streak: 0, bestStreak: 0 };
}

/* --- 1. the shape of the curve ------------------------------------------- */

check("a cold fighter gets the base rate", battleStreakBonus(0) === 1);
check(
  "each win adds exactly one step",
  battleStreakBonus(1) === 1 + STREAK_STEP && battleStreakBonus(2) === 1 + 2 * STREAK_STEP,
);
check(
  "the cap is where the curve stops",
  battleStreakBonus(STREAK_CAP) === 1 + STREAK_CAP * STREAK_STEP,
);
check(
  "past the cap nothing more is paid",
  battleStreakBonus(STREAK_CAP + 1) === battleStreakBonus(STREAK_CAP) &&
    battleStreakBonus(99) === battleStreakBonus(STREAK_CAP),
  "an uncapped streak would make losing on purpose the correct play",
);
check("the cap is five", STREAK_CAP === 5);
check("the top bonus is 1.75x", battleStreakBonus(STREAK_CAP) === 1.75);

/* Nonsense inputs, because a save file is user-writable and a corrupt streak must not
   produce a negative payout or a NaN on the receipt. */
check("a negative streak is treated as zero", battleStreakBonus(-4) === 1);
check("a fractional streak counts only whole wins", battleStreakBonus(2.7) === battleStreakBonus(2));
check("NaN does not become NaN", battleStreakBonus(NaN) === 1, `got ${battleStreakBonus(NaN)}`);
check(
  "Infinity is refused rather than paid at the cap",
  battleStreakBonus(Infinity) === 1,
  "a corrupt value must not be the generous one",
);

/* --- 2. the payout matches the number on screen --------------------------- */

check("the preview agrees with the multiplier", streakCoinPreview(60, 0) === 60);
check("a three-win streak previews 87", streakCoinPreview(60, 3) === 87, `got ${streakCoinPreview(60, 3)}`);
check(
  "the preview is rounded, not fractional",
  Number.isInteger(streakCoinPreview(25, 2)),
  `got ${streakCoinPreview(25, 2)}`,
);

/* --- 3. what advances it, and what breaks it ------------------------------- */

const r = fresh();
check("a win starts the run", advanceStreak(r, "win") === 1, `got ${advanceStreak({ ...r }, "win")}`);
check("two more wins make three", advanceStreak(r, "win") === 2 && advanceStreak(r, "win") === 3);
check("the best run is remembered", r.bestStreak === 3, `got ${r.bestStreak}`);

advanceStreak(r, "loss");
check("a loss resets the run", r.streak === 0, `got ${r.streak}`);
check("a loss does not erase the best run", r.bestStreak === 3, `got ${r.bestStreak}`);

const d = fresh();
advanceStreak(d, "win");
advanceStreak(d, "win");
advanceStreak(d, "draw");
check("a draw also breaks the run", d.streak === 0, "a draw that kept it would make drawing the safe play");
check("a draw keeps the best run", d.bestStreak === 2, `got ${d.bestStreak}`);

/* A run longer than the cap keeps counting, because the record is worth having even
   once the money stops changing. */
const long = fresh();
for (let i = 0; i < 9; i++) advanceStreak(long, "win");
check("a long run still counts", long.streak === 9);
check("but it pays no more than the cap", battleStreakBonus(long.streak) === battleStreakBonus(STREAK_CAP));
check("and the record is the true length", long.bestStreak === 9);

/* --- 4. it survives a save from before streaks existed -------------------- */

const store = new GameStore();
store.state.plants.length = 0;
store.state.leafCoin = 500;
store.state.seeds.thornroot = 4;
store.plantSeed("thornroot");
const planted = store.state.plants[0];

// Exactly what an older build wrote: the record with no streak fields at all.
(planted as unknown as { battleRecord: Record<string, unknown> }).battleRecord = {
  wins: 7,
  losses: 2,
  draws: 0,
  scars: 1,
};
store.save();

// A second store reads the same key, so the repair runs on the real load path.
const loaded = new GameStore();
const revived = loaded.state.plants[0];

check("a pre-streak save loads at all", Boolean(revived));
check(
  "its streak reads as a number, not undefined",
  revived?.battleRecord.streak === 0,
  `got ${String(revived?.battleRecord.streak)}`,
);
check("its best streak reads as a number", revived?.battleRecord.bestStreak === 0);
check("its old numbers survive the repair", revived?.battleRecord.wins === 7 && revived?.battleRecord.losses === 2);
check(
  "and it can start a run from there",
  revived ? advanceStreak(revived.battleRecord, "win") === 1 : false,
);

/* A hand-edited save is not an exotic case - the file is in localStorage - so a streak
   of NaN must read as zero rather than reach the payout. (`Infinity` cannot arrive this
   way: JSON.stringify writes it as null, so it arrives as 0.) */
const tampered = new GameStore();
const tamperedRecord = tampered.state.plants[0].battleRecord as unknown as Record<string, number>;
tamperedRecord.streak = NaN;
tamperedRecord.bestStreak = 1e9;
tampered.save();
const reloaded = new GameStore();
check(
  "a NaN streak is repaired to a number",
  Number.isFinite(reloaded.state.plants[0].battleRecord.streak),
  `got ${String(reloaded.state.plants[0].battleRecord.streak)}`,
);
check(
  "an absurd best streak is clamped, not refused",
  reloaded.state.plants[0].battleRecord.bestStreak >= 1,
  `got ${String(reloaded.state.plants[0].battleRecord.bestStreak)}`,
);
check(
  "and the repaired record pays a finite amount",
  Number.isFinite(streakCoinPreview(60, reloaded.state.plants[0].battleRecord.streak)),
);

/* --- 5. the streak belongs to the fighter, not the account ----------------- */

const twoPlants = new GameStore();
twoPlants.state.plants.length = 0;
twoPlants.state.leafCoin = 500;
twoPlants.state.seeds.thornroot = 4;
twoPlants.state.seeds.emberleaf = 4;
twoPlants.plantSeed("thornroot");
twoPlants.plantSeed("emberleaf");
const [first, second] = twoPlants.state.plants;
advanceStreak(first.battleRecord, "win");
advanceStreak(first.battleRecord, "win");
advanceStreak(second.battleRecord, "win");
check("one fighter's run is not another's", first.battleRecord.streak === 2 && second.battleRecord.streak === 1);
advanceStreak(second.battleRecord, "loss");
check(
  "losing with one does not touch the other",
  first.battleRecord.streak === 2 && second.battleRecord.streak === 0,
);

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
