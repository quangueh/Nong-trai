/**
 * Central game store. Owns player state, the nursery, inventory and the economy
 * ledger. All mutations go through here so saves stay consistent and coin can
 * never be double-spent (docs/16 §24-§25: idempotent, immutable ledger).
 */

import { Rng, clamp, round2, seedToken } from "./rng";
import type { Plant } from "./types";
import { createSeedPlant, breedPlants, genomeSignature, validateGenome, estimatePower, type BreedingContext, type BreedingResult } from "../genetics/genomeGenerator";
import { applyCatalyst, getProtocol, protocolDiversity, protocolUnlocked, type ProtocolId } from "../genetics/protocols";
import { plantName, nameKey } from "../genetics/names";
import { emptyStreakFields } from "./streak";
import {
  CURRENCY_IDS,
  NECTAR_PER_CARE,
  POLLEN_PER_BREED,
  currencyInfo,
  shortOf,
  type CurrencyId,
} from "./currency";
import { EMBER_DAILY_CAP, rollDrops, type DropRoll } from "./drops";
import {
  describeStage,
  monsterFor,
  stageExtraDrop,
  stageIsOpen,
  stageReward,
  type MonsterSpec,
  type StageBrief,
  type StageReward,
} from "../pve";

import { getActiveAccountId, saveSlotKey } from "./saveSlot";
import { computeEcr } from "../genetics/ecrCalculator";
import { applyCare, gainXp, xpRequired } from "../growth/care";
import type { CareActionId } from "../config/careActions";
import { tickGrowth } from "../growth/stages";
import { addSkillXp } from "../genetics/skillGenerator";
import { canSell, tryAwaken } from "../growth/stages";
import { sellPrice } from "../economy/shop";
import { emptyPity, type PityCounters, type Rarity } from "../config/rarity";
import { TIER_META, type CombatTier } from "../config/balance";
import type { SpeciesId } from "../config/species";
import { SPECIES, SPECIES_BY_ID } from "../config/species";
import { PLOT_DEFS, checkUnlock, contextFrom, type UnlockContext } from "../config/unlocks";
import { DAILY_GOAL_COUNT, GOAL_COOLDOWN_DAYS, GOAL_POOL, MILESTONES, WEATHER_INFO, streakMultiplier, type MilestoneMetric } from "../config/quests";
import { finalRarityWeights } from "../config/rarity";
import { simulateBattle, type BattleConfig, type BattleResult } from "../battle/engine";

/**
 * The breeder level cap.
 *
 * Named rather than left as the literal 60 that appeared in four places: the
 * level-up loop, the notice that fires on a level, and the badge that shows the
 * player where they stand all have to agree on where the ladder ends.
 */
export const BREEDER_LEVEL_CAP = 60;

/** Levels 1-3 all cost this much. See `xpForLevel`. */
const FLAT_LEVELS = 3;
const FLAT_XP = 12;

/**
 * XP needed to go from `level` to `level + 1`.
 *
 * Exported because the top-bar badge shows the same number the level-up loop
 * consumes. One definition, so the badge cannot drift from the game.
 *
 * The shape is the point, not the constants:
 *
 * **A flat start.** The first three levels cost the same twelve experience, so a new
 * breeder reaches level 2 after a fight or two rather than after twenty. The old curve
 * opened at 120 XP when a win was worth 6, which put the first level-up at the far end of
 * a session - long enough that a new player concluded the badge in the corner was
 * decoration. A progression you cannot see in your first five minutes is not progression.
 *
 * **Growth after that.** Each level costs about half again what the last one did, so the
 * pace slows the way it should and every level after the third means something. Nothing
 * about levelling is a reward if it arrives at a constant rate.
 *
 *   level 1-3   12
 *   level 4     33
 *   level 10   233
 *   level 20   847
 *   level 40  2412
 */
export function xpForLevel(level: number): number {
  if (level <= FLAT_LEVELS) return FLAT_XP;
  return Math.round(FLAT_XP * Math.pow(level - FLAT_LEVELS + 1, 1.45));
}

/**
 * Breeder experience for a plant reaching a level.
 *
 * The other half of the answer to "levelling is too slow". A win was worth six breeder
 * experience and nothing else gave any, so the badge only moved when the player went and
 * fought - which made tending, breeding and growing a plant feel like they led nowhere.
 *
 * A plant levelling up now pays into the breeder, and more the older the plant is, so
 * the two progressions pull each other along instead of running in parallel. Four at the
 * first level is enough that three plant levels carry a new breeder through their first
 * level-up, which is the pace that reads as "it responded to what I just did".
 *
 * Capped so a single plant at level 100 is worth a lot but not a whole tier: this is a
 * bonus for tending, not a second win condition.
 */
export function breederXpForPlantLevel(newLevel: number): number {
  return Math.min(40, Math.max(4, Math.round(2 * newLevel)));
}

export interface LedgerEntry {
  at: number;
  delta: number;
  reason: string;
}

export type GardenWeather = "mist" | "sun" | "storm" | "moon";
/**
 * The kinds a daily goal can be about.
 *
 * Eight rather than four, and that is the point: goals are drawn at most one per
 * kind per day, so the number of kinds is a hard ceiling on how alike a day can
 * look. With four kinds and three goals the guarantee held only because there
 * were enough templates to hide behind; widening the pool without widening the
 * kinds would still let two rows read the same.
 *
 * `battle` and `win` are separate on purpose — "đấu hai trận" and "thắng hai
 * trận" are genuinely different asks and a player who loses twice should see one
 * of them move and not the other.
 */
export type DailyGoalKind = "plant" | "care" | "battle" | "win" | "breed" | "sell" | "awaken" | "openPlot" | "unlock";

/**
 * Something the player should be told about, right now.
 *
 * Separate from the render-subscription because a notice has to outlive the
 * re-render it causes — a banner rebuilt from scratch mid-animation reads as a
 * flicker, which is exactly the problem it was meant to solve.
 */
export interface Notice {
  id: number;
  kind: "level" | "unlock" | "goal" | "plot" | "milestone";
  title: string;
  body?: string;
  /**
   * Present on a level notice, and the reason this interface has it.
   *
   * The level-up celebration used to reconstruct the event by reading the title and body
   * with regular expressions — matching `cấp (\d+)` and `+(\d+) cấp` out of Vietnamese prose.
   * That is a wire format made of grammar: reword the sentence and the celebration silently
   * stops firing, or fires with a level of zero. Nothing would fail in a test, because the
   * test would be written against the same prose.
   *
   * So the store, which is the only thing that knows what happened, now says it. Optional,
   * because the other four notice kinds have no level in them.
   */
  levelUp?: {
    /** Which progression this was: the account's breeder, or one named plant. */
    subject: "breeder" | "plant";
    subjectId?: string;
    subjectName: string;
    /** The level reached. */
    level: number;
    /** How many levels were crossed. Greater than one on a big stage clear. */
    levelsGained: number;
    /** XP this grant was worth. */
    expGained: number;
    /** XP banked after the grant, and what the next level costs. */
    xpAfter: number;
    needAfter: number;
    /** True when the requirement curve was walked to its end. */
    capped: boolean;
    /** Every breeder level crossed, in order, so unlocks can be derived from real data. */
    crossed: number[];
  };
  /**
   * Species revealed by this notice.
   *
   * Present so the UI can show the plant itself rather than only a count. A
   * player told "12 loài mới" has learned nothing; shown three plants, they
   * learn what to go and look at.
   */
  species?: SpeciesId[];
  /** How many more there were than are listed. */
  moreCount?: number;
}

export interface DailyGoal {
  id: string;
  kind: DailyGoalKind;
  label: string;
  target: number;
  progress: number;
  reward: { leafCoin?: number; geneCrystal?: number; items?: number };
  claimed: boolean;
  /** What to actually do, shown on tap. A goal that names a verb is still a puzzle. */
  hint: string;
  /**
   * Whether the "done" banner has already played.
   *
   * `claimed` cannot carry this: a goal stays unclaimed while complete, and
   * without a separate flag the announcement would repeat every time the same
   * kind ticked again.
   */
  announced: boolean;
}

export interface GardenDayState {
  dayKey: string;
  weather: GardenWeather;
  streak: number;
  focus: number;
  goals: DailyGoal[];
  /**
   * Template ids drawn in the last few days.
   *
   * Carried forward so the next day can bar them. Kept on the day state rather
   * than recomputed from history because there is no separate day log to read.
   */
  recentGoals: string[];
}

export interface DiscoveryState {
  species: string[];
  elements: string[];
  traits: string[];
  careActions: string[];
  battles: number;
  breeds: number;
  claimed: string[];
}

export interface DiscoveryMilestone {
  id: string;
  label: string;
  hint: string;
  progress: number;
  target: number;
  reward: { leafCoin?: number; geneCrystal?: number; items?: number };
  claimed: boolean;
}

