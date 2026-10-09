/**
 * Central game store. Owns player state, the nursery, inventory and the economy
 * ledger. All mutations go through here so saves stay consistent and coin can
 * never be double-spent (docs/16 §24-§25: idempotent, immutable ledger).
 */

import { Rng, clamp, round2, seedToken } from "./rng";
import type { Plant } from "./types";
import { DEFAULT_PLAYER_NAME, STAGE_ORDER, STAGE_SECONDS, emptyArchetype } from "./types";
import { createSeedPlant, breedPlants, genomeSignature, validateGenome, estimatePower, type BreedingContext, type BreedingResult } from "../genetics/genomeGenerator";
import { applyCatalyst, getProtocol, protocolDiversity, protocolUnlocked, type ProtocolId } from "../genetics/protocols";
import { plantName, nameKey } from "../genetics/names";
import { emptyStreakFields } from "./streak";
import {
  CURRENCY_IDS,
  NECTAR_PER_CARE,
  POLLEN_PER_BREED,
  currencyInfo,
  currencyName,
  shortOf,
  type CurrencyId,
} from "./currency";
import { EMBER_DAILY_CAP, rollDrops, type DropRoll } from "./drops";
import { EXCHANGE_DAILY_CAP, quoteExchange } from "../economy/exchange";
import {
  describeStage,
  gateCheck,
  isBossStage,
  minFighterPower,
  monsterFor,
  stageExtraDrop,
  stageGate,
  stageIsOpen,
  stageReward,
  type MonsterSpec,
  type StageBrief,
  type StageReward,
} from "../pve";

import { getActiveAccountId, saveSlotKey } from "./saveSlot";
import { computeEcr } from "../genetics/ecrCalculator";
import { applyCare, gainXp, xpRequired } from "../growth/care";
import { giftFor, dayInCycle, isMilestone, AUTO_CARE_MS, type CheckInGift } from "./checkin";
import { MOOD_EFFECTS, type CareActionId } from "../config/careActions";
import { tickGrowth } from "../growth/stages";
import { addSkillXp } from "../genetics/skillGenerator";
import { evaluateObjectives, objectiveContext, readCombo, type ObjectiveOutcome } from "../progression/objectives";
import { canSell, tryAwaken } from "../growth/stages";
import { sellPrice } from "../economy/shop";
import { emptyPity, type PityCounters, type Rarity } from "../config/rarity";
import { TIER_META, type CombatTier } from "../config/balance";
import type { SpeciesId } from "../config/species";
import { SPECIES, SPECIES_BY_ID } from "../config/species";
import { PLOT_DEFS, checkUnlock, contextFrom, type UnlockContext } from "../config/unlocks";
import { QUEST_CATALOG } from "../quests/catalog";
import { generatedMainQuests } from "../quests/generated";
import { advance as questAdvance, claim as questClaim, emptyQuestSave, questViews as computeQuestViews, repairQuestSave, tracked as questTracked, type QuestContext, type QuestDef, type QuestEvent, type QuestReward, type QuestSave, type QuestView } from "../quests/engine";
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
 * Something the player should be told about, right now.
 *
 * Separate from the render-subscription because a notice has to outlive the
 * re-render it causes — a banner rebuilt from scratch mid-animation reads as a
 * flicker, which is exactly the problem it was meant to solve.
 */
export interface Notice {
  id: number;
  kind: "level" | "unlock" | "quest" | "plot" | "milestone" | "warn";
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
  /**
   * Dedup identity for notices that would otherwise stack.
   *
   * Quest progress ticks once per event, and a burst of actions can tick the same
   * quest several times in a second — five banners saying "928/10000" piled over
   * the garden. Given a key, the HUD refreshes the banner already on screen
   * instead of adding another copy.
   */
  key?: string;
  /**
   * Set when the notice announces an outcome a live ceremony is about to show
   * better — a stage result pushed while its replay is still on screen spoils
   * the ending mid-swing. The UI holds it until the fight card clears, so the
   * banner lands after the result overlay as a receipt rather than a spoiler.
   */
  hold?: boolean;
}

export interface GardenDayState {
  dayKey: string;
  weather: GardenWeather;
  streak: number;
  focus: number;
  /**
   * Template ids drawn in the last few days.
   *
   * Carried forward so the next day can bar them. Kept on the day state rather
   * than recomputed from history because there is no separate day log to read.
   *
   * Kept after the daily-goal system was replaced by the quest shelf: an old save carries it,
   * and dropping the field would mean a migration for data nothing reads.
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
  /**
   * Genome signatures of every plant ever owned, living or consumed.
   *
   * Breeding checks against this — not just the plants still in the garden — so
   * a child can never come out identical to a parent that was spent, which is
   * the duplicate a "không bao giờ trùng" rule actually has to catch. Capped
   * rather than unbounded: the list is a Set's job done in an array so the save
   * stays small, and 4,000 signatures is more garden history than a season
   * produces.
   */
  genomes: string[];
  /**
   * Seeds ever planted, by species.
   *
   * Written in `plantSeed`, never decremented: "trồng n cây X" asks whether the
   * planting happened, and consuming the plant afterwards does not un-plant it.
   * This is also the record the planting quest measures, which is what lets it
   * count plants grown while the quest was still locked.
   */
  planted: Partial<Record<SpeciesId, number>>;
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
  /** The day `exchangedLeaf` was counted on — the same by-date reset as the Ember cap. */
  exchangeDay: string;
  /**
   * LeafCoin-equivalent already poured through the exchange today.
   *
   * Measured on the money *in*, in xu, so the cap means the same thing whichever
   * pair is converted: a day of Ember cash-outs and a day of pollen trades both
   * stop at the same place.
   */
  exchangedLeaf: number;
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
   * The quest shelf: progress on every quest, plus the day's daily roll.
   *
   * The heart of progression. Everything the player is told to do next comes from here, and
   * every reward in it is paid through the same paths a fight or a harvest would use.
   */
  quests: QuestSave;
  /**
   * Every point of experience this account has ever earned.
   *
   * Accumulated rather than derived, because it is a *total*, not a current level: the score
   * achievements ("đạt tổng 10.000 điểm") are about everything done, and no amount of arithmetic
   * on the current level can recover that. Written by the same two methods that pay experience,
   * so it cannot drift from them.
   */
  lifetimeExp: number;
  /**
   * The PvE ladder: how far this player has climbed.
   *
   * Nested because it is one coherent thing with several parts that always travel together -
   * the record, the day the record was set on, and the run of attempts on the stage that
   * stopped them. Flat fields would make `ascent.stage = n` able to leave `ascentDay` pointing
   * at a different day, and the daily escalation would then apply to the wrong stage.
   */
  ascent: AscentState;
  /** Daily check-in (điểm danh). Repaired to a never-claimed default on old saves. */
  checkIn: CheckInState;
  /**
   * Hired-gardener buff expiry (ms epoch). While `Date.now() < autoCareUntil`
   * the store's `autoCareTick` tends the garden for free. Written by the daily
   * check-in and by the rewarded-ad button.
   */
  autoCareUntil: number;
}

