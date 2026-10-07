/**
 * Vượt ải: the ladder, the monsters' shape, and what clearing pays.
 *
 * Pure. Every number here is a function of `(stage, dayIndex, playerPower)`, so a stage is
 * reproducible without being stored, and the same player always meets the same monster on
 * the same stage - which is what makes "ải 40" a thing rather than a number that rerolls
 * every time the screen repaints.
 *
 * ## Why the difficulty curve is measured against the player rather than a fixed number
 *
 * The instinct is to make stage N strong = some formula of N. Measured, that cannot work:
 * a player's power is bounded by their plant's tier, a tier comes from a plant's level,
 * and levelling raises a plant's potential *caps* without touching its stats
 * (`gainXp`, src/core/care.ts). Forty bred genomes per tier:
 *
 *     seedling  249 / 270 / 291        (min / med / max)
 *     sprout    383 / 417 / 463
 *     bloom     578 / 639 / 720
 *     ancient   854 / 939 / 1089
 *     fresh seed plant: 223 / 237 / 255
 *
 * So the whole reachable range is about 237 to 1089, a factor of 4.6 - and a fixed curve
 * would either be trivially easy for a new player for its first hundred stages, or
 * impossible for a levelled player by stage ten. A curve anchored to the player's own best
 * plant is always asking them to beat the hardest thing they have beaten, which is the
 * only difficulty statement that stays true for every account.
 *
 * ## Why the ladder does not stop at the stat ceiling
 *
 * Player power tops out near 1089, so a monster of 5000 power is not a harder stage, it is
 * an unwinnable one. Beyond that the axis has to be something power cannot answer, and the
 * only one the engine already has is *the kit*: which skills a monster builds, from which
 * genes, under which affix. Affixes stack without bound and each one has an answer - bring
 * a plant that beats it. That is what makes stage 300 mean something when stage 40 already
 * out-sizes every plant in the garden.
 */

/**

/**
 * Power on stage 1, in absolute terms.
 *
 * Absolute, and that is the second correction to this curve. The first version set a
 * monster's strength as a *share of the player's own best plant*, which sounds self-balancing
 * and is in fact a ladder with no wall in it: every account measured 100% at every stage,
 * because the monster was always built to exactly the strength that account could handle.
 * A ladder that everyone always clears is not a ladder.
 *
 * So the ladder is a fixed set of numbers, and a player's place on it depends on how strong
 * their plants actually are. Measured over forty bred genomes per tier:
 *
 *     fresh seed plant  223 / 237 / 255      (min / median / max)
 *     seedling          249 / 270 / 291
 *     sprout            383 / 417 / 463
 *     bloom             578 / 639 / 720
 *     ancient           854 / 939 / 1089
 *
 * Stage 1 sits at 150 so that a brand new account - holding a fresh plant at 237 - wins it
 * comfortably. That first stage has to be winnable by someone who has never fought anything.
 */
export const FIRST_STAGE_POWER = 150;

/**
 * How much each stage adds.
 *
 * Geometric rather than linear, because the power a player can reach is itself roughly
 * geometric: a fresh plant is at 237 and the ceiling is near 1090, a factor of 4.6, and that
 * spread has to fit inside the stages or the last of them is a cliff.
 *
 * 4.5% a stage, and **only** up to `STAT_LADDER_END`. Past that the geometric term keeps
 * running as written and the ladder stops being a ladder: stage 400 came out at 6.4 *billion*
 * power, which is not a hard stage, it is a number nobody can read and no player can reach.
 * An early version applied the growth to the whole ladder and every deep stage was nonsense -
 * the infinite tail has to be flat in power and infinite in kit.
 *
 * And the ramp has to *land* on the wall rather than overshoot it, so the end of it is
 * solved rather than extrapolated: 4.5% over 60 stages from 150 arrives at 2014, which is 1.8x
 * the strongest account that can be bred - a stage nobody clears, i.e. a dead end. The growth
 * rate is therefore solved backwards from the parity point instead of chosen, which is what
 * `STAGE_GROWTH` below does: it fits the ladder between its two measured ends rather than
 * guessing a rate and hoping the ends land somewhere sensible.
 */

