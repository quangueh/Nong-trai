/**
 * Deterministic battle engine (docs/03, docs/13).
 *
 * Runs at 10 logical ticks/second and emits an ordered event stream. The same
 * seed + same snapshots + same inputs always produce the same event log, on the
 * client (for replay) and on the server (for authority).
 */

import { Rng, clamp, round2 } from "../core/rng";
import type { Plant, Skill } from "../core/types";
import { dominantArchetype } from "../core/types";
import { type ElementId, elementMultiplier } from "../config/elements";
import { TIER_META } from "../config/balance";
import type { StatusKind } from "../config/traits";

export type Stance = "aggressive" | "guard" | "swift" | "focus";

export const STANCE_LABEL: Record<Stance, string> = {
  aggressive: "Công",
  guard: "Thủ",
  swift: "Nhanh",
  focus: "Kỹ năng",
};

export const STANCE_EFFECTS: Record<Stance, { atk: number; def: number; spd: number; eva: number; acc: number; skillPower: number; status: number; castBias: number }> = {
  aggressive: { atk: 1.08, def: 0.95, spd: 1, eva: 1, acc: 1, skillPower: 1, status: 1, castBias: 1.1 },
  guard: { atk: 0.95, def: 1.1, spd: 1, eva: 1, acc: 1, skillPower: 1, status: 1, castBias: 0.95 },
  swift: { atk: 1, def: 1, spd: 1.08, eva: 1.05, acc: 0.97, skillPower: 1, status: 1.1, castBias: 1.05 },
  focus: { atk: 0.95, def: 1, spd: 1, eva: 1, acc: 1, skillPower: 1.08, status: 1.05, castBias: 1 },
};

export const TICK_RATE = 10;
export const TICK_DT = 1 / TICK_RATE;

export type ArenaKind = "sunny" | "moon" | "indoor";

export interface BattleConfig {
  seed: string;
  maxSeconds: number;
  arena: ArenaKind;
  /** Optional per-side stance chosen in the lobby. */
  stances?: { a: Stance; b: Stance };
}

export type BattleEventType =
  | "BATTLE_START"
  | "INTRO"
  | "TICK"
  | "BASIC_ATTACK"
  | "SKILL_CAST_STARTED"
  | "SKILL_RESOLVED"
  | "DAMAGE_APPLIED"
  | "HEAL_APPLIED"
  | "SHIELD_APPLIED"
  | "STATUS_APPLIED"
  | "STATUS_TICK"
  | "STATUS_EXPIRED"
  | "MORPH_STARTED"
  | "MORPH_ENDED"
  | "MISS"
  | "REFLECT"
  | "LEECH"
  | "IMMUNE"
  | "EVADED"
  | "STUNNED"
  | "DEATH"
  | "BATTLE_FINISHED";

/**
 * The trade a morph buys, in one place.
 *
 * 1.38 out and 0.82 in looks generous until you count what it costs: the cast
 * pays its own energy, and a morph has the longest windup of any striking
 * delivery, so the plant is defenceless while it changes shape. That windup is
 * the real price. Without it a defensive plant would morph every cooldown and
 * the numbers would be correct but the decision would not be one.
 */
export const MORPH_TUNING = {
  outgoing: 1.38,
  incoming: 0.82,
  duration: 6,
} as const;

/**
 * A fighter mid-transformation.
 *
 * Not an `ActiveStatus`: statuses are debuffs that cleanse and dispel reach, and
 * a morph is the caster being a different shape. Nothing in the game's existing
 * vocabulary should be able to remove it.
 */
export interface MorphState {
  until: number;
  /** Which form it took, named from the dominant element. Drives the VFX. */
  form: string;
  element: ElementId | undefined;
}

export interface BattleEvent {
  seq: number;
  type: BattleEventType;
  t: number;
  side?: "a" | "b";
  /** Set on MORPH_STARTED: which form, and the element that chose it. */
  element?: ElementId;
  form?: string;
  other?: "a" | "b";
  amount?: number;
  isCrit?: boolean;
  hpAfter?: number;
  shieldAfter?: number;
  skillId?: string;
  skillName?: string;
  status?: StatusKind;
  text?: string;
  hpPct?: number;
  winner?: "a" | "b" | "draw";
  energyAfter?: number;
  /**
   * Set on the HEAL_APPLIED that is a Second Wind revival, not a heal.
   *
   * The plant genuinely hit 0 — the DEATH event above it is honest — but the
   * view renders this event as a stand-back-up flourish rather than a heal
   * number, because "died, then did not stay dead" is a different story than
   * "+34 HP".
   */
  revived?: boolean;
}

export interface BattleSideSnapshot {
  plantId: string;
  name: string;
  displayName: string;
  hp: number;
  maxHp: number;
  stats: Plant["stats"];
  elements: Record<ElementId, number>;
  skills: Skill[];
  traits: string[];
  archetype: Plant["archetype"];
  tier: Plant["tier"];
  personality: Personality;
  level: number;
  rarity: Plant["rarity"];
}

export type Personality = "aggressive" | "defensive" | "trickster" | "healer" | "burster" | "controller";

export const PERSONALITY_LABEL: Record<Personality, string> = {
  aggressive: " hung hăng",
  defensive: "thủ thủ",
  trickster: "mưu mẹo",
  healer: "dưỡng sinh",
  burster: "bùng nổ",
  controller: "kiểm soát",
};

export interface BattleResult {
  winner: "a" | "b" | "draw";
  events: BattleEvent[];
  a: { hp: number; hpPct: number; damageDealt: number; damageTaken: number; shields: number; heals: number; energyPeak: number; skillUses: number };
  b: { hp: number; hpPct: number; damageDealt: number; damageTaken: number; shields: number; heals: number; energyPeak: number; skillUses: number };
  durationSeconds: number;
  timeouts: boolean;
  log: string[];
  seed: string;
}

