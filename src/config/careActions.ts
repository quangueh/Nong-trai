/** Care actions (docs/01 §5, docs/12 §5). */

import type { StatGeneId } from "./species";

export type CareActionId =
  | "water"
  | "sunlight"
  | "fertilizer"
  | "pruning"
  | "music"
  | "moonlight"
  | "gene_serum";

/**
 * Every id here must resolve to a field that is actually read by a mechanic —
 * `stats.*` for combat stats, `growthStats.mutationChance` / `growthStats.growthRate`
 * for farm-side effects. Earlier ids like statusPower/elementPower had no home:
 * the gain was rolled, announced, and silently discarded. Weights that used them
 * now feed skillPower instead, which is where status and elemental potency
 * actually flow (skill strength covers both).
 */
export type GrowthStatId = StatGeneId | "skillPower" | "growthRate" | "mutationChance";

export type StressKind = "overwater" | "heat" | "overfeed" | "mutationDebt" | "battleFatigue" | "neglect";

export interface CareActionDef {
  id: CareActionId;
  name: string;
  emoji: string;
  /** Resource cost. */
  cost: { leafCoin?: number; items?: number; geneCrystal?: number };
  cooldownSeconds: number;
  primary: Partial<Record<GrowthStatId, number>>;
  secondary: Partial<Record<GrowthStatId, number>>;
  riskTags: string[];
  /** Care actions that a skill may be tagged with, for skill XP (docs/14 §10). */
  skillTags: string[];
  baseGain: number;
  description: string;
  /** Element affinity nudge. */
  affinity?: { element: string; delta: number };
}

export const CARE_ACTIONS: Record<CareActionId, CareActionDef> = {
  water: {
    id: "water",
    name: "Tưới nước",
    emoji: "💧",
    cost: { items: 1 },
    cooldownSeconds: 45,
    primary: { hp: 0.6, defense: 0.25 },
    secondary: { skillPower: 0.1, growthRate: 0.05 },
    riskTags: ["overwater"],
    skillTags: ["heal", "shield", "regen"],
    baseGain: 5,
    description: "Tăng HP và độ bền. Tưới liên tục sẽ úng.",
    affinity: { element: "water", delta: 0.01 },
  },
  sunlight: {
    id: "sunlight",
    name: "Ánh sáng",
    emoji: "☀️",
    cost: { leafCoin: 5 },
    cooldownSeconds: 60,
    primary: { attack: 0.55, skillPower: 0.2 },
    secondary: { growthRate: 0.15, crit: 0.1 },
    riskTags: ["heat"],
    skillTags: ["fire", "burst", "attack"],
    baseGain: 5,
    description: "Tăng sát thương và đẩy nhanh quá trình lớn. Quá nhiều sẽ héo.",
    affinity: { element: "fire", delta: 0.012 },
  },
  fertilizer: {
    id: "fertilizer",
    name: "Bón phân",
    emoji: "💩",
    cost: { leafCoin: 12 },
    cooldownSeconds: 90,
    primary: { attack: 0.3, hp: 0.3, defense: 0.25, speed: 0.15 },
    secondary: { mutationChance: 0.1 },
    riskTags: ["overfeed"],
    skillTags: ["dot", "growth"],
    baseGain: 6,
    description: "Tăng ngẫu nhiên một chỉ số, có cơ hội đột biến nhỏ.",
  },
  pruning: {
    id: "pruning",
    name: "Cắt tỉa",
    emoji: "✂️",
    cost: { items: 1 },
    cooldownSeconds: 75,
    primary: { speed: 0.45, crit: 0.25 },
    secondary: { evasion: 0.2, attack: 0.1 },
    riskTags: ["bleed"],
    skillTags: ["speed", "precision", "projectile"],
    baseGain: 4,
    description: "Tăng tốc độ và chí mạng, giảm nhẹ HP.",
  },
  music: {
    id: "music",
    name: "Âm nhạc",
    emoji: "🎵",
    cost: { leafCoin: 8 },
    cooldownSeconds: 100,
    primary: { skillPower: 0.7 },
    secondary: { growthRate: 0.1 },
    riskTags: ["wildness"],
    skillTags: ["music", "resonance", "control"],
    baseGain: 5,
    description: "Tăng sức chiêu và khả năng gây trạng thái.",
  },
  moonlight: {
    id: "moonlight",
    name: "Ánh trăng",
    emoji: "🌙",
    cost: { geneCrystal: 1 },
    cooldownSeconds: 300,
    primary: { skillPower: 0.5 },
    secondary: { mutationChance: 0.2 },
    riskTags: ["latent"],
    skillTags: ["rare", "shadow", "mutation"],
    baseGain: 8,
    description: "Hiếm. Tăng cơ hội mở đặc tính hiếm và đột biến.",
  },
  gene_serum: {
    id: "gene_serum",
    name: "Tinh chất gene",
    emoji: "🧪",
    cost: { geneCrystal: 2, leafCoin: 60 },
    cooldownSeconds: 240,
    primary: { skillPower: 0.35, attack: 0.2 },
    secondary: { mutationChance: 0.35, growthRate: 0.1 },
    riskTags: ["mutationDebt", "unstableTrait"],
    skillTags: ["mutation", "hybrid", "chaos"],
    baseGain: 9,
    description: "Mạnh nhất và nguy hiểm nhất. Tăng tỉ lệ đột biến nhưng cũng tăng nợ đột biến.",
  },
};

export const CARE_LIST: CareActionDef[] = Object.values(CARE_ACTIONS);

export const STRESS_LABEL: Record<StressKind, string> = {
  overwater: "Úng nước",
  heat: "Nắng cháy",
  overfeed: "Quá phân",
  mutationDebt: "Nợ đột biến",
  battleFatigue: "Mệt trận",
  neglect: "Bị bỏ rơi",
};

export const MOODS = ["calm", "excited", "wild", "tired", "unstable"] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_LABEL: Record<Mood, string> = {
  calm: "Bình tĩnh",
  excited: "Hào hứng",
  wild: "Hoang dã",
  tired: "Mệt mỏi",
  unstable: "Mất ổn",
};

/** Mood modifiers (docs/12 §11). */
export const MOOD_EFFECTS: Record<Mood, { gain: number; mutation: number; note: string }> = {
  calm: { gain: 1.05, mutation: -0.05, note: "Tăng chỉ số ổn định, hiếm đột biến" },
  excited: { gain: 1.1, mutation: 0.05, note: "Tăng nhanh, dễ biến dạng" },
  wild: { gain: 1.0, mutation: 0.12, note: "Chí mạng dễ hơn, đột biến cao" },
  tired: { gain: 0.85, mutation: 0.0, note: "Tăng chậm, hồi phục tốt" },
  unstable: { gain: 0.95, mutation: 0.2, note: "Bất ổn, đột biến rất cao" },
};
