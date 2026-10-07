/**
 * Unlock conditions (docs/16).
 *
 * Everything gated in the game used to be a single number: a species had a `tier`
 * compared against the breeder level, and the garden had one `nurseryCap`. That
 * answers "can I buy this yet" with one comparison, which means the answer is
 * always yes or always no and never "nearly".
 *
 * Replaced with a small rule language, because the interesting gates are not all
 * the same shape. A player should be able to be told *exactly* how far off they
 * are, so every rule reports progress rather than just a verdict — a locked thing
 * with no visible progress reads as arbitrary, and an arbitrary gate is one the
 * player stops caring about.
 *
 * The rules are deliberately small and all derived from state the game already
 * tracks. There is no separate "quest" bookkeeping, so a condition can never fall
 * out of sync with the save.
 */

import type { Plant } from "../core/types";

export type UnlockRule =
  /** Breeder level at least `n`. */
  | { k: "level"; n: number }
  /** Own at least `n` plants. */
  | { k: "plants"; n: number }
  /** Own seeds of at least `n` distinct species. */
  | { k: "species"; n: number }
  /** Own any plant at growth level `n` or above. */
  | { k: "growthLevel"; n: number }
  /** Own at least `n` awakened plants. */
  | { k: "awakened"; n: number }
  /** Own any plant of generation `n` or above. */
  | { k: "generation"; n: number }
  /** Hold at least `n` coins. */
  | { k: "coin"; n: number }
  /** Have cleared ascent stage `n`. */
  | { k: "stage"; n: number }
  /** Have fought `n` battles (arena or ladder, win or loss — a fight fought). */
  | { k: "battles"; n: number }
  /** Have bred `n` times. */
  | { k: "breeds"; n: number }
  /** Have claimed `n` quest rewards. */
  | { k: "quests"; n: number }
  /** Have discovered `n` distinct elements. */
  | { k: "elements"; n: number };

/**
 * A gate.
 *
 * Accepts a single rule directly, because writing `{ all: [{ k: "level", n: 4 }] }`
 * for every one-rule gate is noise — and an earlier version of the species ladder
 * had exactly that friction, and ended up with a placeholder branch where the
 * shorthand should have gone.
 *
 * `all` must all hold; `any` needs at least one, and an absent or empty `any`
 * never blocks.
 */
export type UnlockReq =
  | UnlockRule
  | {
      all?: UnlockRule[];
      any?: UnlockRule[];
    };

/** Normalise either shape into `{ all, any }`. */
function normalise(req: UnlockReq): { all: UnlockRule[]; any: UnlockRule[] } {
  if ("k" in req) return { all: [req], any: [] };
  return { all: req.all ?? [], any: req.any ?? [] };
}

/** Everything a rule can be measured against, read straight off the save. */
export interface UnlockContext {
  breederLevel: number;
  plantCount: number;
  speciesCount: number;
  topGrowthLevel: number;
  awakenedCount: number;
  topGeneration: number;
  leafCoin: number;
  /** Highest ascent stage ever cleared. */
  ascentHighest: number;
  /** Battles fought, win or lose. */
  battleCount: number;
  /** Times bred. */
  breedCount: number;
  /** Quest rewards claimed. */
  questClaims: number;
  /** Distinct elements ever discovered. */
  elementCount: number;
}

/** One rule, resolved. */
export interface RuleStatus {
  rule: UnlockRule;
  met: boolean;
  /** How far along, in the rule's own units. */
  have: number;
  need: number;
  /** e.g. "Cấp 7/12" — the whole point is that this exists. */
  label: string;
}

export interface UnlockStatus {
  met: boolean;
  /** Every rule, so the UI can show all of them rather than only the blocker. */
  rules: RuleStatus[];
  /** The single most useful line to show when locked. */
  summary: string;
}