export interface PlayerState {
  playerId: string;
  name: string;
  breederLevel: number;
  breederXp: number;
  leafCoin: number;
  /**
   * The other three currencies.
   *
   * Flat fields rather than a bag, for the same reason `pity` and `gardenDay` are flat:
   * a save written before a currency existed simply lacks the field, and repairing it in
   * `loadOrCreate` is a one-line spread. A nested record would make every read a
   * `?.` and every write a merge.
   */
  /** From tending. Pays the tier-2 shelf. */
  nectar: number;
  /** From breeding, plus an uncommon battle drop. Pays tier 3. */
  pollen: number;
  /** From a rare battle drop only, and daily-capped. Pays tier 4 and nothing else. */
  ember: number;
  /** The day `emberToday` was counted on, so the cap resets by date and not by session. */
  emberDay: string;
  /** Ember already earned today. Compared against the cap before a drop fires. */
  emberToday: number;
  geneCrystal: number;
  items: number;
  plants: Plant[];
  seeds: Partial<Record<SpeciesId, number>>;
  inventoryCap: number;
  nurseryCap: number;
  pity: PityCounters;
  ledger: LedgerEntry[];
  createdAt: number;
  lastSeen: number;
  seenGenes: string[];
  gardenDay: GardenDayState;
  discovery: DiscoveryState;
  /**
   * The PvE ladder: how far this player has climbed.
   *
   * Nested because it is one coherent thing with several parts that always travel together -
   * the record, the day the record was set on, and the run of attempts on the stage that
   * stopped them. Flat fields would make `ascent.stage = n` able to leave `ascentDay` pointing
   * at a different day, and the daily escalation would then apply to the wrong stage.
   */
  ascent: AscentState;
}

/** Everything the ladder needs to remember about a player. */
export interface AscentState {
  /** Highest stage cleared. 0 means none, so `stage 1` is the first thing anyone sees. */
  highest: number;
  /** Attempts at `highest + 1`, for the diminishing consolation reward. */
  attempts: number;
  /** Clears, for the ledger line on the screen. */
  cleared: number;
  /** Day the record was set, so a new day resets the attempt counter. */
  day: string;
  /** Best monster power beaten, which is the player's own record to see. */
  bestPower: number;
}

/** A fresh ladder. Also what `loadOrCreate` repairs an older save to. */
export function emptyAscent(day: string): AscentState {
  return { highest: 0, attempts: 0, cleared: 0, day, bestPower: 0 };
}

/* Every read and write of the save goes through `saveSlotKey` from ./saveSlot, because
   the key depends on who is signed in. There is deliberately no bare key constant here to
   reach for: one is what made every account share one garden. */
const SEED_PACK_PRICE = 0.05;

/**
 * How many times breeding re-rolls to escape a genome already in the garden.
 *
 * A collision is rare — 400 straight breeds produced 400 distinct genomes — so
 * this is a backstop, not the normal path. It exists because "rare" is not
 * "never", and the player promise is that no two plants are the same.
 */
const UNIQUE_BREED_ATTEMPTS = 8;

/**
 * How far to walk the name salt before giving up on a free name.
 *
 * Bounded so a pathological save cannot turn breeding into a hang. The name
 * space is ~10^5 per genome, so reaching this limit would need hundreds of
 * plants sharing one genome — which the signature check above already excludes.
 */
const NAME_SALT_LIMIT = 64;

