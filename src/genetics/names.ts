/**
 * Plant name generation — a name should hint at the genes (docs/05 §11).
 *
 * Names are a *pure function of the genome*. That matters for more than tidiness:
 * breeding has to guarantee a new plant never reuses a name already in the
 * garden (docs/05 §11, "mỗi lần lai tạo ra một loại khác nhau"). If the name were
 * drawn from the generation RNG stream, the store would have no way to re-derive
 * it with a different draw — the whole genome would have to be regenerated. With
 * `plantName(dna, traits, salt)` the store can re-derive any other name for the
 * same plant in O(1), and bump `salt` until it is unused.
 *
 * The pools are sized so the effective space is ~10^5. With a few hundred plants
 * in a save that leaves birthday collisions almost free, and the salt fallback
 * is a hard guarantee rather than a probability.
 */

import { Rng, hashString } from "../core/rng";
import type { Dna } from "../core/types";
import { dominantElement, secondaryElement, type ElementId } from "../config/elements";
import { TRAITS_BY_ID } from "../config/traits";

/** Plant part — the head noun. Botanical Vietnamese, not "cây" every time. */
const PART = [
  "Rễ", "Lá", "Nụ", "Đóa", "Cành", "Gai", "Nấm", "Mầm", "Thân", "Củ",
  "Chùm", "Trụ", "Dây", "Lưỡi", "Răng", "Vỏ", "Tán", "Hạt", "Nhụy", "Gốc",
  "Nhánh", "Cuộn", "Đốt", "Mào", "Yên", "Lông", "Rỗng", "Cọng", "Búp", "Đài",
];

/** Element descriptor — reads as the plant's nature, not the element name itself. */
const ELEMENT_EPITHET: Record<ElementId, string[]> = {
  wood: ["Gai", "Xanh", "Mộc", "Rừng", "Trúc", "Tùng", "Thanh", "Lá"],
  fire: ["Lửa", "Đỏ", "Nóng", "Tro", "Hỏa", "Diệm", "Nham", "Cui"],
  water: ["Sương", "Mưa", "Nước", "Lầy", "Giọt", "Suối", "Bến", "Mặt"],
  earth: ["Đá", "Cát", "Núi", "Thạch", "Đất", "Gò", "Hang", "Cứng"],
  electric: ["Sét", "Chớp", "Tia", "Điện", "Kiến", "Lạnh", "Tích", "Rối"],
  poison: ["Độc", "Mủ", "Thối", "Rùng", "Tế", "Hơi", "Chướng", "Trầm"],
  light: ["Quang", "Nắng", "Hào", "Kim", "Trăng", "Mai", "Chói", "Gương"],
  shadow: ["Ám", "Tối", "Huyền", "Khuất", "Câm", "Mù", "U", "Khuất Mù"],
};

/** Ornament — the quality word that makes a name feel rare. */
const ORNAMENT = [
  "Bạc", "Vàng", "Ngọc", "Thép", "Đồng", "Cổ", "Lạ", "Dị", "Hoang", "Huyền",
  "Nham", "Thủy Tinh", "Sương Mù", "Bóng Đêm", "Thanh Nhẹ", "Cứng Vững",
  "Mềm Mại", "Sắc Nhọn", "Trầm Lặng", "Rực Rỡ", "U ám", "Sương Sớm",
  "Đêm Khuya", "Nắng Gắt", "Gió Lùa", "Mưa Phùn", "Sương Mai", "Tàn Tích",
];

/** Size hint — only added when the genome actually carries a size gene. */
const SIZE_EPITHET: Record<string, string> = {
  tiny: "Líu",
  small: "Nhỏ",
  normal: "",
  large: "Lớn",
  colossal: "Khổng Lồ",
};

