/**
 * The quest engine: pure functions over a catalogue, a save and a context.
 *
 * No store, no DOM, no clock of its own — the day comes in through the context and the
 * randomness is seeded from the player and the day. That is what makes the whole system
 * testable in node, and it is also what stops a quest from being advanced in six different
 * screens: there is exactly one function that moves progress, and everything calls it.
 */

import type {
  QuestContext,
  QuestDef,
  QuestEvent,
  QuestSave,
  QuestStatus,
  QuestUnlock,
  QuestView,
} from "./types";

/**
 * The vocabulary, re-exported.
 *
 * Callers of the engine are callers of the quest system — the store, the panel, the tracker —
 * and making each of them import from two modules to say one thing is a tax with no benefit.
 */
export type {
  QuestContext,
  QuestDef,
  QuestEntry,
  QuestEvent,
  QuestEventName,
  QuestMode,
  QuestReward,
  QuestSave,
  QuestStatus,
  QuestTrack,
  QuestType,
  QuestUnlock,
  QuestView,
} from "./types";

/** How many daily quests a player gets. */
export const DAILY_COUNT = 3;

/** A save with nothing done in it. */
export function emptyQuestSave(day: string): QuestSave {
  return { entries: {}, day, dailyIds: [], seen: [] };
}

/**
 * A save read back from disk, made safe.
 *
 * Tolerant by construction: a missing field is a default, an entry for a quest that no longer
 * exists is dropped, and a status that is not one of the four is recomputed. A catalogue change
 * between builds must never be able to crash a save.
 */
export function repairQuestSave(input: unknown, day: string): QuestSave {
  const base = emptyQuestSave(day);
  if (!input || typeof input !== "object") return base;
  const raw = input as Partial<QuestSave>;
  const entries: QuestSave["entries"] = {};
  if (raw.entries && typeof raw.entries === "object") {
    for (const [id, entry] of Object.entries(raw.entries)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<QuestSave["entries"][string]>;
      const status: QuestStatus =
        e.status === "active" || e.status === "completed" || e.status === "claimed" || e.status === "locked"
          ? e.status
          : "active";
      entries[id] = {
        progress: Number.isFinite(e.progress) ? Math.max(0, Number(e.progress)) : 0,
        status,
        ...(typeof e.day === "string" ? { day: e.day } : {}),
      };
    }
  }
  return {
    entries,
    day: typeof raw.day === "string" ? raw.day : day,
    dailyIds: Array.isArray(raw.dailyIds) ? raw.dailyIds.filter((x): x is string => typeof x === "string") : [],
    seen: Array.isArray(raw.seen) ? raw.seen.filter((x): x is string => typeof x === "string") : [],
  };
}

/* -------------------------------------------------------------------------- unlocks */

/** Whether an unlock condition holds right now. */
export function unlockMet(unlock: QuestUnlock | null, ctx: QuestContext): boolean {
  if (!unlock) return true;
  switch (unlock.kind) {
    case "level":
      return ctx.level >= unlock.level;
    case "quest":
      return ctx.claimed.has(unlock.id);
    case "stage":
      return ctx.highestStage >= unlock.stage;
    case "all":
      return unlock.of.every((u) => unlockMet(u, ctx));
    default:
      return true;
  }
}

/**
 * Why a quest cannot be started, in the player's language.
 *
 * The requirement is named rather than merely enforced. "Mở ở cấp 5" is a goal; a locked card
 * with no reason is a bug the player cannot report and cannot plan around.
 */
export function lockedReason(unlock: QuestUnlock | null, ctx: QuestContext, byId: Map<string, QuestDef>): string {
  if (!unlock) return "";
  switch (unlock.kind) {
    case "level":
      return `Mở ở cấp ${unlock.level}`;
    case "quest": {
      const prev = byId.get(unlock.id);
      return prev ? `Cần hoàn thành: ${prev.title}` : "Cần hoàn thành nhiệm vụ trước";
    }
    case "stage":
      return `Cần vượt ải ${unlock.stage}`;
    case "all": {
      const first = unlock.of.find((u) => !unlockMet(u, ctx));
      return first ? lockedReason(first, ctx, byId) : "";
    }
    default:
      return "";
  }
}

/* -------------------------------------------------------------------------- the shelf */

/**
 * The day's daily quests, chosen deterministically from the pool.
 *
 * Seeded on the player and the day, so two players get different shelves and one player gets the
 * same shelf all day — which is what lets the panel be reopened without the quests changing
 * under it.
 */