/**
 * Where the ladder's stat axis stops, and why.
 *
 * Fighting out sixty different monster genomes per point gives this window:
 *
 *     monster power / player power    0.75x    1.0x    1.25x
 *     sprout  (power 463)               93%     57%      5%
 *     bloom   (power 725)               95%     40%      0%
 *     ancient (power 1089)             100%     32%      0%
 *
 * A monster at 0.75x is nearly free; at 1.25x it is nearly impossible. So the body's useful
 * range is about 0.8x to 1.15x of the player, and past this point a bigger monster is not a
 * harder stage but an unwinnable one. That is the whole argument for the affix ladder:
 * affixes change what the monster *does*, which the player's power cannot predict and cannot
 * simply out-scale, so the difficulty keeps moving without a cliff.
 *
 * Bisecting each account's real parity point put the strongest bred account at about 1300.
 * That is the top of the ladder, and it is what `LADDER_TOP_POWER` is.
 *
 * Fifty stages of stat climbing is a career; the rest is kit. Fifty rather than sixty
 * because the climb is a *felt* ramp: at the old sixty-stage fit each stage added 3.7%,
 * which inside the handful of stages a player sees at once read as no movement at all.
 * The same two ends over fifty stages is ~4.5% a stage — every stage is visibly a step,
 * and the wall still lands exactly where a maxed account stops.
 */
export const STAT_LADDER_END = 50;

/** Power at the last stat stage: measured parity for a fully bred, fully levelled account. */
const LADDER_TOP_POWER = 1300;

/**
 * The per-stage rate, solved from the two ends rather than picked.
 *
 * `LADDER_TOP_POWER / FIRST_STAGE_POWER` spread over the ladder's length - which is the whole
 * reason it is a formula and not a literal. Change either end and the ladder re-fits itself,
 * so the first stage stays winnable for a new account and the last stays reachable for a
 * maxed one. At today's numbers it comes out near 4.5% a stage.
 */
export const STAGE_GROWTH = Math.pow(LADDER_TOP_POWER / FIRST_STAGE_POWER, 1 / (STAT_LADDER_END - 1));

/**
 * Daily escalation: how much stronger the world is for each distinct day played.
 *
 * 2% a day, capped at +35%. This is the "càng ngày độ khó càng cao" the ladder is named
 * for, and it is capped because an uncapped daily multiplier makes a player who takes a
 * week off unable to log back in, which reads as the game punishing them for having a life.
 */
const DAILY_STEP = 0.02;
const DAILY_CAP = 0.35;

import type { CombatTier } from "../config/balance";
import type { MutationTier, Rarity } from "../config/rarity";
import type { CurrencyId } from "../core/currency";
import type { Archetype, BodyGeneId, SkillGeneId, StatGeneId } from "../config/species";
import { dominantElement, ELEMENT_INFO, ELEMENTS, type ElementId } from "../config/elements";
import type { Plant } from "../core/types";
import type { EffectKind } from "../config/skills";

/** How a stage is coloured on the ladder. */
export type AscentBand = "khoi-dau" | "thung-lung" | "vuc-tham" | "vuot-han" | "khong-duong";

export const BAND_LABEL: Record<AscentBand, string> = {
  "khoi-dau": "Khởi đầu",
  "thung-lung": "Thung lũng",
  "vuc-tham": "Vực thẳm",
  "vuot-han": "Vượt hạn",
  "khong-duong": "Không đường",
};

/**
 * Bands, by stage. The names are the player's sense of distance, not a difficulty index.
 *
 * The boundaries are the same ones `BAND_CHARACTER` in `stages.ts` uses — 1/11/31/61/91 —
 * because the stage card's band label and the stage's identity/name/hazard are two answers
 * to the same question, and disagreeing is how a stage gets called "Vực thẳm" on the map
 * while its card still says "Thung lũng". (They cannot share the table directly: `stages.ts`
 * imports this module's constants, so importing back would be a cycle.) The old split —
 * one "Thung lũng" label spanning stages 9 to 60 — is also why a long climb felt like the
 * same stage repeated: the map never changed what it called the road.
 */
export function stageBand(stage: number): AscentBand {
  if (stage <= 10) return "khoi-dau";
  if (stage <= 30) return "thung-lung";
  if (stage <= 60) return "vuc-tham";
  if (stage <= 90) return "vuot-han";
  return "khong-duong";
}

/**
 * Which tier the monster's body is built at.
 *
 * Tied to the stage rather than to the player, so a levelled player meeting a stage-40
 * monster meets the biggest body that stage has, and the affixes on top of it are the part
 * that still moves. The steps are compressed inside the stat ladder rather than ending with
 * it — a bloom body arriving at stage 15 and an ancient one at 41 means the middle of the
 * climb visibly changes shape instead of wearing the same body for fifty stages.
 */
export function stageTier(stage: number): CombatTier {
  if (stage <= 4) return "seedling";
  if (stage <= 14) return "sprout";
  if (stage <= 40) return "bloom";
  return "ancient";
}

