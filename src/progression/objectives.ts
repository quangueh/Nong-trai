/**
 * Experience: where it comes from, and what it is measured against.
 *
 * ## Why this module exists
 *
 * A plant could level — visibly, on a bar, with a celebration — and the only sources were a
 * cleared stage and a care action. Everything else the fight already knew was thrown away:
 * how long it took, whether the player was ever hit, how many skills were used, how long the
 * damage ran unbroken. All of that is in the recorded event log, and none of it paid.
 *
 * So this reads the log and turns it into two things a player can chase: a **combo**, and a
 * set of **sub-objectives** per stage.
 *
 * ## Everything here is derived, never invented
 *
 * `readCombo` walks the same event list `BattleView` played. `stageObjectives` are predicates
 * over the same `BattleResult` the store already settled on. Nothing is re-simulated, nothing
 * is estimated, and nothing can disagree with the fight that happened — which matters because
 * the alternative, computing objectives inside the engine, would have meant a second place
 * where a fight's meaning is decided.
 *
 * ## And why objectives are per-stage rather than a flat list
 *
 * A fixed checklist is finished once and then ignored. Keying them to the stage index means
 * the ladder keeps asking new questions as it deepens, and the reward scales with the fight:
 * "win in 20 seconds" is a real ask at stage 8 and an absurd one at stage 90, so each band
 * gets its own thresholds instead of every stage inheriting stage 1's.
 */

import type { BattleEvent, BattleResult } from "../battle/engine";
import { xpRequired } from "../growth/care";
import { STAT_LADDER_END } from "../pve/ascent";

/* ---------------------------------------------------------------------------
   Combo
   --------------------------------------------------------------------------- */

/**
 * What the fight's damage looked like as a run.
 *
 * **A combo is consecutive damaging actions without being hit.** Not consecutive skill casts —
 * a skill that misses does not start a chain, and neither does one the target dodges, so the
 * counter tracks something the player actually did rather than something the cooldown allowed.
 *
 * Being hit resets it, which is what makes it a thing worth playing well for rather than a
 * number that only goes up.
 */
export interface ComboReading {
  /** Longest unbroken run. */
  best: number;
  /** Total damaging actions landed. */
  hits: number;
  /** The largest run, as a share of all hits, for the "consistency" framing. */
  share: number;
}

/**
 * Read the combo out of a finished fight.
 *
 * Walks the recorded events rather than the engine's live state, because by the time the
 * result screen exists the session has already been torn down and the log is the only honest
 * source left. Cheap enough to run on the result screen: one pass over a few hundred events.
 */
export function readCombo(events: readonly BattleEvent[], mySide: "a" | "b"): ComboReading {
  const foe = mySide === "a" ? "b" : "a";
  let run = 0;
  let best = 0;
  let hits = 0;

  for (const ev of events) {
    if (ev.type !== "DAMAGE_APPLIED") continue;
    // The event carries the side that *dealt* it, so mine counts and theirs resets.
    if (ev.side === mySide) {
      run++;
      hits++;
      if (run > best) best = run;
    } else if (ev.side === foe) {
      run = 0;
    }
  }

  return { best, hits, share: hits > 0 ? best / hits : 0 };
}

/* ---------------------------------------------------------------------------
   Sub-objectives
   --------------------------------------------------------------------------- */

/** The facts a fight offers, all of them already recorded. */
export interface ObjectiveContext {
  won: boolean;
  durationSeconds: number;
  /** Fraction of max HP the player's plant finished on, 0-1. */
  hpLeft: number;
  /** Fraction of max HP the monster finished on. */
  foeHpLeft: number;
  combo: ComboReading;
  skillUses: number;
}

export interface SubObjective {
  id: string;
  icon: string;
  label: string;
  /** One line saying what to actually do, since the label alone is not an instruction. */
  hint: string;
  /** Plant experience for meeting it. */
  xp: number;
  /** Breeder experience, which is a quarter of the plant's — the two curves are separate. */
  breederXp: number;
  met: (ctx: ObjectiveContext) => boolean;
}

/**
 * Per-stage thresholds, scaled by how deep into the ladder the stage is.
 *
 * Linear in the stage index up to the stat ladder's end and flat after, because past that
 * point the power stops growing and only the affixes do — the same reason the power curve is
 * flat there. An objective that kept demanding more after stage 60 would be demanding
 * something the fight does not contain.
 */
function scale(stage: number, base: number): number {
  return Math.round(base * (1 + Math.min(stage, STAT_LADDER_END) * 0.045));
}

