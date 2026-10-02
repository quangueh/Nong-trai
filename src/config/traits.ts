/** Trait registry (docs/01 §8, docs/15 §8). Every strong trait ships with a cost. */

import type { ElementId } from "./elements";
import type { Archetype } from "./species";

export type TraitRarity = "common" | "rare" | "unstable";

export type TraitEffect =
  | { kind: "statMult"; stat: string; value: number }
  | { kind: "damageReduction"; value: number }
  | { kind: "reflect"; value: number }
  | { kind: "healOnHit"; value: number }
  | { kind: "statusChance"; status: StatusKind; value: number }
  | { kind: "immuneFirst"; effect: "stun" | "slow" | "poison" }
  | { kind: "lifesteal"; value: number }
  | { kind: "onKillHeal"; value: number }
  | { kind: "arenaBonus"; condition: "sunny" | "moon" | "indoor"; value: number }
  | { kind: "critHeal"; value: number }
  | { kind: "dotMastery"; value: number }
  | { kind: "cooldownMastery"; value: number }
  | { kind: "execute"; threshold: number; value: number }
  | { kind: "secondWind"; value: number }
  | { kind: "evadeFirst"; value: number }
  | { kind: "thornOnHit"; value: number };

export type StatusKind = "poison" | "burn" | "slow" | "stun" | "root" | "regen" | "shield";

export interface TraitDef {
  id: string;
  name: string;
  rarity: TraitRarity;
  tags: string[];
  /** Which archetypes can carry this trait without an extra tax. */
  fits: Archetype[];
  effects: TraitEffect[];
  note?: string;
}