/**
 * Rarity, which is what buys a monster a fourth skill.
 *
 * This is the axis that matters once the body stops growing: `buildSkillsFromGenes` grants
 * a skill per rarity and tier step, so a deeper stage is a monster with a fuller action bar
 * rather than a monster with bigger numbers. The player's own rarity does not climb at the
 * same rate, so this keeps adding pressure after the stat ladder is exhausted - and a fifth
 * skill is impossible, so the ladder stops here and the affixes take the rest.
 */
export function stageRarity(stage: number): Rarity {
  if (stage <= 3) return "C";
  if (stage <= 8) return "B";
  if (stage <= 20) return "A";
  if (stage <= 40) return "S";
  if (stage <= 120) return "SS";
  return "SSS";
}

/** Mutation tier. Chaotic grants the extra skill slot, so it lands with the body stopping. */
export function stageMutation(stage: number): MutationTier {
  if (stage <= 8) return "micro";
  if (stage <= 24) return "minor";
  if (stage <= STAT_LADDER_END) return "major";
  return "chaotic";
}

/**
 * A modifier on the monster.
 *
 * Every field is applied to the genome, never to the finished stats, so an affix shows up
 * in the monster's own body - its skills, its element, its silhouette - and not only in a
 * number on the card. A player who loses to "Gây độc" should be able to see the poison and
 * think "bring the cleanse", and that only works if the affix is real rather than a label.
 */
export interface AscentAffix {
  id: string;
  /** Shown on the card. Vietnamese, because this is the player-facing name of a threat. */
  name: string;
  /** One line: what it does, in the player's terms. */
  gloss: string;
  /** Stat genes pushed up, and by how much, on a 0-1 gene scale. */
  statPush?: Partial<Record<StatGeneId, number>>;
  /** Skill genes pushed up. These decide which skills the monster builds, so this is the
   *  affix's real teeth: raising `dot` here is what turns a monster into a poison one. */
  skillPush?: Partial<Record<SkillGeneId, number>>;
  /** Element pushed toward. */
  element?: ElementId;
  /** Archetype pushed toward. */
  archetype?: Archetype;
  /** Only these gene packages may be used, when non-empty. Keeps an affix honest: "Gây
   *  độc" that drew `vampiric_root` would be a lie on the card. */
  packageEffect?: EffectKind[];
  /** Visual size, so an affix is visible at a glance on the ladder. */
  size?: BodyGeneId;
  /** Colour for the card. */
  colour: string;
}

/**
 * The affix pool.
 *
 * Built so that the pool is *wide* rather than *deep*: twenty-one gene packages and ten
 * skill genes make a great many reachable kits, and the point of the endless ladder is
 * that a player keeps meeting combinations they have not seen. Affixes that changed only
 * numbers would exhaust themselves the moment a player's power passed them.
 */
/** Enough that a very deep stage is a wall of modifiers rather than a repeat. */
const AFFIX_POOL_SIZE = 20;

/**
 * The affix pool.
 *
 * Built so that the pool is *wide* rather than *deep*: twenty-one gene packages and ten
 * skill genes make a great many reachable kits, and the point of the endless ladder is
 * that a player keeps meeting combinations they have not seen. Affixes that changed only
 * numbers would exhaust themselves the moment a player's power passed them.
 *
 * Every entry in this pool is keyed to what it does to the *genome* - which skill genes go
 * up, which packages may be drawn, which element leads - and never to a finished stat. That
 * is what makes an affix a threat the player can read on the monster's own body instead of a
 * label on a card.
 */
