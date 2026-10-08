/**
 * Quái thủ: a stage's monster, built as a real `Plant`.
 *
 * The decision this module exists to record is that a PvE monster is not a second kind of
 * combatant. It is a plant - same `Plant` type, same genome, same skill generator, same
 * battle engine - with genes nobody bred. That is why there is no monster branch anywhere in
 * `battle/engine.ts`: the fight a player has against "ải 40" is the fight they already know
 * how to have, and every status, morph, reflect and counter in the game applies to it
 * because they apply to plants.
 *
 * ## Why the numbers are solved rather than scaled
 *
 * `statsFromGenes` is linear in each gene and in the `expression` multiplier:
 * `stat = reference[tier] * (0.6 + gene * 0.7) * expression`. So for a stage's target stat
 * line the expression is exactly `target / (ref * (0.6 + gene * 0.7))` - no search, no
 * fudging, and the monster's genes keep saying what its stats are, which is what lets the
 * affixes be real instead of decorative.
 *
 * That linearity is also why `powerScaleOverride` was rejected as the difficulty lever.
 * Measured: on an ancient bench plant, x1 gives hp 339 and x10 gives hp 314 - it scales
 * skills and leaves the body alone. A ladder built on it would raise the threat's number
 * without changing the fight.
 */

import { Rng, seedToken } from "../core/rng";
import { statsFromGenes, visualFromDna, potentialFromGenes } from "../genetics/genomeGenerator";
import { buildSkillsFromGenes } from "../genetics/skillGenerator";
import { plantName } from "../genetics/names";
import { GENE_PACKAGES, type GenePackage } from "../config/genePackages";
import { TIER_META, type CombatTier, type Stats } from "../config/balance";
import { RARITY_META } from "../config/rarity";
import { ELEMENTS, dominantElement, type ElementId } from "../config/elements";
// `Archetype` is declared in config/species; the function that reads a map of them lives in
// core/types. Two modules, one import cannot cover both - a smell in the existing layout
// rather than a reason to re-declare the union here and let it drift.
import type { Archetype } from "../config/species";
import { dominantArchetype, emptyArchetype, type Dna, type Plant, type PotentialStat } from "../core/types";
import { estimatePower } from "../genetics/genomeGenerator";
import { stageAffixes, stageMutation, stageRarity, stageTier, type AscentAffix } from "./ascent";

/**
 * Prefixes and suffixes that make a monster read as a monster.
 *
 * A name generator gives "Lá Gai Gai Gai"; the species epithets read as garden stock. The
 * monster needs its own register, because the name is the first thing on the card and it
 * has to say "this is not one of yours" before the player reads a single number.
 */
const MONSTER_TITLE = [
  "Đại",
  "Cổ",
  "Đột Biến",
  "Dị Dật",
  "Hắc ám",
  "Vô Danh",
  "Thái Cổ",
  "Hư Vô",
  "Bất Tử",
  "Cuồng Nộ",
] as const;

const MONSTER_EPITHET = [
  "Thức Giấc",
  "Cổ Súc",
  "Đói Khát",
  "Bất Tận",
  "Xé Xác",
  "Ngấm Độc",
  "Nổi Loạn",
  "Nuốt Chửng",
  "Tàn Nhẫn",
  "Bất Khối",
] as const;

/** A monster's body part vocabulary, so it does not look like a shop plant. */
const MONSTER_BODY = {
  stem: ["thorny", "twisted", "barbed"],
  leaf: ["jagged", "serrated", "ragged"],
  root: ["gnarled", "grasping", "burrowing"],
  flower: ["barbed", "gaping", "toothed"],
  fruit: ["bulbous", "split", "writhing"],
  thorn: ["barbed", "hooked", "needle"],
  fungus: ["sporing", "bracketed", "blooming"],
  aura: ["seeping", "flickering", "writhing"],
  pattern: ["veined", "spotted", "mottled"],
  size: ["small", "normal", "large", "huge"],
} as const;

/** What the screen shows above the fight. */
export interface MonsterSpec {
  plant: Plant;
  name: string;
  title: string;
  stage: number;
  tier: CombatTier;
  rarity: string;
  element: ElementId;
  archetype: Archetype;
  power: number;
  affixes: AscentAffix[];
  skills: { name: string; delivery: string; effect: string }[];
}