/**
 * The objectives for one stage.
 *
 * Four per stage, each reading a different axis of the fight — speed, damage taken, combo,
 * skill variety — so a player has several ways to be rewarded rather than one dominant
 * strategy to repeat. All four can be met at once, and the EXP is additive, so a strong
 * performance on a deep stage is worth far more than four weak ones on an early one.
 */
export function stageObjectives(stage: number): SubObjective[] {
  const fastSeconds = scale(stage, 22);
  const cleanHp = Math.max(0.1, 0.9 - Math.min(stage, STAT_LADDER_END) * 0.008);
  const comboTarget = 4 + Math.floor(stage / 12);
  const skillTarget = 2 + Math.floor(stage / 20);

  return [
    {
      id: "swift",
      icon: "⚡",
      label: "Dứt trận nhanh",
      hint: `Thắng trong ${fastSeconds} giây`,
      xp: scale(stage, 40),
      breederXp: scale(stage, 10),
      met: (c) => c.won && c.durationSeconds <= fastSeconds,
    },
    {
      id: "untouched",
      icon: "🛡️",
      label: "Ít bị đánh",
      hint: `Kết thúc còn trên ${Math.round(cleanHp * 100)}% máu`,
      xp: scale(stage, 45),
      breederXp: scale(stage, 11),
      met: (c) => c.won && c.hpLeft >= cleanHp,
    },
    {
      id: "chain",
      icon: "🔥",
      label: "Liên hoàn",
      hint: `Đánh liên ${comboTarget} lần không bị trúng đòn`,
      xp: scale(stage, 35),
      breederXp: scale(stage, 9),
      met: (c) => c.combo.best >= comboTarget,
    },
    {
      id: "versatile",
      icon: "🎯",
      label: "Đa kỹ năng",
      hint: `Dùng ${skillTarget} kỹ năng trở lên`,
      xp: scale(stage, 30),
      breederXp: scale(stage, 8),
      met: (c) => c.skillUses >= skillTarget,
    },
  ];
}

/** Build the context a predicate needs from a settled result. */
export function objectiveContext(won: boolean, result: BattleResult, mySide: "a" | "b" = "a"): ObjectiveContext {
  const mine = mySide === "a" ? result.a : result.b;
  const theirs = mySide === "a" ? result.b : result.a;
  return {
    won,
    durationSeconds: result.durationSeconds,
    hpLeft: mine.hpPct / 100,
    foeHpLeft: theirs.hpPct / 100,
    combo: readCombo(result.events, mySide),
    skillUses: mine.skillUses,
  };
}

export interface ObjectiveOutcome {
  met: SubObjective[];
  missed: SubObjective[];
  /** Extra plant experience, on top of the stage's own reward. */
  bonusPlantXp: number;
  bonusBreederXp: number;
  /** 0-4, for a single line on the result screen. */
  stars: number;
}

/** Score one fight against one stage's objectives. */
export function evaluateObjectives(stage: number, ctx: ObjectiveContext): ObjectiveOutcome {
  const all = stageObjectives(stage);
  const met: SubObjective[] = [];
  const missed: SubObjective[] = [];
  let bonusPlantXp = 0;
  let bonusBreederXp = 0;

  for (const o of all) {
    if (o.met(ctx)) {
      met.push(o);
      bonusPlantXp += o.xp;
      bonusBreederXp += o.breederXp;
    } else {
      missed.push(o);
    }
  }

  return { met, missed, bonusPlantXp, bonusBreederXp, stars: met.length };
}

/* ---------------------------------------------------------------------------
   Skill mastery
   --------------------------------------------------------------------------- */

/**
 * What a skill's mastery is worth, for the label under its bar.
 *
 * Read from `skillGenerator`'s own curve rather than restated, for the reason every other
 * number in this codebase gets its own copy: a second copy of a curve is a second chance for
 * the bar and the levelling loop to disagree about when a level happens, and that
 * disagreement is invisible until something is one XP short of something.
 */
export function skillMasteryText(level: number, masteryXp: number): string {
  const curve = [0, 30, 80, 150, 260, 420, 650, 950, 1350, 1900];
  if (level >= curve.length) return "Thành thạo tối đa";
  const need = curve[level];
  return `Còn ${Math.max(0, need - masteryXp)} EXP`;
}

/** 0-100 for the mastery bar. The curve is one list, indexed by level. */
export function skillMasteryPct(level: number, masteryXp: number): number {
  const curve = [0, 30, 80, 150, 260, 420, 650, 950, 1350, 1900];
  if (level >= curve.length) return 100;
  const need = curve[level];
  return need <= 0 ? 0 : Math.max(0, Math.min(100, (masteryXp / need) * 100));
}

/**
 * The whole plant-level curve as an export, so a caller can say "this is enough for a level"
 * without importing `growth/care` and having to know the curve lives there.
 */
export { xpRequired };