export function rollDailyIds(catalog: readonly QuestDef[], ctx: QuestContext): string[] {
  const pool = catalog.filter((q) => q.type === "daily" && unlockMet(q.unlock, ctx));
  if (pool.length <= DAILY_COUNT) return pool.map((q) => q.id);
  // FNV-1a over the seed, then a partial Fisher-Yates. Deterministic, tiny, and no dependency.
  let h = 0x811c9dc5;
  for (const ch of `${ctx.playerId}:${ctx.day}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const pick = [...pool];
  for (let i = 0; i < DAILY_COUNT; i++) {
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
    const j = i + (h % (pick.length - i));
    [pick[i], pick[j]] = [pick[j], pick[i]];
  }
  return pick.slice(0, DAILY_COUNT).map((q) => q.id);
}

/**
 * Bring the save up to date with the catalogue and the player's progress.
 *
 * Called before anything reads or advances a quest. Three jobs:
 *
 *   1. Roll a new daily shelf when the day has turned, and clear the entries that fell off it.
 *   2. Give every eligible quest an entry, so a quest added in a new build simply appears.
 *   3. Move quests between `locked` and `active` as their conditions come true or stop being
 *      true — a claimed main quest opens the next one without anything else having to know.
 *
 * Progress is never reset here. A quest that goes back to `locked` (which only happens if a
 * condition genuinely stopped holding) keeps its progress, so re-earning the condition does not
 * mean redoing the work.
 */
export function syncQuests(save: QuestSave, ctx: QuestContext, catalog: readonly QuestDef[]): QuestSave {
  const byId = new Map(catalog.map((q) => [q.id, q]));
  const next: QuestSave = {
    entries: { ...save.entries },
    day: save.day,
    dailyIds: [...save.dailyIds],
    seen: [...save.seen],
  };

  // 1. A new day: re-roll the daily shelf and forget the ones that dropped off it.
  if (next.day !== ctx.day) {
    next.day = ctx.day;
    next.dailyIds = rollDailyIds(catalog, ctx);
    for (const id of Object.keys(next.entries)) {
      if (byId.get(id)?.type === "daily") delete next.entries[id];
    }
  } else if (next.dailyIds.length === 0) {
    next.dailyIds = rollDailyIds(catalog, ctx);
  }

  // 2 + 3. Every quest that should exist, at the right status.
  for (const def of catalog) {
    const isDaily = def.type === "daily";
    if (isDaily && !next.dailyIds.includes(def.id)) continue;

    const existing = next.entries[def.id];
    const met = unlockMet(def.unlock, ctx);
    if (!existing) {
      /*
       * Seed on creation too, not only on re-sync.
       *
       * A quest that *becomes* active the moment it is first seen — the level-5 achievement for
       * a player who is already level 9 — must read its measure immediately, or it would sit at
       * 0 until an event happened to re-measure what the save already knows.
       */
      let progress = 0;
      if (met && def.current) progress = Math.max(0, Math.min(def.target, def.current(ctx)));
      const status: QuestStatus = !met ? "locked" : progress >= def.target ? "completed" : "active";
      next.entries[def.id] = { progress, status, ...(isDaily ? { day: ctx.day } : {}) };
      continue;
    }
    // A finished quest stays finished. A locked/active quest follows its condition.
    if (existing.status === "completed" || existing.status === "claimed") continue;
    const status: QuestStatus = met ? "active" : "locked";

    /*
     * Seed a measurable quest from the state it measures.
     *
     * This is what makes "đạt cấp 5" work for a player who was already level 5 when the quest
     * opened, and it repairs a save that lost an event: the number is read from the save rather
     * than remembered from a stream that may not have been running.
     */
    let progress = existing.progress;
    if (status === "active" && def.current) {
      progress = Math.max(progress, Math.min(def.target, def.current(ctx)));
    }
    const done = progress >= def.target;
    const nextStatus: QuestStatus = status === "active" && done ? "completed" : status;
    if (progress !== existing.progress || nextStatus !== existing.status) {
      next.entries[def.id] = { ...existing, progress, status: nextStatus };
    }
  }

  return next;
}

/* ------------------------------------------------------------------------- advancing */

export interface AdvanceResult {
  save: QuestSave;
  /** Quests whose progress moved, for the progress animation and the toast. */
  changed: { id: string; progress: number; target: number }[];
  /** Quests that finished on this event, for the completion animation and sound. */
  completed: string[];
}

/** Whether an event matches a quest's filter. */
function matches(def: QuestDef, ev: QuestEvent): boolean {
  const m = def.track.match;
  if (!m) return true;
  if (m.boss !== undefined && Boolean(ev.boss) !== m.boss) return false;
  if (m.replay !== undefined && Boolean(ev.replay) !== m.replay) return false;
  if (m.stage !== undefined && ev.stage !== m.stage) return false;
  return true;
}

/**
 * Move every quest that listens to this event.
 *
 * The only place progress changes. Returns a new save rather than mutating, so a caller can
 * decide not to keep it — which is what lets a failed write leave the quest state where it was.
 */
export function advance(save: QuestSave, ctx: QuestContext, catalog: readonly QuestDef[], ev: QuestEvent): AdvanceResult {
  const synced = syncQuests(save, ctx, catalog);
  const entries = { ...synced.entries };
  const changed: AdvanceResult["changed"] = [];
  const completed: string[] = [];

  for (const def of catalog) {
    const entry = entries[def.id];
    if (!entry || entry.status !== "active") continue;
    if (def.track.event !== ev.name) continue;
    if (!matches(def, ev)) continue;

    const before = entry.progress;
    let progress: number;
    if (def.track.mode === "high") {
      // A measuring quest records the best value seen. Without this, "reach a combo of 10"
      // would need ten separate runs of ten and would never finish.
      progress = Math.max(before, ev.value ?? ev.amount ?? 1);
    } else {
      progress = before + (ev.amount ?? 1);
    }
    progress = Math.min(def.target, progress);
    if (progress === before) continue;

    const done = progress >= def.target;
    entries[def.id] = { ...entry, progress, status: done ? "completed" : "active" };
    changed.push({ id: def.id, progress, target: def.target });
    if (done) completed.push(def.id);
  }

  return { save: { ...synced, entries }, changed, completed };
}

/* -------------------------------------------------------------------------- claiming */

export interface ClaimResult {
  ok: boolean;
  reason?: string;
  save: QuestSave;
  /** The quest claimed, so the caller can pay it through the real reward paths. */
  def?: QuestDef;
}

/**
 * Take a finished quest's reward.
 *
 * Refuses anything that is not `completed`, which is what makes double-claiming impossible: the
 * status is the guard, and it is the same status the UI reads. A repeatable quest goes back to
 * `active` with no progress so it can be earned again the next day.
 */
export function claim(save: QuestSave, ctx: QuestContext, catalog: readonly QuestDef[], id: string): ClaimResult {
  const synced = syncQuests(save, ctx, catalog);
  const def = catalog.find((q) => q.id === id);
  const entry = synced.entries[id];
  if (!def || !entry) return { ok: false, reason: "Không tìm thấy nhiệm vụ", save: synced };
  if (entry.status === "claimed") return { ok: false, reason: "Đã nhận thưởng rồi", save: synced };
  if (entry.status !== "completed") return { ok: false, reason: "Chưa hoàn thành nhiệm vụ", save: synced };

  const entries = { ...synced.entries };
  entries[id] = def.repeatable
    ? { progress: 0, status: "active", ...(def.type === "daily" ? { day: ctx.day } : {}) }
    : { progress: entry.progress, status: "claimed" };
  return { ok: true, def, save: { ...synced, entries } };
}

/* ----------------------------------------------------------------------------- views */

/** Everything the UI needs about every quest, resolved and ordered. */
export function questViews(save: QuestSave, ctx: QuestContext, catalog: readonly QuestDef[]): QuestView[] {
  const byId = new Map(catalog.map((q) => [q.id, q]));
  const synced = syncQuests(save, ctx, catalog);
  const out: QuestView[] = [];
  for (const def of catalog) {
    const entry = synced.entries[def.id];
    if (!entry) continue;
    const progress = Math.min(entry.progress, def.target);
    out.push({
      def,
      progress,
      target: def.target,
      status: entry.status,
      lockedReason: entry.status === "locked" ? lockedReason(def.unlock, ctx, byId) : "",
      fraction: def.target <= 0 ? 1 : Math.min(1, progress / def.target),
    });
  }
  return out;
}

/** The quests with a reward waiting, which is what the badge counts. */
export function claimable(views: QuestView[]): QuestView[] {
  return views.filter((v) => v.status === "completed");
}

/**
 * The one main quest the player is on, and the tracked side/daily quests under it.
 *
 * The tracker shows a single main quest on purpose: the whole point of a main line is that there
 * is one next thing. Side and daily quests are shown because they are choices, and choices are
 * only useful when they are visible.
 */
export function tracked(views: QuestView[], sideLimit = 2): { main: QuestView | null; extras: QuestView[] } {
  const byPriority = (a: QuestView, b: QuestView) => a.def.priority - b.def.priority;
  const done = views.filter((v) => v.status === "completed").sort(byPriority);
  const active = views.filter((v) => v.status === "active");
  /*
   * A finished-but-unclaimed main quest outranks the next active one: the chain only moves on
   * a claim, so the next *thing to do* is collecting the reward, not starting the next grind.
   * An empty tracker exactly when a payout is waiting was the failure this ordering fixes.
   */
  const main = done.filter((v) => v.def.type === "main")[0] ?? active.filter((v) => v.def.type === "main").sort(byPriority)[0] ?? null;
  const extras = [
    ...done.filter((v) => v.def.type !== "main"),
    ...active
      .filter((v) => v.def.type === "side" || v.def.type === "daily")
      .sort((a, b) => b.fraction - a.fraction || a.def.priority - b.def.priority),
  ].slice(0, sideLimit);
  return { main, extras };
}