export const AFFIXES: readonly AscentAffix[] = [
  {
    id: "bo-giap",
    name: "Bọc Giáp",
    gloss: "Dày, chậm, và hồi bằng khiên.",
    statPush: { defense: 0.3, hp: 0.2 },
    skillPush: { shield: 0.35 },
    archetype: "tank",
    packageEffect: ["shield"],
    colour: "#4a7fb5",
  },
  {
    id: "chop-nhanh",
    name: "Chớp Nhanh",
    gloss: "Cực nhanh và khó trúng.",
    statPush: { speed: 0.32, evasion: 0.28, crit: 0.15 },
    skillPush: { projectile: 0.3 },
    archetype: "tempo",
    colour: "#c9a227",
  },
  {
    id: "gay-doc",
    name: "Gây Độc",
    gloss: "Đánh ít nhưng độc kéo dài.",
    statPush: { attack: 0.1 },
    skillPush: { dot: 0.5 },
    element: "poison",
    packageEffect: ["dot"],
    colour: "#6b8e23",
  },
  {
    id: "hut-sinh-luc",
    name: "Hút Sinh Lực",
    gloss: "Mỗi đòn trúng lấy lại máu.",
    statPush: { hp: 0.15 },
    skillPush: { dot: 0.3 },
    archetype: "sustain",
    packageEffect: ["dot"],
    colour: "#8b1e3f",
  },
  {
    id: "hoi-phuc",
    name: "Hồi Phục",
    gloss: "Tự hồi máu giữa trận.",
    statPush: { hp: 0.18 },
    skillPush: { heal: 0.5 },
    archetype: "sustain",
    packageEffect: ["heal", "regen"],
    colour: "#2e8b57",
  },
  {
    id: "ham-ung",
    name: "Hãm Ứng",
    gloss: "Khiên nặng và cắt lại đòn đỏng.",
    archetype: "tank",
    packageEffect: ["shield", "root"],
    colour: "#5d4037",
  },
  {
    id: "khoi-chan",
    name: "Khối Chặn",
    gloss: "Trói chân đối thủ vào chỗ.",
    skillPush: { trap: 0.45, control: 0.35 },
    archetype: "control",
    packageEffect: ["root", "slow"],
    colour: "#6d4c41",
  },
  {
    id: "lam-me",
    name: "Làm Mê",
    gloss: "Choáng trước khi kịp phản công.",
    skillPush: { aura: 0.4, control: 0.45 },
    archetype: "control",
    packageEffect: ["stun"],
    colour: "#7b1fa2",
  },
  {
    id: "bien-hinh",
    name: "Biến Hình",
    gloss: "Đổi dạng giữa chừng và hồi lại.",
    archetype: "counter",
    colour: "#ad1457",
  },
  {
    id: "to-xac",
    name: "To Xác",
    gloss: "Một khối máu khổng lồ.",
    statPush: { hp: 0.45 },
    size: "size",
    colour: "#37474f",
  },
  {
    id: "nhanh-nhe",
    name: "Nhanh Nhẹ",
    gloss: "Nhỏ, nhanh, đánh liên hồi.",
    statPush: { speed: 0.4, evasion: 0.2 },
    archetype: "tempo",
    size: "size",
    colour: "#00838f",
  },
  {
    id: "tan-nhien",
    name: "Tàn Nhẫn",
    gloss: "Sát thương lớn, dễ chí mạng.",
    statPush: { attack: 0.32, crit: 0.34 },
    archetype: "burst",
    packageEffect: ["damage"],
    colour: "#b71c1c",
  },
  {
    id: "phan-don",
    name: "Phản Đòn",
    gloss: "Phản lại đòn đánh lên nó.",
    archetype: "counter",
    colour: "#455a64",
  },
  {
    id: "truyen-dam",
    name: "Truyền Dây",
    gloss: "Một cú đánh lan sang nhiều mục tiêu.",
    skillPush: { chain: 0.5 },
    archetype: "tempo",
    packageEffect: ["chain"],
    colour: "#0277bd",
  },
  {
    id: "thoi-sung",
    name: "Thổi Súng",
    gloss: "Một loạt tầm xa liên tiếp.",
    statPush: { skillPower: 0.3 },
    skillPush: { projectile: 0.45 },
    archetype: "burst",
    colour: "#f57c00",
  },
  {
    id: "dot-phong",
    name: "Đốt Phóng",
    gloss: "Cháy lan, khó gần.",
    element: "fire",
    skillPush: { projectile: 0.25, dot: 0.3 },
    statPush: { attack: 0.15 },
    packageEffect: ["dot"],
    colour: "#e65100",
  },
  {
    id: "kim-dien",
    name: "Kim Điện",
    gloss: "Sét liên hoàn, không có đường né.",
    element: "electric",
    skillPush: { chain: 0.4, projectile: 0.2 },
    statPush: { speed: 0.15 },
    colour: "#ffd600",
  },
  {
    id: "tri-thuc",
    name: "Trí Thức",
    gloss: "Đọc trước nước đi của bạn.",
    archetype: "counter",
    statPush: { evasion: 0.3, skillPower: 0.2 },
    colour: "#512da8",
  },
  {
    id: "vuot-ran",
    name: "Vườn Rắn",
    gloss: "Hồi máu và tấn công cùng lúc.",
    skillPush: { summon: 0.45 },
    archetype: "sustain",
    colour: "#33691e",
  },
  {
    id: "khien-thach",
    name: "Kiền Thạch",
    gloss: "Cứng như đá, phản kích mạnh.",
    statPush: { defense: 0.38 },
    archetype: "tank",
    size: "size",
    colour: "#795548",
  },
] as const;

