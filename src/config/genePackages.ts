/**
 * Gene packages (docs/15 §8). A package is a coherent cluster of grants that
 * MUST be paid for with a drawback. The generator never emits a package without
 * a matching counter tag, which is what keeps infinite variety from breaking
 * the game.
 */

import type { Archetype } from "../config/species";
import type { Delivery, EffectKind, ModifierId } from "../config/skills";
import type { TraitRarity } from "../config/traits";

export interface GenePackage {
  id: string;
  name: string;
  archetype: Archetype;
  /** Stat multipliers applied to the plant's expression. */
  statGrants: Record<string, number>;
  /** Skill shape this package biases toward. */
  delivery?: Delivery;
  effect?: EffectKind;
  modifiers?: ModifierId[];
  /** At least one must be applied. */
  requiresOneOf: string[];
  counterTags: string[];
  budgetCost: number;
  preferredTraitRarity: TraitRarity;
}

export const GENE_PACKAGES: readonly GenePackage[] = [
  // tank
  {
    id: "bark_wall",
    name: "Vỏ Thành Trì",
    archetype: "tank",
    statGrants: { hp: 1.18, defense: 1.15 },
    requiresOneOf: ["speed_low", "attack_low"],
    counterTags: ["pierce", "drain", "sustain"],
    budgetCost: 26,
    preferredTraitRarity: "common",
  },
  {
    id: "deep_root_hold",
    name: "Rễ Bám Sâu",
    archetype: "tank",
    statGrants: { hp: 1.1, defense: 1.08, evasion: 0.9 },
    delivery: "trap",
    effect: "root",
    requiresOneOf: ["speed_low", "cooldown_long"],
    counterTags: ["evade", "crit"],
    budgetCost: 22,
    preferredTraitRarity: "common",
  },
  // burst
  {
    id: "glass_cannon_bloom",
    name: "Kính Vỡ",
    archetype: "burst",
    statGrants: { attack: 1.22, crit: 1.18, hp: 0.82 },
    delivery: "projectile",
    requiresOneOf: ["hp_low", "defense_low", "cooldown_long"],
    counterTags: ["shield", "dodge", "survive_burst"],
    budgetCost: 30,
    preferredTraitRarity: "rare",
  },
  {
    id: "flash_ignition",
    name: "Đốm Lửa",
    archetype: "burst",
    statGrants: { attack: 1.15, speed: 1.12, crit: 1.1 },
    delivery: "projectile",
    effect: "dot",
    modifiers: ["widen"],
    requiresOneOf: ["hp_low", "evasion_low"],
    counterTags: ["heal", "shield"],
    budgetCost: 27,
    preferredTraitRarity: "common",
  },
  {
    id: "overpressure",
    name: "Áp Quá Tải",
    archetype: "burst",
    statGrants: { attack: 1.3, crit: 1.25 },
    modifiers: ["overgrow", "double_edge"],
    requiresOneOf: ["self_damage"],
    counterTags: ["heal", "cleanse"],
    budgetCost: 34,
    preferredTraitRarity: "unstable",
  },
  // sustain
  {
    id: "deep_wellspring",
    name: "Mạch Nước Sâu",
    archetype: "sustain",
    statGrants: { hp: 1.12, skillPower: 1.1 },
    delivery: "aura",
    effect: "heal",
    requiresOneOf: ["attack_low", "speed_low"],
    counterTags: ["anti_heal", "burst", "timeout"],
    budgetCost: 24,
    preferredTraitRarity: "common",
  },
  {
    id: "vampiric_root",
    name: "Rễ Hút",
    archetype: "sustain",
    statGrants: { attack: 0.95, hp: 1.05 },
    modifiers: ["lifesteal"],
    requiresOneOf: ["attack_low"],
    counterTags: ["heal_reduction", "burst"],
    budgetCost: 28,
    preferredTraitRarity: "rare",
  },
  {
    id: "regrowth_engine",
    name: "Máy Tái Tạo",
    archetype: "sustain",
    statGrants: { hp: 1.15, defense: 1.05, skillPower: 1.05 },
    delivery: "aura",
    effect: "regen",
    requiresOneOf: ["speed_low"],
    counterTags: ["burn", "anti_heal", "burst"],
    budgetCost: 29,
    preferredTraitRarity: "rare",
  },
  // control
  {
    id: "root_prison",
    name: "Ngục Rễ",
    archetype: "control",
    statGrants: { skillPower: 1.12, attack: 0.9 },
    delivery: "trap",
    effect: "root",
    requiresOneOf: ["attack_low"],
    counterTags: ["cleanse", "burst"],
    budgetCost: 25,
    preferredTraitRarity: "common",
  },
  {
    id: "pollen_choke",
    name: "Phấn Nghẹt",
    archetype: "control",
    statGrants: { skillPower: 1.3, attack: 0.88 },
    delivery: "aura",
    effect: "stun",
    requiresOneOf: ["attack_low", "cooldown_long"],
    counterTags: ["status_resist", "burst"],
    budgetCost: 31,
    preferredTraitRarity: "rare",
  },
  {
    id: "toxin_engine",
    name: "Cỗ Máy Độc",
    archetype: "control",
    statGrants: { skillPower: 1.26 },
    effect: "dot",
    requiresOneOf: ["burst_low"],
    counterTags: ["cleanse", "earth_resist"],
    budgetCost: 26,
    preferredTraitRarity: "common",
  },
  // tempo
  {
    id: "quickfire_vine",
    name: "Dây Liên Tục",
    archetype: "tempo",
    statGrants: { speed: 1.2, attack: 1.05, hp: 0.9 },
    modifiers: ["chain_lightning"],
    requiresOneOf: ["hp_low", "defense_low"],
    counterTags: ["slow", "root", "burst"],
    budgetCost: 25,
    preferredTraitRarity: "common",
  },
  {
    id: "blink_seed",
    name: "Hạt Nhảy",
    archetype: "tempo",
    statGrants: { speed: 1.25, evasion: 1.2, attack: 0.95, hp: 0.9 },
    requiresOneOf: ["defense_low"],
    counterTags: ["root", "evade_wreck", "accurate"],
    budgetCost: 28,
    preferredTraitRarity: "rare",
  },
  {
    id: "chain_conductor",
    name: "Dây Dẫn Sét",
    archetype: "tempo",
    statGrants: { speed: 1.12, skillPower: 1.1, crit: 1.1 },
    modifiers: ["chain_lightning", "bounce"],
    requiresOneOf: ["hp_low", "accuracy_low"],
    counterTags: ["ground", "burst"],
    budgetCost: 30,
    preferredTraitRarity: "rare",
  },
  // counter
  {
    id: "thorn_retaliator",
    name: "Gai Phản Đòn",
    archetype: "counter",
    statGrants: { defense: 1.1, hp: 1.05, attack: 0.95 },
    modifiers: ["thorn_bonus"],
    requiresOneOf: ["attack_low"],
    counterTags: ["pierce", "drain"],
    budgetCost: 23,
    preferredTraitRarity: "common",
  },
  {
    id: "mirror_bark",
    name: "Vỏ Gương",
    archetype: "counter",
    statGrants: { defense: 1.18, attack: 0.88, evasion: 1.1 },
    modifiers: ["double_edge"],
    requiresOneOf: ["attack_low"],
    counterTags: ["reflect_lock", "pierce"],
    budgetCost: 27,
    preferredTraitRarity: "rare",
  },
  {
    id: "cleanse_purge",
    name: "Tẩy Rửa",
    archetype: "counter",
    statGrants: { skillPower: 1.1, defense: 1.05, attack: 0.9 },
    effect: "cleanse",
    requiresOneOf: ["attack_low"],
    counterTags: ["burst", "status_pressure"],
    budgetCost: 22,
    preferredTraitRarity: "common",
  },
  // hybrid / utility
  {
    id: "dual_element_core",
    name: "Lõi Song Hệ",
    archetype: "counter",
    statGrants: { skillPower: 1.26 },
    requiresOneOf: ["purity_low"],
    counterTags: ["single_element_counter"],
    budgetCost: 26,
    preferredTraitRarity: "rare",
  },
  {
    id: "wild_chimera",
    name: "Dị Thể Hoang Dã",
    archetype: "counter",
    statGrants: { crit: 1.2, speed: 1.12, hp: 0.88 },
    requiresOneOf: ["stability_low"],
    counterTags: ["predictable", "sustain"],
    budgetCost: 32,
    preferredTraitRarity: "unstable",
  },
  {
    id: "unstable_reactor",
    name: "Lò Phản Ứng Mất Ổn",
    archetype: "burst",
    statGrants: { skillPower: 1.28, crit: 1.2 },
    modifiers: ["overgrow", "last_stand"],
    requiresOneOf: ["stability_low", "self_damage"],
    counterTags: ["heal", "cleanse", "shield"],
    budgetCost: 36,
    preferredTraitRarity: "unstable",
  },
];