export const RULE_LABEL: Record<UnlockRule["k"], (n: number) => string> = {
  level: (n) => `Cấp nhà lai tạo ${n}`,
  plants: (n) => `Trồng ${n} cây`,
  species: (n) => `Có hạt của ${n} loài`,
  growthLevel: (n) => `Có cây đạt cấp ${n}`,
  awakened: (n) => `Thức tỉnh ${n} cây`,
  generation: (n) => `Có cây thế hệ ${n}`,
  coin: (n) => `Có ${n.toLocaleString("vi-VN")} xu`,
  stage: (n) => `Vượt ải ${n}`,
  battles: (n) => `Đánh ${n} trận`,
  breeds: (n) => `Lai tạo ${n} lần`,
  quests: (n) => `Nhận thưởng ${n} nhiệm vụ`,
  elements: (n) => `Khám phá ${n} hệ`,
};

function progress(n: number): string {
  return n.toLocaleString("vi-VN");
}

/**
 * The parts of a context that are not derivable from the plants and seeds alone —
 * the ladder record, the discovery tallies and the quest claims all live elsewhere
 * in the save, and a rule that measures them would read zero without being told.
 */
export interface ProgressExtras {
  ascentHighest?: number;
  battleCount?: number;
  breedCount?: number;
  questClaims?: number;
  elementCount?: number;
}

/** Build a context from the live game state. */
export function contextFrom(
  plants: Plant[],
  breederLevel: number,
  seeds: Partial<Record<string, number>>,
  leafCoin: number,
  extras: ProgressExtras = {},
): UnlockContext {
  let topGrowthLevel = 0;
  let awakenedCount = 0;
  let topGeneration = 0;
  let speciesCount = 0;
  const owned = new Set<string>();
  for (const [id, n] of Object.entries(seeds)) {
    if ((n ?? 0) > 0) {
      owned.add(id);
      speciesCount++;
    }
  }
  for (const p of plants) {
    if (p.growth.level > topGrowthLevel) topGrowthLevel = p.growth.level;
    if (p.growth.stage === "awakened") awakenedCount++;
    if (p.generation > topGeneration) topGeneration = p.generation;
  }
  return {
    breederLevel,
    plantCount: plants.length,
    speciesCount,
    topGrowthLevel,
    awakenedCount,
    topGeneration,
    leafCoin,
    ascentHighest: extras.ascentHighest ?? 0,
    battleCount: extras.battleCount ?? 0,
    breedCount: extras.breedCount ?? 0,
    questClaims: extras.questClaims ?? 0,
    elementCount: extras.elementCount ?? 0,
  };
}

function measure(ctx: UnlockContext, rule: UnlockRule): { have: number; need: number } {
  switch (rule.k) {
    case "level":
      return { have: ctx.breederLevel, need: rule.n };
    case "plants":
      return { have: ctx.plantCount, need: rule.n };
    case "species":
      return { have: ctx.speciesCount, need: rule.n };
    case "growthLevel":
      return { have: ctx.topGrowthLevel, need: rule.n };
    case "awakened":
      return { have: ctx.awakenedCount, need: rule.n };
    case "generation":
      return { have: ctx.topGeneration, need: rule.n };
    case "coin":
      return { have: ctx.leafCoin, need: rule.n };
    case "stage":
      return { have: ctx.ascentHighest, need: rule.n };
    case "battles":
      return { have: ctx.battleCount, need: rule.n };
    case "breeds":
      return { have: ctx.breedCount, need: rule.n };
    case "quests":
      return { have: ctx.questClaims, need: rule.n };
    case "elements":
      return { have: ctx.elementCount, need: rule.n };
    default:
      return { have: 0, need: 1 };
  }
}

/** Resolve one rule. */
export function checkRule(ctx: UnlockContext, rule: UnlockRule): RuleStatus {
  const { have, need } = measure(ctx, rule);
  return {
    rule,
    have,
    need,
    met: have >= need,
    label: `${RULE_LABEL[rule.k](need)} · ${progress(have)}/${progress(need)}`,
  };
}