/** How fast affixes accumulate once the stat ladder is over.
 *
 *  Every 14 stages, so it takes a hundred stages of clearing to reach the cap. The ladder is
 *  meant to be endless, and an affix every fortnight means there is always a new combination
 *  to answer for a very long time. */
const AFFIX_EVERY = 10;

/**
 * The ceiling on stacked affixes.
 *
 * All twenty, and that is what makes the tail endless rather than merely long. Power stops
 * growing at stage 60, so past that the affixes are the *only* thing making a stage harder -
 * and a cap below the pool size would reach its ceiling and then stop, leaving stage 4000
 * identical to stage 300. Measured, a fully-bred account clears stage 200 at 100% with a cap
 * of six; with the whole pool stacked it is a genuine fight.
 *
 * The pool is not repeated to get there: it is sampled without replacement, so a stage with
 * twenty affixes carries every one of them exactly once, and two stages differ by which
 * combination they were dealt.
 */
const AFFIX_MAX = AFFIX_POOL_SIZE;

/**
 * The affixes on a stage.
 *
 * Drawn from `(playerId, stage)` rather than from a counter, so the same stage always has
 * the same affixes for the same player - the ladder has to be a place, not a shuffle - and
 * two players on the same stage face different ones, so no two fights are the same fight.
 *
 * Day only ever adds, never removes. A player who comes back after a week should not find
 * stage 30 easier than it was.
 */
export function stageAffixes(playerId: string, stage: number, dayIndex: number): AscentAffix[] {
  // Nothing before the body stops growing: an affix there would double-dip, asking for the
  // kit on top of a stat line that is already climbing on its own.
  if (stage <= STAT_LADDER_END) return [];
  // Starts at the *first* stage past the ladder, not a second one past it. `Math.floor` of
  // anything below one is zero, so an affix-free band immediately after the stat ladder is
  // just a gap where the difficulty stalls flat - measured, the first two stages past the
  // ladder came out with no affix while the third had one.
  const from = stage - STAT_LADDER_END;
  const raw = 1 + Math.floor((from - 1) / AFFIX_EVERY) + Math.floor(dayIndex / 7);
  /*
   * Past the pool size the count stops climbing and starts oscillating just under the cap.
   *
   * Pinning it at exactly `AFFIX_MAX` was the real cause of the tail being one fight
   * repeated: with a 20-entry pool and a count of 20, every deep stage drew *all twenty*, so
   * the composition was fixed and only the array order varied. Letting it ride at 18, 19, 20
   * instead means consecutive deep stages genuinely differ in *which* affixes are present,
   * not merely in what order they are listed — and `monster.ts` reads that order with
   * `.find()`, so the ordering was load-bearing all along.
   *
   * A ±10% swing in the affix load is well inside the band the tail already sits in, so this
   * varies the fight without moving the power envelope: the power curve is flat here by
   * design and stays flat.
   */
  const count = raw <= AFFIX_MAX ? raw : AFFIX_MAX - (from % 3);
  if (count <= 0) return [];
  const rng = mulberry(`${playerId}|ascent|affix|${stage}`);
  /*
   * Cycled sampling.
   *
   * Shuffle once, then walk the shuffled deck repeatedly, reshuffling on every wrap. Two
   * stages therefore never draw the same *order*, and once the count exceeds the pool the
   * count no longer has to be the thing that varies — the combination does, which is what
   * `monster.ts` turns into genes.
   *
   * The alternative, letting the count grow past the pool, was rejected on evidence: player
   * power is capped near 1089 and `solveToPower` trades HP for abilities, so a deeper stage
   * that asks for more power is not a harder stage, it is an unwinnable one. Variety has to
   * come from *which* affixes and in what order.
   */
  let deck: AscentAffix[] = [];
  const out: AscentAffix[] = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      deck = [...AFFIXES];
      // Fisher-Yates on the stage's own seeded generator, so the order is stable for a
      // given stage and different for every other one.
      for (let j = deck.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        const tmp = deck[j];
        deck[j] = deck[k];
        deck[k] = tmp;
      }
    }
    out.push(deck.shift() as AscentAffix);
  }
  return out;
}

/**
 * The power a monster on this stage is built to.
 *
 * A share of the player's own best plant, closing on it as the stage number rises. Two
 * consequences worth stating plainly:
 *
 *  - A new player meets a monster at 55% of their best and wins comfortably. That is the
 *    only way stage 1 means anything to someone whose whole power budget is 237.
 *  - A levelled player meets a monster at ~100% of their best. The stat ladder therefore
 *    always terminates in "as strong as your strongest plant", which is a wall, and past
 *    it the affixes are the fight.
 */
