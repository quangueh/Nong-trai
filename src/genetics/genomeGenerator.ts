/**
 * Genome generator (docs/02 §5, docs/15 §10).
 *
 * Produces a plant from parents + seed. Every step is deterministic and every
 * strength is paid for with a drawback, so near-infinite variety stays inside a
 * fixed power budget.
 */

import { Rng, clamp, round2, seedToken } from "../core/rng";
import type { Dna, Plant, PotentialStat, Skill, VisualGenes } from "../core/types";
import { emptyArchetype, dominantArchetype, normaliseArchetype } from "../core/types";
import { ELEMENTS, type ElementId, dominantElement, secondaryElement } from "../config/elements";
import { SPECIES_BY_ID, STAT_GENES, SKILL_GENES, type Archetype, type BodyGeneId, type SkillGeneId, type SpeciesId, type StatGeneId } from "../config/species";
import { speciesAffinity } from "../config/species";
import { TRAITS, TRAITS_BY_ID, TRAIT_ELEMENTS, type TraitDef } from "../config/traits";
import { GENE_PACKAGES, type GenePackage } from "../config/genePackages";
import { STAT_COST, TIER_META, TIER_ORDER, type CombatTier, type Stats } from "../config/balance";
import { MUTATION_TIER_META, RARITY_META, RARITY_REQUIREMENT, rarityFromScore, type MutationTier, type Rarity } from "../config/rarity";
import { getProtocol, type ProtocolId } from "./protocols";
import { buildSkillsFromGenes } from "./skillGenerator";
import { plantName } from "./names";
import { emptyCareMemory, emptyStress } from "../core/types";

export interface BreedingContext {
  playerId: string;
  nonce: string;
  attempt: number;
  tier: CombatTier;
  targetRarity?: Rarity;
  breederLevel?: number;
  catalystBonus?: number;
  /**
   * The protocol the breeder ran.
   *
   * Read in three places below — mutation chance, the mutation tier ceiling and the
   * element blend — and nowhere else, so a protocol's whole effect can be read by
   * grepping for this one field.
   */
  protocol?: ProtocolId;
}

export interface BreedingResult {
  plant: Plant;
  report: MutationReport;
}

export interface MutationReport {
  childSeed: string;
  mutationTier: MutationTier;
  mutations: { tier: MutationTier; label: string; detail: string }[];
  inheritedTraits: string[];
  newTraits: string[];
  rarity: Rarity;
  rarityScore: number;
  elementLine: string;
  headline: string;
  skillNames: string[];
  packages: string[];
  drawbacks: string[];
  counters: string[];
  strengths: string[];
  weaknesses: string[];
  generationFallbackUsed: boolean;
}


const BODY_POOL: Record<BodyGeneId, string[]> = {
  stem: ["thin", "slender", "normal", "thick", "vine", "lean", "braided"],
  leaf: ["round", "arrow", "serrated", "broad", "needle", "lobed", "ribbon"],
  root: ["shallow", "normal", "deep", "fibrous", "clawed", "tangly"],
  flower: ["none", "bud", "ember_core", "dew_bloom", "spore_ring", "star_flower", "double_bloom"],
  fruit: ["none", "pearl", "seedpod", "berry", "lantern"],
  thorn: ["none", "fine", "barbed", "hooked", "poison_spur"],
  fungus: ["none", "cap", "shelf", "ring", "bloom_mold"],
  aura: ["none", "warm_glow", "spark", "spore_dust", "dew", "shadow_haze", "halo"],
  pattern: ["plain", "veined", "mottled", "spotted", "gradient", "rings"],
  size: ["tiny", "small", "normal", "large", "colossal"],
};

const AURA_PALETTE = ["none", "warm_glow", "spark", "spore_dust", "dew", "shadow_haze", "halo"];
const PATTERNS = ["plain", "veined", "mottled", "spotted", "gradient", "rings"] as const;
const SEED_SHAPES: VisualGenes["seedShape"][] = ["round", "teardrop", "angular", "cluster"];

/** Weighted mix of two parent values with variance and a dominance bias. */
function mixGene(a: number, b: number, variance: number, dominance: number, rng: Rng): number {
  const bias = a * dominance + b * (1 - dominance);
  const noise = rng.float(-variance, variance);
  return clamp(bias + noise, 0, 1);
}

