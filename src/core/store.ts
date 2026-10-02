/**
 * Central game store. Owns player state, the nursery, inventory and the economy
 * ledger. All mutations go through here so saves stay consistent and coin can
 * never be double-spent (docs/16 §24-§25: idempotent, immutable ledger).
 */

import { Rng, clamp, round2, seedToken } from "./rng";
import type { Plant } from "./types";
import { createSeedPlant, breedPlants, genomeSignature, validateGenome, estimatePower, type BreedingContext, type BreedingResult } from "../genetics/genomeGenerator";
import { plantName, nameKey } from "../genetics/names";
import { computeEcr } from "../genetics/ecrCalculator";
import { applyCare, gainXp } from "../growth/care";
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

/**
 * XP needed to go from `level` to `level + 1`.
 *
 * Exported because the top-bar badge shows the same number the level-up loop
 * consumes. One definition, so the badge cannot drift from the game.
 */
export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.3));
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
}

const STORAGE_KEY = "mutant-sprout-save-v1";
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

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore quota / privacy mode
    }
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

    buySeed(species: SpeciesId, count = 1): { ok: boolean; reason?: string } {
    const def = SPECIES_BY_ID[species];
    // Unlock gate. Without it all 6000 generated species are purchasable on day
    // one and progression means nothing — the shop would simply be the most
    // expensive entry in the registry.
    //
    // Reports progress rather than a bare refusal, so a player can see they are
    // two plants short rather than merely being told no.
    const gate = checkUnlock(this.unlockContext(), def.unlock);
    if (!gate.met) {
      return { ok: false, reason: `Chưa mở khóa: ${gate.summary}` };
    }
    const price = Math.floor(def.seedPrice * count * (1 - (count >= 10 ? SEED_PACK_PRICE : 0)));
    if (!this.debit(price, `Mua ${count} hạt ${def.name}`)) {
      return { ok: false, reason: "Không đủ LeafCoin" };
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
    this.tryCareCombo(plant);
    this.commit("care");
    return { ok: true, result: res, plant };
  }

  // --- breeding --------------------------------------------------------

  breedingPreview(parentAId: string, parentBId: string): Record<Rarity, number> | null {
    const a = this.get(parentAId);
    const b = this.get(parentBId);
    if (!a || !b) return null;
    return finalRarityWeights(a.growth.level, b.growth.level, a.rarity, b.rarity, {
      breederLevel: this.state.breederLevel,
      geneDiversity: lineageDiversity(a, b),
      careQuality: 0.5,
      pity: this.state.pity,
    });
  }

  breed(parentAId: string, parentBId: string): { ok: boolean; reason?: string; result?: BreedingResult } {
    const a = this.get(parentAId);
    const b = this.get(parentBId);
    if (!a || !b) return { ok: false, reason: "Chọn 2 cây" };
    if (a.plantId === b.plantId) return { ok: false, reason: "Không thể tự lai" };
    if (a.growth.stage !== "mature" && a.growth.stage !== "awakened") return { ok: false, reason: "Cây A chưa trưởng thành" };
    if (b.growth.stage !== "mature" && b.growth.stage !== "awakened") return { ok: false, reason: "Cây B chưa trưởng thành" };
    if (this.state.plants.length >= this.state.nurseryCap) return { ok: false, reason: "Vườn đã đầy" };

    // Breeding fee.
    const fee = Math.floor((sellPrice(a) + sellPrice(b)) * 0.2);
    if (!this.debit(fee, "Phí lai tạo")) return { ok: false, reason: "Không đủ LeafCoin cho phí lai" };

    // Roll the target rarity band from final weights.
    const weights = this.breedingPreview(parentAId, parentBId)!;
    const rng = new Rng(seedToken(a.plantId, b.plantId, this.state.pity.totalBreeds, Date.now()));
    const targetRarity = rollWeighted(rng, weights);
    const tier: CombatTier = tierForLevel(Math.max(a.growth.level, b.growth.level));
    const baseCtx: Omit<BreedingContext, "attempt"> = {
      playerId: this.state.playerId,
      nonce: seedToken(this.state.pity.totalBreeds, rng.next()),
      tier,
      targetRarity,
      breederLevel: this.state.breederLevel,
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

    // XP to parents + pity.
    this.addPlantXp(a, 25);
    this.addPlantXp(b, 25);
    this.updatePity(result.plant.rarity);

    this.state.plants.push(result.plant);
    this.state.discovery.breeds++;
    this.recordPlantDiscovery(result.plant);
    this.advanceGoal("breed", 1);
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

  private addPlantXp(plant: Plant, xp: number) {
    gainXp(plant, xp);
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

    while (this.state.breederXp >= xpForLevel(this.state.breederLevel) && this.state.breederLevel < BREEDER_LEVEL_CAP) {
      this.state.breederXp -= xpForLevel(this.state.breederLevel);
      this.state.breederLevel++;
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
        title: `Cấp nhà lai tạo ${this.state.breederLevel}`,
        body:
          this.state.breederLevel === BREEDER_LEVEL_CAP
            ? "Đã đạt cấp cao nhất."
            : fresh.length > 0
              ? `Mở khoá ${fresh.length.toLocaleString("vi-VN")} loài cây mới.`
              : "Chưa có loài nào mở thêm — hãy trồng cây và tích luỹ để mở tiếp.",
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
    gainXp(plant, comboReward.xp);
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

function loadOrCreate(): PlayerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerState;
      if (parsed && Array.isArray(parsed.plants)) {
        // Repair missing pity.
        parsed.pity = { ...emptyPity(), ...parsed.pity };
        parsed.gardenDay = parsed.gardenDay ?? createGardenDay(dayKey(Date.now()), undefined, parsed.breederLevel ?? 1, parsed.playerId ?? "player");
        parsed.discovery = repairDiscovery(parsed.discovery);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
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
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  void TIER_META;
  void round2;
}
