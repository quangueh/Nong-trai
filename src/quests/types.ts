/**
 * The quest system's vocabulary.
 *
 * ## Why this replaces two systems rather than joining them
 *
 * The game had a "starter roadmap" (five hard-coded steps in the garden), a "discovery book"
 * (twenty-four collection milestones with its own claim method), a daily-goal pool on the
 * garden's weather card, and a first-run coach strip. Four answers to "what should I do now",
 * none of which knew about the others: the roadmap did not know a stage had been cleared, the
 * discovery book did not know what level the player was, and the daily goals reset on a clock
 * that had nothing to do with either.
 *
 * This is one system with four *kinds* of quest, sharing one state, one event stream, one claim
 * path and one set of rewards. A quest is a definition plus an entry; everything else is derived.
 *
 * ## The three things that make it a system rather than a list
 *
 * **One event stream.** Gameplay never touches a quest directly. The store emits named events at
 * the places things actually happen — a stage was cleared, a level was crossed, a combo ran — and
 * `advance` matches them against the catalogue. Adding a quest is adding a definition, not
 * editing six screens.
 *
 * **Two progress modes.** A quest that counts ("win 3 battles") increments; a quest that measures
 * ("reach a combo of 10") records the high-water mark. Without the distinction, "reach combo 10"
 * would need ten separate ten-combos and would never complete.
 *
 * **Unlocks are conditions, not flags.** A quest is locked, active or finished because of what
 * the player has actually done — level, stages cleared, another quest's completion — recomputed
 * from state. There is no "unlocked" field to fall out of sync with the progress it describes.
 */

/** Which shelf a quest lives on. */
export type QuestType = "main" | "side" | "daily" | "achievement";

/**
 * Where a quest is in its life.
 *
 * `completed` and `claimed` are deliberately separate: finishing the work and taking the reward
 * are two moments, and collapsing them would take away the second one — which is the one with
 * the sound and the flying numbers.
 */
export type QuestStatus = "locked" | "active" | "completed" | "claimed";

/** What a quest pays. Experience is plant experience; the account curve is `breederXp`. */
export interface QuestReward {
  /** Plant experience, paid through the real levelling path so a level-up can fire. */
  exp?: number;
  /** Breeder experience, the account curve. */
  breederXp?: number;
  coins?: number;
  items?: number;
  geneCrystal?: number;
  /**
   * Human-readable names of what finishing this opens.
   *
   * Descriptive, not a flag: the things it names (a stage, a shop shelf, the daily shelf) are
   * gated by the state they are already gated by, and a second stored "unlocked" boolean would
   * be a second answer to the same question. The panel shows these so the reward is legible
   * before it is earned.
   */
  unlocks?: string[];
}

/**
 * What has to be true before a quest can be worked on.
 *
 * Composable rather than a flat set of fields, because the real gates combine: "level 5 *and*
 * the previous main quest finished" is one condition, not two special cases.
 */
export type QuestUnlock =
  | { kind: "level"; level: number }
  | { kind: "quest"; id: string }
  | { kind: "stage"; stage: number }
  | { kind: "all"; of: QuestUnlock[] };

/** The gameplay events a quest can listen to. */
export type QuestEventName =
  | "plant"
  | "care"
  | "breed"
  | "stage_completed"
  | "stage_failed"
  | "enemy_defeated"
  | "exp_gained"
  | "level_up"
  | "item_collected"
  | "combo_reached"
  | "reward_claimed"
  | "skill_unlocked";

/** One event, as the store emits it. */
export interface QuestEvent {
  name: QuestEventName;
  /** How much to add, for a counting quest. Defaults to 1. */
  amount?: number;
  /** The value to beat, for a measuring quest (a combo length, a level). */
  value?: number;
  /** Context a quest's filter can match on. */
  stage?: number;
  /** Whether the stage was a boss stage. */
  boss?: boolean;
  /** Whether the stage had already been cleared before this fight. */
  replay?: boolean;
  /**
   * The species bloodlines on the plant the event is about.
   *
   * A plant carries every species in its lineage, not one, so a bred descendant of a
   * species still counts for "win with this species" quests — the match checks membership,
   * not equality.
   */
  species?: string[];
}