/** Resolve a whole gate. */
export function checkUnlock(ctx: UnlockContext, req: UnlockReq | undefined): UnlockStatus {
  if (!req) return { met: true, rules: [], summary: "" };
  const { all, any } = normalise(req);
  const allDone = all.map((r) => checkRule(ctx, r));
  const anyDone = any.map((r) => checkRule(ctx, r));
  const allMet = allDone.every((r) => r.met);
  // An `any` group with nothing in it must not block, or a half-written gate
  // would silently lock content forever.
  const anyMet = anyDone.length === 0 || anyDone.some((r) => r.met);

  // Show the blocker, not the first rule. With an `all` list the first unmet rule
  // is the closest thing to actionable; with `any` the least-met option is the
  // cheapest route and that is what should be shown.
  let blocker: RuleStatus | undefined;
  if (!allMet) blocker = allDone.find((r) => !r.met);
  else if (!anyMet) blocker = [...anyDone].sort((a, b) => b.have / b.need - a.have / a.need)[0];

  const met = allMet && anyMet;
  const summary = met ? "" : blocker ? blocker.label : "";
  return { met, rules: [...allDone, ...anyDone], summary };
}

/** Convenience for the common "nothing gated" case. */
export const ALWAYS: UnlockReq = {};

// ---------------------------------------------------------------------------
// Garden plots
// ---------------------------------------------------------------------------

export interface PlotDef {
  /** Position in the garden grid, 1-based. */
  index: number;
  /** Coins to open this plot. Zero for the ones the player starts with. */
  cost: number;
  unlock?: UnlockReq;
}

/**
 * How many plots the player begins with.
 *
 * Six, not one. The old garden showed `nurseryCap` slots that all existed from the
 * start, so there was nothing to look forward to inside the screen the player
 * spends the most time in.
 */
export const STARTING_PLOTS = 6;

/**
 * The garden's plots.
 *
 * Built rather than written out because the cost curve is the design: each block
 * of six roughly doubles, so opening plot 7 is a small decision and plot 19 is a
 * real one. The unlock conditions are drawn from the same rule pool as the
 * species, so the two systems read as one idea.
 */
export const PLOT_DEFS: readonly PlotDef[] = Object.freeze(
  Array.from({ length: 24 }, (_, i) => {
    const index = i + 1;
    if (index <= STARTING_PLOTS) return { index, cost: 0 };
    // 7..12 -> 900, 13..18 -> 2_600, 19..24 -> 7_400.
    const block = Math.floor((index - STARTING_PLOTS - 1) / 6);
    const base = [900, 2600, 7400][block] ?? 7400;
    const step = [900, 2600, 7400][block] ?? 7400;
    // Within a block each plot costs a bit more than the last, so "open the next
    // one" is always the cheapest way forward and the player is never stuck
    // choosing between two unaffordable things.
    const within = (index - STARTING_PLOTS - 1) % 6;
    const cost = base + Math.round(within * (step * 0.12));
    const unlock: UnlockReq =
      block === 0
        ? { any: [{ k: "level", n: 4 }, { k: "plants", n: 4 }] }
        : block === 1
          ? { all: [{ k: "level", n: 14 }], any: [{ k: "species", n: 6 }, { k: "growthLevel", n: 12 }] }
          : { all: [{ k: "level", n: 30 }], any: [{ k: "awakened", n: 1 }, { k: "generation", n: 3 }] };
    return { index, cost, unlock };
  }),
);

/** Total plots the garden can ever hold. */
export const MAX_PLOTS = PLOT_DEFS.length;

export interface PlotStatus {
  def: PlotDef;
  /** Flattened for the UI: the plot's number is needed on its own constantly. */
  index: number;
  open: boolean;
  /** Can be opened right now: unlocked *and* affordable. */
  canBuy: boolean;
  /** Why not, when it cannot. */
  blocked: string;
  status: UnlockStatus;
}

/** Which plots are open, and why the rest are not. */
export function plotStatuses(ctx: UnlockContext, unlockedPlots: number): PlotStatus[] {
  return PLOT_DEFS.map((def) => {
    const status = checkUnlock(ctx, def.unlock);
    const open = def.index <= unlockedPlots;
    if (open) return { def, index: def.index, open: true, canBuy: false, blocked: "", status };
    const affordable = ctx.leafCoin >= def.cost;
    const blocked = !status.met ? status.summary : !affordable ? `Cần ${progress(def.cost)} xu` : "";
    return { def, index: def.index, open: false, canBuy: status.met && affordable, blocked, status };
  });
}