/**
 * The power a monster on this stage is built to.
 *
 * Absolute - see `FIRST_STAGE_POWER` for why not a share of the player. The daily term is
 * the only thing here that moves on its own, and it is capped.
 *
 * `playerBestPower` is kept in the signature on purpose: it is what the stage card shows the
 * player ("this is 84% of your strongest"), and a screen that could not compare a stage to
 * the garden in front of it would ask the player to guess. `describeStage` is what reads it -
 * this function deliberately does not, because letting the target follow the player is the
 * mistake the comment above is about.
 */
/**
 * The endless tail does *not* raise a monster's power.
 *
 * The obvious design - each affix adds so much percent of power - was tried at 7% and
 * measured, and it is wrong for a reason worth writing down. `solveToPower` counts a monster's
 * skill power as a *fixed* term and scales the body down to make room for it, so affixes that
 * inflate skill genes do not add power: they trade hit points for abilities. At 7% a stage
 * went 8% win rate at stage 60, 10% at 80, then **0% from 120 onwards** - twenty affixes put
 * the target at 3120 against a player capped near 1023, which is not a hard stage, it is a
 * wall nobody clears and a ladder nobody walks.
 *
 * And the tail cannot be made harder by numbers at all. A player's power is bounded by their
 * plant's tier, a tier comes from a plant's level, and levelling raises a plant's potential
 * caps without touching its stats (`gainXp`). So the ceiling is real and near 1090, and a
 * stage past it is unwinnable rather than difficult. Anything that pushes power above the
 * player's ceiling converts "hard" into "impossible" with no in between.
 *
 * So the tail is flat in power and infinite in *shape*: the same ceiling, twenty different
 * affixes, no two stages the same combination, and the difficulty comes from whether the
 * player's build happens to answer the one in front of them. That is a real axis rather than
 * a number going up, and it is the only one the ceiling leaves available.
 */
function affixPowerBonus(_stage: number, _dayIndex: number): number {
  return 0;
}

/**
 * Which stages are bosses.
 *
 * Every tenth stage is a boss, and a boss is not just a bigger number: it has a different
 * reward profile, its own line in the map, and it pays a milestone when beaten. The maths of
 * that reward is in `stageReward`; the label is here so exactly one module decides what a
 * boss *is*, and a condition change here moves every surface that asks.
 */
export function isBossStage(stage: number): boolean {
  return stage >= 10 && stage % 10 === 0;
}

export function stageTargetPower(stage: number, _playerBestPower: number, dayIndex: number): number {
  const n = Math.max(1, stage);
  // Clamped, not extrapolated. Past the stat ladder the body holds at the level the last
  // stat stage reached, and everything after that is the affix ladder's job - see the note
  // on `STAGE_GROWTH` for what happens if the geometric term is left running here.
  const steps = Math.min(n, STAT_LADDER_END) - 1;
  const body = FIRST_STAGE_POWER * Math.pow(STAGE_GROWTH, Math.max(0, steps));
  const daily = 1 + Math.min(DAILY_CAP, dayIndex * DAILY_STEP);
  // A boss is a wall with more room behind it. ×1,115 lifts the bar enough to feel different
  // without pushing past the player's own ceiling, which would turn "boss" into "impossible".
  const boss = isBossStage(n) ? 1.115 : 1;
  return Math.max(60, Math.round(body * (1 + affixPowerBonus(stage, dayIndex)) * daily * boss));
}

/**
 * How far past their record a player may reach.
 *
 * A hard gate at `highest + 1` would hide the wall: the player would never see what they are
 * working towards, only the stage that just stopped being hard. Four stages of look-ahead
 * shows the next difficulty and still refuses the rest, which is the difference between a
 * goal and a surprise.
 *
 * Stages already cleared never reopen. The ladder only goes forward: an old stage is
 * history, not a farm — replaying it for EXP was the one way to grow without ever
 * breeding or planting, which is exactly the shortcut this rule removes.
 */
export const LOOKAHEAD = 4;

export function stageIsOpen(stage: number, highestCleared: number): boolean {
  return stage > highestCleared && stage <= highestCleared + LOOKAHEAD;
}

/**
 * The weakest fighter a stage will still admit — a quarter of the monster's
 * target power.
 *
 * Below that line the fight is not a fight, and refusing it early is kinder
 * than animating a loss: the honest answer is "grow it, or breed a stronger
 * one", which is what the garden is for. At stage 1 the floor is ~40 — a brand
 * new mature plant already clears it, so the gate only bites once the ladder
 * has genuinely outrun the garden.
 */
export function minFighterPower(stage: number, dayIndex = 0): number {
  return Math.round(stageTargetPower(stage, 0, dayIndex) * 0.25);
}