/**
 * The monster guarding `stage` for `playerId`.
 *
 * Deterministic in `(playerId, stage)` and nothing else - notably not in the time of day and
 * not in the attempt number. Two consequences that both matter:
 *
 *  - Retrying a stage you lost meets the *same* monster. Otherwise "I lost to that one" is
 *    not a sentence anyone can say, and the ladder stops being a place.
 *  - Two players on stage 40 meet different monsters, because the player id is in the seed.
 *
 * `dayIndex` deliberately does not reach the genome either. The daily escalation in
 * `ascent.ts` moves the *target power*, not the monster's identity: the shape you lose to is
 * the shape you will meet again tomorrow, only bigger.
 */
export function monsterFor(
  playerId: string,
  stage: number,
  targetPower: number,
  dayIndex = 0,
  now = 0,
): MonsterSpec {
  const seed = seedToken(playerId, "ascent", stage);
  const rng = new Rng(seed);
  const affixes = stageAffixes(playerId, stage, dayIndex);
  const tier = stageTier(stage);
  const rarity = stageRarity(stage);
  const mutation = stageMutation(stage);

  /* --- elements -------------------------------------------------------
     One dominant element plus a plausible secondary, which is what makes two monsters on
     the same stage feel different rather than reskinned. `secondaryElement` treats anything
     at or above 0.18 as a real second element, so the tail is kept under that - a value
     above it would register as a second element and the card would not match the body. */
  const affinity = emptyElementAffinity();
  const primary = affixes.find((a) => a.element)?.element ?? ELEMENTS[rng.int(0, ELEMENTS.length - 1)];
  affinity[primary] = rng.float(0.5, 0.68);
  const secondary = pickOther(ELEMENTS, primary, rng);
  affinity[secondary] = rng.float(0.2, 0.34);
  // A dry spread of everything else, below the secondary-element threshold.
  for (const el of ELEMENTS) if (!affinity[el]) affinity[el] = rng.float(0.01, 0.11);

  /* --- archetype ------------------------------------------------------ */
  const archetype = emptyArchetype();
  const lead = affixes.find((a) => a.archetype)?.archetype ?? ARCHETYPES[rng.int(0, 5)];
  archetype[lead] = rng.float(0.44, 0.62);
  const second = pickOther(ARCHETYPES, lead, rng);
  archetype[second] = rng.float(0.16, 0.3);
  // Normalised so `estimatePower`'s dominance multiplier means something stable.
  const archTotal = Object.values(archetype).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(archetype) as Archetype[]) archetype[k] /= archTotal;

  /* --- stat genes -----------------------------------------------------
     Random per variant. This is the "unlimited variants" part: the gene draw is what makes
     ải 40 different from ải 41 even before affixes, and because it is drawn from the seed
     rather than from a table it never runs out. */
  const statGenes = {
    hp: rng.float(0.32, 0.86),
    attack: rng.float(0.32, 0.86),
    defense: rng.float(0.32, 0.86),
    speed: rng.float(0.32, 0.86),
    skillPower: rng.float(0.3, 0.84),
    crit: rng.float(0.15, 0.72),
    evasion: rng.float(0.12, 0.6),
  };
  for (const a of affixes) {
    if (!a.statPush) continue;
    for (const [k, v] of Object.entries(a.statPush)) {
      const key = k as keyof typeof statGenes;
      statGenes[key] = Math.min(0.97, statGenes[key] + (v ?? 0));
    }
  }

  /* --- skill genes ----------------------------------------------------
     Pushed hard, not nudged. `buildSkillsFromGenes` ranks these and builds the top two to
     four, so this is the affix's real mechanism: a monster with `dot` at 0.95 builds its
     skills around poison whatever the archetype says. */
  const skillGenes = {
    projectile: rng.float(0.2, 0.6),
    melee: rng.float(0.2, 0.6),
    aura: rng.float(0.15, 0.5),
    trap: rng.float(0.1, 0.45),
    dot: rng.float(0.1, 0.45),
    heal: rng.float(0.08, 0.4),
    shield: rng.float(0.1, 0.45),
    control: rng.float(0.1, 0.45),
    chain: rng.float(0.1, 0.4),
    summon: rng.float(0.06, 0.35),
  };
  for (const a of affixes) {
    if (!a.skillPush) continue;
    for (const [k, v] of Object.entries(a.skillPush)) {
      const key = k as keyof typeof skillGenes;
      skillGenes[key] = Math.min(0.98, skillGenes[key] + (v ?? 0));
    }
  }

  /* --- packages -------------------------------------------------------
     Restricted to packages whose effect the affix actually names, so the card does not
     promise a poison affix and then hand out a shield package. */
  const allowed = pickPackages(lead, affixes, rng, rarity);

  const bodyGenes = {
    stem: MONSTER_BODY.stem[rng.int(0, 2)],
    leaf: MONSTER_BODY.leaf[rng.int(0, 2)],
    root: MONSTER_BODY.root[rng.int(0, 2)],
    flower: MONSTER_BODY.flower[rng.int(0, 2)],
    fruit: MONSTER_BODY.fruit[rng.int(0, 2)],
    thorn: MONSTER_BODY.thorn[rng.int(0, 2)],
    fungus: MONSTER_BODY.fungus[rng.int(0, 2)],
    aura: MONSTER_BODY.aura[rng.int(0, 2)],
    pattern: MONSTER_BODY.pattern[rng.int(0, 2)],
    size: affixes.find((a) => a.size)?.size ?? MONSTER_BODY.size[rng.int(0, 3)],
  };

  const dna: Dna = {
    // No lineage. A monster was not bred from anything, and pretending otherwise would put a
    // species chip on its card and make it look like a nursery plant that escaped.
    lineage: [],
    elementGenes: affinity,
    bodyGenes,
    statGenes,
    skillGenes,
    // Wild by construction: a thing the garden made rather than something it kept.
    mutationGenes: {
      instability: rng.float(0.55, 0.95),
      rarityLuck: rng.float(0.3, 0.8),
      wildness: rng.float(0.6, 0.98),
      purity: rng.float(0.35, 0.7),
    },
    archetype,
    seed,
  };

  /* --- the stat line --------------------------------------------------
     Natural first: whatever the genes and the packages produce, unscaled. The proportions
     are kept and only the size is solved for, which is what preserves a monster's shape -
     a solve that also redistributed the stats would flatten every monster onto one body and
     let them differ only in size. */
  const stats = statsFromGenes(dna, tier, undefined, allowed);

  const skills = buildSkillsFromGenes(dna, allowed, seedToken(seed, "skill"), tier, mutation, rarity);
  // No traits. An affix is a monster's mark, but writing its id into `traits` would look it
  // up in `traitDisplayName`, which has never heard of "bo-giap" - and a trait the engine
  // cannot resolve is worse than no trait at all. The affixes work through genes instead.
  const traits: string[] = [];

  const monster: Plant = {
    plantId: `mon_${seed}`,
    ownerId: "ascent",
    name: "", // filled below, once the genome is complete - the name derives from it
    generation: 1,
    baseLineage: [],
    rarity,
    rarityScore: RARITY_META[rarity].minScore,
    dna,
    visual: visualFromDna(dna, rng, mutation === "chaotic" ? "chaotic" : "major"),
    growth: { stage: "awakened", stageStartedAt: now, stageReadyAt: now, level: 1, xp: 0, careOpportunities: 0 },
    stats,
    potential: potentialFromGenes(dna, tier) as Record<string, PotentialStat>,
    growthStats: { growthRate: 0, careEfficiency: 0, mutationChance: 0, breedingPower: 0, stability: 0.4 },
    hidden: { temperament: rng.float(0.3, 0.9), wildness: rng.float(0.6, 1), genePurity: 0.4, latentPower: 0, mutationDebt: 0 },
    skills,
    traits,
    mutations: [],
    parents: { a: null, b: null },
    archetype,
    tier,
    battleRecord: { wins: 0, losses: 0, draws: 0, scars: 0, streak: 0, bestStreak: 0 },
    careMemory: { recent: [], counts: {}, lastUse: {}, lastAction: null },
    stress: {},
    mood: "wild",
    powerRating: 0,
    validation: {
      buildValue: 0,
      tierBudget: TIER_META[tier].budget,
      ecr: 0,
      synergyTax: 0,
      invalidCombos: [],
      warnings: [],
      rankedLegal: false,
    },
    locks: { favorite: false, manual: false, battle: false, breeding: false, transaction: false },
    economy: { purchaseCost: 0, investedMaterialValue: 0, careCycles: 0, expectedSellPrice: 0 },
    createdAt: now,
    updatedAt: now,
  };

  const title = MONSTER_TITLE[rng.int(0, MONSTER_TITLE.length - 1)];
  const epithet = MONSTER_EPITHET[rng.int(0, MONSTER_EPITHET.length - 1)];
  monster.name = `${title} ${plantName(dna, traits, stage)} ${epithet}`.trim();

  /* Solved against the finished monster, so the skill contribution is in the sum. */
  monster.stats = solveToPower(monster.stats, monster.skills, archetype, targetPower);
  monster.powerRating = Math.round(estimatePower(monster));

  return {
    plant: monster,
    name: monster.name,
    title,
    stage,
    tier,
    rarity: RARITY_META[rarity].label,
    element: dominantElement(affinity).id,
    archetype: dominantArchetype(archetype),
    power: monster.powerRating,
    affixes,
    skills: monster.skills.map((s) => ({ name: s.name, delivery: s.delivery, effect: s.effect })),
  };
}