export interface BattleSideState {
  snap: BattleSideSnapshot;
  hp: number;
  shield: number;
  energy: number;
  maxEnergy: number;
  statuses: ActiveStatus[];
  /** Non-null while transformed. Null the moment the form ends. */
  morph: MorphState | null;
  cooldown: Record<string, number>;
  casting: { skillId: string; resolveAt: number } | null;
  recoveringUntil: number;
  stunnedUntil: number;
  actionInterval: number;
  /** Unmodified interval derived from speed; status effects scale from this. */
  baseActionInterval: number;
  nextActionAt: number;
  stance: Stance;
  stanceChangeAt: number;
  lastStanceChange: number;
  damageDealt: number;
  damageTaken: number;
  shields: number;
  heals: number;
  skillUses: number;
  energyPeak: number;
  secondWindUsed: boolean;
  evadeFirstUsed: boolean;
  focusUsed: boolean;
  autoSkill: boolean;
  died: boolean;
  rampStacks: number;
}

interface ActiveStatus {
  kind: StatusKind;
  until: number;
  power: number;
  source: "a" | "b";
  tickAccum: number;
}

function snapshotFromPlant(plant: Plant): BattleSideSnapshot {
  return {
    plantId: plant.plantId,
    name: plant.name,
    displayName: plant.name,
    hp: plant.stats.hp,
    maxHp: plant.stats.hp,
    stats: plant.stats,
    elements: plant.dna.elementGenes,
    skills: plant.skills,
    traits: plant.traits,
    archetype: plant.archetype,
    tier: plant.tier,
    personality: personalityFor(plant),
    level: plant.growth.level,
    rarity: plant.rarity,
  };
}

function personalityFor(plant: Plant): Personality {
  const arch = dominantArchetype(plant.archetype);
  const map: Record<string, Personality> = {
    tank: "defensive",
    burst: "burster",
    sustain: "healer",
    control: "controller",
    tempo: "aggressive",
    counter: "trickster",
  };
  return map[arch] ?? "aggressive";
}

function actionInterval(stats: Plant["stats"]): number {
  // Higher speed -> shorter gap between basic attacks.
  return clamp(2.2 - stats.speed / 60, 0.5, 2.2);
}

/**
 * Battle phases (docs/13 §16). Overtime deliberately weakens healing so
 * sustain builds cannot stall a match past the timer — this is what keeps the
 * timeout rate under the 8% budget in docs/15 §15.
 */
export type BattlePhase = "opening" | "mid" | "late" | "overtime";

export function battlePhase(t: number, maxSeconds: number): BattlePhase {
  const left = maxSeconds - t;
  if (left <= 15) return "overtime";
  if (t >= maxSeconds * 0.66) return "late";
  if (t >= 15) return "mid";
  return "opening";
}

/** Healing/shield multiplier for the current phase. */
export function sustainMultiplier(phase: BattlePhase): number {
  switch (phase) {
    case "opening":
      return 1.15;
    case "mid":
      return 1;
    case "late":
      return 0.9;
    case "overtime":
      return 0.55;
  }
}

function initSide(snap: BattleSideSnapshot, stance: Stance, now: number): BattleSideState {
  return {
    snap,
    hp: snap.hp,
    shield: 0,
    energy: 0,
    maxEnergy: 100,
    statuses: [],
    morph: null,
    cooldown: {},
    casting: null,
    recoveringUntil: 0,
    stunnedUntil: 0,
    actionInterval: actionInterval(snap.stats),
    baseActionInterval: actionInterval(snap.stats),
    nextActionAt: now + 1.2, // exact start jitter is set per-match from the seed
    stance,
    stanceChangeAt: now,
    lastStanceChange: -999,
    damageDealt: 0,
    damageTaken: 0,
    shields: 0,
    heals: 0,
    skillUses: 0,
    energyPeak: 0,
    secondWindUsed: false,
    evadeFirstUsed: false,
    focusUsed: false,
    autoSkill: true,
    died: false,
    rampStacks: 0,
  };
}

// ---------------------------------------------------------------------------
// combat maths
// ---------------------------------------------------------------------------

function defenseReduction(defense: number, tier: Plant["tier"]): number {
  const k = TIER_META[tier]?.kDefense ?? 130;
  return defense / (defense + k);
}

function computeDamage(
  rng: Rng,
  attacker: BattleSideState,
  defender: BattleSideState,
  opts: { base: number; isSkill: boolean; pierce: number },
): { amount: number; isCrit: boolean; missed: boolean; elementReason: string } {
  const st = STANCE_EFFECTS[attacker.stance];
  const atk = attacker.snap.stats.attack * st.atk;

  // Miss check (evasion vs accuracy).
  const acc = clamp(0.9 * st.acc, 0.5, 0.99);
  const eva = clamp(defender.snap.stats.evasion * st.eva, 0, 0.6);
  if (!defender.evadeFirstUsed && attacker.snap.traits.includes("evade_reflex")) {
    // handled by caller
  }
  const missChance = clamp(0.05 + (eva - 0.08) - (acc - 0.9), 0, 0.5);
  if (rng.next() < missChance) return { amount: 0, isCrit: false, missed: true, elementReason: "" };

  // Crit.
  let critChance = attacker.snap.stats.crit + (opts.isSkill ? 0.03 : 0);
  if (attacker.snap.skills.some((s) => s.core.modifiers.includes("crit_focus") && attacker.cooldown[s.id] === 0)) {
    critChance += 0.05;
  }
  const isCrit = rng.next() < critChance;
  const critMult = isCrit ? 1.6 : 1;

  // Element.
  const em = elementMultiplier(attacker.snap.elements, defender.snap.elements);

  // Defense with stance + pierce.
  const defStance = STANCE_EFFECTS[defender.stance];
  const def = defender.snap.stats.defense * defStance.def;
  const dr = defenseReduction(def, defender.snap.tier) * (1 - opts.pierce);

  // Raw.
  let raw = opts.base;
  const dmg = clamp(raw * (1 - dr) * em.multiplier * critMult * rng.float(0.9, 1.1), 1, 9999);
  void atk;
  return { amount: dmg, isCrit, missed: false, elementReason: em.reason };
}