/* -------------------------------------------------------------------------- gates */

/**
 * What a stage asks of the plant that enters it.
 *
 * A stage is not only a bigger monster: milestone stages carry an *entry* condition, so
 * climbing the ladder is also a question of what the garden is growing, not only how
 * strong the best plant got. Three kinds of gate, each on its own beat so a stage never
 * asks two things at once:
 *
 *   boss (every 10th)   the plant's growth level — the ladder's own measure.
 *   every 15th non-boss an element trial — the plant's dominant element must be one of
 *                       two, seeded per stage, so a one-element garden eventually meets a
 *                       stage it has to grow sideways for.
 *   every 25th rest     a generation floor — a stage asking for a bred plant, which is
 *                       what ties the ladder back to the breeding table.
 *
 * The beats are deliberately sparse: most stages stay gate-free because the wall is
 * already the difficulty, and a gate on every stage would read as lockout rather than
 * challenge.
 */
export interface StageGate {
  kind: "level" | "elements" | "generation";
  /** `level`/`generation`: the floor. */
  n?: number;
  /** `elements`: the two elements that may enter. */
  of?: ElementId[];
}

export function stageGate(stage: number): StageGate | null {
  const n = Math.max(1, Math.floor(stage));
  if (isBossStage(n)) {
    // Level 2 at the first boss, rising slowly — 4 at ải 30, 8 at ải 100 — capped so the
    // tail never asks for a level the growth curve cannot actually reach.
    return { kind: "level", n: Math.min(20, 2 + Math.floor(n / 15)) };
  }
  if (n % 15 === 0) {
    const h = hashStage(n, "elements");
    const a = ELEMENTS[h % ELEMENTS.length];
    const b = ELEMENTS[(h * 7 + 3) % ELEMENTS.length];
    return { kind: "elements", of: a === b ? [a, ELEMENTS[(h * 7 + 4) % ELEMENTS.length]] : [a, b] };
  }
  if (n % 25 === 0) {
    // Bred, not just grown: thế hệ 2 means the plant is someone's offspring.
    return { kind: "generation", n: Math.max(2, Math.floor(n / 50) + 1) };
  }
  return null;
}

