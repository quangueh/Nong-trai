/**
 * Progression: what a level is, how far along one the player is, and what crossing it gave.
 *
 * Pure, and deliberately the *only* place any of this is worked out. The top bar draws a
 * bar, the plant cards draw a number, the stage screen previews the next level, and the
 * level-up celebration lists what was unlocked — four surfaces, and before this they each
 * read `store.state` and did their own arithmetic. Which is how a bar and a number came to
 * disagree about the same plant.
 *
 * ## The two curves are different on purpose
 *
 * A **plant's** level comes from `gainXp` (`growth/care.ts`): `40 * level^1.45 + 60`. A
 * **breeder's** comes from `xpForLevel` (`core/store.ts`): flat for the first three levels,
 * then `12 * (level-2)^1.45`. They are not reconciled here and should not be — the breeder
 * levels because the *garden* grew, a plant levels because *it* was tended and fought.
 *
 * Both are imported rather than restated. A second copy of a curve is a second chance for
 * the bar and the levelling loop to disagree about when a level happens, and that
 * disagreement is invisible until a plant is one XP short of something.
 */

import { xpRequired } from "../growth/care";
import { BREEDER_LEVEL_CAP, xpForLevel } from "../core/store";
import { PLOT_DEFS, type UnlockReq } from "../config/unlocks";
import { TIER_UNLOCK } from "../economy/shop";
import type { Plant } from "../core/types";

/** Where one level stands. Everything a bar needs and nothing more. */
export interface ProgressionSnapshot {
  level: number;
  /** XP banked toward the next level. Always less than `need` unless capped. */
  xp: number;
  /** XP required to level from here. 0 when capped, so a bar can be drawn full. */
  need: number;
  /** 0-100. 100 when capped. */
  pct: number;
  capped: boolean;
}

/** A snapshot with nothing in it yet, for a save written before this existed. */
export function emptySnapshot(cap: number): ProgressionSnapshot {
  return { level: 1, xp: 0, need: xpForLevel(1), pct: 0, capped: cap <= 1 };
}

/**
 * The breeder's progress.
 *
 * `need` is read from the store's own curve at the *current* level, so "Cấp 14" is measured
 * against the cost of leaving 14 — not against a cost computed for some other level.
 */
export function breederSnapshot(level: number, xp: number): ProgressionSnapshot {
  const capped = level >= BREEDER_LEVEL_CAP;
  const need = capped ? 0 : xpForLevel(level);
  const pct = capped ? 100 : clampPct((xp / Math.max(1, need)) * 100);
  return { level, xp, need, pct, capped };
}

/** A plant's progress, in the same shape so one bar can draw either. */
export function plantSnapshot(plant: Plant): ProgressionSnapshot {
  const level = Math.max(1, plant.growth.level);
  // A plant stops gaining levels at 100; past that the bar is full rather than absent,
  // because "this cannot move" reads as broken and "this is complete" does not.
  const capped = level >= 100;
  const need = capped ? 0 : xpRequired(level);
  const pct = capped ? 100 : clampPct((plant.growth.xp / Math.max(1, need)) * 100);
  return { level, xp: plant.growth.xp, need, pct, capped };
}

/**
 * What a grant of experience would do, before it is granted.
 *
 * The stage screen shows this so the player can see a fight is worth a level *before*
 * spending it, which is the difference between "progress" and "a number that moved".
 *
 * Loops rather than solving, because the requirement changes on every step and because the
 * honest answer is the one the same loop that will actually run produces. A closed form
 * here would be a second implementation of `gainXp`, and the two would drift.
 *
 * The leftover is returned as well: crossing two levels at once leaves a remainder, and the
 * celebration has to show where that remainder landed or the bar and the number disagree.
 */