function applyStatus(target: BattleSideState, kind: StatusKind, duration: number, power: number, source: "a" | "b", events: BattleEvent[], now: number, seq: { v: number }, attackerName: string, targetName: string) {
  // Resistance reduces status chance/duration a bit.
  const existing = target.statuses.find((s) => s.kind === kind && s.source === source);
  if (existing) {
    existing.until = Math.max(existing.until, now + duration);
    existing.power = Math.max(existing.power, power);
  } else {
    target.statuses.push({ kind, until: now + duration, power, source, tickAccum: 0 });
  }
  events.push({
    seq: seq.v++,
    type: "STATUS_APPLIED",
    t: round2(now),
    side: source,
    other: source === "a" ? "b" : "a",
    status: kind,
    text: `${attackerName} gây ${statusName(kind)} lên ${targetName}`,
  });
}

function statusName(kind: StatusKind): string {
  const map: Record<StatusKind, string> = {
    poison: "Độc",
    burn: "Cháy",
    slow: "Làm chậm",
    stun: "Choáng",
    root: "Trói",
    regen: "Tái tạo",
    shield: "Khiên",
  };
  return map[kind] ?? kind;
}

// ---------------------------------------------------------------------------
// main simulation
// ---------------------------------------------------------------------------

/**
 * Run a fight to completion and return its result.
 *
 * ## This is a driver, not a second simulation
 *
 * It used to contain its own tick loop, ~110 lines doing the same work as
 * `BattleSession.step()` and drifting from it in four places:
 *
 *   - energy regen included the stance's `castBias` here and not there
 *   - the first tick was at `t = 0` here and `t = 0.1` there, so every event timestamp
 *     differed by 100ms
 *   - the timeout was checked *after* the action block here, so a basic attack and an
 *     auto-cast could land at exactly `maxSeconds` in one engine and never in the other
 *
 * Same seed, same plants, same inputs, different event log. Measured across 40 seeded
 * fights, **only 25 produced the same winner** — so a player watching a ladder stage could
 * watch themselves win a fight the game had recorded as a loss, and be paid accordingly.
 * `BattleView` drives `BattleSession`; the store settles with `simulateBattle`; the two
 * were never the same fight.
 *
 * So there is one simulation now. `BattleView` and the store build the same object from the
 * same seed and therefore run the same fight, which is what lets a stage result honestly
 * claim to be a record of something the player actually watched.
 *
 * ## Why the seed has to be the caller's
 *
 * The caller owns it, because only the caller knows the stage, the day and the two plants
 * together — which is everything the seed is derived from. `Date.now()` used to be read
 * here, independently on each side, so the store's fight and the view's fight were two
 * different fights with the same participants. See `store.runAscentStage`.
 */
export function simulateBattle(plantA: Plant, plantB: Plant, config: BattleConfig): BattleResult {
  const session = new BattleSession(plantA, plantB, config);
  // Bounded independently of `done` so a session that somehow never resolves still returns
  // rather than spinning. One tick of headroom over the timeout covers the step in which
  // the winner is assigned and `finished` is set.
  const cap = Math.ceil(config.maxSeconds * TICK_RATE) + 2;
  for (let i = 0; i < cap && !session.done; i++) session.step();
  return session.summary();
}

function sideSummary(s: BattleSideState) {
  return {
    /* Same rounding rule as the live bar: a survivor at 0.4 HP is reported as 1,
       never 0 — a winner that "had 0 HP left" reads as a corpse. */
    hp: shownHp(s),
    hpPct: s.died ? 0 : Math.max(0.5, round2(clamp((s.hp / s.snap.maxHp) * 100, 0, 100))),
    damageDealt: Math.round(s.damageDealt),
    damageTaken: Math.round(s.damageTaken),
    shields: Math.round(s.shields),
    heals: Math.round(s.heals),
    energyPeak: Math.round(s.energyPeak),
    skillUses: s.skillUses,
  };
}

function winnerLabel(w: "a" | "b" | "draw"): string {
  return w === "draw" ? "Hòa" : w === "a" ? "A thắng" : "B thắng";
}

