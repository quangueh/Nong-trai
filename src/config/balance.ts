/**
 * Balance config (docs/15 §4-§12). Every coefficient the generator and the
 * battle engine read lives here so a balance patch never needs an engine change.
 */

import type { Archetype } from "./species";

export const BALANCE_VERSION = "genes-v1.0.0";

export type CombatTier = "seedling" | "sprout" | "bloom" | "ancient";

export const TIER_META: Record<CombatTier, { label: string; budget: number; tolerance: number; kDefense: number; reference: Stats }> = {
  seedling: { label: "Mầm", budget: 100, tolerance: 0.03, kDefense: 60, reference: { hp: 120, attack: 22, defense: 20, speed: 18, skillPower: 18, crit: 0.05, evasion: 0.05 } },
  sprout: { label: "Nảy", budget: 140, tolerance: 0.03, kDefense: 90, reference: { hp: 190, attack: 34, defense: 30, speed: 27, skillPower: 28, crit: 0.07, evasion: 0.06 } },
  bloom: { label: "Nở", budget: 190, tolerance: 0.025, kDefense: 130, reference: { hp: 280, attack: 48, defense: 44, speed: 38, skillPower: 42, crit: 0.1, evasion: 0.08 } },
  ancient: { label: "Cổ", budget: 250, tolerance: 0.02, kDefense: 175, reference: { hp: 400, attack: 66, defense: 60, speed: 52, skillPower: 58, crit: 0.13, evasion: 0.1 } },
};

export const TIER_ORDER: readonly CombatTier[] = ["seedling", "sprout", "bloom", "ancient"];

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  skillPower: number;
  crit: number;
  evasion: number;
}

/** Budget groups for a tier, used to allocate spend (docs/15 §4.2). */
export const TIER_ALLOCATION = {
  seedling: { stats: [40, 60], skills: [25, 45], passive: [8, 18], element: [4, 12], utility: [0, 5] },
  sprout: { stats: [55, 78], skills: [34, 58], passive: [11, 24], element: [5, 15], utility: [0, 7] },
  bloom: { stats: [70, 105], skills: [45, 75], passive: [15, 35], element: [5, 20], utility: [0, 10] },
  ancient: { stats: [90, 130], skills: [60, 98], passive: [20, 45], element: [6, 24], utility: [0, 12] },
} as const;

/** Stat valuation costs (docs/15 §5). */
export const STAT_COST = {
  hp: 1.0,
  sustainedDamage: 1.0,
  /**
   * Action speed is priced by its REALIZED payoff, not its raw magnitude.
   * In the engine `actionInterval = 2.2 - speed/60`, so the DPS gain from a
   * point of speed shrinks as speed rises. Pricing it at the naive value makes
   * speed the cheapest stat in the game and every generated build buys it.
   */
  actionSpeed: 2.2,
  healing: 1.1,
  crit: 0.7,
  evasion: 1.2,
  statusResist: 0.75,
  energy: 0.9,
} as const;

/** Skill cost coefficients (docs/15 §12). */
export const SKILL_COST = {
  instantDamage: 1.0,
  damageOverTime: 0.72,
  activeHeal: 1.05,
  passiveRegen: 0.85,
  stun: 2.4,
  slow: 0.8,
  root: 1.15,
  aoePerTarget: 0.55,
  homingReliability: 1.3,
  manualExecution: 0.1,
  cooldownDiscountPerSecond: 2.2,
  energyDiscountPerTen: 0.4,
  conditionDiscount: 0.35,
  drawbackRefundRate: 0.4,
} as const;

/** Forbidden combos (docs/15 §9.1). */
export const FORBIDDEN = {
  maxLockSeconds: 3.0,
  maxEvasion: 0.6,
  maxReflectReflect: true,
  oneShotFraction: 0,
} as const;

