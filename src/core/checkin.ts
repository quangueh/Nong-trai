/**
 * Daily check-in (điểm danh) + the hired gardener (auto-care).
 *
 * Two features sharing one entry point because the day a player remembers to
 * open the game is exactly the day an automated helper is worth most:
 *
 *  - **Điểm danh**: once per calendar day the player claims a random gift
 *    (đặc ân). Consecutive days build a streak; the streak decides which
 *    reward band the roll comes from, and days 7/14/21/30 of each 30-day
 *    cycle are fixed milestone chests instead of a roll. A missed day restarts
 *    the streak at 1.
 *  - **Người làm vườn**: 15 minutes of automated tending, granted by the
 *    daily check-in and by watching a rewarded ad. While the buff runs, a
 *    store tick applies one care action per plant per round — free of
 *    resources, respecting cooldowns, stress and the 24h anti-spam memory,
 *    so a buff can never burn a garden the way a macro would.
 *
 * Everything here is deterministic per player-day: the gift roll is seeded by
 * playerId + day + streak, so a second device reading the same save sees the
 * same gift rather than re-rolling it.
 */

import { Rng } from "./rng";
import { SPECIES, type SpeciesId } from "../config/species";
import type { CurrencyId } from "./currency";

/* ------------------------------------------------------------------ */
/* The day structure                                                    */
/* ------------------------------------------------------------------ */

/** A streak's position inside its 30-day reward cycle, 1-indexed. */
export function dayInCycle(streak: number): number {
  return ((Math.max(1, streak) - 1) % 30) + 1;
}

/** Milestone days inside the cycle — the fixed VIP chests. */
export const MILESTONE_DAYS = [7, 14, 21, 30] as const;

export function isMilestone(dayInCycle_: number): boolean {
  return (MILESTONE_DAYS as readonly number[]).includes(dayInCycle_);
}

/** The next milestone strictly after `day`, or null on the last day of a cycle. */
export function nextMilestone(dayInCycle_: number): number | null {
  for (const m of MILESTONE_DAYS) if (m > dayInCycle_) return m;
  return null;
}

/* ------------------------------------------------------------------ */
/* The gift                                                             */
/* ------------------------------------------------------------------ */

/** One line of a granted gift — the UI prints these, the store pays them. */
export interface GiftLine {
  kind: "currency" | "items" | "crystal" | "seed" | "autocare";
  /** For kind=currency. */
  currency?: CurrencyId;
  /** For kind=seed. */
  species?: SpeciesId;
  amount: number;
  /** Display label, e.g. "LeafCoin ×300" — assembled by the UI via currencyInfo. */
}

export interface CheckInGift {
  /** The fixed part every claim pays. */
  lines: GiftLine[];
  /** True on milestone days — the UI dresses these claims up as chests. */
  milestone: boolean;
  dayInCycle: number;
  streak: number;
}

const AUTO_CARE_MS = 15 * 60 * 1000;
export const AUTO_CARE_MINUTES = 15;
export { AUTO_CARE_MS };

/** Species pickable as gift seeds, grouped by the tier a milestone unlocks. */
const GIFT_SEED_TIERS: Record<number, SpeciesId[]> = {};
function giftSeeds(maxTier: number): SpeciesId[] {
  if (!GIFT_SEED_TIERS[maxTier]) {
    GIFT_SEED_TIERS[maxTier] = SPECIES.filter((s) => s.tier <= maxTier).map((s) => s.id);
  }
  return GIFT_SEED_TIERS[maxTier];
}

/**
 * The milestone chests — fixed, generous, and always with seeds so the day
 * visibly pays something a roll of coins cannot.
 */
const MILESTONE_CHEST: Record<number, { currency: Partial<Record<CurrencyId, number>>; items: number; crystal: number; seeds: number; seedTier: number }> = {
  7: { currency: { leafCoin: 300, nectar: 60, pollen: 10 }, items: 6, crystal: 0, seeds: 2, seedTier: 1 },
  14: { currency: { leafCoin: 600, pollen: 25, ember: 3 }, items: 8, crystal: 1, seeds: 2, seedTier: 2 },
  21: { currency: { leafCoin: 1000, pollen: 50, ember: 6 }, items: 10, crystal: 2, seeds: 2, seedTier: 3 },
  30: { currency: { leafCoin: 2000, pollen: 90, ember: 12 }, items: 12, crystal: 5, seeds: 3, seedTier: 4 },
};