/** The attendance book: one row, updated once a day. */
export interface CheckInState {
  /** dayKey of the most recent claim, "" when never claimed. */
  lastDay: string;
  /** Consecutive claimed days ending today or yesterday. */
  streak: number;
  /** Longest streak ever — the number a broken streak still gets to brag about. */
  best: number;
  /** Total days ever claimed, for the lifetime counter on the card. */
  total: number;
}

export function emptyCheckIn(): CheckInState {
  return { lastDay: "", streak: 0, best: 0, total: 0 };
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
export const SEED_PACK_PRICE = 0.05;

/**
 * The price a batch of `count` seeds charges — mirrors `buySeed`, so the
 * picker's "Mua + Trồng" button can show the real total before committing.
 */
export function seedPackPrice(species: SpeciesId, count: number): number {
  const def = SPECIES_BY_ID[species];
  return Math.floor(def.seedPrice * count * (1 - (count >= 10 ? SEED_PACK_PRICE : 0)));
}

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

/** How often the hired gardener walks the rows — one care action per plant per round. */
const AUTO_CARE_TICK_MS = 12_000;
/** The furthest back an offline catch-up replays — a shade over the buff itself. */
const AUTO_CARE_CATCHUP_MS = 16 * 60 * 1000;

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

  /**
   * Nonzero while a stage settle is running.
   *
   * The settle is synchronous and the screen replays it afterwards, so every
   * notice fired inside it — the result banner, quest ticks, level pings —
   * describes an outcome the player has not watched yet. `pushNotice` marks
   * them all `hold`, and the UI keeps those queued until the fight card clears
   * rather than spoiling the ending at the opening bell.
   */
  private settling = 0;

  /** Listen for things worth telling the player about. Returns an unsubscribe. */
  onNotice(fn: (n: Notice) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  private pushNotice(n: Omit<Notice, "id">): void {
    this.noticeSeq++;
    const notice: Notice = { ...n, id: this.noticeSeq, hold: n.hold || this.settling > 0 };
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
      this.saveFailed = false;
    } catch {
      /* Storage refused (quota or private mode): the run stays alive in memory
         but nothing is on disk. Say so once instead of letting the player trust
         a save that silently does not exist — and keep `saveFailed` readable so
         the sync strip can show it too. */
      if (!this.saveFailed) {
        this.saveFailed = true;
        this.pushNotice({
          kind: "warn",
          title: "⚠ Không lưu được trên máy này",
          body: "Bộ nhớ trình duyệt đang chặn ghi. Tiến trình giữ trong phiên này và vẫn đồng bộ cloud nếu đã đăng nhập.",
        });
      }
    }
  }

  /** True once a localStorage write has been refused — progress is RAM-only until it clears. */
  saveFailed = false;

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
    this.creditCurrency("leafCoin", delta, reason);
  }

  private debit(delta: number, reason: string): boolean {
    return this.debitCurrency("leafCoin", delta, reason);
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
    // Plots open in order: buying a later one wholesale would open every plot
    // before it for that single price, which undercuts the whole cost curve.
    if (def.index !== this.state.nurseryCap + 1) return { ok: false, reason: `Mở theo thứ tự — ô kế tiếp là ${this.state.nurseryCap + 1}` };

    const ctx = this.unlockContext();
    const gate = checkUnlock(ctx, def.unlock);
    if (!gate.met) return { ok: false, reason: `Chưa mở khóa: ${gate.summary}` };
    if (!this.debit(def.cost, `Mở ô vườn ${def.index}`)) {
      return { ok: false, reason: `Không đủ ${def.cost.toLocaleString("vi-VN")} xu` };
    }
    this.state.nurseryCap = def.index;
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
    let questClaims = 0;
    for (const e of Object.values(this.state.quests.entries)) {
      if (e.status === "claimed") questClaims++;
    }
    return contextFrom(this.state.plants, this.state.breederLevel, this.state.seeds, this.state.leafCoin, {
      ascentHighest: this.state.ascent.highest,
      battleCount: this.state.discovery.battles,
      breedCount: this.state.discovery.breeds,
      questClaims,
      elementCount: this.state.discovery.elements.length,
    });
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
    /* A NaN would poison the balance into "NaN xu" forever; a negative credit is
       a debit that skipped the affordability check. Neither is a payment. */
    if (!Number.isFinite(delta) || delta <= 0) return;
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
    /* A non-positive or non-finite "price" must not debit at all — `0 < -5` is
       false, so a negative delta would otherwise add money instead of taking it. */
    if (!Number.isFinite(delta) || delta < 0) return false;
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
   * LeafCoin-equivalent still convertible today.
   *
   * Same by-date reset as `emberLeftToday`, for the same reason: closing the game
   * must not hand out a fresh allowance. Read through here because the shop tab's
   * printed number and the debit both have to agree on what "còn lại" means.
   */
  exchangeAllowanceLeft(): number {
    const today = dayKey(Date.now());
    if (this.state.exchangeDay !== today) {
      this.state.exchangeDay = today;
      this.state.exchangedLeaf = 0;
    }
    return Math.max(0, EXCHANGE_DAILY_CAP - this.state.exchangedLeaf);
  }

  /**
   * Đổi `amountIn` của `from` sang `to`, theo bảng tỉ giá trong economy/exchange.
   *
   * Đây là đường quy đổi duy nhất — mua hạt hay ô đất bằng tiền khác đi qua đây,
   * nên phí, tỉ giá và hạn mức ngày chỉ tồn tại một bản. Từ chối thay vì đi quá:
   * hai hạch toán ledger (trừ `from`, cộng `to`) chỉ ghi khi mọi điều kiện đã qua,
   * để "đổi lúc 23:59 hết hạn mức" không bao giờ là một lệnh nửa chừng.
   */
  exchangeCurrency(from: CurrencyId, to: CurrencyId, amountIn: number): { ok: boolean; reason?: string; out?: number } {
    if (!CURRENCY_IDS.includes(from) || !CURRENCY_IDS.includes(to)) {
      return { ok: false, reason: "Loại tiền không hợp lệ" };
    }
    if (from === to) return { ok: false, reason: "Chọn hai loại tiền khác nhau" };
    if (to === "ember") {
      return { ok: false, reason: "Mảnh lửa không đổi được — chỉ kiếm từ chiến đấu" };
    }
    const quote = quoteExchange(from, to, amountIn);
    if (!quote) return { ok: false, reason: "Số lượng không hợp lệ" };
    if (quote.out < 1) return { ok: false, reason: "Số tiền quá nhỏ — đổi được 0" };
    if (this.state[from] < amountIn) {
      return {
        ok: false,
        reason: `${shortOf(from)} — đang có ${currencyInfo(from).icon}${GameStore.say(this.state[from])}`,
      };
    }
    const left = this.exchangeAllowanceLeft();
    if (quote.leafIn > left) {
      return {
        ok: false,
        reason: `Vượt hạn mức quy đổi hôm nay — còn đổi được ~${GameStore.say(left)}🪙 giá trị`,
      };
    }
    // Balance was checked above; a failed debit here would mean the state moved
    // between the check and the write, which single-threaded calls cannot do.
    if (!this.debitCurrency(from, amountIn, `Đổi sang ${currencyName(to)}`)) {
      return { ok: false, reason: shortOf(from) };
    }
    this.state.exchangedLeaf += quote.leafIn;
    this.creditCurrency(to, quote.out, `Đổi từ ${currencyName(from)}`);
    this.commit("exchange");
    return { ok: true, out: quote.out };
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
    if (!def) return { ok: false, reason: "Hạt không tồn tại" };
    /* A negative or fractional count prices itself negative, which makes
       debitCurrency pay *in* — the shop would hand out coins and take seeds
       below zero. Only whole, positive purchases exist. */
    if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "Số lượng không hợp lệ" };
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
    const price = seedPackPrice(species, count);
    if (!this.debitCurrency(currency, price, `Mua ${count} hạt ${def.name}`)) {
      return {
        ok: false,
        reason: `${shortOf(currency)} — cần ${currencyInfo(currency).icon}${GameStore.say(price)} (đang có ${currencyInfo(currency).icon}${GameStore.say(this.state[currency])})`,
      };
    }
    this.state.seeds[species] = (this.state.seeds[species] ?? 0) + count;
    /*
     * Buying seeds is collecting items, and it is also the moment a species becomes yours.
     *
     * `skill_unlocked` is emitted only for a species whose gate had just opened, which is the
     * event a "mở khoá một loài" quest would listen to. Emitting it on every purchase would make
     * it a synonym for "buy a seed", which is a different and worse thing to measure.
     */
    this.questEvent({ name: "item_collected", amount: count, species: [species] });
    if (!def.unlock) this.questEvent({ name: "skill_unlocked", amount: 1, species: [species] });
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
    this.state.discovery.planted[species] = (this.state.discovery.planted[species] ?? 0) + 1;
    this.questEvent({ name: "plant", amount: 1, species: [species] });
    this.commit("plantSeed");
    return { ok: true, plantId: plant.plantId };
  }

  /**
   * Plant several seeds of the same species in one shot.
   *
   * One commit for the whole batch rather than one per seed: the picker lets a
   * player fill every empty plot with the same seed, and N commits would push N
   * saves to the cloud-queue debounce and N redundant re-renders.
   *
   * Plants as many as fit: if the bag or the nursery runs out partway through,
   * what got planted stays planted and the count planted is what came back —
   * "gieo hết chỗ trống" is the gesture, not "gieo đúng N hoặc không gì".
   */
  plantSeeds(species: SpeciesId, count: number): { ok: boolean; reason?: string; plantIds: string[] } {
    if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "Số lượng không hợp lệ", plantIds: [] };
    if ((this.state.seeds[species] ?? 0) <= 0) return { ok: false, reason: "Không có hạt này", plantIds: [] };
    if (this.state.plants.length >= this.state.nurseryCap) return { ok: false, reason: "Vườn đã đầy", plantIds: [] };
    const n = Math.min(count, this.state.seeds[species] ?? 0, this.state.nurseryCap - this.state.plants.length);
    const plantIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const plant = createSeedPlant(species, this.state.playerId, seedToken(Date.now(), i, Math.random()), Date.now());
      plant.economy.purchaseCost = SPECIES_BY_ID[species].seedPrice;
      this.state.plants.push(plant);
      plantIds.push(plant.plantId);
      this.recordPlantDiscovery(plant);
      this.state.discovery.planted[species] = (this.state.discovery.planted[species] ?? 0) + 1;
    }
    this.state.seeds[species] = (this.state.seeds[species] ?? 0) - n;
    this.questEvent({ name: "plant", amount: n, species: [species] });
    this.commit("plantSeed");
    return { ok: true, plantIds };
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
    this.questEvent({ name: "care", amount: 1 });
    // Nectar, from tending. Paid on every action without exception, which is what makes
    // this currency a floor rather than a goal: a player who does nothing but tend can
    // always eventually reach the tier-2 shelf.
    this.creditCurrency("nectar", NECTAR_PER_CARE, `Chăm cây: ${action}`);
    this.tryCareCombo(plant);
    this.commit("care");
    return { ok: true, result: res, plant };
  }

  // --- the hired gardener (auto-care) ---------------------------------

  /** Actions the gardener may perform — cheap and safe: no gene serum or
   *  moonlight, because an unattended helper must never gamble with mutation
   *  debt. Ordered so watering, the thing players ask for most, is tried first. */
  private static readonly AUTO_ROTATION: readonly CareActionId[] = ["water", "sunlight", "fertilizer", "music", "pruning"];

  /** Milliseconds of gardener time left. */
  autoCareLeft(now = Date.now()): number {
    return Math.max(0, (this.state.autoCareUntil ?? 0) - now);
  }

  /**
   * Hire the gardener for `ms` more — stacking on top of whatever is left, so
   * a check-in claimed while an ad-bought buff still runs is never wasted.
   * Capped at one day so a bug in a caller cannot hand out infinite buff.
   */
  grantAutoCare(ms: number, now = Date.now()) {
    const base = Math.max(now, this.state.autoCareUntil ?? 0);
    this.state.autoCareUntil = Math.min(base + ms, now + 24 * 60 * 60 * 1000);
    this.commit("autocare");
  }

  /**
   * One round of automated tending at time `now`.
   *
   * Each plant gets at most one action per call: the rotation is tried in
   * order and the first action the engine accepts lands. Cooldowns, the shared
   * rest, stress and the 24h anti-spam memory all apply exactly as they do to
   * a human tap — the gardener is free of *resources*, not of horticulture.
   * Returns how many actions actually ran, so the caller can skip a repaint
   * and a save on an idle round.
   */
  autoCareTick(now = Date.now()): number {
    if (now >= (this.state.autoCareUntil ?? 0)) return 0;
    let did = 0;
    for (const plant of this.state.plants) {
      if (plant.locks.battle) continue; // mid-fight: no touching the fighter
      const start = plant.economy.careCycles % GameStore.AUTO_ROTATION.length;
      for (let i = 0; i < GameStore.AUTO_ROTATION.length; i++) {
        const action = GameStore.AUTO_ROTATION[(start + i) % GameStore.AUTO_ROTATION.length];
        // Abundant virtual resources: the gardener brings their own watering
        // can. applyCare still enforces cooldowns, rest, stress and memory.
        const res = applyCare(plant, action, now, { items: 1e9, geneCrystal: 1e9, leafCoin: 1e9 });
        if (res.ok) {
          plant.powerRating = Math.round(estimatePower(plant));
          plant.validation = validateGenome(plant);
          did++;
          break;
        }
      }
    }
    if (did) this.commit("autocare");
    return did;
  }

  /**
   * Simulate the rounds that ran while the app was closed.
   *
   * The buff does not stop when the tab does — that is the whole point of a
   * hired gardener. Replay one tick per interval from `from` until now (or
   * the buff's end), so a player who watched an ad and closed the laptop still
   * finds their fifteen minutes worth of watering done.
   */
  autoCareCatchUp(from: number, now = Date.now()): number {
    const until = Math.min(now, this.state.autoCareUntil ?? 0);
    let did = 0;
    // ~150 rounds covers a 15-minute buff with headroom; the loop also stops
    // the moment the simulated clock passes the expiry.
    for (let t = Math.max(from, until - AUTO_CARE_CATCHUP_MS); t <= until; t += AUTO_CARE_TICK_MS) {
      did += this.autoCareTick(t);
    }
    return did;
  }

  // --- daily check-in (điểm danh) -------------------------------------

  /**
   * Where the attendance book stands this morning — and what claiming today
   * would continue. `claimStreak` is the streak *after* today's claim, which
   * is the number the gift table reads.
   */
  checkInStatus(now = Date.now()): { claimed: boolean; streak: number; claimStreak: number; dayInCycle: number; milestone: boolean } {
    const today = dayKey(now);
    const ci = this.state.checkIn;
    const claimed = ci.lastDay === today;
    const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
    const claimStreak = claimed ? ci.streak : ci.lastDay === yesterday ? ci.streak + 1 : 1;
    const cyc = dayInCycle(claimStreak);
    return { claimed, streak: ci.streak, claimStreak, dayInCycle: cyc, milestone: isMilestone(cyc) };
  }

  /**
   * Claim today's gift.
   *
   * Pays every line through the same creditCurrency/items/seeds paths a quest
   * or a purchase uses, so the ledger reads truthfully. The gardener minutes
   * stack onto any buff still running.
   */
  claimCheckIn(now = Date.now()): { ok: boolean; reason?: string; gift?: CheckInGift } {
    const today = dayKey(now);
    const status = this.checkInStatus(now);
    if (status.claimed) return { ok: false, reason: "Hôm nay đã điểm danh rồi" };

    const gift = giftFor(this.state.playerId, today, status.claimStreak);
    const ci = this.state.checkIn;
    ci.lastDay = today;
    ci.streak = status.claimStreak;
    ci.best = Math.max(ci.best, ci.streak);
    ci.total += 1;

    for (const line of gift.lines) {
      if (line.kind === "autocare") {
        this.grantAutoCare(AUTO_CARE_MS, now);
      } else if (line.kind === "currency" && line.currency) {
        this.creditCurrency(line.currency, line.amount, `Điểm danh ngày ${ci.streak}`);
      } else if (line.kind === "items") {
        this.state.items += line.amount;
        this.state.ledger.push({ at: now, delta: line.amount, reason: `Điểm danh: vật tư` });
      } else if (line.kind === "crystal") {
        this.state.geneCrystal += line.amount;
        this.state.ledger.push({ at: now, delta: line.amount, reason: `Điểm danh: GeneCrystal` });
      } else if (line.kind === "seed" && line.species) {
        this.state.seeds[line.species] = (this.state.seeds[line.species] ?? 0) + line.amount;
        addUnique(this.state.discovery.species, line.species);
        this.state.ledger.push({ at: now, delta: line.amount, reason: `Điểm danh: hạt ${line.species}` });
      }
    }
    this.commit("checkin");
    return { ok: true, gift };
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
    /* A live fight holds `locks.battle`. Breeding spends the parent, and spending a
       fighter mid-fight would leave the running battle writing rewards to a plant
       the garden no longer owns. */
    if (a.locks.battle || b.locks.battle) return { ok: false, reason: "Cây đang trong trận đấu" };
    // Breeding spends both parents: the garden goes in at N and comes out at
    // N-1, so a full garden can still breed — fusion frees a plot, it does not
    // need one. Refusing here would force a pointless sell first.
    if (this.state.plants.length - 1 > this.state.nurseryCap) return { ok: false, reason: "Vườn đã đầy" };
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
    const existingSigs = new Set<string>(this.state.discovery.genomes);
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
    /* "Một phần XP bố mẹ" means a part of what they actually earned — 30% of
       both parents' LIFETIME xp, not a number guessed from the current level.
       A pair of level-30s passes down noticeably more than a pair of 5s. */
    const lifetimeXpOf = (p: Plant): number => {
      let total = p.growth.xp;
      for (let l = 1; l < p.growth.level; l++) total += xpRequired(l);
      return total;
    };
    const inheritedXp = Math.floor(0.3 * (lifetimeXpOf(a) + lifetimeXpOf(b)));
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
    // The child's lineage and generation ride the event: a "lai được thế hệ N" quest is a
    // measurement, and a "trồng dòng X" quest should count a bred descendant too.
    this.questEvent({ name: "breed", amount: 1, species: result.plant.baseLineage, value: result.plant.generation });
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
  // A non-finite grant would floor to NaN inside gainXp and poison growth.xp and
  // lifetimeExp in one shot — and a negative one would print "-50 EXP" on a
  // level-up receipt. Neither is a gain; refuse both before anything moves.
  const granted = Number.isFinite(xp) ? Math.max(0, Math.round(xp)) : 0;
  const levels = gainXp(plant, granted);
  // The lifetime total, so a quest or an achievement that measures everything earned is not
  // restricted to what happens to be sitting in the current bar.
  this.state.lifetimeExp += granted;
  this.questEvent({ name: "exp_gained", amount: granted });
  // The grant is passed on because this is the only place that knows it. `gainXp` reports
  // how many levels were crossed and says nothing about experience, and the celebration
  // prints "+N EXP" — so with nothing to print it fell back to "đã lên cấp", which is the
  // receipt with the number the player just earned removed from it.
  if (levels > 0) this.announcePlantLevelUp(plant, levels, granted);
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
  /* Each level crossed pays its own chunk — a +4-level burst earned four
     payouts, not one priced at the landing level. Batching and drip-feeding
     the same xp must pay the same breeder xp. */
  let gained = 0;
  for (let l = plant.growth.level - levels + 1; l <= plant.growth.level; l++) {
    gained += breederXpForPlantLevel(l);
  }
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

  /**
   * The player's own display name — the one the leaderboard, room joins and
   * friend invites all read out of the save.
   *
   * Trimmed and capped at 24 chars, matching what the Worker keeps. A no-op on an
   * unchanged name so an identity sync at sign-in does not write a save for
   * nothing.
   */
  renamePlayer(name: string): void {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed || trimmed === this.state.name) return;
    this.state.name = trimmed;
    this.commit("renamePlayer");
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
    /**
     * The fighter as it was when the bell rang, so the replay fights the same plant.
     *
     * Returned rather than letting the screen re-read the live plant, because the settle
     * has already paid out by the time the replay mounts — skill XP has strengthened the
     * skills and plant XP has lifted the level. `snapshotFromPlant` reads those fields,
     * so a replay built from the post-settle object is a different fight: same seed,
     * different log, and the watched ending can disagree with the recorded one.
     */
    replayAs?: Plant;
    /**
     * Which sub-objectives were met, and the bonus they paid.
     *
     * Returned rather than recomputed by the screen, for the reason every receipt in this
     * store is: two sources of truth for a payout means the receipt and the ledger can
     * disagree, and a receipt that under-reports what it just paid is worse than no receipt.
     */
    objectives?: ObjectiveOutcome;
  } {
    const me = this.get(plantId);
    if (!me) return { ok: false, reason: "Không tìm thấy cây" };
    if (me.growth.stage !== "mature" && me.growth.stage !== "awakened") {
      return { ok: false, reason: "Cây chưa trưởng thành" };
    }
    const ascent = this.ascentToday();
    if (stage <= ascent.highest) {
      /* Cleared stages never reopen — replaying them was the one way to grow
         without planting or breeding, which is the shortcut this rule removes. */
      return { ok: false, reason: `Ải ${stage} đã vượt rồi — thang chỉ đi lên.` };
    }
    if (!stageIsOpen(stage, ascent.highest)) {
      return { ok: false, reason: `Ải ${stage} chưa mở. Hãy vượt ải ${ascent.highest + 1} trước.` };
    }
    if (me.powerRating < minFighterPower(stage, this.ascentDayIndex())) {
      return { ok: false, reason: `Cây quá yếu cho ải ${stage} — hãy chăm, lên cấp hoặc lai giống mạnh hơn rồi quay lại.` };
    }

    /*
     * Milestone stages carry an entry condition — a growth level on bosses, an element
     * on trial stages, a generation on the bred-plant beats. Enforced here rather than
     * only on the button, because the store is the one place every entry path (screen,
     * test, future client) has to pass through.
     */
    const gateFail = gateCheck(me, stageGate(stage));
    if (!gateFail.ok) return { ok: false, reason: gateFail.reason };

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
    /*
     * The fighter, frozen the way the bell will see it.
     *
     * The settle below pays out before the screen replays the fight — skill XP
     * raises `skill.power` and shortens `cooldown`, plant XP lifts the level —
     * and every one of those writes lands on the same live `me` the replay
     * snapshots. A replay that fights with post-reward skills is a different
     * fight: same seed, different event log, and a plant can "die" on screen in
     * a fight the store recorded as a win. The clone is returned so the view
     * replays the fighter the settle actually used.
     */
    const fighterAsSettled: Plant = {
      ...me,
      stats: { ...me.stats },
      skills: me.skills.map((s) => ({ ...s })),
      growth: { ...me.growth },
    };
    const result = simulateBattle(fighterAsSettled, monster.plant, {
      seed,
      maxSeconds: 90,
      arena: "sunny",
    });
    const won = result.winner === "a";

    /* From here to the return is the settle: rewards paid, quests ticked, the
       result banner pushed. The screen replays the fight after this returns,
       so everything announced in this block is marked `hold` (see `settling`)
       and the UI queues it until the replay is over.
       The locals are hoisted so the receipt can return them once `settling`
       has unwound. */
    const attempt = won ? 0 : ascent.attempts;
    // A stage at or below the record has already paid its full reward once. Replaying it is for
    // practice and for a better attempt, not for farming the same payout ahead of the next band.
    const alreadyCleared = stage <= ascent.highest;
    const reward = stageReward(stage, won, attempt, alreadyCleared);
    let drops: DropRoll[] = [];
    let nextUnlocked: number | undefined;
    let objectives: ObjectiveOutcome | null = null;
    this.settling++;
    try {

      this.credit(reward.leafCoin, won ? `Vượt ải ${stage}` : `Thử ải ${stage}`);
      for (const id of ["nectar", "pollen"] as const) {
        const amount = reward[id];
        if (amount > 0) this.creditCurrency(id, amount, `Vượt ải ${stage}`);
      }
      if (reward.geneCrystal > 0) this.state.geneCrystal += reward.geneCrystal;
      this.state.items += reward.items;

      // The arena's own drop table, so the odds it prints and the odds it pays are one thing.
      drops = won ? this.awardDrops("win") : [];
      // Ladder-only extra: Pollen and Nectar on top of the table, never Ember, because Ember
      // already has a daily cap in `drops.ts` and a second source would quietly break it.
      const extra = stageExtraDrop(stage, won);
      if (extra) {
        this.creditCurrency(extra.currency, extra.amount, `Vượt ải ${stage}`);
      }

      /*
       * Sub-objectives, scored off the log this fight just produced.
       *
       * Read from `result.events` rather than from any live state, because the session is
       * finished by now and the log is the only record of what happened. Paid on top of the
       * stage's own experience, and to the breeder as well — a clean fast fight should move
       * both progressions, or the ladder's bonus work would only ever advance one of them.
       */
      objectives = won ? evaluateObjectives(stage, objectiveContext(true, result)) : null;
      const bonusPlantXp = objectives?.bonusPlantXp ?? 0;
      if (bonusPlantXp > 0) this.addPlantXp(me, bonusPlantXp);
      const bonusBreederXp = objectives?.bonusBreederXp ?? 0;
      if (bonusBreederXp > 0) this.addBreederXp(bonusBreederXp);

      const levels = this.addPlantXp(me, reward.plantXp);
      for (const s of me.skills) addSkillXp(s, won ? 12 : 4);

      me.battleRecord.wins += won ? 1 : 0;
      me.battleRecord.losses += won ? 0 : 1;
      this.state.discovery.battles++;

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

      /*
       * The ladder's quest events, emitted where the fight was actually settled.
       *
       * A win is three separate facts — a stage was cleared, an enemy was defeated, and a combo
       * was run — and each is a different quest. The replay flag is carried so "luyện lại ải cũ"
       * can tell a first clear from a repeat without the quest needing to know the ladder's rules.
       */
      if (won) {
        this.questEvent({ name: "stage_completed", stage, boss: isBossStage(stage), replay: alreadyCleared, species: me.baseLineage });
        this.questEvent({ name: "enemy_defeated", amount: 1, species: me.baseLineage });
        const combo = readCombo(result.events, "a").best;
        if (combo >= 2) this.questEvent({ name: "combo_reached", value: combo });
      } else {
        this.questEvent({ name: "stage_failed", stage, species: me.baseLineage });
      }
      this.commit("ascent");
      this.pushNotice({
        kind: "level",
        title: won ? `🏆 Vượt ải ${stage}: thắng` : `Ải ${stage}: thua`,
        body: `${monster.name} · +${reward.leafCoin} 🪙` + (levels > 0 ? ` · ${me.name} lên ${levels} cấp` : ""),
      });
    } finally {
      this.settling--;
    }

    return { ok: true, result, won, monster, reward, drops, nextUnlocked, seed, replayAs: fighterAsSettled, objectives: objectives ?? undefined };
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
    // A quick battle is not a ladder stage, so it counts as an enemy defeated and nothing else.
    // Folding it into `stage_completed` would let a player farm the ladder quests in the arena.
    if (won) this.questEvent({ name: "enemy_defeated", amount: 1, species: me.baseLineage });
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
    // The lifetime total, so the score achievements measure everything ever earned rather than
    // the current level's leftovers.
    this.state.lifetimeExp += Math.max(0, Math.round(amount));
    this.questEvent({ name: "exp_gained", amount: Math.max(0, Math.round(amount)) });

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
    if (this.state.breederLevel > levelBefore) {
      this.questEvent({ name: "level_up", value: this.state.breederLevel, amount: crossed.length });
    }
    this.commit("addBreederXp");
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

  private recordPlantDiscovery(plant: Plant) {
    for (const species of plant.baseLineage) addUnique(this.state.discovery.species, species);
    addUnique(this.state.discovery.genomes, genomeSignature(plant));
    // The oldest signatures are the least likely to collide anyway — breeding
    // drifts away from them with every generation — so the cap drops history
    // rather than refusing to record new plants.
    if (this.state.discovery.genomes.length > 4000) {
      this.state.discovery.genomes.splice(0, this.state.discovery.genomes.length - 4000);
    }
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

  // --- quests -------------------------------------------------------------
  //
  // The whole progression system. Gameplay does not touch a quest: it calls `questEvent` with
  // what happened, and the engine decides which quests that moves. Adding a quest means adding a
  // definition in `quests/catalog.ts`, not editing the six screens that happen to cause it.

  /**
   * Everything a quest's conditions are judged against, read from the save right now.
   *
   * Recomputed on every call rather than cached: a cached context is a second copy of the
   * player's progress, and the whole reason the old systems drifted is that they each kept one.
   */
  private questContext(): QuestContext {
    let speciesCount = 0;
    for (const n of Object.values(this.state.seeds)) if ((n ?? 0) > 0) speciesCount++;
    const claimed = new Set<string>();
    for (const [id, entry] of Object.entries(this.state.quests.entries)) {
      if (entry.status === "claimed") claimed.add(id);
    }
    /*
     * The measures the quests read live. Care and wins-by-lineage are summed over
     * the plants still standing — a spent plant's history is gone, which is the
     * honest lower bound the save can offer; `discovery.planted` is the one that
     * survives, because it is written rather than derived.
     */
    let cares = 0;
    const lineageWins: Record<string, number> = {};
    for (const p of this.state.plants) {
      for (const n of Object.values(p.careMemory.counts)) cares += n ?? 0;
      for (const sp of p.baseLineage) lineageWins[sp] = (lineageWins[sp] ?? 0) + (p.battleRecord.wins || 0);
    }
    return {
      level: this.state.breederLevel,
      highestStage: this.state.ascent.highest,
      stagesCleared: this.state.ascent.cleared,
      speciesCount,
      wins: this.state.plants.reduce((a, p) => a + p.battleRecord.wins, 0),
      score: this.state.lifetimeExp,
      claimed,
      day: dayKey(Date.now()),
      playerId: this.state.playerId,
      seeds: this.state.seeds,
      discovered: new Set<string>(this.state.discovery.species),
      planted: this.state.discovery.planted,
      breeds: this.state.discovery.breeds,
      cares,
      lineageWins,
    };
  }

  /**
   * The fixed catalogue plus the generated main chain.
   *
   * The generated half is a pure function of the save and the context — same inputs, same
   * quests — so rebuilding it on every call is what keeps the chain's species pinned to
   * the entry that already exists instead of drifting under the player.
   */
  private questCatalog(): QuestDef[] {
    const ctx = this.questContext();
    // One unlock context for the whole pick: the generator probes the registry for a
    // species whose shop gate is already met, and rebuilding the context per candidate
    // would make "what is my next quest" cost a full sweep per event.
    const unlockCtx = this.unlockContext();
    const isOpen = (id: SpeciesId) => checkUnlock(unlockCtx, SPECIES_BY_ID[id]?.unlock).met;
    return [...QUEST_CATALOG, ...generatedMainQuests(this.state.quests, ctx, isOpen)];
  }

  /** Every quest, resolved for the UI. Syncs first, so a new quest appears without a migration. */
  questViews(): QuestView[] {
    return computeQuestViews(this.state.quests, this.questContext(), this.questCatalog());
  }

  /** The main quest to track, plus a couple of optional ones worth showing beside it. */
  questTracker(): { main: QuestView | null; extras: QuestView[] } {
    return questTracked(this.questViews());
  }

  /** How many quests have a reward waiting. What the HUD badge counts. */
  questClaimableCount(): number {
    let n = 0;
    for (const v of this.questViews()) if (v.status === "completed") n++;
    return n;
  }

  /**
   * Tell the quest system that something happened.
   *
   * The single entry point. Every call site below is inside the store's own action — planting,
   * caring, breeding, settling a stage — so no screen can advance a quest, and no quest can be
   * advanced twice by two screens that both noticed the same thing.
   */
  questEvent(ev: QuestEvent): void {
    const catalog = this.questCatalog();
    const result = questAdvance(this.state.quests, this.questContext(), catalog, ev);
    if (result.changed.length === 0 && result.completed.length === 0) return;
    this.state.quests = result.save;
    for (const c of result.changed) {
      if (result.completed.includes(c.id)) continue; // announced below, and once
      const def = catalog.find((q) => q.id === c.id);
      this.pushNotice({ kind: "quest", title: def?.title ?? c.id, body: `${c.progress}/${c.target}`, key: `quest:${c.id}` });
    }
    for (const id of result.completed) {
      const def = catalog.find((q) => q.id === id);
      this.pushNotice({ kind: "quest", title: "Hoàn thành nhiệm vụ!", body: def?.title ?? id, key: `quest-done:${id}` });
    }
    this.commit("quest");
  }

  /**
   * Take a finished quest's reward.
   *
   * Every part of it goes through the path the rest of the game uses: experience through
   * `addPlantXp`/`addBreederXp` (so a level-up fires and celebrates for real), coins through
   * `credit` (so the ledger records it), items and crystals into the same fields the shop reads.
   * A reward that only moved a number in the quest panel would be the "UI giả" the brief warns
   * about.
   */
  claimQuest(id: string): { ok: boolean; reason?: string; title?: string; levels?: number; rewards?: QuestReward } {
    const result = questClaim(this.state.quests, this.questContext(), this.questCatalog(), id);
    if (!result.ok || !result.def) return { ok: false, reason: result.reason };
    const def = result.def;
    const r = def.rewards;
    this.state.quests = result.save;

    let levels = 0;
    if (r.exp) {
      const fighter = this.bestFighter();
      if (fighter) levels = this.addPlantXp(fighter, r.exp);
      else {
        this.state.lifetimeExp += r.exp;
        this.questEvent({ name: "exp_gained", amount: r.exp });
      }
    }
    if (r.breederXp) this.addBreederXp(r.breederXp);
    if (r.coins) this.credit(r.coins, `Nhiệm vụ: ${def.title}`);
    if (r.items) this.state.items += r.items;
    if (r.geneCrystal) this.state.geneCrystal += r.geneCrystal;

    // Emitted after the payment so a future "claim N quests" quest sees it. It cannot advance
    // the quest just claimed: that one is already `claimed`, and `advance` only touches `active`.
    this.questEvent({ name: "reward_claimed", amount: 1 });
    this.commit("claimQuest");
    return { ok: true, title: def.title, levels, rewards: r };
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
        /*
         * Structural triage before any repair below touches a field.
         *
         * A plant without dna/stats/growth cannot be grown, cared for, battled or
         * drawn — one truncated entry used to throw inside the repair loop and take
         * the whole garden down with it. What is merely missing gets a default;
         * what is unreadable gets dropped, and the rest of the garden survives.
         */
        parsed.plants = parsed.plants.filter(
          (pl): pl is Plant => !!pl && typeof pl === "object" && !!pl.dna && !!pl.stats && !!pl.growth,
        );
        if (typeof parsed.seeds !== "object" || parsed.seeds === null || Array.isArray(parsed.seeds)) parsed.seeds = {};
        if (!Number.isFinite(parsed.items)) parsed.items = 0;
        if (!Number.isFinite(parsed.geneCrystal)) parsed.geneCrystal = 0;
        if (!Number.isFinite(parsed.inventoryCap) || (parsed.inventoryCap as number) < 1) parsed.inventoryCap = 60;
        if (!Number.isFinite(parsed.nurseryCap) || (parsed.nurseryCap as number) < 1) parsed.nurseryCap = 6;
        if (!Number.isFinite(parsed.breederLevel) || (parsed.breederLevel as number) < 1) parsed.breederLevel = 1;
        if (!Number.isFinite(parsed.breederXp)) parsed.breederXp = 0;
        if (!Array.isArray(parsed.ledger)) parsed.ledger = [];
        if (!Array.isArray(parsed.seenGenes)) parsed.seenGenes = [];
        if (typeof parsed.playerId !== "string" || !parsed.playerId) parsed.playerId = `pl_${seedToken("player", Date.now(), Math.random())}`;
        if (typeof parsed.name !== "string" || !parsed.name) parsed.name = DEFAULT_PLAYER_NAME;
        if (!Number.isFinite(parsed.createdAt)) parsed.createdAt = Date.now();
        if (!Number.isFinite(parsed.lastSeen)) parsed.lastSeen = Date.now();
        for (const pl of parsed.plants) {
          pl.dna.elementGenes = pl.dna.elementGenes ?? ({} as Plant["dna"]["elementGenes"]);
          pl.dna.statGenes = pl.dna.statGenes ?? ({} as Plant["dna"]["statGenes"]);
          pl.dna.skillGenes = pl.dna.skillGenes ?? ({} as Plant["dna"]["skillGenes"]);
          pl.dna.mutationGenes = pl.dna.mutationGenes ?? ({} as Plant["dna"]["mutationGenes"]);
          pl.baseLineage = Array.isArray(pl.baseLineage) ? pl.baseLineage : [];
          pl.careMemory = { recent: [], counts: {}, lastUse: {}, lastAction: null, ...(pl.careMemory as Partial<Plant["careMemory"]> | undefined) };
          pl.stress = pl.stress ?? {};
          pl.locks = { favorite: false, manual: false, battle: false, breeding: false, transaction: false, ...(pl.locks as Partial<Plant["locks"]> | undefined) };
          /* Battle/breeding/transaction locks describe an operation that was live
             when the save was written — a reload means it is over, whatever the
             save says. Keeping a saved `battle: true` would lock the plant out of
             selling and breeding forever. `manual`/`favorite` are the player's
             choice and persist. */
          pl.locks.battle = false;
          pl.locks.breeding = false;
          pl.locks.transaction = false;
          pl.economy = { purchaseCost: 0, investedMaterialValue: 0, careCycles: 0, expectedSellPrice: 0, ...(pl.economy as Partial<Plant["economy"]> | undefined) };
          pl.growthStats = { growthRate: 0.5, careEfficiency: 0.5, mutationChance: 0.05, breedingPower: 0.4, stability: 0.8, ...(pl.growthStats as Partial<Plant["growthStats"]> | undefined) };
          pl.hidden = { temperament: 0.5, wildness: 0.5, genePurity: 0.5, latentPower: 0.5, mutationDebt: 0, ...(pl.hidden as Partial<Plant["hidden"]> | undefined) };
          pl.traits = Array.isArray(pl.traits) ? pl.traits : [];
          pl.mutations = Array.isArray(pl.mutations) ? pl.mutations : [];
          pl.skills = Array.isArray(pl.skills) ? pl.skills : [];
          pl.parents = pl.parents ?? { a: null, b: null };
          pl.potential = pl.potential ?? {};
          /* Saves written while crit/evasion caps were stored ×100 carry caps
             like `20` next to a `0.16` stat — every cap check compared numbers a
             hundred-fold apart and never bound. Divide them back into the
             stat's own unit. */
          for (const g of ["crit", "evasion"] as const) {
            const pot = pl.potential[g] as { softCap: number; hardCap: number } | undefined;
            if (pot && Number.isFinite(pot.hardCap) && pot.hardCap > 1) {
              pot.softCap = round2(pot.softCap / 100);
              pot.hardCap = round2(pot.hardCap / 100);
            }
          }
          /* An unrecognised mood crashes every care preview (`mood.gain` on
             undefined). Anything outside MOOD_EFFECTS falls back to calm. */
          pl.mood = typeof pl.mood === "string" && pl.mood in MOOD_EFFECTS ? pl.mood : "calm";
          /* Same shape for archetype: a missing or malformed vector crashed
             `Object.keys(...).map` inside the mutation roll. Merge over the
             zeroed default so partial saves keep what they had. */
          pl.archetype = pl.archetype && typeof pl.archetype === "object" && !Array.isArray(pl.archetype)
            ? { ...emptyArchetype(), ...(pl.archetype as Partial<Plant["archetype"]>) }
            : emptyArchetype();
          pl.growth.stage = STAGE_ORDER.includes(pl.growth.stage) ? pl.growth.stage : "seed";
          if (!Number.isFinite(pl.growth.stageStartedAt)) pl.growth.stageStartedAt = Date.now();
          if (!Number.isFinite(pl.growth.stageReadyAt)) pl.growth.stageReadyAt = pl.growth.stageStartedAt + STAGE_SECONDS[pl.growth.stage] * 1000;
          if (!Number.isFinite(pl.growth.level) || pl.growth.level < 1) pl.growth.level = 1;
          if (!Number.isFinite(pl.growth.xp)) pl.growth.xp = 0;
          /* A NaN in a stat propagates into power, sell price and every care
             preview — clamp it to 0 here rather than print NaN in the HUD. */
          for (const [k, v] of Object.entries(pl.stats)) {
            if (!Number.isFinite(v)) (pl.stats as unknown as Record<string, number>)[k] = 0;
          }
          if (!Number.isFinite(pl.powerRating)) pl.powerRating = 0;
          if (!Number.isFinite(pl.rarityScore)) pl.rarityScore = 0;
        }
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
        // The exchange cap is the same shape as the Ember cap: a date plus a counter,
        // repaired to "today, nothing spent" when an old save lacks it.
        parsed.exchangeDay = typeof parsed.exchangeDay === "string" ? parsed.exchangeDay : dayKey(Date.now());
        parsed.exchangedLeaf = Number.isFinite(parsed.exchangedLeaf) ? parsed.exchangedLeaf : 0;
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
        // Whether the save already knows its planting history decides if the plants
        // loop below may backfill `planted` from the living garden.
        const plantedWasRecorded = !!parsed.discovery && typeof parsed.discovery.planted === "object" && parsed.discovery.planted !== null;
        parsed.discovery = repairDiscovery(parsed.discovery);
        /*
         * The quest shelf.
         *
         * Repaired rather than required, so a save written before quests existed simply gains an
         * empty shelf. Progress is *not* back-filled here: `syncQuests` seeds every measurable
         * quest from the state it measures, so a returning player with ten stages cleared sees
         * "vượt 10 ải" already complete the first time the panel opens, without a migration that
         * would have to guess what the old systems had recorded.
         */
        parsed.quests = repairQuestSave(parsed.quests, dayKey(Date.now()));
        /*
         * Check-in + the gardener buff. A save written before điểm danh has no
         * book at all — a fresh one starts at never-claimed, which is also what
         * a broken streak looks like, so the repair is a plain default.
         */
        parsed.checkIn = { ...emptyCheckIn(), ...(parsed.checkIn as Partial<CheckInState> | undefined) };
        parsed.autoCareUntil = Number.isFinite(parsed.autoCareUntil) ? parsed.autoCareUntil! : 0;
        /*
         * Lifetime experience.
         *
         * A save written before this field existed has none, and the score achievements would
         * then read zero for a veteran. Seeded from what is recoverable — breeder experience
         * plus every plant's banked experience — which is a lower bound and is honest about it:
         * experience already spent on levels cannot be recovered, so the number is "at least
         * this much" rather than a claim to be exact.
         */
        parsed.lifetimeExp = Number.isFinite(parsed.lifetimeExp)
          ? parsed.lifetimeExp
          : Math.round(
              (Number(parsed.breederXp) || 0) +
                parsed.plants.reduce((a, p) => a + (Number(p.growth?.xp) || 0), 0),
            );
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
          // Living plants seed the genome history on old saves, so a bred child
          // can never silently equal one already standing in the garden.
          addUnique(parsed.discovery.genomes, genomeSignature(plant));
          /*
           * A save written before `planted` existed cannot say which plants were
           * sown — a bred child is indistinguishable from a seed-grown one — so
           * the living garden's lineage is used as the lower bound. It is
           * generous rather than exact, and it is what lets a planting quest
           * count the garden the player already grew.
           */
          if (!plantedWasRecorded) {
            for (const species of plant.baseLineage) {
              parsed.discovery.planted[species] = (parsed.discovery.planted[species] ?? 0) + 1;
            }
          }
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
    name: DEFAULT_PLAYER_NAME,
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
    exchangeDay: dayKey(now),
    exchangedLeaf: 0,
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
    quests: emptyQuestSave(dayKey(now)),
    lifetimeExp: 0,
    ascent: emptyAscent(dayKey(now)),
    checkIn: emptyCheckIn(),
    autoCareUntil: 0,
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
    if (rawOverride === undefined) {
      /*
       * Never destroy a slot we could not read.
       *
       * The fallback below is reachable when the stored value is not valid JSON, or is JSON
       * that is not a save — a partial write, a value written by some other tool, a format from
       * a much older build. Writing a fresh garden straight over it is the one irreversible
       * thing this function can do, and it is not worth doing silently: the previous value is
       * moved to a `:backup` key first, so a garden that was merely unreadable can still be
       * recovered by hand.
       */
      const key = saveSlotKey(getActiveAccountId());
      const existing = localStorage.getItem(key);
      if (existing !== null) localStorage.setItem(`${key}:backup`, existing);
      localStorage.setItem(key, JSON.stringify(fresh));
    }
  } catch {
    // ignore
  }
  return fresh;
}

function emptyDiscovery(): DiscoveryState {
  return { species: [], elements: [], traits: [], careActions: [], battles: 0, breeds: 0, claimed: [], genomes: [], planted: {} };
}

function repairDiscovery(input: DiscoveryState | undefined): DiscoveryState {
  const base = emptyDiscovery();
  if (!input) return base;
  const planted: DiscoveryState["planted"] = {};
  if (input.planted && typeof input.planted === "object") {
    for (const [sp, n] of Object.entries(input.planted)) {
      const count = Math.floor(Number(n));
      if (Number.isFinite(count) && count > 0) planted[sp as SpeciesId] = count;
    }
  }
  return {
    species: Array.isArray(input.species) ? input.species : [],
    elements: Array.isArray(input.elements) ? input.elements : [],
    traits: Array.isArray(input.traits) ? input.traits : [],
    careActions: Array.isArray(input.careActions) ? input.careActions : [],
    battles: Number.isFinite(input.battles) ? input.battles : 0,
    breeds: Number.isFinite(input.breeds) ? input.breeds : 0,
    claimed: Array.isArray(input.claimed) ? input.claimed : [],
    genomes: Array.isArray(input.genomes) ? input.genomes : [],
    planted,
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
 * Build a day's state: the weather, the streak, and the focus number.
 *
 * The daily *goals* that used to be drawn here are gone — the quest shelf owns daily work now,
 * and the engine rolls its own three from `quests/catalog.ts`. What is left is the weather and
 * the streak, which are about the garden rather than about a checklist, and `recentGoals` is kept
 * only so an old save's field round-trips.
 *
 * Exported because it is the only pure seam in the day cycle: it takes the previous day and
 * returns the next, so a test can walk a month of rotation in a loop without touching the clock
 * that `refreshGardenDay` reads.
 */
export function createGardenDay(key: string, previous: GardenDayState | undefined, level: number, playerId: string): GardenDayState {
  const rng = new Rng(seedToken("garden-day", key, playerId));
  const weather = rng.pick(["mist", "sun", "storm", "moon"] as GardenWeather[]) ?? "mist";

  let streak = 0;
  if (previous) {
    streak = daysBetween(previous.dayKey, key) === 1 ? previous.streak + 1 : 0;
  }
  void level;

  return {
    dayKey: key,
    weather,
    streak,
    focus: Math.min(100, 15 + streak * 5),
    recentGoals: [],
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