const ARCHETYPES: Archetype[] = ["tank", "burst", "sustain", "control", "tempo", "counter"];

/** An all-zero element map, so a draw can fill every element and none is left undefined. */
function emptyElementAffinity(): Record<ElementId, number> {
  return Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as Record<ElementId, number>;
}

/** Pick a different entry than `avoid`, so a monster never has two of the same dominant. */
function pickOther<T>(all: readonly T[], avoid: T, rng: Rng): T {
  const rest = all.filter((x) => x !== avoid);
  return rest[rng.int(0, rest.length - 1)];
}

/**
 * The gene packages a monster may be built from.
 *
 * Count rises with the stage because `buildSkillsFromGenes` takes one package per skill and
 * a bigger kit is what the endless ladder has to offer once the body stops growing. The
 * affix filter is applied first and the count second, so an affix that names one effect
 * still gets its package rather than losing the slot to a pool that had none of it.
 */
function pickPackages(
  lead: Archetype,
  affixes: AscentAffix[],
  rng: Rng,
  rarity: string,
): GenePackage[] {
  const wanted = affixes.flatMap((a) => a.packageEffect ?? []);
  const pool = wanted.length
    ? GENE_PACKAGES.filter((p) => wanted.includes(p.effect ?? "damage") || (!p.effect && wanted.length > 1))
    : GENE_PACKAGES.filter((p) => p.archetype === lead);
  const source = pool.length ? pool : [...GENE_PACKAGES];
  const count = rarity === "SSS" ? 5 : rarity === "SS" ? 4 : rarity === "S" ? 3 : 2;
  const out: GenePackage[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count && used.size < source.length; i++) {
    let pick = source[rng.int(0, source.length - 1)];
    let guard = 0;
    while (used.has(pick.id) && guard++ < 24) pick = source[rng.int(0, source.length - 1)];
    if (used.has(pick.id)) break;
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}

/**
 * Scale a monster's five linear stats so its power lands on the stage's target.
 *
 * `estimatePower` is
 *
 *     (hp*0.5 + atk*2 + def*1.6 + spd*1.5 + skl*1.4 + skills*1.2 + traits*12) * dominance
 *
 * and every term except the five linear stats is already fixed by the time this is called:
 * the skills were built, and the archetype is drawn. So the scale on those five is one
 * division rather than a search, and the result is the target instead of something near it.
 *
 * Crit and evasion are deliberately left alone. They are percentages with hard caps, and
 * scaling them with a stage's power drove them into the ceiling by about stage 3 - at which
 * point a monster is not stronger, it is just lucky forever.
 */
function solveToPower(stats: Stats, skills: { power: number }[], archetype: Record<Archetype, number>, target: number): Stats {
  const linear = stats.hp * 0.5 + stats.attack * 2 + stats.defense * 1.6 + stats.speed * 1.5 + stats.skillPower * 1.4;
  const fixed = skills.reduce((a, sk) => a + sk.power * 1.2, 0);
  const dom = Math.max(...Object.values(archetype));
  const dominance = 1 + dom * 0.4;
  /* Below the fixed part, no scale can reach the target: a monster whose skills alone
     out-power it would need negative stats, which the engine would read as glass.
     Scaled to 1 in that case, which leaves the monster *above* its target - so the stage is
     harder than the card claims rather than impossible, which is the honest direction to err
     in. The card prints the solve's real output, not the target, so the player is never
     told a stage is a 50% fight when it is a 5% one. */
  const needed = target / dominance - fixed;
  const k = needed <= 0 ? 1 : needed / Math.max(1, linear);
  const r = (v: number) => Math.max(1, Math.round(v * k));
  return {
    hp: r(stats.hp),
    attack: r(stats.attack),
    defense: r(stats.defense),
    speed: r(stats.speed),
    skillPower: r(stats.skillPower),
    crit: stats.crit,
    evasion: stats.evasion,
  };
}