/** Synergy interactions taxed in the balance model (docs/15 §9.2). */
export const SYNERGY_RULES: readonly {
  id: string;
  when: { a: string; b: string };
  coefficient: number;
  note: string;
}[] = [
  { id: "speed_on_hit", when: { a: "speed", b: "dot" }, coefficient: 0.35, note: "Tốc độ + độc lan mỗi đòn đánh" },
  { id: "multihit_leech", when: { a: "multi_hit", b: "lifesteal" }, coefficient: 0.4, note: "Đa đòn + hút máu" },
  { id: "crit_reset", when: { a: "crit", b: "cooldown_reset" }, coefficient: 0.45, note: "Chí mạng + hồi nhanh" },
  { id: "shield_break_damage", when: { a: "shield", b: "shield_break_damage" }, coefficient: 0.3, note: "Khiên + nổ khiên" },
  { id: "lowhp_selfdamage", when: { a: "low_hp_power", b: "self_damage" }, coefficient: 0.35, note: "Mạnh khi HP thấp + tự mất máu" },
  { id: "root_bonus", when: { a: "root", b: "root_bonus" }, coefficient: 0.4, note: "Trói + cộng sát thương lên mục tiêu bị trói" },
  { id: "evasion_reflect", when: { a: "evasion", b: "reflect" }, coefficient: 0.25, note: "Né + phản đòn" },
  { id: "heal_shield_stack", when: { a: "heal", b: "shield" }, coefficient: 0.5, note: "Hồi + khiên cộng dồn" },
];

/** Control cap per tier — hard CC seconds allowed in one window. */
export const CONTROL_CAP: Record<CombatTier, number> = {
  seedling: 1.2,
  sprout: 1.8,
  bloom: 2.4,
  ancient: 3.0,
};

export const ARCHETYPE_KEYS: readonly Archetype[] = ["tank", "burst", "sustain", "control", "tempo", "counter"];

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  tank: "Sinh tồn",
  burst: "Bùng nổ",
  sustain: "Duy trì",
  control: "Khống chế",
  tempo: "Nhịp độ",
  counter: "Ổn định",
};

export const ARCHETYPE_ROLE: Record<Archetype, string> = {
  tank: "Kéo giãn, chịu đòn",
  burst: "Kết liễu nhanh",
  sustain: "Bào mòn, hồi phục",
  control: "Khoá nhịp đối thủ",
  tempo: "Ép nhịp, đánh nhanh",
  counter: "Trừng phạt hành động",
};

export const ARCHETYPE_STRENGTH: Record<Archetype, string> = {
  tank: "sống lâu, kéo hết tài nguyện địch",
  burst: "sát thương đỉnh trong cửa sổ ngắn",
  sustain: "hồi phục và mài mòn",
  control: "khoá nhịp, ép đối thủ chậm",
  tempo: "hành động nhanh, ép nhịp",
  counter: "phản đòn và trừng phạt",
};

export const ARCHETYPE_WEAKNESS: Record<Archetype, string> = {
  tank: "chậm, sát thương thấp",
  burst: "hồi chiêu dài, mỏng",
  sustain: "sợ đòn bùng nổ và cơ chế chống hồi máu",
  control: "sát thương thấp, hiệu ứng có kháng",
  tempo: "mỗi đòn yếu, dễ bị phản đòn",
  counter: "yếu khi không gặp đúng mục tiêu",
};

/** Stat -> which archetype keys it feeds, for the vec radar. */
export const STAT_ARCHETYPE: Record<keyof Stats, Archetype> = {
  hp: "tank",
  attack: "burst",
  defense: "tank",
  speed: "tempo",
  skillPower: "sustain",
  crit: "burst",
  evasion: "tempo",
};

/** Matchmaking bands on ECR. */
export const ECR_BANDS = [
  { min: 0.42, max: 0.48, label: "Mầm" },
  { min: 0.48, max: 0.52, label: "Lớn" },
  { min: 0.52, max: 0.56, label: "Cổ" },
] as const;

export const BENCHMARK_ROSTER = [
  "tank_physical",
  "tank_status",
  "burst_fast",
  "burst_slow",
  "sustain_heal",
  "poison_dot",
  "control_lock",
  "tempo_onhit",
  "counter_reflect",
  "ramp_endgame",
  "balanced_neutral",
] as const;

export type BenchmarkId = (typeof BENCHMARK_ROSTER)[number];
