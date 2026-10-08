/** Rarity bands, level-based roll tables, pity (docs/16 §7-§14). */

export type Rarity = "C" | "B" | "A" | "S" | "SS" | "SSS";

export const RARITY_ORDER: readonly Rarity[] = ["C", "B", "A", "S", "SS", "SSS"];

/**
 * `colour` is used both as a fill (odds bar, ribbons) and as TEXT on the light
 * garden background, so each value is dark enough to clear 4.5:1 there.
 */
export const RARITY_META: Record<Rarity, { label: string; colour: string; minScore: number; sellMult: number; priceCap: number }> = {
  C: { label: "Phổ thông", colour: "#43544b", minScore: 0, sellMult: 1.0, priceCap: 1200 },
  B: { label: "Không thường", colour: "#0c5483", minScore: 20, sellMult: 1.8, priceCap: 3000 },
  A: { label: "Hiếm", colour: "#6f25b4", minScore: 40, sellMult: 3.5, priceCap: 8000 },
  S: { label: "Cực hiếm", colour: "#684b05", minScore: 60, sellMult: 8.0, priceCap: 20000 },
  SS: { label: "Huyền dị", colour: "#9a1b41", minScore: 75, sellMult: 20.0, priceCap: 50000 },
  SSS: { label: "Độc bản", colour: "#505050", minScore: 90, sellMult: 60.0, priceCap: 150000 },
};

export const RARITY_POINT: Record<Rarity, number> = { C: 0, B: 1, A: 2, S: 3, SS: 4, SSS: 5 };

/** Minimum content a band must contain (docs/16 §13). */
export const RARITY_REQUIREMENT: Record<Rarity, { minRareModules: number; minMutationTier: number; minVisualSignature: boolean; minIdentity: boolean }> = {
  C: { minRareModules: 0, minMutationTier: 0, minVisualSignature: false, minIdentity: false },
  B: { minRareModules: 0, minMutationTier: 1, minVisualSignature: false, minIdentity: false },
  A: { minRareModules: 1, minMutationTier: 1, minVisualSignature: true, minIdentity: false },
  S: { minRareModules: 2, minMutationTier: 2, minVisualSignature: true, minIdentity: true },
  SS: { minRareModules: 3, minMutationTier: 2, minVisualSignature: true, minIdentity: true },
  SSS: { minRareModules: 4, minMutationTier: 3, minVisualSignature: true, minIdentity: true },
};

export const MUTATION_TIERS = ["micro", "minor", "major", "chaotic"] as const;
export type MutationTier = (typeof MUTATION_TIERS)[number];

export const MUTATION_TIER_META: Record<MutationTier, { label: string; score: number; colour: string }> = {
  micro: { label: "vi mô", score: 6, colour: "#255b2a" },
  minor: { label: "nhỏ", score: 16, colour: "#075488" },
  major: { label: "lớn", score: 30, colour: "#670bd5" },
  chaotic: { label: "hỗn loạn", score: 46, colour: "#9d084e" },
};

/**
 * Base rarity weights in basis points, keyed by average parent cultivation level
 * (docs/16 §9). Each row sums to exactly 10 000.
 */
export const RARITY_TABLE: readonly { minLevel: number; maxLevel: number; weights: Record<Rarity, number> }[] = [
  { minLevel: 1, maxLevel: 9, weights: { C: 5500, B: 2700, A: 1200, S: 450, SS: 140, SSS: 10 } },
  { minLevel: 10, maxLevel: 19, weights: { C: 5200, B: 2800, A: 1300, S: 510, SS: 177, SSS: 13 } },
  { minLevel: 20, maxLevel: 29, weights: { C: 4900, B: 2850, A: 1420, S: 580, SS: 234, SSS: 16 } },
  { minLevel: 30, maxLevel: 39, weights: { C: 4600, B: 2900, A: 1550, S: 660, SS: 270, SSS: 20 } },
  { minLevel: 40, maxLevel: 49, weights: { C: 4300, B: 2900, A: 1700, S: 740, SS: 335, SSS: 25 } },
  { minLevel: 50, maxLevel: 59, weights: { C: 4000, B: 2900, A: 1850, S: 850, SS: 365, SSS: 35 } },
  { minLevel: 60, maxLevel: 69, weights: { C: 3700, B: 2850, A: 2000, S: 950, SS: 455, SSS: 45 } },
  { minLevel: 70, maxLevel: 79, weights: { C: 3400, B: 2800, A: 2150, S: 1050, SS: 540, SSS: 60 } },
  { minLevel: 80, maxLevel: 89, weights: { C: 3100, B: 2700, A: 2300, S: 1200, SS: 620, SSS: 80 } },
  { minLevel: 90, maxLevel: 99, weights: { C: 2800, B: 2600, A: 2400, S: 1400, SS: 690, SSS: 110 } },
  { minLevel: 100, maxLevel: 100, weights: { C: 2500, B: 2500, A: 2500, S: 1500, SS: 850, SSS: 150 } },
];

