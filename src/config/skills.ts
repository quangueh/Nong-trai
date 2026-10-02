/**
 * Skill module registry (docs/02 §8, docs/14 §2-§13).
 *
 * A skill is a composition of modules, not a row in a table. The generator
 * picks delivery + effect + modifier from gene weight, then the naming step
 * produces a Vietnamese name from the composition.
 */

import type { ElementId } from "./elements";
import type { SkillGeneId } from "./species";
import type { Rng } from "../core/rng";

export type Delivery = "projectile" | "melee" | "aura" | "trap" | "channel" | "summon" | "morph";
export type EffectKind =
  | "damage"
  | "dot"
  | "heal"
  | "shield"
  | "slow"
  | "stun"
  | "root"
  | "chain"
  | "regen"
  | "cleanse";

export type ModifierId =
  | "bounce"
  | "pierce"
  | "lifesteal"
  | "crit_focus"
  | "chain_lightning"
  | "thorn_bonus"
  | "delayed"
  | "widen"
  | "overgrow"
  | "drain"
  | "double_edge"
  | "last_stand";

export interface DeliveryDef {
  id: Delivery;
  name: string;
  /** Damage delivered as a fraction of a raw single hit (aura hits harder, traps weaker). */
  hitFactor: number;
  /** Ticks per cast for damage-over-time style deliveries. */
  ticks: number;
  windup: number;
  recovery: number;
  budgetCost: number;
  colour: string;
}

export const DELIVERIES: Record<Delivery, DeliveryDef> = {
  projectile: { id: "projectile", name: "Phun", hitFactor: 1.0, ticks: 1, windup: 0.35, recovery: 0.2, budgetCost: 8, colour: "#ffd166" },
  melee: { id: "melee", name: "Vung", hitFactor: 1.15, ticks: 1, windup: 0.2, recovery: 0.35, budgetCost: 6, colour: "#9ae6b4" },
  aura: { id: "aura", name: "Toả", hitFactor: 0.9, ticks: 2, windup: 0.5, recovery: 0.4, budgetCost: 12, colour: "#c8a2ff" },
  trap: { id: "trap", name: "Bẫy", hitFactor: 0.8, ticks: 1, windup: 0.9, recovery: 0.5, budgetCost: 10, colour: "#8ecae6" },
  channel: { id: "channel", name: "Dây chuyền", hitFactor: 1.05, ticks: 1, windup: 0.45, recovery: 0.3, budgetCost: 14, colour: "#f4a261" },
  summon: { id: "summon", name: "Mọc", hitFactor: 0.7, ticks: 3, windup: 0.6, recovery: 0.5, budgetCost: 18, colour: "#b8f2a0" },
  // The longest windup of any striking delivery, and deliberately so: the plant
  // spends it defenceless, which is what makes morphing a decision.
  morph: { id: "morph", name: "Biến hình", hitFactor: 0.9, ticks: 1, windup: 0.5, recovery: 0.45, budgetCost: 20, colour: "#ff9f68" },
};

export interface EffectDef {
  id: EffectKind;
  name: string;
  budgetCost: number;
  /** Damage/heal expressed as skillPower multipliers. */
  power: number;
  status?: { kind: "poison" | "burn" | "slow" | "stun" | "root"; chance: number; duration: number };
}

export const EFFECTS: Record<EffectKind, EffectDef> = {
  damage: { id: "damage", name: "Sát thương", budgetCost: 10, power: 1.0 },
  dot: {
    id: "dot",
    name: "Độc lan",
    budgetCost: 12,
    power: 0.45,
    status: { kind: "poison", chance: 0.6, duration: 4 },
  },
  heal: { id: "heal", name: "Hồi máu", budgetCost: 12, power: 0.9 },
  shield: {
    id: "shield",
    name: "Khiên",
    budgetCost: 11,
    power: 0.8,
    status: { kind: "slow", chance: 0, duration: 0 },
  },
  slow: {
    id: "slow",
    name: "Làm chậm",
    budgetCost: 9,
    power: 0.25,
    status: { kind: "slow", chance: 0.55, duration: 3 },
  },
  stun: {
    id: "stun",
    name: "Choáng",
    budgetCost: 18,
    power: 0.2,
    status: { kind: "stun", chance: 0.3, duration: 1.1 },
  },
  root: {
    id: "root",
    name: "Trói rễ",
    budgetCost: 12,
    power: 0.2,
    status: { kind: "root", chance: 0.5, duration: 2.2 },
  },
  chain: { id: "chain", name: "Lan truyền", budgetCost: 14, power: 0.55 },
  regen: { id: "regen", name: "Tái tạo", budgetCost: 15, power: 0.7 },
  cleanse: { id: "cleanse", name: "Tẩy sạch", budgetCost: 8, power: 0 },
};

