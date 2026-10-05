/**
 * Battle streak: the reason to fight once more.
 *
 * A win is worth the same as the last win, which is the flattest possible reason to
 * press the button again. Scaling the payout by the current run turns the second win
 * into a different event from the first, and makes losing a run something a player goes
 * and takes back rather than a number that only climbs.
 *
 * Two rules keep it from becoming a grind rather than a game:
 *
 * **Bounded.** The bonus caps at five consecutive wins and at +75%. Unbounded, a
 * strong player would stop losing on purpose and farm the eighth win forever, which
 * turns the arena into a puzzle about losing efficiently.
 *
 * **Per plant.** A streak belongs to the fighter, not to the account. Swapping plants
 * to reset a multiplier would make the strongest plant the wrong one to bring, which
 * inverts the whole point of breeding for a fighter.
 *
 * One function is exported so the menu, the result screen and the payout all read the
 * same number. Three copies of this table is how a screen ends up promising a bonus the
 * payout does not pay.
 */

/** Wins that count toward the bonus. Past this, more of the same stops mattering. */
export const STREAK_CAP = 5;

/** Each consecutive win adds this fraction to the payout. */
export const STREAK_STEP = 0.15;

export interface BattleRecordLike {
  streak: number;
  bestStreak: number;
}

/**
 * The reward multiplier for a streak.
 *
 * The bonus is paid on the streak *already held*, so the first win of a run pays the
 * base rate and each subsequent one pays more. Paying on the post-win streak would make
 * the first win already generous and the curve flatter than it looks.
 */
export function battleStreakBonus(streak: number): number {
  // Non-finite reads as zero, which is the safe direction: a corrupt value must not
  // hand out a large payout, and NaN in particular survives Math.floor and Math.min
  // unchanged, so without this it would reach the receipt as "NaN🪙". Infinity cannot
  // come from a save - JSON.stringify writes it as null - so this is a guard against a
  // computation upstream going wrong, and zero is the answer that cannot be exploited.
  const held = Number.isFinite(streak) ? Math.max(0, Math.min(STREAK_CAP, Math.floor(streak))) : 0;
  return 1 + held * STREAK_STEP;
}

/**
 * Apply the outcome and return the streak as it now stands.
 *
 * A draw resets the run as well as a loss does. A draw that kept the streak would make
 * the safe option the good one, and the player would take draws to protect a multiplier.
 */
export function advanceStreak(
  record: BattleRecordLike,
  outcome: "win" | "loss" | "draw",
): number {
  if (outcome === "win") {
    record.streak += 1;
    if (record.streak > record.bestStreak) record.bestStreak = record.streak;
  } else {
    record.streak = 0;
  }
  return record.streak;
}

/** What the streak is worth right now, in coins, for the screen to show before the fight. */
export function streakCoinPreview(baseCoins: number, streak: number): number {
  return Math.round(baseCoins * battleStreakBonus(streak));
}

/** Repaired onto a save written before the streak existed. */
export function emptyStreakFields(): BattleRecordLike {
  return { streak: 0, bestStreak: 0 };
}