/**
 * Skill generation from gene weight (docs/14 §11-§12, docs/02 §8).
 *
 * Skills are compositions, not a fixed list. The generator reads the plant's
 * skillGenes + chosen packages, picks a delivery/effect/modifier set that
 * fits the element affinity, and then prices it against the power budget.
 */

import { Rng, clamp, round2 } from "../core/rng";
import type { ElementId } from "../config/elements";
import { dominantElement } from "../config/elements";
import type { SkillGeneId } from "../config/species";
import type { GenePackage } from "../config/genePackages";
import type { MutationTier, Rarity } from "../config/rarity";
import type { CombatTier } from "../config/balance";
import { TIER_META } from "../config/balance";
import {
  DELIVERIES,
  EFFECT_ELEMENT_AFFINITY,
  EFFECTS,
  SKILL_GENE_DELIVERY,
  composeSkillName,
  type Delivery,
  type EffectKind,
  type ModifierId,
} from "../config/skills";
import type { Dna, EvolutionNode, Skill } from "../core/types";

const SKILL_GENES: SkillGeneId[] = ["projectile", "melee", "aura", "trap", "dot", "heal", "shield", "control", "chain", "summon"];

const EFFECT_FOR_GENE: Partial<Record<SkillGeneId, EffectKind[]>> = {
  dot: ["dot"],
  heal: ["heal", "regen"],
  shield: ["shield"],
  control: ["slow", "stun", "root"],
  chain: ["chain", "damage"],
  projectile: ["damage"],
  melee: ["damage", "dot"],
  aura: ["damage", "slow"],
  trap: ["root", "slow", "dot"],
  summon: ["damage", "dot"],
};