function tickStatuses(
  self: BattleSideState,
  time: number,
  dt: number,
  side: "a" | "b",
  foeSide: "a" | "b",
  events: BattleEvent[],
  seq: { v: number },
  _log: string[],
) {
  // The morph ends with the rest of the fight's timed effects. Kept here rather
  // than in a sweep of its own so a transformed plant and a poisoned one come
  // undone on the same tick — a form that outlasted every debuff on it would read
  // as the game losing track of its own timers.
  if (self.morph && time >= self.morph.until) {
    const form = self.morph.form;
    self.morph = null;
    events.push({ seq: seq.v++, type: "MORPH_ENDED", t: round2(time), side, text: `Trở lại sau dạng ${form}` });
  }

  for (let i = self.statuses.length - 1; i >= 0; i--) {
    const st = self.statuses[i];
    if (time >= st.until) {
      self.statuses.splice(i, 1);
      events.push({ seq: seq.v++, type: "STATUS_EXPIRED", t: round2(time), side: foeSide, status: st.kind, text: `${statusName(st.kind)} hết hiệu lực` });
      continue;
    }
    if (st.kind === "poison" || st.kind === "burn") {
      st.tickAccum += dt;
      const tickRate = 1; // per second
      while (st.tickAccum >= tickRate) {
        st.tickAccum -= tickRate;
        const dmg = st.power * (st.kind === "burn" ? 1.2 : 1);
        self.hp -= dmg;
        self.damageTaken += dmg;
        /*
         * Death, here as in applyDamage.
         *
         * Without this a plant poisoned to -400 HP went on acting for the rest of the
         * fight. `self.hp` is clamped here rather than left negative so the HP bar and
         * the "remaining HP%" tiebreak both read 0 instead of a nonsense value.
         */
        if (self.hp <= 0) fellOrRevive(self, side, time, events, seq, ` vì ${statusName(st.kind)} lan`);
        events.push({ seq: seq.v++, type: "STATUS_TICK", t: round2(time), side, other: foeSide, amount: round2(dmg), status: st.kind, hpAfter: shownHp(self), text: `${statusName(st.kind)} gây ${Math.round(dmg)} sát thương` });
      }
    }
    if (st.kind === "regen") {
      st.tickAccum += dt;
      while (st.tickAccum >= 1) {
        st.tickAccum -= 1;
        const heal = st.power;
        self.hp = Math.min(self.snap.maxHp, self.hp + heal);
        events.push({ seq: seq.v++, type: "HEAL_APPLIED", t: round2(time), side, amount: round2(heal), hpAfter: shownHp(self), text: `Tái tạo +${Math.round(heal)}` });
      }
    }
    if (st.kind === "stun" && time < self.stunnedUntil) {
      // handled by stunnedUntil
    }
  }
  // Slow/root reduce the effective action speed. This must be recomputed from
  // the BASE interval every tick — multiplying the live value would compound
  // 1.5x per tick and freeze the plant permanently.
  const slowed = self.statuses.some((s) => s.kind === "slow");
  const rooted = self.statuses.some((s) => s.kind === "root");
  let interval = self.baseActionInterval;
  if (slowed) interval *= 1.6;
  if (rooted) interval *= 1.9;
  if (self.stunnedUntil > time) interval = Infinity;
  self.actionInterval = Math.min(interval, 6);
}

function maybeDriftStance(self: BattleSideState, foe: BattleSideState, time: number) {
  if (time - self.lastStanceChange < 10) return;
  const hpPct = self.hp / self.snap.maxHp;
  const foeHpPct = foe.hp / foe.snap.maxHp;
  let want: Stance = "aggressive";
  if (self.snap.personality === "defensive" || hpPct < 0.3) want = "guard";
  else if (self.snap.personality === "healer") want = "guard";
  else if (self.snap.personality === "controller" || self.snap.personality === "trickster") want = "focus";
  else if (self.snap.personality === "aggressive" && foeHpPct < 0.35) want = "aggressive";
  else want = "aggressive";
  if (want !== self.stance) {
    self.stance = want;
    self.lastStanceChange = time;
  }
}

function performBasicAttack(
  attacker: BattleSideState,
  defender: BattleSideState,
  side: "a" | "b",
  foeSide: "a" | "b",
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  log: string[],
  rng: Rng,
  arena: ArenaKind,
) {
  const st = STANCE_EFFECTS[attacker.stance];
  const base = attacker.snap.stats.attack * 0.9 * st.atk * arenaEdge(attacker, arena);
  const res = computeDamage(rng, attacker, defender, { base, isSkill: false, pierce: 0 });

  events.push({ seq: seq.v++, type: "BASIC_ATTACK", t: round2(time), side, other: foeSide, text: `${attacker.snap.name} đánh thường` });

  if (res.missed) {
    events.push({ seq: seq.v++, type: "MISS", t: round2(time), side, other: foeSide, text: `${defender.snap.name} né được` });
    return;
  }

  // Thorn traits.
  const thorn = attacker.snap.traits.find((t) => t === "thorn_counter" || t === "sharp_leaves" || t === "prickly_retaliation");
  void thorn;

  applyDamage(attacker, defender, side, foeSide, res.amount, res.isCrit, time, events, seq, log, "Đánh thường", res.elementReason);
}

function arenaEdge(s: BattleSideState, arena: ArenaKind): number {
  let m = 1;
  if (arena === "sunny" && s.snap.traits.includes("solar_hunger")) m += 0.14;
  if (arena === "sunny" && s.snap.traits.includes("photosurge")) m += 0.08;
  if (arena === "moon" && (s.snap.traits.includes("night_bloom") || s.snap.traits.includes("moon_vein"))) m += 0.14;
  return m;
}

/**
 * What a fighter looks like while transformed.
 *
 * Named from the dominant element rather than from a fixed list, so a fire morph
 * and an earth morph read as different things without six separate mechanics
 * behind them. The names lean on the elements this game already uses to
 * characterise a plant, so a fire-heavy tree turning into a berserker is a thing
 * you could have guessed.
 */
export function morphFormName(element: ElementId | undefined): string {
  switch (element) {
    case "fire":
      return "Cuồng Nham";
    case "earth":
      return "Thạch Giáp";
    case "shadow":
      return "Ẩn Dạ";
    case "electric":
      return "Lôi Hình";
    case "water":
      return "Truyền Tinh";
    case "poison":
      return "Độc Ảnh";
    case "light":
      return "Quang Thân";
    case "wood":
      return "Cường Sinh";
    default:
      return "Cuồng Hình";
  }
}