export const MODIFIERS: Record<ModifierId, { name: string; budgetCost: number; desc: string }> = {
  bounce: { name: "Nảy", budgetCost: 6, desc: "Phản lại 1 lần sang mục tiêu dự phòng." },
  pierce: { name: "Xuyên", budgetCost: 5, desc: "Bỏ qua 30% giáp." },
  lifesteal: { name: "Hút máu", budgetCost: 9, desc: "Hồi 18% sát thương gây ra." },
  crit_focus: { name: "Tập trung chí mạng", budgetCost: 7, desc: "+18% tỉ lệ chí mạng khi ra chiêu." },
  chain_lightning: { name: "Dây sét nối", budgetCost: 8, desc: "Nảy điện sang 2 mục tiêu." },
  thorn_bonus: { name: "Gai phản đòn", budgetCost: 6, desc: "Trả lại 20% sát thương khi bị đánh." },
  delayed: { name: "Trễ", budgetCost: 3, desc: "Đòn trễ 0.6s nhưng trộn hơn." },
  widen: { name: "Quang đại", budgetCost: 7, desc: "Bán kính ảnh hưởng +60%." },
  overgrow: { name: "Vượt tầm", budgetCost: 8, desc: "+25% sát thương, tốn thêm 20% nhựa." },
  drain: { name: "Hút nhựa", budgetCost: 6, desc: "Hồi 10% nhựa khi trúng." },
  double_edge: { name: "Lưỡi hai", budgetCost: 4, desc: "Tự mất 8% HP khi ra chiêu." },
  last_stand: { name: "Cùng đường", budgetCost: 10, desc: "Gây gấp đôi khi HP dưới 30%." },
};

export const MODIFIER_LIST = Object.values(MODIFIERS);

/** Skill gene -> which deliveries it unlocks. */
export const SKILL_GENE_DELIVERY: Record<SkillGeneId, Delivery[]> = {
  projectile: ["projectile"],
  // Morph sits beside melee because it is a body change rather than a
  // projectile: it only makes sense on something with a body to change.
  melee: ["melee", "channel", "morph"],
  aura: ["aura"],
  trap: ["trap"],
  dot: ["aura", "projectile"],
  heal: ["aura", "channel"],
  shield: ["aura", "channel"],
  control: ["trap", "aura", "projectile"],
  chain: ["projectile", "aura"],
  // A summoning gene can also reshape the caster, which reads as the same
  // instinct: this plant makes more of itself.
  summon: ["summon", "morph"],
};

export const SKILL_GENE_LABEL: Record<SkillGeneId, string> = {
  projectile: "Phun",
  melee: "Vung",
  aura: "Toả",
  trap: "Bẫy",
  dot: "Độc lan",
  heal: "Hồi máu",
  shield: "Khiên",
  control: "Khống chế",
  chain: "Lan truyền",
  summon: "Mọc mầm",
};

// --- naming (docs/14 §13) ------------------------------------------------

