/**
 * Hand-tuned benchmark plants used to measure ECR (docs/15 §14).
 *
 * These are full builds, not bare stat sticks: each carries 2-3 skills and a
 * trait set matched to its identity, so a generated plant is measured against
 * something of comparable total power rather than a stripped-down dummy.
 */

import type { ElementId } from "../config/elements";
import type { Skill, Stats } from "../core/types";

export type SkillFactory = (
  id: string,
  name: string,
  delivery: Skill["delivery"],
  effect: Skill["effect"],
  elements: ElementId[],
  power: number,
  cooldown: number,
  statusChance?: number,
  statusDuration?: number,
) => Skill;

export interface BenchSpec {
  name: string;
  elements: Partial<Record<ElementId, number>>;
  stats: Partial<Stats>;
  archetype: Record<string, number>;
  traits: string[];
  statGenes?: Record<string, number>;
  /** `powerScale` re-prices skill damage when the benchmark is built for a
   *  tier other than its authored one. */
  skills: (mk: SkillFactory, powerScale: number) => Skill[];
}

export const BENCHMARK_TRAITS: Record<string, BenchSpec> = {
  tank_physical: {
    name: "Benchmark Tank Vật Lý",
    elements: { wood: 0.6, earth: 0.35, fire: 0.05 },
    stats: { hp: 330, attack: 40, defense: 60, speed: 26, skillPower: 38, crit: 0.06, evasion: 0.04 },
    archetype: { tank: 0.6, counter: 0.2, sustain: 0.2 },
    traits: ["thick_bark", "rooted_will"],
    skills: (mk) => [
      mk("wall", "Vỏ Dày", "aura", "shield", ["wood"], 30, 8),
      mk("root", "Rễ Giam", "trap", "root", ["earth"], 20, 9, 0.45, 2.2),
      mk("bough", "Cành Đâm", "melee", "damage", ["wood"], 26, 5),
    ],
  },
  tank_status: {
    name: "Benchmark Tank Kháng Hiệu Ứng",
    elements: { wood: 0.4, poison: 0.35, earth: 0.25 },
    stats: { hp: 315, attack: 42, defense: 50, speed: 28, skillPower: 44, crit: 0.06, evasion: 0.05 },
    archetype: { tank: 0.55, control: 0.25, sustain: 0.2 },
    traits: ["hardy_shell", "deep_grip"],
    skills: (mk) => [
      mk("purge", "Tẩy Rửa", "aura", "cleanse", ["water"], 20, 10),
      mk("husk", "Mai Cứng", "aura", "shield", ["earth"], 26, 9),
      mk("lash", "Dây Gai", "melee", "dot", ["poison"], 22, 6, 0.5, 3),
    ],
  },
  burst_fast: {
    name: "Benchmark Burst Nhanh",
    elements: { fire: 0.5, electric: 0.35, wood: 0.15 },
    stats: { hp: 240, attack: 60, defense: 28, speed: 54, skillPower: 46, crit: 0.22, evasion: 0.12 },
    archetype: { burst: 0.65, tempo: 0.35 },
    traits: ["fragile_stem", "quick_sprout"],
    skills: (mk) => [
      mk("dart", "Hạt Bắn", "projectile", "damage", ["fire"], 42, 4),
      mk("spark", "Tia Sét", "projectile", "chain", ["electric"], 28, 6, 0.2, 1),
    ],
  },
  burst_slow: {
    name: "Benchmark Burst Chậm Có Telegraph",
    elements: { fire: 0.55, light: 0.3, wood: 0.15 },
    stats: { hp: 270, attack: 66, defense: 32, speed: 24, skillPower: 54, crit: 0.2, evasion: 0.05 },
    archetype: { burst: 0.7, tank: 0.3 },
    traits: ["overgrown", "solar_hunger"],
    skills: (mk) => [
      mk("nova", "Đốm Lửa Lớn", "aura", "damage", ["fire"], 74, 9, 0.3, 2),
      mk("ember", "Than Nóng", "projectile", "dot", ["fire"], 24, 6, 0.6, 3),
    ],
  },
  sustain_heal: {
    name: "Benchmark Hồi Máu",
    elements: { water: 0.55, light: 0.3, wood: 0.15 },
    stats: { hp: 290, attack: 32, defense: 42, speed: 32, skillPower: 52, crit: 0.05, evasion: 0.07 },
    archetype: { sustain: 0.7, tank: 0.3 },
    traits: ["dew_skin", "moon_vein"],
    skills: (mk) => [
      mk("bloom", "Sương Hồi Sinh", "aura", "heal", ["water"], 38, 7),
      mk("dew", "Khiên Sương", "aura", "shield", ["water"], 26, 9),
      mk("drop", "Giọt Mưa", "projectile", "slow", ["water"], 18, 5, 0.5, 2.5),
    ],
  },
  poison_dot: {
    name: "Benchmark Độc",
    elements: { poison: 0.6, wood: 0.25, shadow: 0.15 },
    stats: { hp: 275, attack: 36, defense: 36, speed: 34, skillPower: 54, crit: 0.08, evasion: 0.08 },
    archetype: { control: 0.6, sustain: 0.4 },
    traits: ["venom_veins", "spore_choke"],
    skills: (mk) => [
      mk("cloud", "Mây Độc", "aura", "dot", ["poison"], 24, 6, 0.75, 4),
      mk("spore", "Bào Tử", "projectile", "dot", ["poison"], 20, 7, 0.6, 3),
      mk("sting", "Gai Nhiễm Độc", "melee", "damage", ["wood", "poison"], 22, 5),
    ],
  },
  control_lock: {
    name: "Benchmark Khống Chế",
    elements: { water: 0.4, earth: 0.35, wood: 0.25 },
    stats: { hp: 270, attack: 32, defense: 44, speed: 36, skillPower: 54, crit: 0.07, evasion: 0.1 },
    archetype: { control: 0.75, sustain: 0.25 },
    traits: ["deep_grip", "sleepy_pollen"],
    skills: (mk) => [
      mk("snare", "Rễ Địa Lao", "trap", "root", ["earth"], 18, 6, 0.6, 2.4),
      mk("drowse", "Phấn Hoang", "aura", "stun", ["water"], 22, 11, 0.3, 1.2),
      mk("lash", "Dây Vung", "channel", "slow", ["wood"], 20, 5, 0.5, 3),
    ],
  },
  tempo_onhit: {
    name: "Benchmark Nhịp Nhanh",
    elements: { electric: 0.5, wood: 0.3, fire: 0.2 },
    stats: { hp: 250, attack: 48, defense: 30, speed: 60, skillPower: 42, crit: 0.18, evasion: 0.16 },
    archetype: { tempo: 0.8, burst: 0.2 },
    traits: ["quick_sprout", "sharp_leaves"],
    skills: (mk) => [
      mk("spark", "Hạt Sét Nảy", "projectile", "chain", ["electric"], 28, 5, 0.2, 1),
      mk("cut", "Lá Sắc", "melee", "damage", ["wood"], 24, 3),
    ],
  },
  counter_reflect: {
    name: "Benchmark Phản Đòn",
    elements: { wood: 0.5, earth: 0.3, poison: 0.2 },
    stats: { hp: 300, attack: 40, defense: 52, speed: 30, skillPower: 44, crit: 0.1, evasion: 0.1 },
    archetype: { counter: 0.7, tank: 0.3 },
    traits: ["thorn_counter", "iron_wall"],
    skills: (mk) => [
      mk("lash", "Dây Gai Nhiễm Độc", "melee", "damage", ["wood", "poison"], 30, 6, 0.5, 3),
      mk("brace", "Thuẫn Gai", "aura", "shield", ["wood"], 24, 9),
    ],
  },
  ramp_endgame: {
    name: "Benchmark Tiến Hoá Cuối Trận",
    elements: { fire: 0.4, poison: 0.35, wood: 0.25 },
    stats: { hp: 265, attack: 44, defense: 36, speed: 38, skillPower: 58, crit: 0.14, evasion: 0.08 },
    archetype: { burst: 0.4, sustain: 0.6 },
    traits: ["resonant_bloom", "unstable_gene"],
    skills: (mk) => [
      mk("overgrow", "Vượt Tầm", "aura", "regen", ["fire"], 42, 8),
      mk("flare", "Bùng Lửa", "aura", "damage", ["fire"], 34, 9, 0.3, 2),
    ],
  },
  balanced_neutral: {
    name: "Benchmark Cân Bằng",
    elements: { wood: 0.4, fire: 0.2, water: 0.2, earth: 0.2 },
    stats: { hp: 280, attack: 48, defense: 44, speed: 38, skillPower: 44, crit: 0.1, evasion: 0.08 },
    archetype: { tank: 0.2, burst: 0.2, sustain: 0.2, control: 0.15, tempo: 0.15, counter: 0.1 },
    traits: ["thick_bark"],
    skills: (mk) => [
      mk("bolt", "Cành Đâm", "melee", "damage", ["wood"], 28, 6),
      mk("shell", "Khiên Lá", "aura", "shield", ["wood"], 22, 9),
    ],
  },
};