/**
 * `hpAfter` on every event goes through `shownHp`: `Math.round(0.4)` is 0, and
 * a 0 in that field read as "dead" downstream — the view drew kill-weight
 * impact on a hit that did not kill, and result cards printed "HP 0%" for the
 * winner. A live plant reports at least 1; 0 means actually down.
 */
function shownHp(s: BattleSideState): number {
  return s.died ? 0 : Math.max(1, Math.round(s.hp));
}

/**
 * The single way a fighter goes down.
 *
 * Four places can kill — a clean hit, a poison or burn tick, reflection, a
 * double-edge backlash — and each used to write its own obituary, which is how
 * a DoT kill printed no "gục ngã" at all and how `second_wind` only answered
 * deaths by direct hit. Every fall runs through here: zero the HP, raise the
 * flag, log the line — then let the one trait that answers death do its work.
 */
function fellOrRevive(
  self: BattleSideState,
  side: "a" | "b",
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  cause: string,
): void {
  self.hp = 0;
  self.died = true;
  events.push({ seq: seq.v++, type: "DEATH", t: round2(time), side, text: `${self.snap.name} gục ngã${cause}` });
  if (self.snap.traits.includes("second_wind") && !self.secondWindUsed) {
    self.secondWindUsed = true;
    self.hp = self.snap.maxHp * 0.3;
    self.died = false;
    events.push({
      seq: seq.v++,
      type: "HEAL_APPLIED",
      t: round2(time),
      side,
      amount: round2(self.hp),
      hpAfter: shownHp(self),
      revived: true,
      text: `Hơi Thở Thứ Hai — ${self.snap.name} đứng dậy lại!`,
    });
  }
}

function applyDamage(
  attacker: BattleSideState,
  defender: BattleSideState,
  side: "a" | "b",
  foeSide: "a" | "b",
  amount: number,
  isCrit: boolean,
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  _log: string[],
  sourceLabel: string,
  elementNote?: string,
) {
  // The morph reduces what lands. Here rather than at the call sites: skills,
  // reflected hits and lifesteal all funnel through this function, and a morph
  // that protected against one and not another would read as a bug.
  if (defender.morph) amount *= MORPH_TUNING.incoming;

  // Shield absorbs first.
  let remaining = amount;
  if (defender.shield > 0) {
    const absorbed = Math.min(defender.shield, remaining);
    defender.shield -= absorbed;
    remaining -= absorbed;
    events.push({ seq: seq.v++, type: "SHIELD_APPLIED", t: round2(time), side: foeSide, amount: round2(absorbed), shieldAfter: Math.round(defender.shield), text: `Khiên chặn ${Math.round(absorbed)}` });
  }

  defender.hp -= remaining;
  attacker.damageDealt += amount;
  defender.damageTaken += amount;

  // Energy gain on dealing/taking damage.
  attacker.energy = clamp(attacker.energy + 4, 0, attacker.maxEnergy);
  defender.energy = clamp(defender.energy + 3, 0, defender.maxEnergy);

  events.push({
    seq: seq.v++,
    type: "DAMAGE_APPLIED",
    t: round2(time),
    side,
    other: foeSide,
    amount: Math.round(amount),
    isCrit,
    /* Lethality, not the died flag: `fellOrRevive` runs below this push, so
       `died` is not set yet. hp<=0 here means the hit kills — which is also
       what the view reads for kill-weight impact. A survivor on 0.4 HP still
       reports 1, never 0. */
    hpAfter: defender.hp <= 0 ? 0 : Math.max(1, Math.round(defender.hp)),
    /* The element note rides on the damage line so the log answers "why was
       that hit so big" without the player opening a chart: `Mộc khắc Đất`
       right after the number is the explanation, in the place eyes already are. */
    text: `${sourceLabel} gây ${Math.round(amount)} sát thương${isCrit ? " (chí mạng)" : ""}${elementNote ? ` · ${elementNote}` : ""}`,
  });

  // Reflect (thorn_counter).
  if (defender.snap.traits.includes("thorn_counter") && amount > 0 && !defender.died) {
    const reflect = amount * 0.25;
    attacker.hp -= reflect;
    attacker.damageTaken += reflect;
    /*
     * Same for reflection.
     *
     * A thorn_counter plant that killed its opponent by reflecting kept fighting at 0 HP,
     * because the clamp further down `applyDamage` only zeroes the number and leaves
     * `died` alone. Note this runs before the lifesteal and crit-heal blocks that follow,
     * so a greedy_root attacker could be healed back up by the very hit that killed it —
     * which is arguably correct, and is left alone deliberately, but only once death is
     * actually recorded.
     */
    events.push({ seq: seq.v++, type: "REFLECT", t: round2(time), side: foeSide, amount: round2(reflect), hpAfter: attacker.hp <= 0 ? 0 : Math.max(1, Math.round(attacker.hp)), text: `Vỏ Cứng phản lại ${Math.round(reflect)}` });
    if (attacker.hp <= 0) fellOrRevive(attacker, side, time, events, seq, " vì phản sát thương");
  }

  // Lifesteal.
  if (attacker.snap.traits.includes("greedy_root") && !attacker.died) {
    const heal = amount * 0.22;
    attacker.hp = Math.min(attacker.snap.maxHp, attacker.hp + heal);
    events.push({ seq: seq.v++, type: "LEECH", t: round2(time), side, amount: round2(heal), hpAfter: shownHp(attacker), text: `Hút máu +${Math.round(heal)}` });
  }

  // Crit heal.
  if (isCrit && attacker.snap.traits.includes("crit_lifesteal") && !attacker.died) {
    const heal = amount * 0.35;
    attacker.hp = Math.min(attacker.snap.maxHp, attacker.hp + heal);
    attacker.heals += heal;
    events.push({ seq: seq.v++, type: "HEAL_APPLIED", t: round2(time), side, amount: round2(heal), hpAfter: shownHp(attacker), text: `Chí mạng hồi máu +${Math.round(heal)}` });
  }

  if (defender.hp <= 0) fellOrRevive(defender, foeSide, time, events, seq, "");

  if (attacker.hp <= 0) attacker.hp = 0;
}