export class GameStore {
  state: PlayerState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = loadOrCreate();
    const raw = localStorage.getItem(saveSlotKey(getActiveAccountId()));
    if (raw) {
      try {
        const at = (JSON.parse(raw) as { savedAt?: number }).savedAt;
        if (typeof at === "number") this.savedAt = at;
      } catch {
        // A save that will not parse is rebuilt by loadOrCreate; the timestamp is
        // simply unknown, which loses nothing but conflict resolution.
      }
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private noticeListeners = new Set<(n: Notice) => void>();
  private noticeSeq = 0;

  /** Listen for things worth telling the player about. Returns an unsubscribe. */
  onNotice(fn: (n: Notice) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  private pushNotice(n: Omit<Notice, "id">): void {
    this.noticeSeq++;
    const notice: Notice = { ...n, id: this.noticeSeq };
    // Copied first: a handler that unsubscribes during dispatch would otherwise
    // mutate the set being iterated.
    for (const fn of [...this.noticeListeners]) {
      try {
        fn(notice);
      } catch {
        // A broken banner must not take down the action that caused it.
      }
    }
  }

  /**
   * Every species whose gate is currently satisfied.
   *
   * Recomputed rather than tracked, so a save from an older version is judged by
   * today's rules instead of by whatever it thought it had unlocked.
   */
  private unlockedSpeciesIds(): Set<SpeciesId> {
    const ctx = this.unlockContext();
    const out = new Set<SpeciesId>();
    for (const sp of SPECIES) if (checkUnlock(ctx, sp.unlock).met) out.add(sp.id);
    return out;
  }

  /**
   * When this save was last written, in epoch milliseconds.
   *
   * A field on the store rather than on `PlayerState`, so it is not part of the state
   * that gets compared, exported to the cloud, or reasoned about by any screen. It is
   * stamped into the localStorage slot as a sibling key by `save()` and `importState()`,
   * because `reload()` has always read it from `JSON.parse(raw).savedAt`.
   *
   * Zero means "no timestamp known", which every comparison treats as older than
   * anything. That is the safe direction for an unknown: the cloud copy wins, rather than
   * a device quietly deciding its own guess is the newer truth.
   */
  savedAt = 0;

  save() {
    this.savedAt = Date.now();
    try {
      /*
       * `savedAt` is written *alongside* the state, not inside it.
       *
       * The class field is documented above as deliberately carried on the state so the
       * localStorage shape never changes — but `reload()` reads it back with
       * `JSON.parse(raw).savedAt`, and `save()` was writing only `this.state`. The two
       * disagreed, so every slot written by `save()` came back with no timestamp and
       * `reload()` left `savedAt` at 0.
       *
       * Which quietly disabled two conflict guards at once. `push()` fell back to
       * `Date.now()` for its timestamp, and `pull(false)` compared the cloud against 0,
       * so the "this device is newer" branch could never fire and a second device would
       * overwrite a newer local save with a stale cloud copy on every sync.
       *
       * The envelope matches what `reload()` already expected, so both agree now. A save
       * written by an older build has no envelope and still loads — `reload()` treats a
       * missing timestamp as 0, which is the safe direction: it makes this device look
       * older, so the cloud wins rather than the other way round.
       */
      localStorage.setItem(saveSlotKey(getActiveAccountId()), JSON.stringify({ ...this.state, savedAt: this.savedAt }));
    } catch {
      // ignore quota / privacy mode
    }
  }

  /**
   * Re-read the save for whichever slot is now active.
   *
   * Called when the signed-in account changes. Without it, signing in would switch the
   * key that gets written while leaving the previous account's garden in memory to be
   * saved straight over the new account's slot - the same bug one step later, and the
   * worse version, because it destroys data instead of showing the wrong data.
   *
   * Emits afterwards so open screens redraw against the garden that is actually loaded.
   */
  reload(): void {
    this.state = loadOrCreate();
    this.savedAt = 0;
    const raw = localStorage.getItem(saveSlotKey(getActiveAccountId()));
    if (raw) {
      try {
        const at = (JSON.parse(raw) as { savedAt?: number }).savedAt;
        if (typeof at === "number") this.savedAt = at;
      } catch {
        // Unparseable: loadOrCreate already rebuilt a fresh garden from it.
      }
    }
    this.emit();
  }

  /** The whole save, for the cloud copy. */
  exportState(): unknown {
    return this.state;
  }

  /**
   * Replace the save with one from the cloud.
   *
   * Loaded through `loadOrCreate`'s repair path rather than assigned blindly, so a
   * save written by an older build — or one that lost a field to a partial write —
   * comes back with its pity counters, garden day and discovery lists repaired
   * rather than crashing the first screen that touches them.
   *
   * ## Why this writes to disk, and why that used to destroy saves
   *
   * This only held the pulled save in memory. It was not written to the account's slot,
   * and that was fatal, because the slot was *already occupied*.
   *
   * Signing in calls `setActiveAccountId`, which makes the store reload; a slot nobody
   * has written yet reloads as a brand-new garden, and `loadOrCreate` **persists** that
   * default. So the sequence on a second device was:
   *
   *   1. sign in          → slot now holds a fresh empty garden
   *   2. pull the cloud   → that garden is replaced in memory only
   *   3. close the tab    → nothing was on disk
   *   4. come back later  → the store reads the slot from step 1: an empty garden
   *   5. play for a minute → the empty garden is pushed up, over the real one
   *
   * A returning player's account was destroyed by them opening the game again. Nothing
   * errored; the sync strip said "Đã nạp vườn từ tài khoản." while the disk still held
   * the opposite of what the player was looking at.
   *
   * So the pulled state is written here, immediately, with the server's own timestamp.
   *
   * ## Why the timestamp is the server's and not `Date.now()`
   *
   * The local clock is almost always *ahead* of the server's — the two are different
   * machines. Stamping a pulled save with `Date.now()` makes this device believe it is
   * newer than the cloud, and every later `pull()` then takes the
   * `remote.savedAt < localAt` branch and reports a conflict instead of updating. A
   * second device would be permanently, silently out of sync. `savedAt` is what the
   * server stamped on this exact data, so it is the only value that keeps the comparison
   * honest.
   *
   * Defaults to `Date.now()` only for a caller with no timestamp to offer, which is the
   * repair-on-import case rather than the sync case.
   */
  importState(next: unknown, savedAt?: number): void {
    if (!next || typeof next !== "object") return;
    const repaired = loadOrCreate(JSON.stringify(next));
    this.state = repaired;
    const at = typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : Date.now();
    this.savedAt = at;

    /*
     * Persist before announcing. `emit()` is last so any subscriber that reads the store
     * — a screen repainting, the top bar — sees the state that is also now on disk. The
     * reverse order would let a subscriber act on a save that a crash one line later
     * would throw away.
     */
    try {
      localStorage.setItem(saveSlotKey(getActiveAccountId()), JSON.stringify({ ...repaired, savedAt: at }));
    } catch {
      /*
       * Storage refused. The state is still live in memory and still goes up on the next
       * push, so the player keeps playing and keeps their cloud save; only the offline
       * copy of *this particular* device is missing. Reporting nothing is the right call
       * here — `sync.ts` owns player-facing storage failures, and a second, differently
       * worded complaint about the same failure is noise.
       */
    }

    this.emit();
  }

  private commit(reason: string) {
    this.refreshGardenDay();
    this.state.lastSeen = Date.now();
    this.save();
    void reason;
    this.emit();
  }

  // --- economy ---------------------------------------------------------

  private credit(delta: number, reason: string) {
    this.state.leafCoin += delta;
    this.state.ledger.push({ at: Date.now(), delta, reason });
    if (this.state.ledger.length > 200) this.state.ledger.splice(0, this.state.ledger.length - 200);
  }

  private debit(delta: number, reason: string): boolean {
    if (this.state.leafCoin < delta) return false;
    this.state.leafCoin -= delta;
    this.state.ledger.push({ at: Date.now(), delta: -delta, reason });
    return true;
  }

  // --- seeding ---------------------------------------------------------

  /**
   * Open a locked garden plot.
   *
   * `nurseryCap` doubles as "how many plots are open", which is why it is raised
   * here rather than tracked separately — one number, one meaning, and it cannot
   * disagree with the plot grid.
   */
  buyPlot(index: number): { ok: boolean; reason?: string } {
    const def = PLOT_DEFS.find((p) => p.index === index);
    if (!def) return { ok: false, reason: "Ô không tồn tại" };
    if (def.index <= this.state.nurseryCap) return { ok: false, reason: "Ô này đã mở" };

    const ctx = this.unlockContext();
    const gate = checkUnlock(ctx, def.unlock);
    if (!gate.met) return { ok: false, reason: `Chưa mở khóa: ${gate.summary}` };
    if (!this.debit(def.cost, `Mở ô vườn ${def.index}`)) {
      return { ok: false, reason: `Không đủ ${def.cost.toLocaleString("vi-VN")} xu` };
    }
    this.state.nurseryCap = def.index;
    this.advanceGoal("openPlot", 1);
    this.commit("buyPlot");
    return { ok: true };
  }

  /**
   * Everything the unlock rules are measured against, read live off the save.
   *
   * Built on demand rather than cached: a cached context would go stale the
   * moment a plant was added or a level was spent, and a gate that disagrees with
   * the game is worse than no gate.
   */
  unlockContext(): UnlockContext {
    return contextFrom(this.state.plants, this.state.breederLevel, this.state.seeds, this.state.leafCoin);
  }

    /**
   * Credit a currency.
   *
   * Goes through here rather than being assigned at a call site so that every gain lands
   * in the ledger. With one currency that was already true; with four it is the only
   * thing that makes "where did this pollen come from" answerable after the fact, which
   * is the first question a player asks when a currency will not move.
   */
  creditCurrency(id: CurrencyId, delta: number, reason: string) {
    this.state[id] += delta;
    this.state.ledger.push({ at: Date.now(), delta, reason });
    if (this.state.ledger.length > 200) this.state.ledger.splice(0, this.state.ledger.length - 200);
  }

  /**
   * Thousands-separated, for the refusal message. A local formatter rather than the one in
   * ui/components: the store must not import the UI, which imports the store.
   */
  private static say(n: number): string {
    return Math.round(n).toLocaleString("vi-VN");
  }

  /** Spend a currency. Refuses rather than going negative, and says which one was short. */
  private debitCurrency(id: CurrencyId, delta: number, reason: string): boolean {
    if (this.state[id] < delta) return false;
    this.state[id] -= delta;
    this.state.ledger.push({ at: Date.now(), delta: -delta, reason });
    return true;
  }

  /**
   * Ember still obtainable today.
   *
   * Resets by date rather than by session, so closing the game does not hand out a fresh
   * allowance. Read through here because the comparison has to happen in one place: the
   * roll, the arena's printed odds and the result screen all ask this question, and three
   * copies of "have I had my three today" is how the cap quietly stops working.
   */
  emberLeftToday(): number {
    const today = dayKey(Date.now());
    if (this.state.emberDay !== today) {
      this.state.emberDay = today;
      this.state.emberToday = 0;
    }
    return Math.max(0, EMBER_DAILY_CAP - this.state.emberToday);
  }

  /**
   * Roll a finished fight's drops and pay them.
   *
   * Returns what was actually paid, so the result screen prints the same list the ledger
   * recorded. The Ember line is counted against the daily cap here and nowhere else,
   * including when it is refused - a drop that was rolled and then discarded must not
   * count as one that was earned, or the cap silently drifts upwards over a long session.
   */
  awardDrops(outcome: "win" | "loss" | "draw", rng: () => number = Math.random): DropRoll[] {
    const left = this.emberLeftToday();
    const rolled = rollDrops(outcome, rng, { emberLeftToday: left });
    const paid: DropRoll[] = [];

    for (const drop of rolled) {
      if (drop.currency === "ember") {
        this.state.emberToday += drop.amount;
      }
      this.creditCurrency(drop.currency, drop.amount, `Trận ${outcome === "win" ? "thắng" : outcome === "draw" ? "hòa" : "thua"}`);
      paid.push(drop);
    }
    return paid;
  }

  buySeed(species: SpeciesId, count = 1): { ok: boolean; reason?: string } {
    const def = SPECIES_BY_ID[species];
    // Unlock gate. Without it all 6000 generated species are purchasable on day
    // one and progression means nothing - the shop would simply be the most
    // expensive entry in the registry.
    //
    // Reports progress rather than a bare refusal, so a player can see they are
    // two plants short rather than merely being told no.
    const gate = checkUnlock(this.unlockContext(), def.unlock);
    if (!gate.met) {
      return { ok: false, reason: `Chưa mở khóa: ${gate.summary}` };
    }
    // Charged in the species' own currency. The card shows this same figure before the
    // button, so a player who cannot afford it knows which of four numbers to go and
    // earn rather than just being refused.
    const currency = def.currency;
    const price = Math.floor(def.seedPrice * count * (1 - (count >= 10 ? SEED_PACK_PRICE : 0)));
    if (!this.debitCurrency(currency, price, `Mua ${count} hạt ${def.name}`)) {
      return {
        ok: false,
        reason: `${shortOf(currency)} — cần ${currencyInfo(currency).icon}${GameStore.say(price)} (đang có ${currencyInfo(currency).icon}${GameStore.say(this.state[currency])})`,
      };
    }
    this.state.seeds[species] = (this.state.seeds[species] ?? 0) + count;
    // "Unlock" means the gate had not passed before this purchase. Counting every
    // seed purchase would make the goal a synonym of "buy a seed", which is a
    // different thing and a worse goal.
    if (!def.unlock) this.advanceGoal("unlock", 1);
    this.commit("buySeed");
    return { ok: true };
  }

  plantSeed(species: SpeciesId): { ok: boolean; reason?: string; plantId?: string } {
    if ((this.state.seeds[species] ?? 0) <= 0) return { ok: false, reason: "Không có hạt này" };
    if (this.state.plants.length >= this.state.nurseryCap) return { ok: false, reason: "Vườn đã đầy" };
    this.state.seeds[species] = (this.state.seeds[species] ?? 0) - 1;
    const plant = createSeedPlant(species, this.state.playerId, seedToken(Date.now(), Math.random()), Date.now());
    plant.economy.purchaseCost = SPECIES_BY_ID[species].seedPrice;
    this.state.plants.push(plant);
    this.recordPlantDiscovery(plant);
    this.advanceGoal("plant", 1);
    this.commit("plantSeed");
    return { ok: true, plantId: plant.plantId };
  }

  // --- care ------------------------------------------------------------

  care(plantId: string, action: CareActionId): { ok: boolean; reason?: string; result?: ReturnType<typeof applyCare>; plant?: Plant } {
    const plant = this.get(plantId);
    if (!plant) return { ok: false, reason: "Không tìm thấy cây" };
    if (plant.locks.manual && plant.growth.stage === "mature" && action === "gene_serum") {
      // manual lock just protects from accidental sell; care still allowed
    }
    const res = applyCare(plant, action, Date.now(), {
      items: this.state.items,
      geneCrystal: this.state.geneCrystal,
      leafCoin: this.state.leafCoin,
    });
    if (!res.ok) return { ok: false, reason: res.reason, result: res };
    // The plant may have levelled from this action. Announced before the combo is
    // resolved, because a combo pays more experience and can level it again - and two
    // notices for one tap is the noise this is meant to remove, not create.
    if ((res.levels ?? 0) > 0) this.announcePlantLevelUp(plant, res.levels ?? 0, 0);
    // Consume resources.
    const cfg = CARE_COST[action];
    this.state.items -= cfg.items ?? 0;
    this.state.geneCrystal -= cfg.geneCrystal ?? 0;
    if (cfg.leafCoin) this.debit(cfg.leafCoin, `Chăm cây ${action}`);
    plant.economy.investedMaterialValue += (cfg.leafCoin ?? 0) + (cfg.items ?? 0) * 8;
    plant.powerRating = Math.round(estimatePower(plant));
    plant.validation = validateGenome(plant);
    addUnique(this.state.discovery.careActions, action);
    this.recordPlantDiscovery(plant);
    this.advanceGoal("care", 1);
    // Nectar, from tending. Paid on every action without exception, which is what makes
    // this currency a floor rather than a goal: a player who does nothing but tend can
    // always eventually reach the tier-2 shelf.
    this.creditCurrency("nectar", NECTAR_PER_CARE, `Chăm cây: ${action}`);
    this.tryCareCombo(plant);
    this.commit("care");
    return { ok: true, result: res, plant };
  }

  // --- breeding --------------------------------------------------------

  breedingPreview(parentAId: string, parentBId: string, protocol?: ProtocolId): Record<Rarity, number> | null {
    const a = this.get(parentAId);
    const b = this.get(parentBId);
    if (!a || !b) return null;
    const base = finalRarityWeights(a.growth.level, b.growth.level, a.rarity, b.rarity, {
      breederLevel: this.state.breederLevel,
      geneDiversity: protocol ? protocolDiversity(protocol, lineageDiversity(a, b)) : lineageDiversity(a, b),
      careQuality: 0.5,
      pity: this.state.pity,
    });
    return protocol ? applyCatalyst(base, protocol) : base;
  }

  /**
   * The breeding fee for a parent pair under a protocol.
   *
   * A named method rather than a number the screen recomputes, because the screen and
   * `breed` both need it and a fee shown to the player must be the fee charged. When
   * the two disagreed, the player would be told one price and charged another.
   */
  breedingFee(parentAId: string, parentBId: string, protocol?: ProtocolId): number {
    const a = this.get(parentAId);
    const b = this.get(parentBId);
    if (!a || !b) return 0;
    const base = Math.floor((sellPrice(a) + sellPrice(b)) * 0.2);
    return protocol ? Math.floor(base * getProtocol(protocol).feeMultiplier) : base;
  }

  breed(
    parentAId: string,
    parentBId: string,
    protocol?: ProtocolId,
  ): { ok: boolean; reason?: string; result?: BreedingResult } {
    const a = this.get(parentAId);
    const b = this.get(parentBId);
    if (!a || !b) return { ok: false, reason: "Chọn 2 cây" };
    if (a.plantId === b.plantId) return { ok: false, reason: "Không thể tự lai" };
    if (a.growth.stage !== "mature" && a.growth.stage !== "awakened") return { ok: false, reason: "Cây A chưa trưởng thành" };
    if (b.growth.stage !== "mature" && b.growth.stage !== "awakened") return { ok: false, reason: "Cây B chưa trưởng thành" };
    // Breeding now spends the parents, so the cap has to leave room for the child.
    // `>= nurseryCap` was right when the parents survived: the child took a plot the
    // parents' plots were freed by, so the count did not grow. With both parents gone
    // the garden grows by one every time, and checking `>= cap` let a breed push the
    // garden one plant past the cap it was validated against.
    if (this.state.plants.length + 1 > this.state.nurseryCap) return { ok: false, reason: "Vườn đã đầy" };
    if (protocol && !protocolUnlocked(protocol, this.state.breederLevel)) {
      return {
        ok: false,
        reason: `${getProtocol(protocol).label} mở ở cấp ${getProtocol(protocol).levelRequired}`,
      };
    }

    // Breeding fee.
    const fee = this.breedingFee(parentAId, parentBId, protocol);
    if (!this.debit(fee, "Phí lai tạo")) return { ok: false, reason: "Không đủ LeafCoin cho phí lai" };

    // Roll the target rarity band from final weights.
    //
    // Read through the same call the screen's odds bar used, so the roll and the
    // published odds cannot come from two different distributions.
    const weights = this.breedingPreview(parentAId, parentBId, protocol)!;
    const rng = new Rng(seedToken(a.plantId, b.plantId, this.state.pity.totalBreeds, Date.now()));
    const targetRarity = rollWeighted(rng, weights);
    const tier: CombatTier = tierForLevel(Math.max(a.growth.level, b.growth.level));
    const baseCtx: Omit<BreedingContext, "attempt"> = {
      playerId: this.state.playerId,
      nonce: seedToken(this.state.pity.totalBreeds, rng.next()),
      tier,
      targetRarity,
      breederLevel: this.state.breederLevel,
      protocol,
    };

    // --- every breeding must yield a new kind -----------------------------
    //
    // Two separate ways a child can read as "the plant I already have":
    //
    //   1. The crossover and mutation happen to reproduce a genome that is
    //      already in the garden. Rare, but real, and invisible to the player
    //      until they notice the stats, so it gets an explicit check.
    //   2. The genome is new but the generated *name* collides with a plant on
    //      display. This is by far the common one — the name space used to be
    //      small enough that a few hundred plants exhausted it, so breeding
    //      kept handing back the same names. That is the complaint.
    //
    // (1) is retried by bumping `attempt`, which reseeds the whole generation.
    // (2) is fixed by re-deriving the name with a higher salt, which is free
    // because a name is a pure function of the genome.
    const existingSigs = new Set<string>();
    for (const p of this.state.plants) existingSigs.add(genomeSignature(p));
    existingSigs.add(genomeSignature(a));
    existingSigs.add(genomeSignature(b));
    const usedNames = new Set<string>();
    for (const p of this.state.plants) usedNames.add(nameKey(p.name));

    let result = breedPlants(a, b, { ...baseCtx, attempt: this.state.pity.totalBreeds }, Date.now());
    for (let i = 1; i < UNIQUE_BREED_ATTEMPTS; i++) {
      if (!existingSigs.has(genomeSignature(result.plant))) break;
      result = breedPlants(a, b, { ...baseCtx, attempt: this.state.pity.totalBreeds + i }, Date.now());
    }

    // A new genome can still land on a name already on display. Walk the salt
    // forward until the name is free — the space is ~10^5, so this settles on
    // the first or second try in practice.
    for (let salt = 1; salt <= NAME_SALT_LIMIT && usedNames.has(nameKey(result.plant.name)); salt++) {
      result.plant.name = plantName(result.plant.dna, result.plant.traits, salt);
    }

    // Compute ECR for the child.
    const ecr = computeEcr(result.plant);
    result.plant.validation.ecr = ecr.ecr;
    result.report.rarityScore = result.plant.rarityScore;
    result.report.rarity = result.plant.rarity;

    // --- the parents are spent -----------------------------------------------
    //
    // Two mature plants go into the fusion and do not come out. This changes what
    // breeding *is*: it stops being a free roll you can repeat and becomes a decision
    // you spend two plants to make.
    //
    // A rule that only takes needs something to give, or the correct strategy becomes
    // "never breed anything you like". The parents' accumulated growth passes into the
    // child, so a pair of level-30 plants produces a child that starts well ahead of one
    // from a pair of level-1s. The parent's XP used to be granted to the parent itself
    // (`addPlantXp(a, 25)`), which is now pointless — the plant is about to be removed.
    const inheritedXp = Math.round(((a.growth.level + b.growth.level) / 2) * 6) + 50;
    this.updatePity(result.plant.rarity);

    this.state.plants.push(result.plant);
    this.addPlantXp(result.plant, inheritedXp);
    // Removed by id rather than by index, and through the same shape `sell` uses, so
    // there is one way a plant leaves the garden.
    this.state.plants = this.state.plants.filter(
      (p) => p.plantId !== a.plantId && p.plantId !== b.plantId,
    );
    this.state.discovery.breeds++;
    this.recordPlantDiscovery(result.plant);
    this.advanceGoal("breed", 1);
    // Pollen, from breeding. Paid for the act rather than for the result, because the
    // result is already standing in the garden as the child plant.
    this.creditCurrency("pollen", POLLEN_PER_BREED, `Lai tạo: ${a.name} × ${b.name}`);
    this.commit("breed");
    return { ok: true, result };
  }

  private updatePity(rarity: Rarity) {
    const p = this.state.pity;
    p.totalBreeds++;
    p.sinceA = p.sinceA + 1;
    p.sinceS = p.sinceS + 1;
    p.sinceSS = p.sinceSS + 1;
    p.sinceSSS = p.sinceSSS + 1;
    const idx = ["C", "B", "A", "S", "SS", "SSS"].indexOf(rarity);
    if (idx >= 2) p.sinceA = 0;
    if (idx >= 3) p.sinceS = 0;
    if (idx >= 4) p.sinceSS = 0;
    if (idx >= 5) p.sinceSSS = 0;
  }

  /**
 * Give a plant experience, and tell everyone when that turned into a level.
 *
 * The single place the garden grants plant XP through the store, so the level-up notice
 * and the breeder payout cannot be raised from one path and forgotten on another. Both
 * fire off the same returned count, which is why a plant levelling twice from one big
 * payout produces one notice saying "+2" rather than two notices for a thing that
 * happened once.
 *
 * Public because the arena pays plant experience too, and both of its call sites used to
 * reach past the store for `gainXp` directly - which levelled the plant up and told nobody,
 * on the one screen where a player is most likely to be watching the level.
 */
addPlantXp(plant: Plant, xp: number) {
  const levels = gainXp(plant, xp);
  // The grant is passed on because this is the only place that knows it. `gainXp` reports
  // how many levels were crossed and says nothing about experience, and the celebration
  // prints "+N EXP" — so with nothing to print it fell back to "đã lên cấp", which is the
  // receipt with the number the player just earned removed from it.
  if (levels > 0) this.announcePlantLevelUp(plant, levels, xp);
  return levels;
}

/**
 * A plant gained levels: say so, and pay the breeder.
 *
 * Both halves belong here. The notice is what the player asked for - they could watch a
 * fighter climb from 4 to 9 and had no way of knowing that was an event - and the
 * breeder experience is what makes tending a plant worth doing at all.
 */
private announcePlantLevelUp(plant: Plant, levels: number, xpGranted: number) {
  const gained = breederXpForPlantLevel(plant.growth.level);
  const gainedText = levels > 1 ? ` +${levels} cấp` : "";

  this.pushNotice({
    kind: "level",
    title: `⬆️ ${plant.name} lên cấp ${plant.growth.level}${gainedText}`,
    // No `species` here on purpose. The title already names the plant, and a notice
    // carrying species chips drops its body line - so passing one would have thrown
    // away the "+N EXP" receipt, which is the half of this the player has never seen.
    // It would also have rendered a single chip, and the chip row is sized for three.
    body: `+${gained} EXP thợ lai tạo · còn ${xpForLevel(this.state.breederLevel)} EXP để lên cấp ${this.state.breederLevel + 1}`,
    /*
     * The plant's own progress, so the celebration can show *its* bar — the number the
     * player just moved — rather than the breeder's.
     *
     * Read after `gainXp`, so these are post-grant. `xpRequired` is the same function
     * `gainXp` walks; if the two ever disagreed, the bar in the celebration would
     * disagree with the bar on the card, which is the exact failure this structured
     * payload exists to make impossible.
     */
    levelUp: {
      subject: "plant",
      subjectId: plant.plantId,
      subjectName: plant.name,
      level: plant.growth.level,
      levelsGained: levels,
      expGained: Math.round(xpGranted),
      xpAfter: plant.growth.xp,
      needAfter: xpRequired(plant.growth.level),
      capped: plant.growth.level >= 100,
      crossed: [],
    },
  });

  // Straight to the breeder, not queued: the notice above is the receipt for this, and
  // two notices for one level-up is the thing the player would call noise.
  this.addBreederXp(gained);
}

  // --- selling ---------------------------------------------------------

  sellQuote(plantId: string): { price: number; breakdown: Record<string, number> } | null {
    const plant = this.get(plantId);
    if (!plant || !canSell(plant)) return null;
    const price = sellPrice(plant);
    return {
      price,
      breakdown: {
        base: 100,
        rarity: price,
        careCycles: plant.economy.careCycles,
        generation: plant.generation,
      },
    };
  }

  sell(plantId: string): { ok: boolean; reason?: string; price?: number } {
    const plant = this.get(plantId);
    if (!plant) return { ok: false, reason: "Không tìm thấy cây" };
    if (!canSell(plant)) return { ok: false, reason: "Cây đang bị khoá hoặc chưa sẵn sàng bán" };
    const price = sellPrice(plant);
    this.state.plants = this.state.plants.filter((p) => p.plantId !== plantId);
    this.credit(price, `Bán ${plant.name}`);
    this.advanceGoal("sell", 1);
    this.commit("sell");
    return { ok: true, price };
  }

  /**
   * Awaken a plant.
   *
   * Lives here rather than in the sheet because the sheet was calling
   * `tryAwaken` directly and mutating the plant behind the store's back. Every
   * other mutation in this file goes through a method, and the moment awakening
   * also needs to tick a daily goal and raise a notice, a back door is a
   * guarantee that one of those two gets missed.
   */
  awaken(plantId: string): { ok: boolean; reason: string } {
    const plant = this.get(plantId);
    if (!plant) return { ok: false, reason: "Không tìm thấy cây" };
    const r = tryAwaken(plant, Date.now());
    if (!r.ok) return r;
    this.advanceGoal("awaken", 1);
    this.addPlantXp(plant, 30);
    this.recordPlantDiscovery(plant);
    this.commit("awaken");
    return r;
  }

  // --- collection / locks ---------------------------------------------

  toggleFavorite(plantId: string) {
    const p = this.get(plantId);
    if (!p) return;
    p.locks.favorite = !p.locks.favorite;
    this.commit("favorite");
  }

  toggleLock(plantId: string) {
    const p = this.get(plantId);
    if (!p) return;
    p.locks.manual = !p.locks.manual;
    this.commit("lock");
  }

  rename(plantId: string, name: string) {
    const p = this.get(plantId);
    if (!p) return;
    p.name = name.slice(0, 24) || p.name;
    this.commit("rename");
  }

  get(plantId: string): Plant | undefined {
    return this.state.plants.find((p) => p.plantId === plantId);
  }

  // --- battle ----------------------------------------------------------

  /* --- the ladder --------------------------------------------------------- */

  /**
   * The strongest plant this player owns, by `powerRating`.
   *
   * Read here rather than by the screen, because the answer changes mid-session whenever a
   * plant levels and the screen would otherwise have cached a stale best - and the stage card
   * compares every stage against it.
   *
   * 0 when the garden is empty, which the ladder handles: the first stage has to be winnable
   * by a plant the player does not have yet, or a new account opens onto an unwinnable stage.
   */
  bestFighter(): Plant | null {
    let best: Plant | null = null;
    for (const p of this.state.plants) {
      if (p.growth.stage !== "mature" && p.growth.stage !== "awakened") continue;
      if (!best || p.powerRating > best.powerRating) best = p;
    }
    return best;
  }

  /** Whether the garden has anything that can fight. The screen says so rather than hiding. */
  canFight(): boolean {
    return this.bestFighter() !== null;
  }

  /** Today's ladder state, with the attempt counter reset if the date moved. */
  private ascentToday(): AscentState {
    const today = dayKey(Date.now());
    const a = this.state.ascent ?? (this.state.ascent = emptyAscent(today));
    if (a.day !== today) {
      // Only the counter resets. The record is the player's, not the day's.
      a.day = today;
      a.attempts = 0;
    }
    return a;
  }

  /**
   * How many distinct days this player has come back on.
   *
   * The daily escalation term, and it is a *count of days*, not a countdown from an
   * anniversary: the garden's own `streak` already tracks consecutive days and resets on a
   * miss, and a player who takes a week off should not find the world weaker for it.
   *
   * Derived rather than stored, from `createdAt`, so it cannot drift from the calendar. A
   * player created today has day 0; one who has been here a week has day 7.
   */
  ascentDayIndex(): number {
    const start = this.state.createdAt ?? Date.now();
    const days = Math.floor((Date.now() - start) / 86_400_000);
    return Math.max(0, days);
  }

  /** The brief for a stage, for the screen. */
  stageBrief(stage: number): StageBrief {
    const best = this.bestFighter();
    return describeStage(stage, best?.powerRating ?? 0, this.state.playerId, this.ascentDayIndex());
  }

  /** The monster guarding a stage. Built fresh each call, so nothing is stored to go stale. */
  stageMonster(stage: number): MonsterSpec {
    const brief = this.stageBrief(stage);
    return monsterFor(this.state.playerId, stage, brief.targetPower, this.ascentDayIndex(), Date.now());
  }

  /**
   * Fight a stage, and pay it.
   *
   * Separate from `runQuickBattle` rather than a parameter on it, because the two disagree
   * about what a fight is worth: quick battles pay a flat 40 coins because they are a
   * side activity, while a stage pays a reward that climbs with the stage number and is the
   * main progression axis. Folding them together would mean either the ladder pays arena rates
   * or the arena pays ladder rates.
   *
   * The consolation reward is halved per consecutive loss on the same stage, so being stuck
   * is uncomfortable rather than farmable - but never zero, because a loss that pays nothing
   * is a loss the player learns to stop attempting.
   */
  runAscentStage(
    plantId: string,
    stage: number,
  ): {
    ok: boolean;
    reason?: string;
    result?: BattleResult;
    won?: boolean;
    monster?: MonsterSpec;
    reward?: StageReward;
    drops?: DropRoll[];
    nextUnlocked?: number;
    /**
     * The seed the fight was settled with, so the screen can replay the same one.
     *
     * Returned rather than recomputed by the caller because the seed mixes the two plant
     * ids, the stage and the clock, and a caller that rebuilt it would have to guess all
     * four. `BattleView` used to generate its own seed from `Date.now()` and therefore ran
     * a *different* fight from the one this recorded — see `simulateBattle`.
     */
    seed?: string;
  } {
    const me = this.get(plantId);
    if (!me) return { ok: false, reason: "Không tìm thấy cây" };
    if (me.growth.stage !== "mature" && me.growth.stage !== "awakened") {
      return { ok: false, reason: "Cây chưa trưởng thành" };
    }
    const ascent = this.ascentToday();
    if (!stageIsOpen(stage, ascent.highest)) {
      return { ok: false, reason: `Ải ${stage} chưa mở. Hãy vượt ải ${ascent.highest + 1} trước.` };
    }

    const monster = this.stageMonster(stage);
    // Simulated here and the result handed back, so the store is the only thing that decides
    // an outcome. The screen replays this event log rather than running its own battle - two
    // fights with two seeds would settle differently, and a player who watched a fight they
    // won get marked as a loss is not coming back.
    /*
     * Captured before the fight rather than inlined.
     *
     * The screen builds a `BattleView` from this seed so the fight the player watches is
     * the fight that was settled. Reading the clock twice would give two different seeds
     * and quietly reintroduce the exact bug this replaces, which is why it is hoisted into
     * a local: one value, used by both.
     */
    const seed = seedToken(me.plantId, monster.plant.plantId, stage, Date.now());
    const result = simulateBattle(me, monster.plant, {
      seed,
      maxSeconds: 90,
      arena: "sunny",
    });
    const won = result.winner === "a";

    const attempt = won ? 0 : ascent.attempts;
    const reward = stageReward(stage, won, attempt);

    this.credit(reward.leafCoin, won ? `Vượt ải ${stage}` : `Thử ải ${stage}`);
    for (const id of ["nectar", "pollen"] as const) {
      const amount = reward[id];
      if (amount > 0) this.creditCurrency(id, amount, `Vượt ải ${stage}`);
    }
    if (reward.geneCrystal > 0) this.state.geneCrystal += reward.geneCrystal;
    this.state.items += reward.items;

    // The arena's own drop table, so the odds it prints and the odds it pays are one thing.
    const drops = won ? this.awardDrops("win") : [];
    // Ladder-only extra: Pollen and Nectar on top of the table, never Ember, because Ember
    // already has a daily cap in `drops.ts` and a second source would quietly break it.
    const extra = stageExtraDrop(stage, won);
    if (extra) {
      this.creditCurrency(extra.currency, extra.amount, `Vượt ải ${stage}`);
    }

    const levels = this.addPlantXp(me, reward.plantXp);
    for (const s of me.skills) addSkillXp(s, won ? 12 : 4);

    me.battleRecord.wins += won ? 1 : 0;
    me.battleRecord.losses += won ? 0 : 1;
    this.state.discovery.battles++;

    let nextUnlocked: number | undefined;
    if (won) {
      ascent.cleared++;
      if (stage >= ascent.highest) {
        ascent.highest = stage;
        ascent.attempts = 0;
        ascent.bestPower = Math.max(ascent.bestPower, monster.power);
        nextUnlocked = stage + 1;
      } else {
        ascent.attempts = 0;
      }
    } else {
      ascent.attempts++;
    }

    this.advanceGoal("battle", 1);
    if (won) this.advanceGoal("win", 1);
    this.commit("ascent");
    this.pushNotice({
      kind: "level",
      title: won ? `🏆 Vượt ải ${stage}: thắng` : `Ải ${stage}: thua`,
      body: `${monster.name} · +${reward.leafCoin} 🪙` + (levels > 0 ? ` · ${me.name} lên ${levels} cấp` : ""),
    });

    return { ok: true, result, won, monster, reward, drops, nextUnlocked, seed };
  }

  runQuickBattle(plantId: string, opponent: Plant): { result: BattleResult; won: boolean } {
    const me = this.get(plantId);
    if (!me) throw new Error("no plant");
    const config: BattleConfig = {
      seed: seedToken(me.plantId, opponent.plantId, Date.now()),
      maxSeconds: 90,
      arena: "sunny",
    };
    const result = simulateBattle(me, opponent, config);
    const won = result.winner === "a";
    // Rewards.
    const reward = won ? 40 : 12;
    const itemReward = won ? 4 : 2;
    this.credit(reward, won ? "Thắng trận" : "Tham gia trận");
    this.state.items += itemReward;
    // Skill XP.
    for (const s of me.skills) {
      addSkillXp(s, s.id && result.a.skillUses > 0 ? 12 : 4);
    }
    me.battleRecord.wins += won ? 1 : 0;
    me.battleRecord.losses += won ? 0 : 1;
    // Battle scar chance.
    if (Math.random() < 0.12) me.battleRecord.scars++;
    this.addPlantXp(me, won ? 15 : 10);
    this.state.discovery.battles++;
    this.recordPlantDiscovery(me);
    this.advanceGoal("battle", 1);
    // Only on a win. Sharing the "battle" counter would mean a player who loses
    // eight times in a row completes a quest called "thắng hai trận".
    if (won) this.advanceGoal("win", 1);
    this.commit("battle");
    return { result, won };
  }

  // --- growth tick -----------------------------------------------------

  tickAll(): { stageUps: { plant: Plant; stage: string }[] } {
    const stageUps: { plant: Plant; stage: string }[] = [];
    const now = Date.now();
    for (const plant of this.state.plants) {
      const r = tickGrowth(plant, now);
      if (r.stageChanged && r.newStage) {
        stageUps.push({ plant, stage: r.newStage });
        if (r.newStage === "mature") {
          plant.locks.manual = ["A", "S", "SS", "SSS"].includes(plant.rarity);
        }
      }
    }
    if (stageUps.length) this.commit("growth");
    return { stageUps };
  }

  // --- breeder level ---------------------------------------------------

  addBreederXp(amount: number) {
    this.state.breederXp += amount;

    const levelBefore = this.state.breederLevel;
    const beforeUnlock = this.unlockedSpeciesIds();
    // Every level crossed, in order. Not just the count: the celebration lists what each
    // one opened, and a big stage can cross three, each with its own shelf behind it.
    const crossed: number[] = [];

    while (this.state.breederXp >= xpForLevel(this.state.breederLevel) && this.state.breederLevel < BREEDER_LEVEL_CAP) {
      this.state.breederXp -= xpForLevel(this.state.breederLevel);
      this.state.breederLevel++;
      crossed.push(this.state.breederLevel);
      // Plots are no longer granted by levelling.
      //
      // This used to raise the cap every five levels, which quietly handed out
      // plots that the new uyPlot was also charging for: at level 20 the player
      // had 14 of 24 for free and had no reason to ever buy one. Levelling now
      // unlocks plots *eligibility*; opening one is a purchase.
      this.credit(200, `Cấp nhà lai tạo ${this.state.breederLevel}`);
    }

    // Only say something if a level actually moved. The XP bar can fill and sit
    // there, and a "lên cấp!" banner on an idle tick would train the player to
    // ignore banners.
    if (this.state.breederLevel > levelBefore) {
      const afterUnlock = this.unlockedSpeciesIds();
      const fresh: SpeciesId[] = [];
      for (const id of afterUnlock) if (!beforeUnlock.has(id)) fresh.push(id);
      // Sorted by registry index so the three shown are the *earliest* ones just
      // opened — the ones the player was closest to, not an arbitrary sample.
      fresh.sort((a, b) => a.localeCompare(b));
      const shown = fresh.slice(0, 3);

      this.pushNotice({
        kind: "level",
        title: crossed.length > 1 ? `Lên ${crossed.length} cấp!` : `Cấp nhà lai tạo ${this.state.breederLevel}`,
        body:
          this.state.breederLevel === BREEDER_LEVEL_CAP
            ? "Đã đạt cấp cao nhất."
            : fresh.length > 0
              ? `Mở khoá ${fresh.length.toLocaleString("vi-VN")} loài cây mới.`
              : "Chưa có loài nào mở thêm — hãy trồng cây và tích luỹ để mở tiếp.",
        levelUp: {
          subject: "breeder",
          subjectName: "Nhà lai tạo",
          level: this.state.breederLevel,
          levelsGained: crossed.length,
          expGained: Math.round(amount),
          xpAfter: this.state.breederXp,
          needAfter: this.state.breederLevel >= BREEDER_LEVEL_CAP ? 0 : xpForLevel(this.state.breederLevel),
          capped: this.state.breederLevel >= BREEDER_LEVEL_CAP,
          crossed,
        },
      });

      if (shown.length > 0) {
        this.pushNotice({
          kind: "unlock",
          title: shown.length === fresh.length ? "Loài mới trong cửa hàng" : `${shown.length} loài mới trong cửa hàng`,
          body: shown.map((id) => SPECIES_BY_ID[id]?.name ?? id).join(" · "),
          species: shown,
          moreCount: fresh.length - shown.length,
        });
      }
    }

    // Committed unconditionally, not only when the level moved: XP that did not
    // level up still advances the bar, and the badge shows XP to the next level,
    // so the player has to see it move. Skipping this was why the badge could
    // read level 1 while the store held level 10.
    this.commit("addBreederXp");
  }

  claimGoal(goalId: string): { ok: boolean; reason?: string; goal?: DailyGoal } {
    this.refreshGardenDay();
    const goal = this.state.gardenDay.goals.find((g) => g.id === goalId);
    if (!goal) return { ok: false, reason: "Không tìm thấy nhiệm vụ" };
    if (goal.claimed) return { ok: false, reason: "Đã nhận thưởng" };
    if (goal.progress < goal.target) return { ok: false, reason: "Chưa hoàn thành" };
    goal.claimed = true;
    if (goal.reward.leafCoin) this.credit(goal.reward.leafCoin, `Thưởng ${goal.label}`);
    if (goal.reward.geneCrystal) this.state.geneCrystal += goal.reward.geneCrystal;
    if (goal.reward.items) this.state.items += goal.reward.items;
    this.state.gardenDay.focus = Math.min(100, this.state.gardenDay.focus + 18);
    this.commit("claimGoal");
    return { ok: true, goal };
  }

  gardenWeatherNote(): string {
    this.refreshGardenDay();
    const notes: Record<GardenWeather, string> = {
      mist: "Sương dày: chăm cây thiên về hồi phục và tăng HP ổn định.",
      sun: "Nắng gắt: cây tăng công nhanh hơn, nhưng dễ nóng nếu chăm quá tay.",
      storm: "Bão sét: hôm nay nên thử cây hệ sét và để cây tự ra chiêu nhiều hơn.",
      moon: "Đêm trăng: dễ mở đặc tính hiếm và đột biến mạnh hơn bình thường.",
    };
    return notes[this.state.gardenDay.weather];
  }

  /** Progress for a milestone metric, read live from player state. */
  private metricProgress(metric: MilestoneMetric): number {
    const d = this.state.discovery;
    switch (metric) {
      case "species":
        return d.species.length;
      case "elements":
        return d.elements.length;
      case "traits":
        return d.traits.length;
      case "careActions":
        return d.careActions.length;
      case "battles":
        return d.battles;
      case "breeds":
        return d.breeds;
      case "wins":
        return this.state.plants.reduce((a, p) => a + p.battleRecord.wins, 0);
      case "plantsOwned":
        return this.state.plants.length;
      case "highestGeneration":
        return this.state.plants.reduce((a, p) => Math.max(a, p.generation), 1);
      case "highestRarity": {
        // Rarity points: C=0 B=1 A=2 S=3 SS=4 SSS=5.
        const pts: Record<string, number> = { C: 0, B: 1, A: 2, S: 3, SS: 4, SSS: 5 };
        return this.state.plants.reduce((a, p) => Math.max(a, pts[p.rarity] ?? 0), 0);
      }
    }
  }

  discoveryMilestones(): DiscoveryMilestone[] {
    return MILESTONES.map((t) => ({
      id: t.id,
      label: t.label,
      hint: t.hint,
      progress: this.metricProgress(t.metric),
      target: t.target,
      reward: t.reward,
      claimed: this.state.discovery.claimed.includes(t.id),
    }));
  }

  claimDiscovery(id: string): { ok: boolean; reason?: string; milestone?: DiscoveryMilestone } {
    const milestone = this.discoveryMilestones().find((m) => m.id === id);
    if (!milestone) return { ok: false, reason: "Không tìm thấy mốc khám phá" };
    if (milestone.claimed) return { ok: false, reason: "Đã nhận thưởng" };
    if (milestone.progress < milestone.target) return { ok: false, reason: "Chưa đủ tiến độ" };
    this.state.discovery.claimed.push(id);
    if (milestone.reward.leafCoin) this.credit(milestone.reward.leafCoin, `Khám phá: ${milestone.label}`);
    if (milestone.reward.geneCrystal) this.state.geneCrystal += milestone.reward.geneCrystal;
    if (milestone.reward.items) this.state.items += milestone.reward.items;
    this.commit("claimDiscovery");
    return { ok: true, milestone };
  }

  private recordPlantDiscovery(plant: Plant) {
    for (const species of plant.baseLineage) addUnique(this.state.discovery.species, species);
    for (const [element, value] of Object.entries(plant.dna.elementGenes as Record<string, number>)) {
      if ((value ?? 0) >= 0.18) addUnique(this.state.discovery.elements, element);
    }
    for (const trait of plant.traits) addUnique(this.state.discovery.traits, trait);
  }

  private refreshGardenDay() {
    const key = dayKey(Date.now());
    if (this.state.gardenDay?.dayKey === key) return;
    this.state.gardenDay = createGardenDay(key, this.state.gardenDay, this.state.breederLevel, this.state.playerId);
  }

  private advanceGoal(kind: DailyGoalKind, amount: number) {
    this.refreshGardenDay();
    let moved = false;
    for (const goal of this.state.gardenDay.goals) {
      if (goal.kind === kind && !goal.claimed && goal.progress < goal.target) {
        goal.progress = Math.min(goal.target, goal.progress + amount);
        moved = true;
      }
    }
    // Fires once, and only on the transition into "done". Announcing on every
    // increment would spam a player who just planted three seeds in a row.
    if (moved) this.checkGoalCompletion();
  }

  /**
   * Announce any goal that just became claimable.
   *
   * Shared by `advanceGoal` and by the unlock/plot/awaken paths, which can clear a
   * goal without going through a counter at all.
   */
  private checkGoalCompletion(): void {
    for (const goal of this.state.gardenDay.goals) {
      if (!goal.claimed && goal.progress >= goal.target && !goal.announced) {
        goal.announced = true;
        this.pushNotice({ kind: "goal", title: "Hoàn thành nhiệm vụ", body: goal.label });
      }
    }
  }

  private tryCareCombo(plant: Plant) {
    const recent = plant.careMemory.recent.slice(-3).map((r) => r.action).join(">");
    const comboReward =
      recent === "water>music>water" ? { label: "Combo hồi sinh", xp: 14, items: 1 } :
      recent === "sunlight>pruning>sunlight" ? { label: "Combo bứt tốc", xp: 16, items: 0 } :
      recent === "moonlight>gene_serum>music" ? { label: "Combo dị biến", xp: 22, geneCrystal: 1 } :
      null;
    if (!comboReward) return;
    this.addPlantXp(plant, comboReward.xp);
    this.state.items += comboReward.items ?? 0;
    this.state.geneCrystal += comboReward.geneCrystal ?? 0;
    this.state.gardenDay.focus = Math.min(100, this.state.gardenDay.focus + 10);
  }
}

import { CARE_ACTIONS } from "../config/careActions";
const CARE_COST = Object.fromEntries(
  Object.values(CARE_ACTIONS).map((c) => [c.id, c.cost]),
) as Record<CareActionId, { items?: number; leafCoin?: number; geneCrystal?: number }>;

function lineageDiversity(a: Plant, b: Plant): number {
  const setA = new Set(a.dna.lineage);
  const setB = new Set(b.dna.lineage);
  const shared = [...setA].filter((s) => setB.has(s)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : clamp((union - shared) / union, 0, 1);
}

function tierForLevel(level: number): CombatTier {
  if (level >= 30) return "ancient";
  if (level >= 15) return "bloom";
  if (level >= 5) return "sprout";
  return "seedling";
}

function rollWeighted(rng: Rng, weights: Record<Rarity, number>): Rarity {
  const entries = Object.entries(weights) as [Rarity, number][];
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = rng.next() * total;
  for (const [r, w] of entries) {
    roll -= w;
    if (roll <= 0) return r;
  }
  return "C";
}

// --- persistence ---------------------------------------------------------

function loadOrCreate(rawOverride?: string): PlayerState {
  try {
    const raw = rawOverride ?? localStorage.getItem(saveSlotKey(getActiveAccountId()));
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerState;
      if (parsed && Array.isArray(parsed.plants)) {
        // Repair missing pity.
        parsed.pity = { ...emptyPity(), ...parsed.pity };
        // Repair the currencies a save written before the multi-currency shop has none of.
        // Read as 0 rather than left undefined, so the top bar prints a number instead of
        // "NaN" for a returning player - and so a refusal can compare against a number.
        for (const id of CURRENCY_IDS) {
          const held = (parsed as unknown as Record<string, unknown>)[id];
          (parsed as unknown as Record<string, number>)[id] = typeof held === "number" && Number.isFinite(held) ? held : 0;
        }
        // Ember is a daily cap, so the day it was last spent has to survive too. Without
        // it a returning player would either lose the day's Ember or be charged for a cap
        // that no longer applies, and neither is knowable from a bare number.
        parsed.emberDay = typeof parsed.emberDay === "string" ? parsed.emberDay : dayKey(Date.now());
        parsed.emberToday = Number.isFinite(parsed.emberToday) ? parsed.emberToday : 0;
        // Repair plants saved before battle streaks existed. Done per plant because
        // the streak lives on the fighter, and a save written by an older build has no
        // such field on any of them. Read as 0 rather than undefined so the arena screen
        // can print a number instead of "undefined" for a returning player.
        for (const pl of parsed.plants) {
          pl.battleRecord = { ...emptyStreakFields(), ...pl.battleRecord };
          pl.battleRecord.streak = Number(pl.battleRecord.streak) || 0;
          pl.battleRecord.bestStreak = Number(pl.battleRecord.bestStreak) || 0;
        }
        parsed.gardenDay = parsed.gardenDay ?? createGardenDay(dayKey(Date.now()), undefined, parsed.breederLevel ?? 1, parsed.playerId ?? "player");
        parsed.discovery = repairDiscovery(parsed.discovery);
        // Repair the ladder. Field by field rather than spreading a whole object over it,
        // because a save written by a build that had the ladder but not the daily escalation
        // has an `ascent` with no `day`, and a default that spread would reset the record to
        // whatever today's date is - silently wiping a player's furthest stage.
        const ascent = (parsed.ascent ?? {}) as Partial<AscentState>;
        parsed.ascent = {
          highest: Number.isFinite(ascent.highest) ? ascent.highest! : 0,
          attempts: Number.isFinite(ascent.attempts) ? ascent.attempts! : 0,
          cleared: Number.isFinite(ascent.cleared) ? ascent.cleared! : 0,
          bestPower: Number.isFinite(ascent.bestPower) ? ascent.bestPower! : 0,
          day: typeof ascent.day === "string" ? ascent.day : dayKey(Date.now()),
        };
        for (const plant of parsed.plants) {
          for (const species of plant.baseLineage) addUnique(parsed.discovery.species, species);
          for (const [element, value] of Object.entries(plant.dna.elementGenes as Record<string, number>)) {
            if ((value ?? 0) >= 0.18) addUnique(parsed.discovery.elements, element);
          }
          for (const trait of plant.traits) addUnique(parsed.discovery.traits, trait);
        }
        return parsed;
      }
    }
  } catch {
    // fall through to new
  }
  const now = Date.now();
  const playerId = `pl_${seedToken("player", now, Math.random())}`;
  const fresh: PlayerState = {
    playerId,
    name: "Nhà Lai Tạo",
    breederLevel: 1,
    breederXp: 0,
    leafCoin: 1200,
    // Enough nectar to buy one tier-2 seed outright, so the first time a player meets a
    // price in something other than coins it is a price they can actually pay. Pollen and
    // Ember start at zero on purpose: both have to be earned, and both are earned by the
    // two things the game most wants a new player to try.
    nectar: 40,
    pollen: 0,
    ember: 0,
    emberDay: dayKey(now),
    emberToday: 0,
    geneCrystal: 5,
    items: 30,
    plants: [],
    seeds: { thornroot: 2, emberleaf: 1, dewbud: 1, voltvine: 1, gloomcap: 0 },
    inventoryCap: 60,
    nurseryCap: 6,
    pity: emptyPity(),
    ledger: [],
    createdAt: now,
    lastSeen: now,
    seenGenes: [],
    gardenDay: createGardenDay(dayKey(now), undefined, 1, playerId),
    discovery: emptyDiscovery(),
    ascent: emptyAscent(dayKey(now)),
  };
  // Seed the first plant.
  const first = createSeedPlant("thornroot", playerId, seedToken(now, "first"), now);
  fresh.plants.push(first);
  addUnique(fresh.discovery.species, "thornroot");
  for (const [element, value] of Object.entries(first.dna.elementGenes as Record<string, number>)) {
    if ((value ?? 0) >= 0.18) addUnique(fresh.discovery.elements, element);
  }
  fresh.seeds.thornroot = (fresh.seeds.thornroot ?? 1) - 1;
  try {
    if (rawOverride === undefined) localStorage.setItem(saveSlotKey(getActiveAccountId()), JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

function emptyDiscovery(): DiscoveryState {
  return { species: [], elements: [], traits: [], careActions: [], battles: 0, breeds: 0, claimed: [] };
}

function repairDiscovery(input: DiscoveryState | undefined): DiscoveryState {
  const base = emptyDiscovery();
  if (!input) return base;
  return {
    species: Array.isArray(input.species) ? input.species : [],
    elements: Array.isArray(input.elements) ? input.elements : [],
    traits: Array.isArray(input.traits) ? input.traits : [],
    careActions: Array.isArray(input.careActions) ? input.careActions : [],
    battles: Number.isFinite(input.battles) ? input.battles : 0,
    breeds: Number.isFinite(input.breeds) ? input.breeds : 0,
    claimed: Array.isArray(input.claimed) ? input.claimed : [],
  };
}

function addUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD keys, ignoring clock time. */
function daysBetween(previous: string, current: string): number {
  const a = Date.parse(`${previous}T00:00:00Z`);
  const b = Date.parse(`${current}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 999;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Build today's board: goals drawn from the pool, gated by breeder level, with
 * the weather giving its favoured kinds a small edge. Streak carries over from
 * yesterday and resets after a missed day.
 */
/**
 * Build a day's state.
 *
 * Exported because it is the only pure seam in the day cycle: it takes the
 * previous day and returns the next, so a test can walk a month of rotation in a
 * loop without touching the clock that `refreshGardenDay` reads.
 */
export function createGardenDay(key: string, previous: GardenDayState | undefined, level: number, playerId: string): GardenDayState {
  const rng = new Rng(seedToken("garden-day", key, playerId));
  const weather = rng.pick(["mist", "sun", "storm", "moon"] as GardenWeather[]) ?? "mist";
  const favours = WEATHER_INFO[weather].favours;

  let streak = 0;
  if (previous) {
    streak = daysBetween(previous.dayKey, key) === 1 ? previous.streak + 1 : 0;
  }

  const eligible = GOAL_POOL.filter((t) => level >= t.minLevel);
  const want = Math.min(DAILY_GOAL_COUNT, eligible.length);
  const picked: DailyGoal[] = [];
  const usedIds = new Set<string>();
  const usedKinds = new Set<DailyGoalKind>();

  // Everything barred today: already picked, or seen inside the cooldown window.
  // The cooldown is what stops a daily player settling on a favourite three. With
  // one-goal-per-kind the variety inside a day is already real; this is what makes
  // the rotation across days move as well.
  const barred = new Set<string>(previous?.recentGoals ?? []);

  let guard = 0;
  while (picked.length < want && guard++ < 120) {
    const choice = rng.weighted(
      // One goal per kind. Two "plant" rows on the same day differ by a number
      // and read as one quest twice, however carefully the pool is written.
      eligible.filter((t) => !usedIds.has(t.id) && !usedKinds.has(t.kind) && !barred.has(t.id)),
      (t) => t.weight * (favours.includes(t.kind) ? 1.4 : 1) * (level >= t.minLevel + 3 ? 0.6 : 1),
    );
    // If the cooldown ate every remaining option, drop the cooldown rather than
    // hand out fewer goals than promised. A short day is worse than a repeat.
    const pick =
      choice ??
      rng.weighted(
        eligible.filter((t) => !usedIds.has(t.id) && !usedKinds.has(t.kind)),
        (t) => t.weight,
      );
    if (!pick || usedIds.has(pick.id) || usedKinds.has(pick.kind)) break;
    usedIds.add(pick.id);
    usedKinds.add(pick.kind);
    picked.push({
      id: `${key}-${pick.id}`,
      kind: pick.kind,
      label: pick.label,
      target: pick.target,
      progress: 0,
      reward: scaleReward(pick.reward, streak),
      claimed: false,
      hint: pick.hint,
      announced: false,
    });
  }

  return {
    dayKey: key,
    weather,
    streak,
    focus: Math.min(100, 15 + streak * 5 + (picked.length >= DAILY_GOAL_COUNT ? 10 : 0)),
    goals: picked,
    // Today's picks join the window and the oldest fall out, so a player sees each
    // template once every few days rather than whenever the weights say so.
    recentGoals: [...picked.map((g) => g.id.slice(key.length + 1)), ...(previous?.recentGoals ?? [])].slice(
      0,
      GOAL_COOLDOWN_DAYS * DAILY_GOAL_COUNT,
    ),
  };
}

function scaleReward(reward: { leafCoin?: number; geneCrystal?: number; items?: number }, streak: number) {
  const mult = streakMultiplier(streak);
  return {
    leafCoin: reward.leafCoin ? Math.round(reward.leafCoin * mult) : undefined,
    geneCrystal: reward.geneCrystal,
    items: reward.items,
  };
}

export function resetSave() {
  try {
    // The active slot, not the guest one. Resetting while signed in must not leave the
    // account's garden sitting in the key the player is about to sign back into.
    localStorage.removeItem(saveSlotKey(getActiveAccountId()));
  } catch {
    // ignore
  }
  void TIER_META;
  void round2;
}
