/** Elements and the counter graph (docs/03 §5, docs/02 §3). */

export type ElementId = "wood" | "fire" | "water" | "earth" | "electric" | "poison" | "light" | "shadow";

export const ELEMENTS: readonly ElementId[] = [
  "wood",
  "fire",
  "water",
  "earth",
  "electric",
  "poison",
  "light",
  "shadow",
];

export interface ElementInfo {
  id: ElementId;
  name: string;
  /** Vivid hue — used for SVG plant art, glows and bars. */
  color: string;
  /**
   * Darkened variant for TEXT and icons. `color` alone is unreadable on the
   * light garden background (light electric measured 1.04:1), so anything drawn
   * as text must use this instead. Solved to clear 4.5:1 on every surface.
   */
  ink: string;
  /** Pale tint of the same hue, for chip backgrounds behind `ink`. */
  tint: string;
  glow: string;
  /** Damage multiplier this element deals to the keyed element. */
  beats: Partial<Record<ElementId, number>>;
  /** Short flavour used in the mutation report. */
  flavour: string;
}

export const ELEMENT_INFO: Record<ElementId, ElementInfo> = {
  wood: {
    id: "wood",
    name: "Mộc",
    color: "#6fd08c",
    ink: "#1e5c31",
    tint: "#e8f7ed",
    glow: "rgba(111,208,140,0.45)",
    beats: { earth: 1.15, water: 1.1 },
    flavour: "bền bỉ, quấn cùn đối thủ",
  },
  fire: {
    id: "fire",
    name: "Lửa",
    color: "#ff7a4d",
    ink: "#922e0c",
    tint: "#faeae5",
    glow: "rgba(255,122,77,0.5)",
    beats: { wood: 1.2, poison: 1.1 },
    flavour: "đốt cháy mọi thứ mềm",
  },
  water: {
    id: "water",
    name: "Nước",
    color: "#5cc8ff",
    ink: "#0a557b",
    tint: "#e5f3fa",
    glow: "rgba(92,200,255,0.45)",
    beats: { fire: 1.2, poison: 1.15 },
    flavour: "dập lửa, rửa sạch độc",
  },
  earth: {
    id: "earth",
    name: "Đất",
    color: "#c99a5b",
    ink: "#694b23",
    tint: "#f7f1e8",
    glow: "rgba(201,154,91,0.4)",
    beats: { electric: 1.2, poison: 1.15 },
    flavour: "hút sạch độc, chặn sét",
  },
  electric: {
    id: "electric",
    name: "Sét",
    color: "#ffe45e",
    ink: "#5e5008",
    tint: "#faf7e5",
    glow: "rgba(255,228,94,0.5)",
    beats: { water: 1.2, shadow: 1.1 },
    flavour: "nảy điện, làm gián đoạn",
  },
  poison: {
    id: "poison",
    name: "Độc",
    color: "#b06cff",
    ink: "#6a11d2",
    tint: "#efe5fa",
    glow: "rgba(176,108,255,0.45)",
    beats: { shadow: 1.2, water: 1.05 },
    flavour: "xuyên giáp, mài mòn theo thời gian",
  },
  light: {
    id: "light",
    name: "Quang",
    color: "#fff3c4",
    ink: "#614e08",
    tint: "#faf6e5",
    glow: "rgba(255,243,196,0.55)",
    beats: { shadow: 1.25, poison: 1.1 },
    flavour: "thiêu khiển bóng tối",
  },
  shadow: {
    id: "shadow",
    name: "Ám",
    color: "#8f7bd8",
    ink: "#5337bb",
    tint: "#ebe7f8",
    glow: "rgba(143,123,216,0.45)",
    beats: { light: 1.2, wood: 1.1 },
    flavour: "cắn ngang nơi sáng chiếu",
  },
};

export function elementName(id: ElementId): string {
  return ELEMENT_INFO[id].name;
}

export function elementColor(id: ElementId): string {
  return ELEMENT_INFO[id].color;
}

/** Text-safe element colour. Use this anywhere the value becomes a glyph. */
export function elementInk(id: ElementId): string {
  return ELEMENT_INFO[id].ink;
}

/** Pale element background for chips. */
export function elementTint(id: ElementId): string {
  return ELEMENT_INFO[id].tint;
}

/**
 * Dominant element affinity (0..1) of a blend. `affinity` is normalised so the
 * entries sum to 1; a plant with two elements at 0.6/0.4 is a hybrid.
 */
export function dominantElement(affinity: Record<ElementId, number>): { id: ElementId; share: number } {
  let best: ElementId = "wood";
  let bestValue = -1;
  for (const el of ELEMENTS) {
    const v = affinity[el] ?? 0;
    if (v > bestValue) {
      bestValue = v;
      best = el;
    }
  }
  return { id: best, share: Math.max(0, bestValue) };
}

export function secondaryElement(affinity: Record<ElementId, number>): ElementId | null {
  const entries: [ElementId, number][] = ELEMENTS.map((el) => [el, affinity[el] ?? 0] as [ElementId, number]);
  const sorted = entries.filter((e) => e[1] >= 0.18).sort((a, b) => b[1] - a[1]);
  return sorted.length > 1 ? sorted[1][0] : null;
}

/** Damage multiplier attacker -> defender using their dominant elements. */
export function elementMultiplier(
  attack: Record<ElementId, number>,
  defence: Record<ElementId, number>,
): { multiplier: number; reason: string } {
  let best = 1;
  let reason = "";
  for (const atkEl of ELEMENTS) {
    const atkShare = attack[atkEl] ?? 0;
    if (atkShare < 0.15) continue;
    for (const defEl of ELEMENTS) {
      const defShare = defence[defEl] ?? 0;
      if (defShare < 0.15) continue;
      const beat = ELEMENT_INFO[atkEl].beats[defEl];
      if (!beat) continue;
      const effective = 1 + (beat - 1) * atkShare * defShare * 2;
      if (effective > best) {
        best = effective;
        reason = `${ELEMENT_INFO[atkEl].name} khắc ${ELEMENT_INFO[defEl].name}`;
      } else if (effective < 1 && best === 1) {
        best = effective;
        reason = `${ELEMENT_INFO[defEl].name} đề kháng ${ELEMENT_INFO[atkEl].name}`;
      }
    }
  }
  return { multiplier: best, reason };
}