/**
 * How a quest's progress moves.
 *
 * `count` adds each event; `high` keeps the largest value seen. See the note at the top — this
 * is the difference between "do this ten times" and "get this far once".
 */
export type QuestMode = "count" | "high";

/** What a quest listens for, and optionally which of those events count. */
export interface QuestTrack {
  event: QuestEventName;
  mode: QuestMode;
  /** Only events matching every key here advance the quest. */
  match?: { boss?: boolean; replay?: boolean; stage?: number; species?: string };
}

export interface QuestDef {
  id: string;
  type: QuestType;
  title: string;
  /** One line, in the player's words, saying why they would want to do this. */
  description: string;
  /** The imperative: "Hoàn thành ải 1". Shown on the card and in the tracker. */
  objective: string;
  target: number;
  icon: string;
  /** Lower sorts first. The main chain uses tens; side and daily use hundreds. */
  priority: number;
  rewards: QuestReward;
  /** `null` means available from the first moment. */
  unlock: QuestUnlock | null;
  /** Quests to open when this one is claimed. The main chain runs on these. */
  next?: string[];
  track: QuestTrack;
  /** Daily quests come back; everything else is finished once. */
  repeatable?: boolean;
  /**
   * The value of this quest's measure, read from the save right now.
   *
   * Needed because a quest can *become active* after its condition is already true: a player who
   * reaches level 5 before the level-5 quest opens would otherwise have to level up again for it
   * to move. Reading the current value on every sync also makes progress self-healing — a save
   * that lost an event gets caught up the next time anything syncs.
   *
   * Omitted for quests that only mean anything as a stream of events (a combo that has to be run
   * now, a stage that has to be cleared while the quest is open).
   */
  current?: (ctx: QuestContext) => number;
}

/** The stored half of a quest. Everything else is derived from state and the definition. */
export interface QuestEntry {
  progress: number;
  status: QuestStatus;
  /** Which day a daily quest belongs to, so a stale entry can be recognised and re-rolled. */
  day?: string;
}

/**
 * The whole quest save.
 *
 * A record rather than an array, so a catalogue change — a quest renamed, a quest deleted —
 * cannot corrupt the save. An entry with no definition is ignored; a definition with no entry is
 * created. Neither is an error, and neither needs a migration.
 */
export interface QuestSave {
  entries: Record<string, QuestEntry>;
  /** The day the daily shelf was last rolled. */
  day: string;
  /** The daily quest ids rolled for `day`. */
  dailyIds: string[];
  /** Quests whose "new" animation has already been shown, so it plays once. */
  seen: string[];
}

/** Everything a quest's unlock conditions are judged against, read from the save. */
export interface QuestContext {
  level: number;
  /** Highest stage cleared. */
  highestStage: number;
  /** Stages cleared in total, including replays. */
  stagesCleared: number;
  /** Distinct species the player holds seeds for. */
  speciesCount: number;
  /** Battles won, across every mode. */
  wins: number;
  /** Total account experience ever earned, for the score achievements. */
  score: number;
  /** Quests already claimed, for `{ kind: "quest" }` conditions. */
  claimed: Set<string>;
  /** The day, so daily quests can be rolled and re-rolled. */
  day: string;
  /** Seeds the daily rotation, so two players do not get the same three quests. */
  playerId: string;
  /**
   * Seed counts by species — what the "own a seed of X" quests measure.
   *
   * Read live rather than remembered, the same reason `current` exists at all: the
   * generated chain asks about a species the player may already hold, and the answer
   * has to be right the moment the quest appears, not after the next purchase.
   */
  seeds: Partial<Record<string, number>>;
  /** Species ever discovered — the dex. A species a player already tamed is no quest. */
  discovered: Set<string>;
}

/** A quest, resolved against the save, ready for the UI. */
export interface QuestView {
  def: QuestDef;
  progress: number;
  target: number;
  status: QuestStatus;
  /** Why it is locked, in the player's language, or "" when it is not. */
  lockedReason: string;
  /** 0..1, for the bar. */
  fraction: number;
}