/** Trait epithet — only added when the plant carries that trait. */
const TRAIT_EPITHET: Record<string, string> = {
  thorn_counter: "Phản Gai",
  venom_veins: "Gân Độc",
  spore_choke: "Bào Tử",
  toxic_bloom: "Độc Nở",
  sleepy_pollen: "Phấn Hoang",
  static_bloom: "Tĩnh Điện",
  conductive_vein: "Dẫn Sét",
  solar_hunger: "Khát Nắng",
  night_bloom: "Nở Đêm",
  moon_vein: "Mạch Trăng",
  thick_bark: "Vỏ Dày",
  stone_heart: "Tim Đá",
  overgrowth: "Vượt Tầm",
  dew_skin: "Da Sương",
  unsterile: "",
};

/**
 * A stable seed for the name of this exact genome.
 *
 * Genes are serialised in sorted key order so the same plant always hashes to the
 * same value regardless of the order the object was built in.
 */
function nameSeed(dna: Dna, traits: string[], salt: number): string {
  const ser = (o: Record<string, unknown>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${(o as Record<string, string | number>)[k]}`)
      .join(";");
  return `name:${ser(dna.elementGenes as Record<string, number>)}|${ser(
    dna.statGenes as Record<string, number>,
  )}|${ser(dna.bodyGenes as Record<string, string>)}|${[...traits].sort().join(",")}|${salt}`;
}

/** Case- and accent-insensitive comparison key, so "Lá Lá" counts as a repeat. */
function norm(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * The plant's name.
 *
 * @param salt Bump to get a different valid name for the same genome. Breeding
 *   uses this to walk past a name already used by another plant in the garden.
 */
export function plantName(dna: Dna, traits: string[], salt = 0): string {
  const rng = new Rng(hashString(nameSeed(dna, traits, salt)));
  const dom = dominantElement(dna.elementGenes);
  const sec = secondaryElement(dna.elementGenes);

  const parts: string[] = [];
  const used = new Set<string>();

  /**
   * Add a phrase unless any of its words is already in the name.
   *
   * Splitting matters: several trait epithets are two words ("Vỏ Dày"), and
   * checking the phrase as one string let "Vỏ" slip past a check that already
   * held "Vỏ" from the plant part — producing "Vỏ Thanh Cát Vỏ Dày".
   */
  const add = (phrase: string | undefined): void => {
    if (!phrase) return;
    const words = phrase.split(" ").filter(Boolean);
    const keys = words.map((w) => norm(w));
    if (keys.some((k) => !k || used.has(k))) return;
    for (const k of keys) used.add(k);
    parts.push(phrase);
  };

  add(rng.pick(PART));

  const pool = ELEMENT_EPITHET[dom.id] ?? ELEMENT_EPITHET.wood;
  const domWord = rng.pick(pool);
  add(domWord);

  // Secondary element, occasionally — reads as a hybrid hint.
  if (sec && rng.bool(0.34)) add(rng.pick(ELEMENT_EPITHET[sec]));

  // Trait epithet if a notable trait is present.
  const notable = traits.find((t) => TRAIT_EPITHET[t]);
  if (notable && rng.bool(0.52)) add(TRAIT_EPITHET[notable]);

  // Size hint, only when the genome carries one.
  const size = dna.bodyGenes.size;
  if (size && size !== "normal" && rng.bool(0.6)) add(SIZE_EPITHET[size]);

  // Ornament. Two-thirds of names get one; the rest stay plain, so the pool does
  // not read like every plant has the same "Vàng" prefix.
  if (rng.bool(0.66)) add(rng.pick(ORNAMENT));

  // If collision-filtering left a one-word name, force an ornament so it is at
  // least two words and reads like the others.
  if (parts.length < 2) add(rng.pick(ORNAMENT));

  return parts.join(" ");
}

/**
 * Comparison key for "is this name already taken".
 *
 * Accent- and case-insensitive, because "Lá Gai" and "La Gai" are the same name
 * to a player even though they are different strings — and a garden holding both
 * is exactly the "another identical plant" complaint breeding has to avoid.
 */
export function nameKey(name: string): string {
  return norm(name);
}

export function skillNamePool(): string {
  return "Danh sách tên chiêu được sinh động từ module, không cố định.";
}

export function traitDisplayName(id: string): string {
  return TRAITS_BY_ID[id]?.name ?? id;
}