function resolveSkill(
  self: BattleSideState,
  foe: BattleSideState,
  side: "a" | "b",
  foeSide: "a" | "b",
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  _log: string[],
  rng: Rng,
  arena: ArenaKind,
  maxSeconds: number,
) {
  const skill = self.snap.skills.find((s) => s.id === self.casting?.skillId);
  if (!skill) return;
  self.skillUses++;
  self.cooldown[skill.id] = time + skill.cooldown;

  const st = STANCE_EFFECTS[self.stance];
  const effect = skill.core.effect;
  const isSelfTarget = effect === "heal" || effect === "shield" || effect === "regen" || effect === "cleanse";

  // Self-targeted effects.
  if (isSelfTarget) {
    applySupportEffect(self, side, skill, time, events, seq, st.skillPower, maxSeconds);
    return;
  }

  // The transformation, written before the damage so this cast's own hit already
  // lands in the new form. That is also why the animation can read as the impact:
  // one event, not an event followed by another.
  if (skill.core.delivery === "morph") {
    const element = skill.core.elements[0];
    const form = morphFormName(element);
    self.morph = { until: time + MORPH_TUNING.duration, form, element };
    events.push({
      seq: seq.v++,
      type: "MORPH_STARTED",
      t: round2(time),
      side,
      // Both carried on the event rather than left to be re-derived: the view
      // reads events out of order during a replay, by which point the fighter's
      // morph has already been replaced or cleared.
      element,
      form,
      text: `${self.snap.name} biến thành ${form}`,
    });
  }

  // Offensive.
  const skillPower = self.snap.stats.skillPower * st.skillPower;
  let base = skill.power * (skillPower / 42) * arenaEdge(self, arena);
  if (skill.core.modifiers.includes("overgrow")) base *= 1.25;
  if (self.hp / self.snap.maxHp < 0.3 && skill.core.modifiers.includes("last_stand")) base *= 2;
  // Read after the morph was written above, so a morph hits at full strength.
  if (self.morph) base *= MORPH_TUNING.outgoing;

  // AOE hits harder against a single target than a trap; tune by delivery.
  const res = computeDamage(rng, self, foe, {
    base,
    isSkill: true,
    pierce: skill.core.modifiers.includes("pierce") ? 0.3 : 0,
  });

  events.push({ seq: seq.v++, type: "SKILL_RESOLVED", t: round2(time), side, other: foeSide, skillId: skill.id, skillName: skill.name, text: `${self.snap.name} dùng ${skill.name}` });

  if (res.missed) {
    events.push({ seq: seq.v++, type: "MISS", t: round2(time), side, other: foeSide, text: `${skill.name} bị né` });
    return;
  }

  applyDamage(self, foe, side, foeSide, res.amount, res.isCrit, time, events, seq, _log, skill.name, res.elementReason);

  /* Hút Máu: a signature-grade modifier — 18% of the damage dealt comes back
     as HP. Wired here rather than in `applyDamage` because it is the *skill's*
     rider, not a property of all damage the plant deals. */
  if (skill.core.modifiers.includes("lifesteal") && res.amount > 0 && !self.died) {
    const heal = res.amount * 0.18;
    self.hp = Math.min(self.snap.maxHp, self.hp + heal);
    events.push({ seq: seq.v++, type: "LEECH", t: round2(time), side, amount: round2(heal), hpAfter: shownHp(self), text: `Hút Máu +${Math.round(heal)} HP` });
  }

  /* Hút Nhựa: the hit pays back energy, so the plant reaches its next cast
     sooner. A small flat refund rather than a share of damage — damage scales,
     and a scaling refund makes the modifier decide fights by itself. */
  if (skill.core.modifiers.includes("drain") && res.amount > 0) {
    self.energy = clamp(self.energy + 6, 0, self.maxEnergy);
  }

  // Chain: hit twice.
  if (skill.core.effect === "chain" || skill.core.modifiers.includes("chain_lightning")) {
    const extra = res.amount * 0.5;
    applyDamage(self, foe, side, foeSide, extra, false, time, events, seq, _log, `${skill.name} (nảy)`);
  }

  // Self-damage drawback.
  if (skill.core.modifiers.includes("double_edge")) {
    const selfDmg = self.snap.maxHp * 0.08;
    self.hp -= selfDmg;
    events.push({ seq: seq.v++, type: "DAMAGE_APPLIED", t: round2(time), side: foeSide, amount: round2(selfDmg), hpAfter: Math.max(0, Math.round(self.hp)), text: `Lưỡi Hai tự mất ${Math.round(selfDmg)} HP` });
    if (self.hp <= 0) fellOrRevive(self, side, time, events, seq, " — Lưỡi Hai tự hủy");
  }

  // Status application.
  if (skill.statusChance > 0 && !foe.died) {
    const kind = statusForEffect(effect);
    if (kind) {
      const resist = foe.snap.traits.includes("hardy_shell") ? 0.15 : 0;
      const chance = clamp(skill.statusChance * (1 + (st.status - 1)) - resist, 0.05, 0.95);
      if (rng.next() < chance) {
        const power = skill.power * 0.4;
        applyStatus(foe, kind, skill.statusDuration, power, side, events, time, seq, self.snap.name, foe.snap.name);
        if (kind === "stun") foe.stunnedUntil = time + skill.statusDuration;
      }
    }
  }
}