export const GENE_PACKAGES_BY_ID: Record<string, GenePackage> = Object.fromEntries(GENE_PACKAGES.map((p) => [p.id, p]));

export const DRAWBACK_LABEL: Record<string, string> = {
  speed_low: "tốc độ thấp",
  attack_low: "sát thương thấp",
  defense_low: "phòng thủ thấp",
  hp_low: "mỏng manh",
  evasion_low: "dễ trúng đòn",
  accuracy_low: "kém chính xác",
  cooldown_long: "hồi chiêu dài",
  self_damage: "tự mất máu khi ra chiêu",
  stability_low: "khó kiểm soát",
  purity_low: "gene loãng",
  burst_low: "không có sát thương bùng nổ",
};

export const COUNTER_TAG_LABEL: Record<string, string> = {
  pierce: "xuyên giáp",
  drain: "rút máu",
  sustain: "bào mòn",
  evade: "né tránh",
  crit: "chí mạng",
  shield: "khiên chắn",
  dodge: "lướt khỏi đòn",
  survive_burst: "sống sót qua đòn bùng nổ",
  heal: "hồi máu",
  anti_heal: "chống hồi máu",
  burst: "đòn bùng nổ",
  timeout: "kéo dài trận",
  cleanse: "tẩy sạch",
  heal_reduction: "giảm hồi máu",
  status_resist: "kháng trạng thái",
  burn: "thiêu đốt",
  slow: "làm chậm",
  root: "trói rễ",
  grounded: "dẫn đất",
  accurate: "đánh chính xác",
  evade_wreck: "phá né tránh",
  reflect_lock: "khoá phản đòn",
  status_pressure: "ép trạng thái",
  single_element_counter: "đọc đúng hệ",
  predictable: "dễ đoán",
  purity: "gene thuần",
};