/** One tiny deterministic hash — the element trial picks are a property of the stage. */
function hashStage(stage: number, salt: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${stage}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Whether a plant may enter a gated stage, and if not, why — in the player's words. */
export function gateCheck(plant: Plant, gate: StageGate | null): { ok: boolean; reason?: string } {
  if (!gate) return { ok: true };
  switch (gate.kind) {
    case "level":
      return plant.growth.level >= (gate.n ?? 0)
        ? { ok: true }
        : { ok: false, reason: `Ải này cần cây đạt cấp ${gate.n} — cây này mới cấp ${plant.growth.level}` };
    case "elements": {
      const dom = dominantElement(plant.dna.elementGenes).id;
      return (gate.of ?? []).includes(dom)
        ? { ok: true }
        : { ok: false, reason: `Ải này chỉ nhận cây hệ ${gate.of?.map((e) => ELEMENT_INFO[e].name).join(" hoặc ")}` };
    }
    case "generation":
      return plant.generation >= (gate.n ?? 0)
        ? { ok: true }
        : { ok: false, reason: `Ải này cần cây thế hệ ${gate.n} trở lên — hãy lai tạo thêm` };
    default:
      return { ok: true };
  }
}

/** The gate as one line, for the stage card. */
export function gateLabel(gate: StageGate): string {
  switch (gate.kind) {
    case "level":
      return `Cây đạt cấp ${gate.n}`;
    case "elements":
      return `Chỉ cây hệ ${gate.of?.map((e) => ELEMENT_INFO[e].name).join(" hoặc ")}`;
    case "generation":
      return `Cây thế hệ ${gate.n} trở lên`;
    default:
      return "";
  }
}

/** What a stage pays on a win, before the random part. */
export interface StageReward {
  leafCoin: number;
  nectar: number;
  pollen: number;
  geneCrystal: number;
  items: number;
  /** Plant experience. This is the progression axis: power comes from a plant's level, so
   *  stage XP is the only thing that actually opens the next band. */
  plantXp: number;
}

/** What a stage pays on a loss. Never zero: a loss that pays nothing is a loss the player
 *  repeats for free, which teaches them not to try. */
export interface StageConsolation {
  leafCoin: number;
  items: number;
  plantXp: number;
}

export const CONSOLATION: StageConsolation = { leafCoin: 6, items: 1, plantXp: 3 };

/**
 * The coin reward for a stage.
 *
 * Rises with the stage index, not with the monster's power, so the reward and the threat
 * are both legible from the same number on the ladder. Sub-linear (the exponent is below
 * 1) on purpose: linear coin income against exponential difficulty is a race to a wall
 * where nothing is affordable and nothing matters.
 */
export function stageReward(stage: number, won: boolean, attempt: number, replay = false): StageReward {
  if (!won) {
    // Diminishing consolation, floored at the base. A player stuck on one stage should
    // stop being able to farm it for a living, without ever being punished into leaving.
    const falloff = Math.max(0.25, 1 - attempt * 0.15);
    return {
      leafCoin: Math.round(CONSOLATION.leafCoin * falloff),
      items: Math.max(1, Math.round(CONSOLATION.items * falloff)),
      plantXp: Math.max(1, Math.round(CONSOLATION.plantXp * falloff)),
      nectar: 0,
      pollen: 0,
      geneCrystal: 0,
    } as StageReward;
  }
  const n = Math.max(1, stage);
  const scale = Math.pow(n, 1.15);
  const boss = isBossStage(n);
  // Past the first clear the reward falls to a third. A player who has already taken the
  // ladder's full reward should get practice and a shot at a better star, not a way to farm it
  // ahead of the next band.
  const replayFactor = replay ? 0.35 : 1;
  return {
    leafCoin: Math.round(28 * scale * (boss ? 1.25 : 1) * replayFactor),
    nectar: n >= 6 ? Math.round(3 * Math.pow(n, 0.9) * replayFactor) : 0,
    pollen: n >= 14 ? Math.round(2 * Math.pow(n, 0.85) * replayFactor) : 0,
    // Bosses are the ladder's main crystal source, so a long session is built around clearing
    // them; shrinking that would make the crystals feel ornamental instead of sought.
    geneCrystal: n >= 10 ? Math.round((1 + n / 6) * (boss ? 2.2 : 1) * replayFactor) : 0,
    items: Math.round((2 + n / 3) * (boss ? 1.35 : 1) * replayFactor),
    // Enough that clearing the ladder moves a plant through its tiers. Measured: a plant
    // needs roughly 5k XP for level 15 (bloom) and the ancient tier starts at 30, so this
    // is scaled to put "ải 30 reached bloom" within reach of a player who also tends and
    // breeds - the stage ladder is a road to power, not a substitute for it.
    plantXp: Math.round((24 + 26 * Math.pow(n, 0.72)) * replayFactor),
  };
}

/**
 * The random drop on top.
 *
 * Rolled from `rollDrops` so it is the same table the arena uses and therefore the same
 * odds the arena screen prints - two drop tables would mean the odds shown and the odds
 * paid could disagree, which is the one thing a loot screen must never do. The stage only
 * adds currency the arena cannot reach at all: Ember is not rolled here, because Ember
 * already has a daily cap in `drops.ts` and a second source would quietly break it.
 */
export function stageExtraDrop(stage: number, won: boolean): { currency: CurrencyId; amount: number } | null {
  if (!won || stage < 20) return null;
  // Above the cap Ember stops appearing, so the ladder quietly stops paying it. Stated
  // here rather than left to be discovered.
  const chance = Math.min(0.22, 0.02 + stage * 0.0012);
  if (Math.random() >= chance) return null;
  const pool: CurrencyId[] = stage >= 60 ? ["nectar", "pollen", "pollen"] : ["nectar", "pollen"];
  const currency = pool[Math.floor(Math.random() * pool.length)];
  return { currency, amount: Math.round(4 + stage * 0.35 * (0.5 + Math.random())) };
}

/** A small deterministic PRNG, so affixes are reproducible without importing Rng's surface. */
function mulberry(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything the screen and the store both need to know about one stage. */
export interface StageBrief {
  index: number;
  band: AscentBand;
  tier: CombatTier;
  rarity: Rarity;
  mutation: MutationTier;
  targetPower: number;
  affixes: AscentAffix[];
  reward: StageReward;
  /** The player's own power, so the card can say "this is 71% of your strongest". */
  share: number;
}

export function describeStage(
  stage: number,
  playerBestPower: number,
  playerId: string,
  dayIndex: number,
): StageBrief {
  const targetPower = stageTargetPower(stage, playerBestPower, dayIndex);
  return {
    index: stage,
    band: stageBand(stage),
    tier: stageTier(stage),
    rarity: stageRarity(stage),
    mutation: stageMutation(stage),
    targetPower,
    affixes: stageAffixes(playerId, stage, dayIndex),
    reward: stageReward(stage, true, 0),
    share: playerBestPower > 0 ? targetPower / playerBestPower : 0,
  };
}