const DELIVERY_WORD: Record<Delivery, string[]> = {
  projectile: ["Gai", "Hạt", "Tia", "Mũi", "Chuỳ"],
  // Morph names read as a body changing rather than a thing being thrown.
  morph: ["Cú", "Bọt", "Hình", "Bộ", "Thú"],
  melee: ["Dây", "Rễ", "Cánh", "Cào", "Quấn"],
  aura: ["Tinh", "Bào", "Màn", "Sương", "Đám"],
  trap: ["Lưới", "Bẫy", "Hào", "Bọc", "Chân"],
  channel: ["Dây", "Sợi", "Xích", "Leo", "Trợn"],
  summon: ["Mầm", "Chi", "Đàn", "Lũ", "Đội"],
};

const ELEMENT_WORD: Partial<Record<ElementId, string[]>> = {
  fire: ["Lửa", "Nóng", "Đỏ", "Thiêu"],
  water: ["Sương", "Nước", "Lạnh", "Mưa"],
  earth: ["Đất", "Đá", "Nặng", "Cát"],
  electric: ["Sét", "Tia", "Điện", "Chớp"],
  poison: ["Độc", "Mủ", "Thối", "Mởm"],
  light: ["Quang", "Nắng", "Hào", "Lấp"],
  shadow: ["Ám", "Tối", "Huyền", "Khuất"],
  wood: ["Gai", "Lá", "Cành", "Nhựa"],
};

const EFFECT_WORD: Record<EffectKind, string[]> = {
  damage: ["Đâm", "Phá", "Xé", "Bổ"],
  dot: ["Ăn Mòn", "Mủ", "Thối Rữa", "Rỉ Sỉ"],
  heal: ["Hồi Sinh", "Mát", "Lành", "Dinh Dưỡng"],
  shield: ["Khiên", "Giáp", "Thuẫn", "Ấn"],
  slow: ["Kìm", "Ghì Chân", "Trì Hoãn", "Bám Bớt"],
  stun: ["Ru Ngủ", "Choáng", "Hôn Mê", "Đứng Hình"],
  root: ["Trói", "Giam", "Bám", "Ghì"],
  chain: ["Nảy", "Lan", "Truyền", "Nhảy"],
  regen: ["Tái Tạo", "Mọc Lại", "Đâm Nhẫy", "Lớn"],
  cleanse: ["Tẩy", "Gột", "Rửa", "Khử"],
};
EFFECT_WORD.slow = ["Kìm", "Ghì Chân", "Trì Hoãn", "Bám Bớt"];

const MODIFIER_WORD: Partial<Record<ModifierId, string>> = {
  bounce: "Nảy",
  pierce: "Xuyên",
  lifesteal: "Hút Máu",
  crit_focus: "Tập Trung",
  chain_lightning: "Nối Sét",
  thorn_bonus: "Phản Gai",
  delayed: "Trễ",
  widen: "Quang Đại",
  overgrow: "Vượt Tầm",
  drain: "Hút Nhựa",
  double_edge: "Lưỡi Hai",
  last_stand: "Cùng Đường",
};

export function composeSkillName(
  rng: Rng,
  delivery: Delivery,
  element: ElementId,
  effect: EffectKind,
  modifier: ModifierId | null,
): string {
  const d = rng.pick(DELIVERY_WORD[delivery]);
  const e = rng.pick(ELEMENT_WORD[element] ?? ["Gai"]);
  const f = rng.pick(EFFECT_WORD[effect]);
  let name = `${d} ${e} ${f}`;
  if (modifier && rng.next() < 0.45) {
    name = `${name} ${MODIFIER_WORD[modifier] ?? ""}`;
  }
  return name.replace(/\s+/g, " ").trim();
}

/** Element affinity allowed per effect — keeps generated skills coherent. */
export const EFFECT_ELEMENT_AFFINITY: Partial<Record<EffectKind, ElementId[]>> = {
  dot: ["poison", "water", "wood", "shadow"],
  heal: ["water", "light", "wood"],
  shield: ["earth", "wood", "water", "light"],
  stun: ["electric", "light", "wood"],
  root: ["earth", "wood", "water"],
  slow: ["water", "poison", "wood", "shadow"],
  chain: ["electric", "fire"],
  regen: ["wood", "water", "light"],
  damage: ["wood", "fire", "electric", "earth", "water", "shadow", "light", "poison"],
  cleanse: ["light", "water"],
};