function statusForEffect(effect: string): StatusKind | null {
  switch (effect) {
    case "dot":
      return "poison";
    case "slow":
      return "slow";
    case "stun":
      return "stun";
    case "root":
      return "root";
    default:
      return null;
  }
}

function applySupportEffect(
  self: BattleSideState,
  side: "a" | "b",
  skill: Skill,
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  skillPowerMult: number,
  maxSeconds: number,
) {
  const effect = skill.core.effect;
  const phase = battlePhase(time, maxSeconds);
  const power = skill.power * skillPowerMult * (effect === "heal" || effect === "shield" || effect === "regen" ? sustainMultiplier(phase) : 1);
  if (effect === "heal") {
    const heal = power;
    self.hp = Math.min(self.snap.maxHp, self.hp + heal);
    self.heals += heal;
    events.push({ seq: seq.v++, type: "HEAL_APPLIED", t: round2(time), side, amount: round2(heal), hpAfter: Math.round(self.hp), skillName: skill.name, text: `${self.snap.name} hồi ${Math.round(heal)} HP` });
  } else if (effect === "shield") {
    const shield = power;
    self.shield += shield;
    self.shields += shield;
    events.push({ seq: seq.v++, type: "SHIELD_APPLIED", t: round2(time), side, amount: round2(shield), shieldAfter: Math.round(self.shield), skillName: skill.name, text: `${self.snap.name} tạo khiên ${Math.round(shield)}` });
  } else if (effect === "regen") {
    self.statuses.push({ kind: "regen", until: time + 6, power: power * 0.3, source: "a", tickAccum: 0 });
    events.push({ seq: seq.v++, type: "HEAL_APPLIED", t: round2(time), side, amount: round2(power), skillName: skill.name, text: `${self.snap.name} bật Tái tạo` });
  } else if (effect === "cleanse") {
    const before = self.statuses.length;
    self.statuses = self.statuses.filter((s) => s.kind !== "poison" && s.kind !== "burn");
    events.push({ seq: seq.v++, type: "HEAL_APPLIED", t: round2(time), side, amount: 0, skillName: skill.name, text: `${self.snap.name} tẩy sạch ${before - self.statuses.length} trạng thái` });
  }
}

// --- AI skill scoring (docs/13 §12) ---------------------------------------