/** Interpolate the table so every level has a small step (docs/16 §9.2). */
export function rarityWeightsForLevel(level: number): Record<Rarity, number> {
  const lvl = Math.max(1, Math.min(100, Math.floor(level)));
  let idx = RARITY_TABLE.findIndex((r) => lvl >= r.minLevel && lvl <= r.maxLevel);
  if (idx < 0) idx = RARITY_TABLE.length - 1;
  const row = RARITY_TABLE[idx];
  const next = RARITY_TABLE[idx + 1];
  const span = row.maxLevel - row.minLevel + 1;
  const t = next ? (lvl - row.minLevel) / (row.maxLevel - next.minLevel + span) : 0;
  const out = {} as Record<Rarity, number>;
  for (const r of RARITY_ORDER) {
    out[r] = Math.round(row.weights[r] + ((next ? next.weights[r] : row.weights[r]) - row.weights[r]) * t);
  }
  // Rounding slack always returns to C so the row sums to exactly 10 000.
  const total = RARITY_ORDER.reduce((a, r) => a + out[r], 0);
  out.C += 10000 - total;
  return out;
}

/** Pity thresholds (docs/16 §12). */
export const PITY = {
  aAfter: 20,
  sAfter: 60,
  ssAfter: 250,
  sssSoft: 500,
  sssHard: 1000,
} as const;

export interface PityCounters {
  sinceA: number;
  sinceS: number;
  sinceSS: number;
  sinceSSS: number;
  totalBreeds: number;
}

export function emptyPity(): PityCounters {
  return { sinceA: 0, sinceS: 0, sinceSS: 0, sinceSSS: 0, totalBreeds: 0 };
}

/**
 * Full final-weight pipeline (docs/16 §11). Returns basis points summing to
 * 10 000 so the UI can show exact odds before breeding.
 */
export function finalRarityWeights(
  levelA: number,
  levelB: number,
  rarityA: Rarity,
  rarityB: Rarity,
  opts: {
    breederLevel?: number;
    geneDiversity?: number;
    careQuality?: number;
    catalyst?: Partial<Record<Rarity, number>>;
    pity?: PityCounters;
  } = {},
): Record<Rarity, number> {
  const effectiveLevel = Math.floor((levelA + levelB) / 2);
  const base = rarityWeightsForLevel(effectiveLevel);

  const influence = Math.floor((RARITY_POINT[rarityA] + RARITY_POINT[rarityB]) / 2);
  const parentBoost: Record<Rarity, number> = { C: 0, B: 0.007, A: 0.0045, S: 0.0025, SS: 0.0009, SSS: 0.0001 };

  const breederLevel = opts.breederLevel ?? 1;
  // +5% weight shift to A..SS at level 50, capped, taken from C (docs/16 §9.4).
  const breederBonus = Math.min(0.05, (breederLevel / 50) * 0.05);
  const diversity = opts.geneDiversity ?? 0;
  const care = opts.careQuality ?? 0.5;

  const raw: Record<Rarity, number> = {} as Record<Rarity, number>;
  for (const r of RARITY_ORDER) {
    let w = base[r] / 10000;
    if (r !== "C") w *= 1 + breederBonus;
    w += influence * parentBoost[r];
    w += diversity * (r === "A" ? 0.012 : r === "S" ? 0.008 : r === "SS" ? 0.003 : 0);
    w += (care - 0.5) * (r === "C" ? -0.01 : 0.01);
    if (opts.catalyst?.[r]) w *= opts.catalyst[r]!;
    raw[r] = Math.max(0, w);
  }

  // SSS is capped at +0.05 pp from every soft source (docs/16 §10).
  raw.SSS = Math.min(raw.SSS, 0.0015 + 0.0005);

  const pity = opts.pity;
  if (pity) {
    if (pity.sinceA >= PITY.aAfter) raw.A *= 1 + Math.min(0.5, (pity.sinceA - PITY.aAfter) * 0.03);
    if (pity.sinceS >= PITY.sAfter) raw.S *= 1 + Math.min(1.2, (pity.sinceS - PITY.sAfter) * 0.025);
    if (pity.sinceSS >= PITY.ssAfter) raw.SS *= 1 + Math.min(1.5, (pity.sinceSS - PITY.ssAfter) * 0.02);
    if (pity.sinceSSS >= PITY.sssSoft) raw.SSS *= 1 + Math.min(0.5, (pity.sinceSSS - PITY.sssSoft) * 0.002);
    /* sssHard is a guarantee, not a bigger weight: at the promised counter the
       next roll IS SSS — and because the odds bar reads this same table, the
       published 100% and the rolled outcome cannot disagree. */
    if (pity.sinceSSS >= PITY.sssHard) {
      return { C: 0, B: 0, A: 0, S: 0, SS: 0, SSS: 10000 };
    }
  }

  const total = RARITY_ORDER.reduce((a, r) => a + raw[r], 0) || 1;
  const out = {} as Record<Rarity, number>;
  let sum = 0;
  for (const r of RARITY_ORDER) {
    out[r] = Math.round((raw[r] / total) * 10000);
    sum += out[r];
  }
  out.C += 10000 - sum;
  return out;
}

export function rarityFromScore(score: number): Rarity {
  let best: Rarity = "C";
  for (const r of RARITY_ORDER) if (score >= RARITY_META[r].minScore) best = r;
  return best;
}

export function rarityLabel(r: Rarity): string {
  return RARITY_META[r].label;
}