export function previewGain(
  from: ProgressionSnapshot,
  amount: number,
  needAt: (level: number) => number,
  cap: number,
): { levelsGained: number; finalLevel: number; leftover: number; milestones: Milestone[] } {
  let level = from.level;
  let xp = from.xp + Math.max(0, Math.floor(amount));
  const milestones: Milestone[] = [];
  let gained = 0;

  // Bounded by `cap` as well as by the XP, so a corrupt save cannot spin here.
  while (gained < 1000) {
    if (cap > 0 && level >= cap) break;
    const need = needAt(level);
    if (need <= 0) break;
    if (xp < need) break;
    xp -= need;
    level++;
    gained++;
    const m = milestoneForLevel(level);
    if (m.unlocked.length) milestones.push(m);
  }

  return {
    levelsGained: gained,
    finalLevel: level,
    // At the cap nothing is carried, and the bar is full — so report a full bar rather than
    // an arbitrary remainder that would render as a half-empty bar at max level.
    leftover: cap > 0 && level >= cap ? 0 : xp,
    milestones,
  };
}

/** Preview for a breeder grant. */
export function previewBreederGain(amount: number, from: ProgressionSnapshot) {
  return previewGain(from, amount, xpForLevel, BREEDER_LEVEL_CAP);
}

/** Preview for a plant grant. */
export function previewPlantGain(amount: number, plant: Plant) {
  const from = plantSnapshot(plant);
  const out = previewGain(from, amount, xpRequired, 100);
  /*
   * A plant's rewards are its own — a potential-cap rise and a tier crossing — not the
   * account's shop shelves. So the account milestones `previewGain` collected are discarded
   * and replaced. Leaving them in would have the celebration announce "kệ cấp III" for a
   * plant that just levelled.
   */
  out.milestones = plantMilestoneLevels(from.level, out.finalLevel);
  return out;
}

/** The plant-level milestones between two levels, as `Milestone`-shaped records. */
function plantMilestoneLevels(from: number, to: number): Milestone[] {
  const out: Milestone[] = [];
  // Bounded both ways: a plant caps at 100, and a corrupt grant must not ask for a long walk.
  for (let l = Math.max(1, from + 1); l <= Math.min(to, 100); l++) {
    const m = plantMilestone(l);
    if (m.unlocked.length) out.push({ level: l, shelves: [], plots: 0, unlocked: m.unlocked });
  }
  return out;
}

/**
 * What crossing a breeder level actually opened.
 *
 * Derived from the same tables the shop and the garden read, never from a hand-written
 * list. A reward screen that says "Mở khoá: bậc II" while the shop still refuses to sell
 * bậc II is worse than no reward screen, and a hand-maintained list is exactly how that
 * happens — the table changes, the list does not.
 */
export interface Milestone {
  level: number;
  /** Shop tiers that became purchasable. */
  shelves: string[];
  /** How many garden plots became open to buy. */
  plots: number;
  /** Every human-readable line, for the celebration. */
  unlocked: { icon: string; label: string; gloss: string }[];
}

/** Shop tier names, matching the roman numerals the tier chips use. */
const TIER_LABEL = ["I", "II", "III", "IIII", "IIIII"];

const TIER_GLOSS: Record<number, string> = {
  1: "Kệ hạt giống cấp I mở để mua.",
  8: "Kệ hạt giống cấp II mở để mua.",
  18: "Kệ hạt giống cấp III mở để mua.",
  30: "Kệ hạt giống cấp IV mở để mua.",
  45: "Kệ hạt giống cấp V mở để mua — mọi loài đều mua được.",
};

/**
 * Everything that becomes reachable at `level`, or nothing.
 *
 * A plot "becomes eligible" rather than free: the store deliberately stopped granting plots
 * on level-up, because it was handing out plots the player could otherwise buy, and there
 * was then no reason to ever buy one. So this says "có thể mở" — can open — and the cost is
 * still paid. Saying "mở khoá ô đất" without that would be a lie the garden immediately
 * contradicts.
 */