function maybeAutoCast(
  self: BattleSideState,
  foe: BattleSideState,
  side: "a" | "b",
  foeSide: "a" | "b",
  time: number,
  events: BattleEvent[],
  seq: { v: number },
  _log: string[],
  _rng: Rng,
) {
  if (self.casting) return;
  const ready = self.snap.skills.filter((s) => (self.cooldown[s.id] ?? 0) <= time && (s.energyCost === 0 || self.energy >= s.energyCost));
  if (!ready.length) return;

  const hpPct = self.hp / self.snap.maxHp;
  const foeHpPct = foe.hp / foe.snap.maxHp;

  let best: Skill | null = null;
  let bestScore = 0;
  for (const s of ready) {
    const isDefensive = s.core.effect === "heal" || s.core.effect === "shield" || s.core.effect === "regen" || s.core.effect === "cleanse";
    let score = 1;
    if (isDefensive) {
      score += (1 - hpPct) * 3;
      if (self.snap.personality === "healer") score += 1;
      if (self.snap.personality === "defensive") score += 0.5;
    } else {
      score += foeHpPct * 1.5; // finish low targets
      if (self.snap.personality === "burster") score += foeHpPct * 2;
      if (self.snap.personality === "aggressive") score += 1;
      if (self.snap.personality === "controller") score += s.statusChance * 3;
      if (self.snap.personality === "trickster") score += 1;
      // Prefer control when foe is healthy and we want to set up.
      if (s.statusChance > 0.4) score += 0.8;
    }
    // Burst holds for a crit window.
    if (self.snap.personality === "burster" && foeHpPct > 0.7) score -= 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  // Threshold so calmer plants wait for the right moment.
  const wildness = self.snap.archetype.tempo + self.snap.archetype.burst;
  const threshold = 2.2 - wildness * 1.0;
  if (!best || bestScore < threshold) return;

  // Begin cast.
  self.casting = { skillId: best.id, resolveAt: time + best.windup };
  if (best.energyCost > 0) self.energy -= best.energyCost;
  events.push({ seq: seq.v++, type: "SKILL_CAST_STARTED", t: round2(time), side, other: foeSide, skillId: best.id, skillName: best.name, text: `${self.snap.name} ra ${best.name}` });
}

// ---------------------------------------------------------------------------
// interactive helpers (used by the real-time battle screen)
// ---------------------------------------------------------------------------

/** A stepping battle for animated playback, one tick at a time. */
export class BattleSession {
  readonly seed: string;
  readonly maxSeconds: number;
  readonly arena: ArenaKind;
  private rng: Rng;
  private time = 0;
  private finished = false;
  readonly a: BattleSideState;
  readonly b: BattleSideState;
  private eventLog: BattleEvent[] = [];
  winner: "a" | "b" | "draw" | null = null;

  constructor(plantA: Plant, plantB: Plant, config: BattleConfig) {
    this.seed = config.seed;
    this.maxSeconds = config.maxSeconds;
    this.arena = config.arena;
    this.rng = new Rng(config.seed);
    const snapA = snapshotFromPlant(plantA);
    const snapB = snapshotFromPlant(plantB);
    this.a = initSide(snapA, config.stances?.a ?? "aggressive", 0);
    this.b = initSide(snapB, config.stances?.b ?? "aggressive", 0);
    this.a.nextActionAt = 1.0 + this.rng.float(0, 0.6);
    this.b.nextActionAt = 1.0 + this.rng.float(0, 0.6);
    this.push({ seq: 0, type: "BATTLE_START", t: 0, text: `${snapA.name} VS ${snapB.name}` });
  }

  private push(ev: BattleEvent) {
    this.eventLog.push(ev);
  }

  get elapsed(): number {
    return this.time;
  }

  get log(): BattleEvent[] {
    return this.eventLog;
  }

  get done(): boolean {
    return this.finished;
  }

  side(which: "a" | "b"): BattleSideState {
    return which === "a" ? this.a : this.b;
  }

  /** Advance one logical tick and return the events it produced. */
  step(): BattleEvent[] {
    if (this.finished) return [];
    const before = this.eventLog.length;
    const sides: Record<"a" | "b", BattleSideState> = { a: this.a, b: this.b };
    const other = (s: "a" | "b"): "a" | "b" => (s === "a" ? "b" : "a");
    const localLog: string[] = [];
    const seqRef = { v: 100000 + this.eventLog.length };

    this.time += TICK_DT;
    for (const side of ["a", "b"] as const) {
      const self = sides[side];
      const foe = sides[other(side)];
      if (self.died || foe.died) continue;

      tickStatuses(self, this.time, TICK_DT, side, other(side), this.eventLog, seqRef, localLog);
      self.energy = clamp(self.energy + 1.6 * TICK_DT * (1 + STANCE_EFFECTS[self.stance].castBias * 0.2), 0, self.maxEnergy);
      self.energyPeak = Math.max(self.energyPeak, self.energy);

      if (self.casting && this.time >= self.casting.resolveAt) {
        resolveSkill(self, foe, side, other(side), this.time, this.eventLog, seqRef, localLog, this.rng, this.arena, this.maxSeconds);
        self.casting = null;
      }
      if (self.died) continue;
      if (this.time < self.stunnedUntil || this.time < self.recoveringUntil) continue;

      if (self.autoSkill && this.time - self.lastStanceChange > 10) maybeDriftStance(self, foe, this.time);

      if (this.time >= self.nextActionAt) {
        self.nextActionAt = this.time + self.actionInterval;
        performBasicAttack(self, foe, side, other(side), this.time, this.eventLog, seqRef, localLog, this.rng, this.arena);
      }
      if (self.autoSkill) maybeAutoCast(self, foe, side, other(side), this.time, this.eventLog, seqRef, localLog, this.rng);
    }

    if ((this.a.died || this.b.died) && !this.winner) {
      if (this.a.died && this.b.died) this.winner = "draw";
      else this.winner = this.a.died ? "b" : "a";
    }
    if (this.time >= this.maxSeconds && !this.winner) {
      const aPct = this.a.hp / this.a.snap.maxHp;
      const bPct = this.b.hp / this.b.snap.maxHp;
      this.winner = Math.abs(aPct - bPct) < 0.01 ? (this.a.damageDealt === this.b.damageDealt ? "draw" : this.a.damageDealt > this.b.damageDealt ? "a" : "b") : aPct > bPct ? "a" : "b";
    }
    if (this.winner) {
      this.finished = true;
      this.push({ seq: 999999, type: "BATTLE_FINISHED", t: round2(this.time), winner: this.winner, text: winnerLabel(this.winner) });
    }

    return this.eventLog.slice(before);
  }

  /** Player intents (docs/13 §6). Validated here, applied on the next tick. */
  castSkill(which: "a" | "b", skillId: string): boolean {
    const self = this.side(which);
    if (self.died || self.casting) return false;
    const skill = self.snap.skills.find((s) => s.id === skillId);
    if (!skill) return false;
    if ((self.cooldown[skillId] ?? 0) > this.time) return false;
    if (this.time < self.stunnedUntil) return false;
    if (skill.energyCost > 0 && self.energy < skill.energyCost) return false;
    self.casting = { skillId, resolveAt: this.time + skill.windup };
    if (skill.energyCost > 0) self.energy -= skill.energyCost;
    self.autoSkill = false;
    this.push({ seq: 500000 + this.eventLog.length, type: "SKILL_CAST_STARTED", t: round2(this.time), side: which, skillId, skillName: skill.name, text: `${self.snap.name} ra ${skill.name}` });
    return true;
  }

  changeStance(which: "a" | "b", stance: Stance): boolean {
    const self = this.side(which);
    if (this.time - self.lastStanceChange < 10) return false;
    self.stance = stance;
    self.lastStanceChange = this.time;
    return true;
  }

  useFocus(which: "a" | "b"): boolean {
    const self = this.side(which);
    if (self.focusUsed || self.died) return false;
    self.focusUsed = true;
    // Focus: immediate ulti-like surge — next skill empowered for the rest of the match.
    self.energy = clamp(self.energy + 40, 0, self.maxEnergy);
    this.push({ seq: 600000 + this.eventLog.length, type: "HEAL_APPLIED", t: round2(this.time), side: which, amount: 40, text: `${self.snap.name} tập trung bản năng!` });
    return true;
  }

  summary(): BattleResult {
    return {
      winner: this.winner ?? "draw",
      events: this.eventLog,
      a: sideSummary(this.a),
      b: sideSummary(this.b),
      durationSeconds: round2(this.time),
      timeouts: this.time >= this.maxSeconds,
      log: [],
      seed: this.seed,
    };
  }
}