export function buildSkillsFromGenes(
  dna: Dna,
  packages: GenePackage[],
  seed: string,
  tier: CombatTier,
  mutationTier: MutationTier = "micro",
  targetRarity: Rarity = "C",
): Skill[] {
  const rng = new Rng(seed);
  const dom = dominantElement(dna.elementGenes);
  const allowedForEffect = EFFECT_ELEMENT_AFFINITY;

  // How many active skills this plant is allowed.
  //
  // The floor used to be 1, so a common seedling came out with a single skill and
  // the battle action bar rendered as one lone button — the player had no choice
  // to make and the screen read as broken. Two is the minimum that makes the
  // bar a decision; the ceiling of four keeps the action bar on one row.
  const rarityIndex = ["C", "B", "A", "S", "SS", "SSS"].indexOf(targetRarity);
  const tierBonus = ["seedling", "sprout", "bloom", "ancient"].indexOf(tier);
  const wantCount = clamp(2 + Math.floor((rarityIndex + tierBonus) / 2) + (mutationTier === "chaotic" ? 1 : 0), 2, 4);

  // Candidate skill genes ranked by weight.
  const ranked = SKILL_GENES.map((g) => [g, dna.skillGenes[g] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const usedGenes = new Set<SkillGeneId>();
  const out: Skill[] = [];

  for (let i = 0; i < wantCount; i++) {
    // Pick the gene to build this skill around, avoiding repeats.
    const gene = ranked.find(([g]) => !usedGenes.has(g) && g !== "chain")?.[0] ?? ranked[i % ranked.length][0];
    usedGenes.add(gene);

    // Package bias: if a package names a delivery/effect, this skill honours it.
    const pkg = packages[i % Math.max(1, packages.length)];

    // --- delivery ---
    let delivery: Delivery;
    if (pkg?.delivery && SKILL_GENE_DELIVERY[gene].includes(pkg.delivery)) {
      delivery = pkg.delivery;
    } else {
      const options = SKILL_GENE_DELIVERY[gene];
      delivery = rng.weighted(options, (d) => {
        const def = DELIVERIES[d];
        // Prefer deliveries the element likes: aura for light, trap for earth, etc.
        const elementFit = elementDeliveryFit(d, dna.elementGenes);
        return 1 + elementFit * 1.5 + (def.budgetCost < 12 ? 0.3 : 0);
      });
    }

    // --- effect ---
    let effect: EffectKind;
    if (pkg?.effect && (EFFECT_FOR_GENE[gene]?.includes(pkg.effect) ?? false)) {
      effect = pkg.effect;
    } else {
      const candidates = (EFFECT_FOR_GENE[gene] ?? ["damage"]).filter((e) =>
        (allowedForEffect[e] ?? ["wood", "fire"]).includes(dom.id) || e === "damage" || e === "chain",
      );
      effect = rng.pick(candidates.length ? candidates : ["damage"]);
    }

    // --- element set (max 2) ---
    const elements: ElementId[] = [dom.id];
    const secondary = (Object.keys(dna.elementGenes) as ElementId[])
      .filter((k) => k !== dom.id && (dna.elementGenes[k] ?? 0) > 0.15)
      .sort((a, b) => (dna.elementGenes[b] ?? 0) - (dna.elementGenes[a] ?? 0))[0];
    const elementForEffect = (allowedForEffect[effect] ?? []).find((e) => e !== dom.id);
    if (rng.bool(0.5) && elementForEffect) elements.push(elementForEffect);
    else if (secondary && rng.bool(0.6)) elements.push(secondary);

    // --- modifiers ---
    const modifiers: ModifierId[] = [];
    if (pkg?.modifiers) {
      for (const m of pkg.modifiers) {
        // Only keep a fraction so budget can be enforced.
        if (rng.bool(0.65)) modifiers.push(m);
      }
    }
    if (delivery === "projectile" && rng.bool(0.3)) modifiers.push("bounce");
    if (rng.bool(0.2)) modifiers.push("crit_focus");
    if (rng.bool(0.18) && !modifiers.includes("lifesteal") && (effect === "damage" || effect === "dot")) {
      modifiers.push("lifesteal");
    }
    if (mutationTier === "chaotic" && rng.bool(0.5)) modifiers.push("double_edge");

    // Name.
    const name = composeSkillName(rng, delivery, elements[0], effect, modifiers[0] ?? null);

    const skill = materialiseSkill(
      { delivery, effect, elements: [...new Set(elements)], modifiers: [...new Set(modifiers)] },
      name,
      rng,
      dna,
      tier,
      mutationTier,
    );
    out.push(skill);
  }

  return out;
}

function elementDeliveryFit(delivery: Delivery, affinity: Record<ElementId, number>): number {
  let fit = 0;
  if (delivery === "aura") fit += (affinity.light ?? 0) * 2 + (affinity.poison ?? 0);
  if (delivery === "trap") fit += (affinity.earth ?? 0) * 2;
  if (delivery === "projectile") fit += (affinity.electric ?? 0) * 2 + (affinity.fire ?? 0);
  if (delivery === "chain" as Delivery) fit += (affinity.electric ?? 0) * 2;
  if (delivery === "summon") fit += (affinity.wood ?? 0) * 2;
  // Fire morphs into a berserker, earth into something armoured, shadow into
  // something that should not be where it was. Water is left out on purpose: a
  // plant that turns to water and hits harder does not read as anything.
  if (delivery === "morph") fit += (affinity.fire ?? 0) * 1.6 + (affinity.earth ?? 0) * 1.4 + (affinity.shadow ?? 0) * 1.2;
  if (delivery === "channel") fit += (affinity.water ?? 0) * 2;
  return fit;
}

function materialiseSkill(
  core: { delivery: Delivery; effect: EffectKind; elements: ElementId[]; modifiers: ModifierId[] },
  name: string,
  rng: Rng,
  dna: Dna,
  tier: CombatTier,
  mutationTier: MutationTier,
): Skill {
  const delivery = DELIVERIES[core.delivery];
  const effect = EFFECTS[core.effect];

  // Power scales with the skill gene of its primary effect.
  const geneWeight = 0.6 + rng.next() * 0.4;
  const tierScale = TIER_META[tier].reference.skillPower / 42;
  let power = effect.power * (18 + dna.statGenes.skillPower * 34) * geneWeight * tierScale;
  if (core.modifiers.includes("overgrow")) power *= 1.25;
  if (core.modifiers.includes("last_stand")) power *= 1.15;
  power = round2(power);

  let cooldown = round2(clamp(9 - delivery.budgetCost * 0.35 + rng.float(-1, 2), 3.5, 14));
  if (core.modifiers.includes("delayed")) cooldown += 0.6;

  let accuracy = round2(clamp(0.82 + rng.float(-0.06, 0.16), 0.6, 0.99));
  if (core.effect === "stun") accuracy -= 0.08;
  if (core.modifiers.includes("crit_focus")) accuracy += 0.04;
  accuracy = clamp(accuracy, 0.5, 0.99);

  const status = effect.status;
  let statusChance = status ? round2(clamp(status.chance + rng.float(-0.05, 0.1), 0.05, 0.95)) : 0;
  let statusDuration = status ? round2(status.duration + rng.float(-0.2, 0.6)) : 0;

  // Budget: total skill cost is priced and then capped by spending discounts.
  let cost = skillBudgetCost(core.delivery, core.effect, core.modifiers);
  const tierBudget = TIER_META[tier].budget;
  const skillShareCap = tierBudget * 0.42;
  // Trim power/cooldown until affordable if over the share.
  if (cost > skillShareCap) {
    const overFactor = skillShareCap / cost;
    power = round2(power * clamp(overFactor, 0.5, 1));
    cooldown = round2(cooldown * clamp(1 / overFactor, 1, 1.8));
    accuracy = clamp(accuracy - 0.05, 0.5, 0.99);
    statusChance = round2(statusChance * 0.85);
  }

  // Stability: high mutation, low purity, chaotic tier -> lower.
  let stability = clamp(
    0.95 - dna.mutationGenes.instability * 0.5 - (mutationTier === "chaotic" ? 0.25 : 0) + rng.float(-0.06, 0.06),
    0.2,
    0.99,
  );
  if (core.modifiers.includes("overgrow") || core.modifiers.includes("last_stand")) stability -= 0.08;
  stability = clamp(stability, 0.15, 0.99);

  const tags: string[] = [core.delivery, core.effect, ...core.elements];
  if (core.effect === "dot" || core.effect === "stun" || core.effect === "root" || core.effect === "slow") tags.push("control");

  const nodes = evolutionNodesFor(core);

  return {
    id: `sk_${core.delivery}_${core.effect}_${Math.floor(rng.next() * 1e6).toString(36)}`,
    name,
    core: { delivery: core.delivery, effect: core.effect, elements: core.elements, modifiers: core.modifiers },
    delivery: core.delivery,
    effect: core.effect,
    modifiers: core.modifiers,
    level: 1,
    masteryXp: 0,
    stability: round2(stability),
    cooldown,
    power,
    accuracy: round2(accuracy),
    statusChance,
    statusDuration,
    energyCost: core.effect === "heal" || core.effect === "shield" ? round2(clamp(18 + rng.float(-4, 8), 8, 30)) : 0,
    windup: delivery.windup,
    recovery: delivery.recovery,
    budgetCost: round2(cost),
    tags: [...new Set(tags)],
    evolutionNodes: nodes,
    lineage: { inheritedFrom: [], fusion: false },
  };
}

export function skillBudgetCost(delivery: Delivery, effect: EffectKind, modifiers: ModifierId[]): number {
  let cost = DELIVERIES[delivery].budgetCost + EFFECTS[effect].budgetCost;
  for (const m of modifiers) cost += modifierCost(m);
  return cost;
}

function modifierCost(m: ModifierId): number {
  const table: Record<ModifierId, number> = {
    bounce: 6,
    pierce: 5,
    lifesteal: 9,
    crit_focus: 7,
    chain_lightning: 8,
    thorn_bonus: 6,
    delayed: 3,
    widen: 7,
    overgrow: 8,
    drain: 6,
    double_edge: 4,
    last_stand: 10,
  };
  return table[m] ?? 5;
}

function evolutionNodesFor(core: { delivery: Delivery; effect: EffectKind; modifiers: ModifierId[] }): EvolutionNode[] {
  const nodes: EvolutionNode[] = [];
  const damageish = core.effect === "damage" || core.effect === "dot";

  // Level 3: pick a power or control node (docs/14 §8).
  const controlNode: EvolutionNode = {
    id: "control_burst",
    label: "Kiểm soát mạnh",
    description: damageish ? "+12% tỉ lệ gây trạng thái." : "+10% hiệu lực hồi/khiên.",
    unlockedAtLevel: 3,
    chosen: false,
    effect: damageish ? { statusChance: 0.12 } : { power: 0.1 },
  };
  const powerNode: EvolutionNode = {
    id: "power_surge",
    label: "Mạnh hơn",
    description: "+15% hiệu lực.",
    unlockedAtLevel: 3,
    chosen: false,
    effect: { power: 0.15 },
  };
  nodes.push(controlNode, powerNode);

  // Level 6: second choice.
  const coolNode: EvolutionNode = {
    id: "haste",
    label: "Rút gọn hồi chiêu",
    description: "-12% thời gian hồi.",
    unlockedAtLevel: 6,
    chosen: false,
    effect: { cooldown: -0.12 },
  };
  const pierceNode: EvolutionNode = {
    id: "pierce_armor",
    label: "Xuyên giáp",
    description: "Bỏ qua 30% giáp đối thủ.",
    unlockedAtLevel: 6,
    chosen: false,
    effect: { accuracy: 0.08 },
  };
  nodes.push(coolNode, pierceNode);

  return nodes;
}

// --- skill XP (docs/14 §5) ------------------------------------------------

export function addSkillXp(skill: Skill, xp: number): { leveled: boolean; messages: string[] } {
  const messages: string[] = [];
  const curve = [0, 30, 80, 150, 260, 420, 650, 950, 1350, 1900];
  let leveled = false;
  skill.masteryXp += xp;
  while (skill.level < curve.length && skill.masteryXp >= curve[skill.level]) {
    skill.masteryXp -= curve[skill.level];
    skill.level++;
    leveled = true;
    const gain = applyLevelGrowth(skill, skill.level);
    messages.push(`${skill.name} lên cấp ${skill.level}! ${gain}`);
    if (skill.level === 3 || skill.level === 6) {
      messages.push(`Mở node tiến hóa cho ${skill.name}.`);
    }
  }
  return { leveled, messages };
}

function applyLevelGrowth(skill: Skill, level: number): string {
  const gains: string[] = [];
  // Alternate what improves so a skill doesn't max everything (docs/14 §7).
  if (level % 2 === 0) {
    skill.power = round2(skill.power * 1.05);
    gains.push(`+5% sức`);
  } else {
    skill.cooldown = round2(Math.max(2.5, skill.cooldown * 0.95));
    gains.push("-5% hồi chiêu");
  }
  if (level % 3 === 0) {
    skill.statusChance = round2(clamp(skill.statusChance + 0.02, 0, 0.95));
    gains.push("+2% trạng thái");
  }
  if (level >= 7) {
    skill.accuracy = round2(clamp(skill.accuracy + 0.02, 0.5, 0.99));
    gains.push("+2% chính xác");
  }
  return gains.join(", ");
}