export function milestoneForLevel(level: number): Milestone {
  const shelfIndex = TIER_UNLOCK.indexOf(level);
  const shelves: string[] = [];
  if (shelfIndex >= 0) shelves.push(TIER_LABEL[shelfIndex]);

  // Plots: how many have their level requirement met at exactly this level.
  let plots = 0;
  for (const def of PLOT_DEFS) {
    for (const req of plotLevelReqs(def)) if (req === level) plots++;
  }

  const unlocked: Milestone["unlocked"] = [];
  if (shelfIndex >= 0) {
    unlocked.push({
      icon: "🌿",
      label: `Kệ cấp ${TIER_LABEL[shelfIndex]}`,
      gloss: TIER_GLOSS[level] ?? "Kệ hạt giống mới mở để mua.",
    });
  }
  if (plots > 0) {
    unlocked.push({
      icon: "🟫",
      label: `${plots} ô đất mới`,
      gloss: "Có thể mở thêm ô đất trong vườn (vẫn tốn xu như mọi ô khác).",
    });
  }
  return { level, shelves, plots, unlocked };
}

/**
 * The level requirements a plot carries, flattened.
 *
 * `UnlockReq` has two shapes: a bare `{ k, n }` rule, and a tree of `{ all, any }`. Only the
 * `level` leaves matter here — a plot gated on "level 14 *or* 12 growth levels" becomes
 * eligible at 14 — so both shapes have to be walked or a milestone silently disappears.
 *
 * Mirrors `normalise` in `config/unlocks.ts` rather than importing it, because that one is
 * not exported and exporting it would widen a module's surface for one call. The two shapes
 * are a closed set, so this cannot drift.
 */
function plotLevelReqs(def: { unlock?: UnlockReq }): number[] {
  const req = def.unlock;
  if (!req) return [];
  const rules: { k: string; n: number }[] = [];
  if ("k" in req) rules.push(req);
  else {
    for (const r of req.all ?? []) rules.push(r);
    for (const r of req.any ?? []) rules.push(r);
  }
  return rules.filter((r) => r.k === "level").map((r) => r.n);
}

/**
 * What a *plant* gains by levelling.
 *
 * A plant level is not an account level, so the shop shelves do not apply to it — and the
 * celebration was printing an empty reward list, which reads as "levelling gave you
 * nothing". It does give two things, both real and both in the game already:
 *
 *  - every potential cap rises 3% per level (`gainXp`, growth/care.ts)
 *  - crossing 5, 15 or 30 moves the plant into a higher combat tier, which is the single
 *    largest thing a plant's level does
 *
 * Derived rather than invented, and the tier line comes from the same table the store uses.
 */
export interface PlantMilestone {
  level: number;
  unlocked: { icon: string; label: string; gloss: string }[];
}

const COMBAT_TIERS: { at: number; label: string; gloss: string }[] = [
  { at: 5, label: "Bậc Nảy", gloss: "Cây bước sang bậc Nảy — chỉ số và kỹ năng mạnh hơn hẳn." },
  { at: 15, label: "Bậc Nở", gloss: "Cây bước sang bậc Nở." },
  { at: 30, label: "Bậc Cổ", gloss: "Cây bước sang bậc Cổ — bậc cao nhất." },
];

export function plantMilestone(level: number): PlantMilestone {
  const unlocked: PlantMilestone["unlocked"] = [];
  const tier = COMBAT_TIERS.find((t) => t.at === level);
  if (tier) unlocked.push({ icon: "⚔", label: tier.label, gloss: tier.gloss });
  // Printed on every plant level, because it is true on every plant level — `gainXp` nudges
  // every potential cap by 3% each time. A reward list that is occasionally empty reads as
  // broken; one that always has something in it reads as decoration. So the cap is named
  // explicitly and, when a tier also moved, that sits above it.
  unlocked.push({ icon: "📈", label: "+3% trần chỉ số", gloss: "Mọi trần tiềm năng của cây tăng 3%." });
  return { level, unlocked };
}

/** "Còn X" in the game's language, for the line under a bar. */
export function xpRemainingText(s: ProgressionSnapshot): string {
  if (s.capped) return "Đã đạt cấp tối đa";
  const left = Math.max(0, s.need - s.xp);
  return `Còn ${Math.round(left).toLocaleString("vi-VN")} EXP`;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}