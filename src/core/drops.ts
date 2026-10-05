/**
 * What a finished fight might leave behind.
 *
 * Coins were the whole payout, and they were certain: the same number every win, which is
 * a number a player stops seeing. The rarer currencies are rolled instead, so a fight
 * has a shape - some sessions come back empty-handed from the shelf's point of view,
 * and some hand over the Ember that unlocks a species nothing else can buy.
 *
 * **The odds on the arena screen are the odds this file rolls.** Not a rounded
 * description of them, and not a separate table maintained alongside. A player who reads
 * "12%" and loses eleven times in a row has been done something deliberate, and a
 * breeding game that does that to somebody is not a breeding game. So the screen reads
 * its percentages from `DROP_TABLE` through `dropOdds()`, and there is no second copy.
 *
 * Two rules keep the luck from being a slot machine:
 *
 * **Losing still pays something.** A loss is worth less of everything, but never zero -
 * the consolation matters more for coming back than the win does.
 *
 * **The rare one is protected.** Ember is capped per day. Without a cap, one lucky
 * afternoon buys the entire top tier and the rest of the game has nothing left to ask of
 * you. Capped, the top shelf stays a reason to keep fighting for weeks.
 */

import type { CurrencyId } from "./currency";

/** One line of the drop table: a currency, how often, and how much when it lands. */
export interface DropEntry {
  currency: CurrencyId;
  /** Probability this line fires, 0-1. Shared by win and loss where they are the same. */
  chance: number;
  /** Amount range, inclusive, drawn only when the line fires. */
  min: number;
  max: number;
}

/** How a fight ended. The only thing the table keys off. */
export type Outcome = "win" | "loss" | "draw";

/**
 * The table.
 *
 * LeafCoin is deliberately absent: it is paid outright by the caller, not rolled,
 * because a certain payout the player can count on is what the common currency is for.
 */
export const DROP_TABLE: Record<Outcome, DropEntry[]> = {
  win: [
    { currency: "nectar", chance: 0.55, min: 2, max: 6 },
    { currency: "pollen", chance: 0.22, min: 1, max: 3 },
    { currency: "ember", chance: 0.12, min: 1, max: 1 },
  ],
  loss: [
    { currency: "nectar", chance: 0.28, min: 1, max: 2 },
    { currency: "pollen", chance: 0.07, min: 1, max: 1 },
    { currency: "ember", chance: 0.02, min: 1, max: 1 },
  ],
  draw: [
    { currency: "nectar", chance: 0.4, min: 1, max: 3 },
    { currency: "pollen", chance: 0.12, min: 1, max: 1 },
    { currency: "ember", chance: 0.05, min: 1, max: 1 },
  ],
};

/**
 * The Ember daily cap.
 *
 * Not a soft target: once it is reached the line stops firing and the arena says so,
 * because a player watching a 12% line that never pays looks at a bug rather than at a
 * limit they have reached.
 */
export const EMBER_DAILY_CAP = 3;

export interface DropRoll {
  currency: CurrencyId;
  amount: number;
}

/**
 * Roll the table.
 *
 * Each line is rolled independently rather than picking one, so a win can pay nectar
 * *and* ember. That is the more generous shape and it is deliberate: a single pick would
 * make the 12% ember line compete with a 55% nectar line for one slot, and the thing
 * players actually want is the rare one.
 *
 * `rng` is injected rather than using `Math.random` so a test can walk the real table
 * with a controlled sequence, which is the only way to prove the printed odds are the
 * rolled ones.
 */
export function rollDrops(
  outcome: Outcome,
  rng: () => number,
  opts: { emberLeftToday?: number } = {},
): DropRoll[] {
  const emberLeft = opts.emberLeftToday ?? EMBER_DAILY_CAP;
  const out: DropRoll[] = [];

  for (const line of DROP_TABLE[outcome]) {
    if (line.currency === "ember" && emberLeft <= 0) continue;
    if (rng() >= line.chance) continue;
    const amount = line.min + Math.floor(rng() * (line.max - line.min + 1));
    out.push({ currency: line.currency, amount });
  }

  return out;
}

/**
 * What the arena screen prints before the fight.
 *
 * Percentages are formatted from the table itself and rounded to whole numbers. The
 * rounding means the printed figures may not sum to exactly the true probability across
 * three independent lines, which is why this describes each line rather than promising
 * "a 12% chance of Ember" as if it were the only thing on offer - the body text says the
 * lines are rolled separately.
 */
export function dropOdds(outcome: Outcome = "win"): { currency: CurrencyId; chance: number; min: number; max: number }[] {
  return DROP_TABLE[outcome].map((l) => ({ currency: l.currency, chance: l.chance, min: l.min, max: l.max }));
}

/** A line for a result screen: "🍯 Mật ong ×4". */
export function formatDrops(drops: DropRoll[], label: (id: CurrencyId) => string): string[] {
  return drops.map((d) => `${label(d.currency)} ×${d.amount}`);
}