/**
 * The ordinary-day bands. Each entry is a range the day's roll draws inside —
 * later streak days pay more, and the rarer currencies appear only once the
 * streak has earned them.
 */
interface Band {
  leaf: [number, number];
  items: [number, number];
  nectar: [number, number];
  pollen: [number, number];
  /** Chance of a small ember bonus. */
  emberChance: number;
  ember: [number, number];
  /** Chance of a gene crystal bonus. */
  crystalChance: number;
}
const BANDS: { from: number; to: number; band: Band }[] = [
  { from: 1, to: 6, band: { leaf: [60, 140], items: [2, 5], nectar: [10, 25], pollen: [0, 3], emberChance: 0.06, ember: [1, 1], crystalChance: 0.03 } },
  { from: 8, to: 13, band: { leaf: [120, 220], items: [3, 6], nectar: [20, 40], pollen: [4, 10], emberChance: 0.12, ember: [1, 2], crystalChance: 0.06 } },
  { from: 15, to: 20, band: { leaf: [220, 380], items: [4, 8], nectar: [30, 60], pollen: [8, 16], emberChance: 0.15, ember: [1, 2], crystalChance: 0.15 } },
  { from: 22, to: 29, band: { leaf: [350, 600], items: [5, 10], nectar: [50, 100], pollen: [12, 24], emberChance: 0.22, ember: [1, 3], crystalChance: 0.2 } },
];

function bandFor(dayInCycle_: number): Band {
  for (const b of BANDS) if (dayInCycle_ >= b.from && dayInCycle_ <= b.to) return b.band;
  // Milestone days never reach here; a cycle edge falls back to the last band.
  return BANDS[BANDS.length - 1].band;
}

const rollIn = (rng: Rng, [lo, hi]: [number, number]): number => lo + Math.floor(rng.next() * (hi - lo + 1));

/**
 * What claiming on this streak day pays.
 *
 * Deterministic per player-day: the seed string pins the roll, so two devices
 * that both claim before a sync agree on the gift instead of racing for it.
 * (The second claim is refused by `lastDay` anyway — determinism is for the
 * *display* agreeing, not for paying twice.)
 */
export function giftFor(playerId: string, dayKey: string, streak: number): CheckInGift {
  const day = dayInCycle(streak);
  const rng = new Rng(`checkin|${playerId}|${dayKey}|${streak}`);
  const lines: GiftLine[] = [];

  // Every claim hires the gardener for a quarter hour — stated up front so the
  // UI's "what you get" list always leads with it.
  lines.push({ kind: "autocare", amount: AUTO_CARE_MINUTES });

  const chest = MILESTONE_CHEST[day];
  if (chest) {
    for (const [currency, amount] of Object.entries(chest.currency)) {
      lines.push({ kind: "currency", currency: currency as CurrencyId, amount: amount ?? 0 });
    }
    if (chest.items) lines.push({ kind: "items", amount: chest.items });
    if (chest.crystal) lines.push({ kind: "crystal", amount: chest.crystal });
    const pool = giftSeeds(chest.seedTier);
    for (let i = 0; i < chest.seeds; i++) {
      const species = pool[Math.floor(rng.next() * pool.length)];
      if (species) lines.push({ kind: "seed", species, amount: 1 });
    }
    return { lines, milestone: true, dayInCycle: day, streak };
  }

  const b = bandFor(day);
  lines.push({ kind: "currency", currency: "leafCoin", amount: rollIn(rng, b.leaf) });
  lines.push({ kind: "items", amount: rollIn(rng, b.items) });
  const nectar = rollIn(rng, b.nectar);
  if (nectar > 0) lines.push({ kind: "currency", currency: "nectar", amount: nectar });
  const pollen = rollIn(rng, b.pollen);
  if (pollen > 0) lines.push({ kind: "currency", currency: "pollen", amount: pollen });
  if (rng.next() < b.emberChance) lines.push({ kind: "currency", currency: "ember", amount: rollIn(rng, b.ember) });
  if (rng.next() < b.crystalChance) lines.push({ kind: "crystal", amount: 1 });

  return { lines, milestone: false, dayInCycle: day, streak };
}