export const TRAITS: readonly TraitDef[] = [
  // --- tank -------------------------------------------------------------
  {
    id: "thick_bark",
    name: "Vỏ Dày",
    rarity: "common",
    tags: ["defense", "wood"],
    fits: ["tank"],
    effects: [{ kind: "damageReduction", value: 0.08 }],
  },
  {
    id: "rooted_will",
    name: "Tĩnh Rễ",
    rarity: "rare",
    tags: ["defense", "control"],
    fits: ["tank", "control"],
    effects: [{ kind: "immuneFirst", effect: "stun" }, { kind: "statMult", stat: "defense", value: 1.04 }],
  },
  {
    id: "stone_heart",
    name: "Tim Đá",
    rarity: "rare",
    tags: ["defense", "earth"],
    fits: ["tank"],
    effects: [{ kind: "statMult", stat: "hp", value: 1.12 }, { kind: "statMult", stat: "speed", value: 0.9 }],
  },
  {
    id: "second_wind",
    name: "Hơi Thở Thứ Hai",
    rarity: "rare",
    tags: ["defense", "sustain"],
    fits: ["tank", "sustain"],
    effects: [{ kind: "secondWind", value: 0.3 }],
    note: "Một lần mỗi trận, hồi 30% HP khi chết.",
  },
  {
    id: "iron_wall",
    name: "Tường Sắt",
    rarity: "unstable",
    tags: ["defense"],
    fits: ["tank"],
    effects: [{ kind: "damageReduction", value: 0.16 }, { kind: "statMult", stat: "attack", value: 0.85 }],
  },
  // --- burst ------------------------------------------------------------
  {
    id: "overgrown",
    name: "Vượt Tầm",
    rarity: "common",
    tags: ["burst", "glass"],
    fits: ["burst"],
    effects: [{ kind: "statMult", stat: "attack", value: 1.18 }, { kind: "statMult", stat: "evasion", value: 0.85 }],
  },
  {
    id: "crit_lifesteal",
    name: "Hút Máu Chí Mạng",
    rarity: "rare",
    tags: ["crit", "leech"],
    fits: ["burst"],
    effects: [{ kind: "critHeal", value: 0.35 }],
  },
  {
    id: "fragile_stem",
    name: "Thân Mỏng",
    rarity: "common",
    tags: ["burst", "glass"],
    fits: ["burst", "tempo"],
    effects: [{ kind: "statMult", stat: "speed", value: 1.2 }, { kind: "statMult", stat: "hp", value: 0.8 }],
  },
  {
    id: "overload",
    name: "Quá Tải",
    rarity: "unstable",
    tags: ["burst", "chaos"],
    fits: ["burst"],
    effects: [{ kind: "statMult", stat: "crit", value: 1.35 }, { kind: "statusChance", status: "slow", value: 0.25 }],
    note: "Khi trúng đòn, cây bị trì hoãn.",
  },
  {
    id: "finisher",
    name: "Liều Mãng",
    rarity: "rare",
    tags: ["burst", "execute"],
    fits: ["burst"],
    effects: [{ kind: "execute", threshold: 0.3, value: 1.5 }],
  },
  // --- sustain ----------------------------------------------------------
  {
    id: "dew_skin",
    name: "Da Sương",
    rarity: "common",
    tags: ["sustain", "shield"],
    fits: ["sustain", "tank"],
    effects: [{ kind: "statMult", stat: "hp", value: 1.06 }, { kind: "onKillHeal", value: 0.05 }],
  },
  {
    id: "moon_vein",
    name: "Mạch Trăng",
    rarity: "rare",
    tags: ["sustain", "moon"],
    fits: ["sustain"],
    effects: [{ kind: "healOnHit", value: 0.12 }, { kind: "arenaBonus", condition: "moon", value: 0.1 }],
  },
  {
    id: "photosurge",
    name: "Quang Nhập",
    rarity: "rare",
    tags: ["sustain", "energy"],
    fits: ["sustain", "tempo"],
    effects: [{ kind: "statMult", stat: "skillPower", value: 1.08 }, { kind: "arenaBonus", condition: "sunny", value: 0.08 }],
  },
  {
    id: "greedy_root",
    name: "Rễ Tham",
    rarity: "unstable",
    tags: ["leech"],
    fits: ["sustain", "counter"],
    effects: [{ kind: "lifesteal", value: 0.22 }, { kind: "statMult", stat: "defense", value: 0.9 }],
  },
  // --- control ----------------------------------------------------------
  {
    id: "venom_veins",
    name: "Gân Độc",
    rarity: "common",
    tags: ["poison", "dot"],
    fits: ["control"],
    effects: [{ kind: "statusChance", status: "poison", value: 0.2 }],
  },
  {
    id: "spore_choke",
    name: "Bào Tử Nghẹt",
    rarity: "rare",
    tags: ["poison", "control"],
    fits: ["control"],
    effects: [{ kind: "dotMastery", value: 0.3 }, { kind: "statMult", stat: "attack", value: 0.92 }],
  },
  {
    id: "sleepy_pollen",
    name: "Phấn Hoang",
    rarity: "rare",
    tags: ["control", "stun"],
    fits: ["control", "trickster" as Archetype],
    effects: [{ kind: "statusChance", status: "stun", value: 0.12 }],
  },
  {
    id: "deep_grip",
    name: "Bám Sâu",
    rarity: "common",
    tags: ["control", "root"],
    fits: ["control", "tank"],
    effects: [{ kind: "statusChance", status: "root", value: 0.18 }],
  },
  // --- tempo ------------------------------------------------------------
  {
    id: "quick_sprout",
    name: "Nảy Nhanh",
    rarity: "common",
    tags: ["tempo"],
    fits: ["tempo"],
    effects: [{ kind: "statMult", stat: "speed", value: 1.12 }],
  },
  {
    id: "sharp_leaves",
    name: "Lá Sắc",
    rarity: "common",
    tags: ["tempo", "crit"],
    fits: ["tempo", "burst"],
    effects: [{ kind: "thornOnHit", value: 0.18 }],
  },
  {
    id: "clean_form",
    name: "Dáng Thuôn",
    rarity: "rare",
    tags: ["tempo", "cooldown"],
    fits: ["tempo", "control"],
    effects: [{ kind: "cooldownMastery", value: 0.12 }],
  },
  {
    id: "static_bloom",
    name: "Hoa Tĩnh Điện",
    rarity: "rare",
    tags: ["electric", "tempo"],
    fits: ["tempo"],
    effects: [{ kind: "statusChance", status: "stun", value: 0.1 }, { kind: "statMult", stat: "evasion", value: 1.06 }],
  },
  // --- counter ----------------------------------------------------------
  {
    id: "thorn_counter",
    name: "Phản Gai",
    rarity: "common",
    tags: ["counter", "reflect"],
    fits: ["counter", "tank"],
    effects: [{ kind: "reflect", value: 0.25 }],
  },
  {
    id: "resonant_bloom",
    name: "Cộng Hưởng",
    rarity: "rare",
    tags: ["counter", "music"],
    fits: ["counter", "sustain"],
    effects: [{ kind: "cooldownMastery", value: 0.1 }, { kind: "statusChance", status: "slow", value: 0.12 }],
  },
  {
    id: "evade_reflex",
    name: "Phản Xạ Nhanh",
    rarity: "rare",
    tags: ["counter", "evade"],
    fits: ["counter", "tempo"],
    effects: [{ kind: "evadeFirst", value: 0.45 }],
  },
  {
    id: "unstable_gene",
    name: "Gene Mất Ổn",
    rarity: "unstable",
    tags: ["chaos"],
    fits: ["burst", "control", "tempo"],
    effects: [{ kind: "statMult", stat: "skillPower", value: 1.25 }, { kind: "statusChance", status: "slow", value: 0.18 }],
    note: "Chiêu mạnh hơn nhưng hay trượt.",
  },
  // --- element / hybrid --------------------------------------------------
  {
    id: "solar_hunger",
    name: "Khát Nắng",
    rarity: "rare",
    tags: ["light", "arena"],
    fits: ["burst", "tempo"],
    effects: [{ kind: "arenaBonus", condition: "sunny", value: 0.14 }],
  },
  {
    id: "night_bloom",
    name: "Nở Đêm",
    rarity: "rare",
    tags: ["shadow", "arena"],
    fits: ["control", "counter"],
    effects: [{ kind: "arenaBonus", condition: "moon", value: 0.14 }, { kind: "statMult", stat: "hp", value: 0.94 }],
  },
  {
    id: "conductive_vein",
    name: "Gân Dẫn Điện",
    rarity: "rare",
    tags: ["electric", "hybrid"],
    fits: ["tempo", "burst"],
    effects: [{ kind: "statMult", stat: "speed", value: 1.1 }, { kind: "statMult", stat: "hp", value: 0.92 }],
  },
  {
    id: "toxic_bloom",
    name: "Nở Độc",
    rarity: "rare",
    tags: ["poison", "hybrid"],
    fits: ["control", "sustain"],
    effects: [{ kind: "dotMastery", value: 0.22 }, { kind: "statMult", stat: "attack", value: 0.93 }],
  },
  {
    id: "tidal_bark",
    name: "Vỏ Triều",
    rarity: "common",
    tags: ["water", "hybrid"],
    fits: ["sustain", "tank"],
    effects: [{ kind: "statMult", stat: "skillPower", value: 1.08 }],
  },
  {
    id: "rich_soil_core",
    name: "Lõi Đất Màu",
    rarity: "common",
    tags: ["growth", "earth"],
    fits: ["tank", "sustain"],
    effects: [{ kind: "statMult", stat: "hp", value: 1.07 }, { kind: "statMult", stat: "defense", value: 1.05 }],
  },
  {
    id: "clean_form_echo",
    name: "Dáng Sạch",
    rarity: "common",
    tags: ["growth"],
    fits: ["tempo", "control"],
    effects: [{ kind: "cooldownMastery", value: 0.08 }],
  },
  {
    id: "prickly_retaliation",
    name: "Gai Phản Đòn",
    rarity: "common",
    tags: ["counter", "thorn"],
    fits: ["counter"],
    effects: [{ kind: "thornOnHit", value: 0.12 }, { kind: "statMult", stat: "attack", value: 0.95 }],
  },
  {
    id: "hardy_shell",
    name: "Mai Cứng",
    rarity: "common",
    tags: ["defense", "earth"],
    fits: ["tank", "counter"],
    effects: [{ kind: "damageReduction", value: 0.06 }, { kind: "statMult", stat: "speed", value: 0.95 }],
  },
];

export const TRAITS_BY_ID: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

export function traitName(id: string): string {
  return TRAITS_BY_ID[id]?.name ?? id;
}

export function traitsByRarity(rarity: TraitRarity): TraitDef[] {
  return TRAITS.filter((t) => t.rarity === rarity);
}

/** Elements that a trait leans into, used when breeding inherits traits. */
export const TRAIT_ELEMENTS: Record<string, ElementId[]> = {
  thorn_counter: ["wood"],
  venom_veins: ["poison"],
  spore_choke: ["poison"],
  toxic_bloom: ["poison"],
  sleepy_pollen: ["poison", "shadow"],
  static_bloom: ["electric"],
  conductive_vein: ["electric"],
  solar_hunger: ["light", "fire"],
  night_bloom: ["shadow"],
  moon_vein: ["light", "water"],
  tidal_bark: ["water"],
  thick_bark: ["wood"],
  stone_heart: ["earth"],
  rich_soil_core: ["earth"],
  hardy_shell: ["earth"],
  deep_grip: ["earth", "wood"],
};