function pickFromBoth(rng: Rng, a: string, b: string, mutateChance: number): string {
  const chosen = rng.bool() ? a : b;
  if (rng.next() < mutateChance) {
    const pool = (() => {
      for (const key of Object.keys(BODY_POOL) as BodyGeneId[]) {
        if (BODY_POOL[key].includes(chosen)) return BODY_POOL[key];
      }
      return [chosen];
    })();
    if (pool.length > 1) {
      const others = pool.filter((p) => p !== chosen);
      return rng.pick(others);
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// seed planting
// ---------------------------------------------------------------------------

export function createSeedPlant(species: SpeciesId, ownerId: string, nonce: string, now: number): Plant {
  const seed = seedToken(species, ownerId, nonce, "seed");
  const rng = new Rng(seed);
  const def = SPECIES_BY_ID[species];

  const dna: Dna = {
    lineage: [species],
    elementGenes: speciesAffinity(species),
    bodyGenes: {
      stem: def.bodyBias.stem ?? "normal",
      leaf: def.bodyBias.leaf ?? "broad",
      root: def.bodyBias.root ?? "normal",
      flower: def.bodyBias.flower ?? "none",
      fruit: def.bodyBias.fruit ?? "none",
      thorn: def.bodyBias.thorn ?? "none",
      fungus: def.bodyBias.fungus ?? "none",
      aura: def.bodyBias.aura ?? "none",
      pattern: def.bodyBias.pattern ?? "veined",
      size: "normal",
    },
    statGenes: { hp: 0, attack: 0, defense: 0, speed: 0, skillPower: 0, crit: 0, evasion: 0 },
    skillGenes: { projectile: 0, melee: 0, aura: 0, trap: 0, dot: 0, heal: 0, shield: 0, control: 0, chain: 0, summon: 0 },
    mutationGenes: {
      instability: clamp(0.2 + rng.float(-0.05, 0.12), 0, 1),
      rarityLuck: clamp(0.12 + rng.float(-0.04, 0.1), 0, 1),
      wildness: clamp(0.25 + rng.float(-0.1, 0.15), 0, 1),
      purity: clamp(0.85 + rng.float(-0.08, 0.1), 0, 1),
    },
    archetype: emptyArchetype(),
    seed,
  };

  // Seed is a clean, low-budget plant of the species' own shape.
  for (const g of STAT_GENES) {
    const bias = def.statBias[g] ?? 0.8;
    dna.statGenes[g] = clamp(0.3 + bias * 0.22 + rng.float(-0.05, 0.05), 0.08, 0.95);
  }
  for (const g of SKILL_GENES) {
    const bias = def.skillBias[g] ?? 0.3;
    dna.skillGenes[g] = clamp(bias * 0.6 + rng.float(-0.08, 0.08), 0, 1);
  }
  dna.archetype = archetypeFromSpecies(def.archetype, rng);

  const stats = statsFromGenes(dna, "seedling");
  const potential = potentialFromGenes(dna);

  const plant: Plant = {
    plantId: `p_${seed}`,
    ownerId,
    name: `${def.name} ${rng.pick(["non", "mầm", "hạt", "nhú"])}`,
    generation: 1,
    baseLineage: [species],
    rarity: "C",
    rarityScore: 8,
    dna,
    visual: visualFromDna(dna, rng),
    growth: { stage: "seed", stageStartedAt: now, stageReadyAt: now + 15_000, level: 1, xp: 0, careOpportunities: 0 },
    stats,
    potential,
    growthStats: {
      growthRate: round2(0.4 + dna.statGenes.speed * 0.3),
      careEfficiency: round2(0.5 + dna.mutationGenes.purity * 0.3),
      mutationChance: round2(0.04 + dna.mutationGenes.instability * 0.12),
      breedingPower: round2(0.4 + dna.mutationGenes.purity * 0.35),
      stability: round2(clamp(1 - dna.mutationGenes.instability * 0.6, 0.15, 1)),
    },
    hidden: {
      temperament: round2(rng.next()),
      wildness: round2(dna.mutationGenes.wildness),
      genePurity: round2(dna.mutationGenes.purity),
      latentPower: round2(rng.next()),
      mutationDebt: 0,
    },
    skills: buildSkillsFromGenes(dna, [], seed, "seedling"),
    traits: [],
    mutations: [],
    parents: { a: null, b: null },
    archetype: dna.archetype,
    tier: "seedling",
    battleRecord: { wins: 0, losses: 0, draws: 0, scars: 0, streak: 0, bestStreak: 0 },
    careMemory: emptyCareMemory(),
    stress: emptyStress(),
    mood: "calm",
    powerRating: 100,
    validation: {
      buildValue: 0,
      tierBudget: TIER_META.seedling.budget,
      ecr: 0.5,
      synergyTax: 0,
      invalidCombos: [],
      warnings: [],
      rankedLegal: true,
    },
    locks: { favorite: false, manual: true, battle: false, breeding: false, transaction: false },
    economy: { purchaseCost: def.seedPrice, investedMaterialValue: 0, careCycles: 0, expectedSellPrice: 0 },
    createdAt: now,
    updatedAt: now,
  };

  plant.powerRating = Math.round(estimatePower(plant));
  return plant;
}

function archetypeFromSpecies(arch: Archetype, rng: Rng): Record<Archetype, number> {
  const a = emptyArchetype();
  a[arch] = 0.45;
  const others = rng.shuffle((["tank", "burst", "sustain", "control", "tempo", "counter"] as Archetype[]).filter((k) => k !== arch));
  for (const o of others) a[o] = 0.11;
  return normaliseArchetype(a);
}

// ---------------------------------------------------------------------------
// breeding
// ---------------------------------------------------------------------------

export function breedPlants(parentA: Plant, parentB: Plant, ctx: BreedingContext, now: number): BreedingResult {
  const childSeed = seedToken(parentA.plantId, parentB.plantId, ctx.playerId, ctx.nonce, ctx.attempt);
  const rng = new Rng(childSeed);
  const rngGenes = rng.fork("genes");
  const rngVisual = rng.fork("visual");
  const rngMutation = rng.fork("mutation");
  const rngTrait = rng.fork("trait");

  // The protocol is resolved once, here, and its knobs are read from this object for
  // the rest of the function. Resolving it per use-site would let two sites disagree
  // about what the player asked for.
  const protocol = ctx.protocol ? getProtocol(ctx.protocol) : null;

  // --- element mixture -------------------------------------------------
  const elementGenes = {} as Record<ElementId, number>;
  const crossover = rngGenes.next() < 0.5 ? "first" : "second";
  // `blendCeiling` is how far the recessive parent's contribution may reach.
  // Thối luyện scales it down, so the child inherits the dominant parent's
  // element sharply and becomes a specialist rather than a generalist. A scale on
  // the default rather than an absolute, so the two can never drift apart.
  const blendCeiling = 0.62 * (protocol?.elementBlendScale ?? 1);
  for (const el of ELEMENTS) {
    const va = parentA.dna.elementGenes[el] ?? 0;
    const vb = parentB.dna.elementGenes[el] ?? 0;
    const dominant = crossover === "first" ? va : vb;
    const recessive = crossover === "first" ? vb : va;
    // Recessive alleles stay latent but can be expressed by a mutation.
    const blended = mixGene(dominant, recessive, 0.06, blendCeiling, rngGenes);
    elementGenes[el] = round2(clamp(blended * 1.35, 0, 1));
  }
  const elementTotal = ELEMENTS.reduce((a, el) => a + elementGenes[el], 0) || 1;
  for (const el of ELEMENTS) elementGenes[el] = round2(elementGenes[el] / elementTotal);

  // --- stat + skill genes ----------------------------------------------
  const statGenes = {} as Record<StatGeneId, number>;
  for (const g of STAT_GENES) {
    statGenes[g] = round2(mixGene(parentA.dna.statGenes[g], parentB.dna.statGenes[g], 0.09, 0.5, rngGenes));
  }
  const skillGenes = {} as Record<SkillGeneId, number>;
  for (const g of SKILL_GENES) {
    skillGenes[g] = round2(mixGene(parentA.dna.skillGenes[g], parentB.dna.skillGenes[g], 0.1, 0.5, rngGenes));
  }

  // --- body genes ------------------------------------------------------
  //
  // The protocol's contribution is inside the sum rather than applied to the result,
  // so it is still subject to the same 0.03..0.85 clamp. A protocol cannot push
  // mutation past the cap, and stability cannot reduce it below the floor.
  const mutationChance = clamp(
    0.06 +
      parentA.dna.mutationGenes.instability * 0.28 +
      parentB.dna.mutationGenes.instability * 0.28 +
      (ctx.catalystBonus ?? 0) +
      (protocol?.mutationChanceDelta ?? 0) +
      ((parentA.hidden.mutationDebt + parentB.hidden.mutationDebt) / 2) * 0.1 -
      ((parentA.dna.mutationGenes.purity + parentB.dna.mutationGenes.purity) / 2 - 0.6) * 0.1,
    0.03,
    0.85,
  );
  const bodyGenes = {} as Record<BodyGeneId, string>;
  for (const g of Object.keys(BODY_POOL) as BodyGeneId[]) {
    const va = parentA.dna.bodyGenes[g];
    const vb = parentB.dna.bodyGenes[g];
    bodyGenes[g] = pickFromBoth(rngGenes, va, vb, mutationChance * 0.4);
  }

  // --- mutation tier roll ----------------------------------------------
  //
  // The protocol's tier ceiling is a clamp on the *result*, not on the weights. Zeroing
  // a weight would change the shape of the distribution and silently reallocate the
  // probability; clamping the roll is equivalent to discarding an outcome the player
  // was told was unavailable, which is the promise the protocol actually makes.
  const TIER_ORDER: MutationTier[] = ["micro", "minor", "major", "chaotic"];
  const tierWeights = mutationTierWeights(mutationChance, ctx.tier, ctx.breederLevel ?? 1);
  let tierIdx = weightedPick(tierWeights, rngMutation);
  const tierCeiling = clamp(3 + (protocol?.tierCeilingShift ?? 0), 0, 3);
  if (tierIdx > tierCeiling) tierIdx = tierCeiling;
  const mutationTier = TIER_ORDER[tierIdx];

  // A rare target band pushes the mutation tier up; it never raises the budget.
  //
  // Note this block does nothing: it reads `tierIdx`, finds it below `forced`, and
  // the body is a comment saying it is handled elsewhere. That is accurate — the
  // target reaches `buildSkillsFromGenes`, `assignTraits` and `computeRarityScore`,
  // which is why the dead floor here has never been a visible bug. It is left alone
  // deliberately: making it live would change what every existing breed produces, and
  // that is a balance decision rather than a cleanup.
  const targetRarity = ctx.targetRarity ?? "C";

  // --- archetype vector ------------------------------------------------
  const archetype = emptyArchetype();
  for (const k of Object.keys(archetype) as Archetype[]) {
    archetype[k] = clamp(
      parentA.archetype[k] * 0.5 + parentB.archetype[k] * 0.5 + rngGenes.float(-0.12, 0.12),
      0,
      1,
    );
  }
  // Push toward the dominant element's preferred playstyle so a fire plant plays like fire.
  const dom = dominantElement(elementGenes);
  const elementArchetype: Partial<Record<ElementId, Archetype>> = {
    fire: "burst",
    water: "sustain",
    earth: "tank",
    electric: "tempo",
    poison: "control",
    shadow: "counter",
    light: "counter",
    wood: "tank",
  };
  const biasArch = elementArchetype[dom.id] ?? "tank";
  archetype[biasArch] = clamp(archetype[biasArch] + 0.08, 0, 1);
  const normalisedArchetype = normaliseArchetype(archetype);

  const mutationGenes = {
    instability: round2(clamp((parentA.dna.mutationGenes.instability + parentB.dna.mutationGenes.instability) / 2 + rngMutation.float(-0.06, 0.14), 0, 1)),
    rarityLuck: round2(clamp((parentA.dna.mutationGenes.rarityLuck + parentB.dna.mutationGenes.rarityLuck) / 2 + rngMutation.float(-0.03, 0.08), 0, 1)),
    wildness: round2(clamp((parentA.dna.mutationGenes.wildness + parentB.dna.mutationGenes.wildness) / 2 + rngMutation.float(-0.08, 0.12), 0, 1)),
    purity: round2(clamp(1 - mutationChance * 0.9, 0.08, 1)),
  };

  const dna: Dna = {
    lineage: dedupeLineage([...parentA.dna.lineage, ...parentB.dna.lineage]),
    elementGenes,
    bodyGenes,
    statGenes,
    skillGenes,
    mutationGenes,
    archetype: normalisedArchetype,
    seed: childSeed,
  };

  // --- packages, stats, skills ----------------------------------------
  const budget = TIER_META[ctx.tier].budget;
  const packageCount = mutationTier === "micro" ? 1 : mutationTier === "minor" ? 2 : 2 + (rngTrait.bool(0.5) ? 1 : 0);
  const packages = pickPackages(rngTrait, normalisedArchetype, packageCount, mutationTier);

  const stats = statsFromGenes(dna, ctx.tier, undefined, packages);
  const potential = potentialFromGenes(dna, ctx.tier);

  const skillSeed = `${childSeed}|skill`;
  const skills = buildSkillsFromGenes(dna, packages, skillSeed, ctx.tier, mutationTier, targetRarity);

  // --- traits ----------------------------------------------------------
  const traitResult = assignTraits(rngTrait, dna, skills, packages, targetRarity, mutationTier);

  // --- build the plant --------------------------------------------------
  const child: Plant = {
    plantId: `p_${childSeed}_${ctx.attempt}`,
    ownerId: ctx.playerId,
    name: plantName(dna, traitResult.traits),
    generation: Math.max(parentA.generation, parentB.generation) + 1,
    baseLineage: dna.lineage,
    rarity: "C",
    rarityScore: 0,
    dna,
    visual: visualFromDna(dna, rngVisual, mutationTier),
    growth: {
      stage: "seed",
      stageStartedAt: now,
      stageReadyAt: now + 15_000,
      level: 1,
      xp: 0,
      careOpportunities: 0,
    },
    stats,
    potential,
    growthStats: {
      growthRate: round2(clamp(0.35 + normalisedArchetype.tempo * 0.4, 0.1, 1)),
      careEfficiency: round2(clamp(0.4 + mutationGenes.purity * 0.4, 0.1, 1)),
      mutationChance: round2(clamp(0.05 + mutationGenes.instability * 0.2, 0.02, 0.6)),
      breedingPower: round2(clamp(0.4 + mutationGenes.purity * 0.35 + normalisedArchetype.sustain * 0.15, 0.1, 1)),
      stability: round2(clamp(1 - mutationGenes.instability * 0.55, 0.12, 1)),
    },
    hidden: {
      temperament: round2((parentA.hidden.temperament + parentB.hidden.temperament) / 2 + rngTrait.float(-0.15, 0.15)),
      wildness: round2(mutationGenes.wildness),
      genePurity: round2(mutationGenes.purity),
      latentPower: round2(clamp((parentA.hidden.latentPower + parentB.hidden.latentPower) / 2 + rngTrait.float(-0.1, 0.2), 0, 1)),
      mutationDebt: round2(clamp(mutationChance * 0.5, 0, 0.6)),
    },
    skills,
    traits: traitResult.traits,
    mutations: [],
    parents: { a: parentA.plantId, b: parentB.plantId },
    archetype: normalisedArchetype,
    tier: ctx.tier,
    battleRecord: { wins: 0, losses: 0, draws: 0, scars: 0, streak: 0, bestStreak: 0 },
    careMemory: emptyCareMemory(),
    stress: { ...emptyStress(), mutationDebt: round2(mutationChance * 0.4) },
    mood: mutationTier === "chaotic" ? "unstable" : mutationTier === "major" ? "wild" : "calm",
    powerRating: 100,
    validation: { buildValue: 0, tierBudget: budget, ecr: 0.5, synergyTax: 0, invalidCombos: [], warnings: [], rankedLegal: true },
    locks: { favorite: false, manual: true, battle: false, breeding: false, transaction: false },
    economy: {
      purchaseCost: 0,
      investedMaterialValue: 0,
      careCycles: 0,
      expectedSellPrice: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  // --- rarity + validation ---------------------------------------------
  const rarityScore = computeRarityScore(child, mutationTier, packages, targetRarity);
  const rarity = rarityFromScore(rarityScore);
  child.rarityScore = round2(rarityScore);
  child.rarity = rarity;
  // High rarity auto-locks (docs/16 §20).
  if (["A", "S", "SS", "SSS"].includes(rarity)) child.locks.manual = true;
  child.economy.purchaseCost = 0;
  child.economy.investedMaterialValue = 0;

  // Enforce the band requirement: rarer bands get at least the needed mutation tier.
  if (RARITY_REQUIREMENT[rarity].minMutationTier > ["micro", "minor", "major", "chaotic"].indexOf(mutationTier)) {
    // Bump to the required tier without rerolling the whole plant.
    child.mutations.push({
      at: now,
      tier: mutationTier,
      label: MUTATION_TIER_META[mutationTier].label,
      detail: "Băng độ hiếm yêu cầu biến dạng lớn hơn.",
    });
  }

  // Keep the non-stat portion of the build from crowding out the stats. If
  // skills + traits alone would exceed their share of the tier budget, drop the
  // least valuable extras BEFORE fitting, so the fitter always has a stat lever.
  trimNonStatOverBudget(child, ctx.tier);

  // Pay for overspend / spend the slack before validating (docs/15 §10).
  fitToBudget(child);

  const validation = validateGenome(child);
  child.validation = validation;
  child.powerRating = Math.round(estimatePower(child));

  // --- report -----------------------------------------------------------
  const muts: MutationReport["mutations"] = [];
  const dom2 = dominantElement(elementGenes);
  const sec = secondaryElement(elementGenes);
  muts.push({
    tier: mutationTier,
    label: `Đột biến ${MUTATION_TIER_META[mutationTier].label}`,
    detail: mutationDetail(mutationTier, dna),
  });
  if (sec) {
    muts.push({ tier: "micro", label: "Song hệ", detail: `${dominantElementName(dom2.id)} chính, ${elementLabel(sec)} phụ.` });
  }
  if (mutationTier === "major" || mutationTier === "chaotic") {
    muts.push({ tier: mutationTier, label: "Tái cấu trúc", detail: "Ít nhất một bộ phận cơ thể đổi hoàn toàn." });
  }
  for (const t of traitResult.newTraits) {
    muts.push({ tier: mutationTier, label: "Đặc tính mới", detail: TRAITS_BY_ID[t]?.name ?? t });
  }
  if (child.skills.length > 1) {
    muts.push({ tier: "minor", label: "Chiêu thức", detail: "Thu được nhiều hơn một chiêu nhờ lai." });
  }

  for (const m of muts) {
    child.mutations.push({ at: now, tier: m.tier, label: m.label, detail: m.detail });
  }

  const domArch = dominantArchetype(normalisedArchetype);
  const report: BreedingResult = {
    plant: child,
    report: {
      childSeed,
      mutationTier,
      mutations: muts,
      inheritedTraits: traitResult.inherited,
      newTraits: traitResult.newTraits,
      rarity,
      rarityScore: round2(rarityScore),
      elementLine: sec ? `${dominantElementName(dom2.id)} / ${elementLabel(sec)}` : dominantElementName(dom2.id),
      headline: child.name,
      skillNames: child.skills.map((s) => s.name),
      packages: packages.map((p) => p.name),
      drawbacks: packages.flatMap((p) => p.requiresOneOf).map((d) => d),
      counters: [...new Set(packages.flatMap((p) => p.counterTags))],
      strengths: strengthLines(child, domArch),
      weaknesses: weaknessLines(child, domArch),
      generationFallbackUsed: false,
    },
  };
  return report;
}

function elementLabel(el: ElementId): string {
  return ELEMENT_INFO_NAME[el];
}

const ELEMENT_INFO_NAME: Record<ElementId, string> = {
  wood: "Mộc",
  fire: "Lửa",
  water: "Nước",
  earth: "Đất",
  electric: "Sét",
  poison: "Độc",
  light: "Quang",
  shadow: "Ám",
};

function dominantElementName(el: ElementId): string {
  return ELEMENT_INFO_NAME[el];
}

function dedupeLineage(list: SpeciesId[]): SpeciesId[] {
  const out: SpeciesId[] = [];
  for (const s of list) if (!out.includes(s)) out.push(s);
  return out.slice(0, 5);
}

function mutationTierWeights(chance: number, tier: CombatTier, breederLevel: number): number[] {
  const power = chance * (1 + (breederLevel / 50) * 0.25) + (TIER_ORDER.indexOf(tier) / TIER_ORDER.length) * 0.03;
  return [
    clamp(1 - power * 2.2, 0.05, 0.9), // micro
    clamp(0.5 - power * 0.4, 0.05, 0.6), // minor
    clamp(power * 0.7, 0.02, 0.35), // major
    clamp(power * 0.35, 0.005, 0.22), // chaotic
  ];
}

function weightedPick(weights: number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

function pickPackages(rng: Rng, archetype: Record<Archetype, number>, count: number, tier: MutationTier): GenePackage[] {
  const out: GenePackage[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const candidates = GENE_PACKAGES.filter((p) => !used.has(p.id));
    if (!candidates.length) break;
    const chosen = rng.weighted(candidates, (p) => {
      const archMatch = archetype[p.archetype];
      // Chaotic mutations reach for unstable packages.
      const rarityBias = tier === "chaotic" && p.preferredTraitRarity === "unstable" ? 0.4 : 1;
      return (0.15 + archMatch * 2.4) * rarityBias;
    });
    out.push(chosen);
    used.add(chosen.id);
  }
  return out;
}

/**
 * Natural stat expression. The gene value maps straight onto the tier
 * reference, so a mid-gene (0.5) plant lands at ~95% of the reference plant.
 * Budget fitting happens *after* generation (see `fitToBudget`) — never before,
 * otherwise every plant is generated weak and the budget check is meaningless.
 */
function statsFromGenes(dna: Dna, tierOrLevel: CombatTier | number, expression?: Record<string, number>, packages: GenePackage[] = []): Stats {
  const tier: CombatTier = typeof tierOrLevel === "number" ? "seedling" : tierOrLevel;
  const ref = TIER_META[tier].reference;
  const expr: Record<string, number> = expression ?? (Object.fromEntries(STAT_GENES.map((g) => [g, 1])) as Record<string, number>);

  const raw: Stats = {
    hp: ref.hp * (0.6 + dna.statGenes.hp * 0.7) * (expr.hp ?? 1),
    attack: ref.attack * (0.6 + dna.statGenes.attack * 0.7) * (expr.attack ?? 1),
    defense: ref.defense * (0.6 + dna.statGenes.defense * 0.7) * (expr.defense ?? 1),
    speed: ref.speed * (0.6 + dna.statGenes.speed * 0.7) * (expr.speed ?? 1),
    skillPower: ref.skillPower * (0.6 + dna.statGenes.skillPower * 0.7) * (expr.skillPower ?? 1),
    crit: clamp(0.03 + dna.statGenes.crit * 0.12 * (expr.crit ?? 1), 0.02, 0.55),
    evasion: clamp(0.02 + dna.statGenes.evasion * 0.12 * (expr.evasion ?? 1), 0.01, 0.45),
  };

  for (const p of packages) {
    for (const [stat, mult] of Object.entries(p.statGrants)) {
      if (stat in raw) (raw as unknown as Record<string, number>)[stat] *= mult;
    }
  }

  return {
    hp: Math.round(raw.hp),
    attack: Math.round(raw.attack),
    defense: Math.round(raw.defense),
    speed: Math.round(raw.speed),
    skillPower: Math.round(raw.skillPower),
    crit: round2(clamp(raw.crit, 0.01, 0.6)),
    evasion: round2(clamp(raw.evasion, 0, 0.5)),
  };
}

/**
 * docs/15 §10 steps 7-12: generate freely, price the build, then pay for any
 * overspend with expression — or spend the slack on stats. Only the numbers
 * move; the plant's identity (archetype, traits, skill composition) is fixed.
 *
 * Build value is monotonic in the expression scale, so a bisection converges in
 * a fixed number of rounds. A damped proportional step looks simpler but
 * oscillates: stat value has a very steep slope (~450 points per 1.0 of scale),
 * so any step large enough to matter overshoots into a limit cycle.
 */
export function fitToBudget(plant: Plant, iterations = 20): void {
  const tier = TIER_META[plant.tier];
  const target = tier.budget;
  const base = captureBase(plant);

  // If the un-scaled build is already non-positive its non-stat parts dominate
  // and no scale can express it; nudge up once and accept the result.
  if (buildValueOf(plant, tier) <= 0) {
    applyScale(plant, base, 1.8);
    if (buildValueOf(plant, tier) <= 0) return;
    restoreBase(plant, base);
  }

  const valueAt = (scale: number): number => buildValueOf(applyScale(plant, base, scale), tier);
  const start = valueAt(1);

  // Bracket the target. Build value rises monotonically with scale.
  let lo = 0.2;
  let hi = 4;
  if (start > target) lo = 1;
  else hi = 1;
  if (valueAt(lo) > target) lo = 0.2;
  if (valueAt(hi) < target) hi = 4;

  let best = 1;
  let bestErr = Math.abs(start - target);
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const v = valueAt(mid);
    const err = Math.abs(v - target);
    if (err < bestErr) {
      bestErr = err;
      best = mid;
    }
    if (v < target) lo = mid;
    else hi = mid;
  }

  applyScale(plant, base, best);
  // Over-budget builds also pay in cooldown, never in accuracy (docs/15 §12).
  if (best < 1) {
    const penalty = clamp(1 / best, 1, 1.35);
    for (const s of plant.skills) {
      if (s.cooldown < 12) s.cooldown = round2(s.cooldown * penalty);
    }
  }
}

interface StatSnapshot {
  stats: Plant["stats"];
  powers: number[];
}

function captureBase(plant: Plant): StatSnapshot {
  return { stats: { ...plant.stats }, powers: plant.skills.map((s) => s.power) };
}

function applyScale(plant: Plant, base: StatSnapshot, scale: number): Plant {
  const s = clamp(scale, 0.1, 6);
  for (const k of ["hp", "attack", "defense", "speed", "skillPower"] as const) {
    plant.stats[k] = Math.max(6, Math.round(base.stats[k] * s));
  }
  plant.stats.crit = round2(clamp(base.stats.crit * s, 0.01, 0.6));
  plant.stats.evasion = round2(clamp(base.stats.evasion * s, 0, 0.5));
  for (let i = 0; i < plant.skills.length; i++) {
    plant.skills[i].power = round2(Math.max(1, base.powers[i] * s));
  }
  return plant;
}

function restoreBase(plant: Plant, base: StatSnapshot): void {
  plant.stats = { ...base.stats };
  base.powers.forEach((p, i) => {
    if (plant.skills[i]) plant.skills[i].power = p;
  });
}

/**
 * Skills and traits may claim at most this share of the tier budget, leaving
 * the remainder to the five primary stats (docs/15 §4.2).
 */
const NON_STAT_SHARE = 0.72;

function trimNonStatOverBudget(plant: Plant, tier: CombatTier): void {
  const meta = TIER_META[tier];
  const cap = meta.budget * NON_STAT_SHARE;

  // First choice: weaken skills rather than remove them. Dropping a skill
  // concentrates the whole budget into raw stats, which produces stat-sticks
  // that beat every balanced benchmark — a worse failure than a weak skill.
  for (let guard = 0; guard < 20 && nonStatValueOf(plant, meta) > cap; guard++) {
    for (const s of plant.skills) {
      if (s.power > 3) s.power = round2(Math.max(3, s.power * 0.92));
    }
  }

  // If even the floor is not enough, drop the weakest skill.
  while (plant.skills.length > 1 && nonStatValueOf(plant, meta) > cap) {
    let weakest = 0;
    for (let i = 1; i < plant.skills.length; i++) {
      const a = plant.skills[i].power * plant.skills[i].budgetCost;
      const b = plant.skills[weakest].power * plant.skills[weakest].budgetCost;
      if (a < b) weakest = i;
    }
    plant.skills.splice(weakest, 1);
  }

  // Then drop the least valuable trait, so the build keeps its identity.
  while (plant.traits.length > 1 && nonStatValueOf(plant, meta) > cap) {
    let weakest = 0;
    let weakestValue = Infinity;
    for (let i = 0; i < plant.traits.length; i++) {
      const def = TRAITS_BY_ID[plant.traits[i]];
      const v = def ? (def.rarity === "common" ? 6 : def.rarity === "rare" ? 12 : 18) : 0;
      if (v < weakestValue) {
        weakestValue = v;
        weakest = i;
      }
    }
    plant.traits.splice(weakest, 1);
  }
}

/**
 * A skill's price: its budget cost, corrected by how strong it actually is and
 * by how often it can fire.
 *
 * Both corrections matter. Without the power term a DoT (low burst numbers) is
 * valued at almost nothing; without the cooldown term a 3-second skill costs the
 * same as a 9-second one, which makes fast skills free damage and lets them
 * dominate every matchup (docs/15 §12 prices cooldown explicitly).
 */
function skillValueOf(plant: Plant, tier: (typeof TIER_META)[CombatTier]): number {
  const typicalPower = Math.max(1, tier.reference.skillPower * 0.5);
  const typicalCooldown = TYPICAL_COOLDOWN;
  let sum = 0;
  for (const sk of plant.skills) {
    const powerFactor = clamp(sk.power / typicalPower, 0.45, 1.8);
    const cdFactor = clamp(1 + (typicalCooldown - sk.cooldown) / (typicalCooldown * 1.1), 0.55, 2.0);
    sum += sk.budgetCost * powerFactor * cdFactor;
  }
  return sum * (1 + SKILL_MANUAL_BONUS);
}

/** Reference cooldown a skill is priced around. */
const TYPICAL_COOLDOWN = 7;

function traitValueOf(plant: Plant): number {
  let v = 0;
  for (const t of plant.traits) {
    const def = TRAITS_BY_ID[t];
    if (!def) continue;
    v += def.rarity === "common" ? 6 : def.rarity === "rare" ? 12 : 18;
  }
  return v;
}

function elementValueOf(plant: Plant): number {
  return 5 + dominantElement(plant.dna.elementGenes).share * 15;
}

function utilityValueOf(plant: Plant): number {
  return plant.skills.length > 2 ? 6 : 2;
}

/** Everything in the build that is NOT the five primary stats. */
function nonStatValueOf(plant: Plant, tier: (typeof TIER_META)[CombatTier]): number {
  return skillValueOf(plant, tier) + traitValueOf(plant) + elementValueOf(plant) + utilityValueOf(plant);
}

/** The full build value, used by the budget fitter and the validator. */
function buildValueOf(plant: Plant, tier: (typeof TIER_META)[CombatTier]): number {
  const ref = tier.reference;
  let statValue = 0;
  statValue += (plant.stats.hp / ref.hp - 1) * 100 * STAT_COST.hp;
  const dps = plant.stats.attack * (1 + plant.stats.crit * 0.8);
  const refDps = ref.attack * (1 + ref.crit * 0.8);
  statValue += (dps / refDps - 1) * 100 * STAT_COST.sustainedDamage;
  statValue += (plant.stats.speed / ref.speed - 1) * 100 * STAT_COST.actionSpeed;
  statValue += (plant.stats.skillPower / ref.skillPower - 1) * 100 * STAT_COST.healing * 0.8;
  statValue += (plant.stats.crit - ref.crit) * 100 * STAT_COST.crit;
  statValue += (plant.stats.evasion - ref.evasion) * 100 * STAT_COST.evasion;
  return statValue + nonStatValueOf(plant, tier) - computeSynergyTax(plant);
}

function potentialFromGenes(dna: Dna, tier: CombatTier = "bloom"): Record<string, PotentialStat> {
  const ref = TIER_META[tier].reference;
  const out: Record<string, PotentialStat> = {};
  for (const g of STAT_GENES) {
    const base = g === "crit" || g === "evasion" ? ref[g] * 100 : ref[g];
    const soft = Math.round(base * (0.85 + dna.statGenes[g] * 0.7));
    out[g] = { softCap: soft, hardCap: Math.round(soft * 1.35) };
  }
  return out;
}

function visualFromDna(dna: Dna, rng: Rng, tier: MutationTier = "micro"): VisualGenes {
  const dom = dominantElement(dna.elementGenes);
  const baseHue = ELEMENT_HUE[dom.id] ?? 110;
  const complexity = clamp(
    0.3 +
      (Object.values(dna.bodyGenes).filter((v) => v !== "none").length / Object.keys(BODY_POOL).length) * 0.5 +
      (tier === "major" || tier === "chaotic" ? 0.2 : 0),
    0.15,
    1,
  );
  return {
    hue: round2((baseHue + rng.float(-18, 18) + 360) % 360),
    hueSpread: round2(rng.float(8, 40)),
    saturation: round2(clamp(0.35 + dom.share * 0.5 + rng.float(-0.1, 0.15), 0.2, 0.95)),
    lightness: round2(clamp(0.38 + rng.float(-0.08, 0.2), 0.25, 0.68)),
    accentHue: round2((baseHue + rng.float(60, 180) + 360) % 360),
    scale: round2(rng.float(0.8, 1.35)),
    complexity: round2(complexity),
    pattern: rng.pick(PATTERNS) as VisualGenes["pattern"],
    aura: (dna.bodyGenes.aura !== "none" ? dna.bodyGenes.aura : rng.pick(AURA_PALETTE)) as VisualGenes["aura"],
    size: dna.bodyGenes.size as VisualGenes["size"],
    eyeCount: rng.int(0, tier === "chaotic" ? 4 : tier === "major" ? 3 : 2),
    seedShape: rng.pick(SEED_SHAPES),
  };
}

const ELEMENT_HUE: Record<ElementId, number> = {
  wood: 110,
  fire: 18,
  water: 200,
  earth: 34,
  electric: 52,
  poison: 285,
  light: 48,
  shadow: 265,
};

function mutationDetail(tier: MutationTier, dna: Dna): string {
  const bodyBits = Object.entries(dna.bodyGenes).filter(([, v]) => v !== "none");
  const part = bodyBits.length ? rngFromString(dna.seed).pick(bodyBits)[0] : "thân";
  switch (tier) {
    case "micro":
      return `Màu và tỉ lệ ${bodyLabel(part)} lệch nhẹ.`;
    case "minor":
      return `${capitalise(bodyLabel(part))} thay đổi hình dáng và hiệu ứng nhỏ.`;
    case "major":
      return `${capitalise(bodyLabel(part))} tái cấu trúc hoàn toàn. Cây nhận vai trò chiến đấu mới.`;
    case "chaotic":
      return `${capitalise(bodyLabel(part))} méo mó khác thường. Cây mang quirk huyền thoại.`;
  }
}

function rngFromString(seed: string): Rng {
  return new Rng(seed);
}

function bodyLabel(part: string): string {
  const map: Record<string, string> = {
    stem: "thân",
    leaf: "lá",
    root: "rễ",
    flower: "hoa",
    fruit: "quả",
    thorn: "gai",
    fungus: "nấm",
    aura: "hào quang",
    pattern: "hoa văn",
    size: "kích thước",
  };
  return map[part] ?? part;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function computeRarityScore(child: Plant, tier: MutationTier, packages: GenePackage[], target: Rarity): number {
  // geneNovelty: how many body genes are non-default and element variety.
  const nonDefault = Object.values(child.dna.bodyGenes).filter((v) => v !== "none").length;
  const elementVariety = ELEMENTS.filter((el) => (child.dna.elementGenes[el] ?? 0) > 0.15).length;
  const geneNovelty = clamp((nonDefault / 8) * 0.6 + (elementVariety / 3) * 0.4, 0, 1);

  const mutationScore = MUTATION_TIER_META[tier].score / 46;

  // Module scarcity: rare traits + high-rarity packages.
  const rareTraits = child.traits.filter((t) => TRAITS_BY_ID[t] && TRAITS_BY_ID[t].rarity !== "common").length;
  const moduleScarcity = clamp((rareTraits * 0.3 + packages.filter((p) => p.preferredTraitRarity === "unstable").length * 0.15), 0, 1);

  // Visual uniqueness from spread + complexity.
  const visualUniqueness = clamp(child.visual.complexity * 0.6 + (child.visual.hueSpread / 40) * 0.4, 0, 1);

  // Ancestry depth.
  const ancestryDepth = clamp((child.generation - 1) / 12, 0, 1);

  // Skill complexity: more skills + higher tier of delivery.
  const skillComplexity = clamp((child.skills.length - 1) / 3 * 0.6 + child.skills.reduce((a, s) => a + s.budgetCost / 120, 0) / 2, 0, 1);

  // Stable expression: low instability scores higher.
  const stableExpression = clamp(1 - child.dna.mutationGenes.instability, 0, 1);

  let score =
    geneNovelty * 0.25 +
    mutationScore * 0.25 +
    moduleScarcity * 0.2 +
    visualUniqueness * 0.1 +
    ancestryDepth * 0.05 +
    skillComplexity * 0.1 +
    stableExpression * 0.05;

  score *= 100;
  // Nudge toward the rolled target band without breaking the content.
  const targetScore = RARITY_META[target].minScore + 5;
  score = score * 0.72 + targetScore * 0.28;
  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// traits
// ---------------------------------------------------------------------------

interface TraitAssignment {
  traits: string[];
  inherited: string[];
  newTraits: string[];
}

function assignTraits(
  rng: Rng,
  dna: Dna,
  skills: Skill[],
  packages: GenePackage[],
  target: Rarity,
  tier: MutationTier,
): TraitAssignment {
  const dom = dominantElement(dna.elementGenes);
  const arch = dominantArchetype(dna.archetype);
  const traits: string[] = [];
  const inherited: string[] = [];
  const newTraits: string[] = [];

  // How many traits this band deserves.
  const index = ["C", "B", "A", "S", "SS", "SSS"].indexOf(target);
  const wantCommon = index >= 1 ? 2 : 1;
  const wantRare = index >= 3 ? 1 : index >= 2 ? 1 : 0;
  const wantUnstable = index >= 4 || (tier === "chaotic" && rng.bool(0.4)) ? 1 : 0;

  const fits = (t: TraitDef): number => {
    let w = 1;
    if (t.fits.includes(arch)) w += 2;
    // Element match.
    const te = TRAIT_ELEMENTS[t.id];
    if (te?.includes(dom.id)) w += 1.5;
    // Skill synergy: control traits fit control skills.
    if (t.tags.includes("control") && skills.some((s) => s.tags.includes("control"))) w += 1;
    if (t.tags.includes("heal") && skills.some((s) => s.effect === "heal")) w += 0.8;
    return w;
  };

  const takeTrait = (rarityFilter: TraitRarityFilter, want: number) => {
    let taken = 0;
    const pool = TRAITS.filter((t) => t.rarity === rarityFilter && !traits.includes(t.id));
    for (const p of packages) {
      if (taken >= want) break;
      const preferred = pool.filter((t) => p.preferredTraitRarity === t.rarity);
      if (preferred.length && rng.bool(0.5)) {
        const chosen = rng.weighted(preferred, fits);
        if (!traits.includes(chosen.id)) {
          traits.push(chosen.id);
          newTraits.push(chosen.id);
          taken++;
        }
      }
    }
    while (taken < want && pool.length) {
      const chosen = rng.weighted(pool, fits);
      if (!traits.includes(chosen.id)) {
        traits.push(chosen.id);
        newTraits.push(chosen.id);
        taken++;
      }
      pool.splice(pool.indexOf(chosen), 1);
    }
  };

  takeTrait("common", wantCommon);
  takeTrait("rare", wantRare);
  takeTrait("unstable", wantUnstable);

  return { traits, inherited, newTraits };
}

type TraitRarityFilter = "common" | "rare" | "unstable";

// ---------------------------------------------------------------------------
// strength / weakness lines
// ---------------------------------------------------------------------------

function strengthLines(child: Plant, _arch: Archetype): string[] {
  const a = child.archetype;
  const entries = (Object.keys(a) as Archetype[])
    .map((k) => [k, a[k]] as const)
    .sort((x, y) => y[1] - x[1]);
  const out: string[] = [];
  const labels: Record<Archetype, string> = {
    tank: "Sinh tồn rất cao, chịu được nhiều đòn.",
    burst: "Sát thương đỉnh rất cao trong khoảng ngắn.",
    sustain: "Hồi phục và bào mòn tốt.",
    control: "Khoá nhịp và ép trạng thái đối thủ.",
    tempo: "Hành động nhanh, ép nhịp đối thủ.",
    counter: "Phản đòn và trừng phạt hành động.",
  };
  out.push(labels[entries[0][0]]);
  out.push(labels[entries[1][0]]);
  return out;
}

function weaknessLines(child: Plant, _arch: Archetype): string[] {
  const a = child.archetype;
  const entries = (Object.keys(a) as Archetype[])
    .map((k) => [k, a[k]] as const)
    .sort((x, y) => x[1] - y[1]);
  const weakness: Record<Archetype, string> = {
    tank: "Sát thương thấp, khó kết liễu nhanh.",
    burst: "Hồi chiêu dài, dễ bị đánh trước.",
    sustain: "Sợ đòn bùng nổ và cơ chế chống hồi máu.",
    control: "Sát thương thấp, hiệu ứng bị kháng.",
    tempo: "Mỗi đòn yếu, dễ bị phản đòn.",
    counter: "Yếu nếu không gặp đúng đối thủ.",
  };
  const out: string[] = [weakness[entries[0][0]], weakness[entries[1][0]]];
  const lowCooldown = child.skills.filter((s) => s.cooldown > 8).length;
  if (lowCooldown > 0) out.push(`Phụ thuộc ${lowCooldown} chiêu hồi lâu.`);
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// power rating + validation
// ---------------------------------------------------------------------------

export function estimatePower(plant: Plant): number {
  const s = plant.stats;
  const skillPower = plant.skills.reduce((a, sk) => a + sk.power, 0);
  const traitBonus = plant.traits.length * 12;
  const dominance = dominantArchetype(plant.archetype);
  const dominanceMult = 1 + plant.archetype[dominance] * 0.4;
  return (s.hp * 0.5 + s.attack * 2 + s.defense * 1.6 + s.speed * 1.5 + s.skillPower * 1.4 + skillPower * 1.2 + traitBonus) * dominanceMult;
}

/**
 * A compact fingerprint of everything that makes a plant *this* plant.
 *
 * Used by breeding to enforce "every offspring is a new kind" (docs/05 §11): the
 * store compares the child's signature against every plant already in the garden
 * and against both parents, re-rolling the crossover point while it matches.
 *
 * Deliberately covers genes, visuals and the assembled skill kit — two plants can
 * share a stat line and still read as completely different creatures, so a
 * stat-only signature would pass duplicates the player can see.
 */
export function genomeSignature(plant: Plant): string {
  const num = (o: Record<string, number | undefined>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${(o[k] ?? 0).toFixed(3)}`)
      .join(",");
  const str = (o: Record<string, string | undefined>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${o[k] ?? ""}`)
      .join(",");
  return [
    num(plant.dna.elementGenes as Record<string, number>),
    num(plant.dna.statGenes as Record<string, number>),
    num(plant.dna.skillGenes as Record<string, number>),
    str(plant.dna.bodyGenes as Record<string, string>),
    plant.visual.hue,
    plant.visual.complexity,
    plant.visual.pattern,
    plant.visual.aura,
    plant.visual.size,
    plant.skills.map((s) => `${s.name}:${s.power.toFixed(2)}`).join("+"),
    plant.traits.join("+"),
  ].join("|");
}

export function validateGenome(child: Plant): Plant["validation"] {
  const tier = TIER_META[child.tier];
  const ref = tier.reference;

  // --- stat value (docs/15 §5) ---
  let statValue = 0;
  // HP as effective HP vs reference.
  statValue += (child.stats.hp / ref.hp - 1) * 100 * STAT_COST.hp;
  // Sustained damage: attack weighted by expected crit output.
  const dps = child.stats.attack * (1 + child.stats.crit * 0.8);
  const refDps = ref.attack * (1 + ref.crit * 0.8);
  statValue += (dps / refDps - 1) * 100 * STAT_COST.sustainedDamage;
  // Action speed.
  statValue += (child.stats.speed / ref.speed - 1) * 100 * STAT_COST.actionSpeed;
  // Skill power.
  statValue += (child.stats.skillPower / ref.skillPower - 1) * 100 * STAT_COST.healing * 0.8;
  // Crit & evasion.
  statValue += (child.stats.crit - ref.crit) * 100 * STAT_COST.crit;
  statValue += (child.stats.evasion - ref.evasion) * 100 * STAT_COST.evasion;

  // --- skills / traits / element / utility ---
  // Priced by the same helpers the budget fitter uses, so the validator and the
  // fitter can never disagree about what a build is worth.
  const synergyTax = computeSynergyTax(child);
  const buildValue = statValue + nonStatValueOf(child, tier) - synergyTax;

  // --- forbidden combos ---
  const invalidCombos: string[] = [];
  const warnings: string[] = [];

  const totalEvasion = child.stats.evasion;
  if (totalEvasion > 0.6) invalidCombos.push("evasion_over_cap");

  // Continuous hard control check.
  let lockSeconds = 0;
  for (const sk of child.skills) {
    if (sk.effect === "stun") lockSeconds += sk.statusDuration * sk.statusChance;
    if (sk.effect === "root") lockSeconds += sk.statusDuration * sk.statusChance;
  }
  if (lockSeconds > 3) {
    warnings.push("hard_control_lock_high");
    if (lockSeconds > 4) invalidCombos.push("lock_too_long");
  }

  // One-shot check: a single burst that can kill from full.
  const maxHit = child.stats.attack * 3 + (child.stats.skillPower * 2);
  if (maxHit > ref.hp * 0.9 && child.stats.crit > 0.3) warnings.push("possible_one_shot");

  // Heals + shields stacking.
  const hasHeal = child.skills.some((s) => s.effect === "heal" || s.effect === "regen");
  const hasShield = child.skills.some((s) => s.effect === "shield");
  if (hasHeal && hasShield) warnings.push("heal_shield_stack");

  // Speed + on-hit synergy already taxed above.

  const ratio = buildValue / tier.budget;
  if (ratio < 1 - tier.tolerance) warnings.push("under_budget");
  if (ratio > 1 + tier.tolerance) warnings.push("over_budget");

  return {
    buildValue: round2(buildValue),
    tierBudget: tier.budget,
    synergyTax: round2(synergyTax),
    ecr: 0.5, // filled by the ECR calculator
    invalidCombos,
    warnings,
    rankedLegal: invalidCombos.length === 0,
  };
}

const SKILL_MANUAL_BONUS = 0.1;

function computeSynergyTax(plant: Plant): number {
  let tax = 0;
  const has = (pred: (s: Plant["skills"][number]) => boolean) => plant.skills.some(pred);

  // speed + on-hit dot
  if (plant.stats.speed > TIER_META[plant.tier].reference.speed * 1.2 && has((s) => s.effect === "dot")) {
    tax += 10 * 0.35 * 0.5;
  }
  // multihit + lifesteal
  if (has((s) => s.modifiers.includes("lifesteal"))) tax += 10 * 0.4 * 0.5;
  // heal + shield
  if (has((s) => s.effect === "heal") && has((s) => s.effect === "shield")) tax += 12 * 0.5;
  // root + bonus
  if (has((s) => s.effect === "root") && has((s) => s.effect === "damage")) tax += 8 * 0.4 * 0.5;
  // shield + break damage
  if (has((s) => s.effect === "shield") && has((s) => s.modifiers.includes("overgrow"))) tax += 9 * 0.3;
  return round2(tax);
}

