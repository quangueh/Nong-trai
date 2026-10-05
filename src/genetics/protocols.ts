/**
 * Breeding protocols.
 *
 * Breeding was a black box: pick two plants, pay, receive a child. Every decision the
 * player made before that point — which plants, how much coin, which plot the result
 * goes in — was real. The breeding itself was not. The `catalyst` hook on
 * `finalRarityWeights` and the `catalystBonus` on `BreedingContext` had been sitting
 * there unused since they were written, which is the honest description of this whole
 * change: the lever existed, nobody had held it.
 *
 * A protocol is a held lever. Each one biases the outcome in a direction that is
 * useful, and each one costs something the player cares about, because a choice that
 * is only ever an upside is not a choice — it is a strictly better button.
 *
 * Every protocol has an explicit downside:
 *
 *   Cộng hưởng  free and reliable, but caps how far the child can mutate.
 *   Ổn định     halves mutation chance, and gives up the top rarity band to do it.
 *   Bùng nổ      far more mutation, and a real chance of over-reaching into a plant
 *                that is weirder but weaker. Chaos is not power.
 *   Dị dân      pays double for the cross-lineage bonus even between close relatives.
 *   Thổi luyện  twice the fee for a specialist: the child inherits one parent's
 *                element sharply instead of blending.
 *
 * They are gated by breeder level so the choice unfolds as progression rather than
 * appearing as five buttons on the first breeding.
 */

import type { Rarity } from "../config/rarity";
import { RARITY_ORDER, RARITY_POINT } from "../config/rarity";

export type ProtocolId = "resonance" | "stabilise" | "surge" | "migrant" | "temper";

/**
 * How far a protocol is allowed to push the mutation tier.
 *
 * `mutationTierWeights` returns four buckets (micro, minor, major, chaotic) indexed
 * 0..3. The ceiling is a clamp applied after the roll: a protocol can raise the
 * chance of the high buckets or cut them off, but it can never re-roll the budget,
 * which would let a protocol manufacture an outcome the parents could not reach.
 */
export interface ProtocolDef {
  id: ProtocolId;
  label: string;
  icon: string;
  /** One line: what it does. */
  blurb: string;
  /** One line: what it costs. Shown next to the blurb, never hidden. */
  tradeoff: string;
  levelRequired: number;
  /** Multiplies the breeding fee. */
  feeMultiplier: number;
  /** Added to the mutation chance before the existing clamp. */
  mutationChanceDelta: number;
  /** Added to the tier ceiling, then clamped to 0..3. */
  tierCeilingShift: number;
  /**
   * Forced lineage diversity for the odds calculation, when set.
   *
   * `lineageDiversity` returns 0..1 and feeds `finalRarityWeights` directly. Dị dân
   * claims that value regardless of the parents' actual relatedness, which is the
   * whole point and also why it is the second most expensive protocol.
   */
  forceGeneDiversity?: number;
  /**
   * Element blend, as the upper bound of the recessive contribution.
   *
   * The generator's own default is 0.62. A lower number keeps more of the dominant
   * parent, so Thổi luyện produces a specialist. Expressed as a multiplier on the
   * existing bound rather than an absolute, so the two cannot drift apart.
   */
  elementBlendScale?: number;
  /**
   * Multipliers applied to each rarity's weight in the odds shown before breeding.
   *
   * These must be kept honest against what the generator then does — the odds bar is a
   * promise to the player, and a protocol whose published odds do not match its
   * effect would be worse than having no protocols at all. `tools/test-protocols.ts`
   * checks the two against each other by breeding.
   */
  catalyst: Partial<Record<Rarity, number>>;
}

export const PROTOCOLS: readonly ProtocolDef[] = [
  {
    id: "resonance",
    label: "Cộng hưởng",
    icon: "🔗",
    blurb: "Cây con thừa cả hai khuynh hướng của cha mẹ.",
    tradeoff: "Không tốn phí, nhưng cây con không thể đột biến quá xa.",
    levelRequired: 1,
    feeMultiplier: 1,
    mutationChanceDelta: -0.02,
    tierCeilingShift: -1,
    catalyst: { A: 1.3, S: 1.15 },
  },
  {
    id: "stabilise",
    label: "Ổn định",
    icon: "🛡",
    blurb: "Giảm một nửa khả năng đột biến, ưu tiên dòng gen sạch.",
    tradeoff: "Phí cao hơn và phải hy sinh dải hiếm cao nhất.",
    levelRequired: 5,
    feeMultiplier: 1.3,
    mutationChanceDelta: -0.26,
    tierCeilingShift: -1,
    catalyst: { C: 1.15, S: 0.75, SS: 0.6, SSS: 0.5 },
  },
  {
    id: "surge",
    label: "Bùng nổ",
    icon: "💥",
    blurb: "Đột biến dữ dội, cho phép bậc đột biến cao nhất.",
    tradeoff: "Dễ tạo ra cây quái dị mà yếu — hỗn loạn không phải là sức mạnh.",
    levelRequired: 12,
    feeMultiplier: 1.8,
    mutationChanceDelta: 0.24,
    tierCeilingShift: 1,
    catalyst: { B: 1.2, A: 1.35, S: 1.5, SS: 1.35, SSS: 0.4 },
  },
  {
    id: "migrant",
    label: "Dị dân",
    icon: "🧭",
    blurb: "Buộc cây con vượt dòng, nhận trọn thưởng đa dạng gene.",
    tradeoff: "Gấp đôi phí — kể cả với hai cây cùng huyết thống.",
    levelRequired: 20,
    feeMultiplier: 2,
    mutationChanceDelta: 0.04,
    tierCeilingShift: 0,
    forceGeneDiversity: 0.95,
    catalyst: { B: 1.15, A: 1.3, S: 1.35 },
  },
  {
    id: "temper",
    label: "Thổi luyện",
    icon: "⚒",
    blurb: "Cây con thừa hẳn hệ của cha mẹ mạnh hơn thay vì pha trộn.",
    tradeoff: "Đắt nhất, và cây con thành chuyên gia thay vì đa năng.",
    levelRequired: 30,
    feeMultiplier: 2.4,
    mutationChanceDelta: 0,
    tierCeilingShift: 0,
    elementBlendScale: 0.5,
    catalyst: { S: 1.3, SS: 1.25 },
  },
] as const;

const BY_ID = new Map<ProtocolId, ProtocolDef>(PROTOCOLS.map((p) => [p.id, p] as const));

export function getProtocol(id: ProtocolId): ProtocolDef {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown protocol: ${id}`);
  return p;
}

/** The default, which is to breed without one. */
export const DEFAULT_PROTOCOL: ProtocolId = "resonance";

/**
 * Which protocols a breeder of this level may run.
 *
 * Returns every protocol the player has earned, always including Cộng hưởng — a
 * player must never be shown a breeding screen with nothing selectable.
 */
export function availableProtocols(breederLevel: number): ProtocolDef[] {
  return PROTOCOLS.filter((p) => breederLevel >= p.levelRequired);
}

export function protocolUnlocked(id: ProtocolId, breederLevel: number): boolean {
  return breederLevel >= getProtocol(id).levelRequired;
}

/** What the protocol does to a parent pair's gene-diversity term, if anything. */
export function protocolDiversity(
  id: ProtocolId,
  measured: number,
): number {
  const forced = getProtocol(id).forceGeneDiversity;
  return forced == null ? measured : Math.max(measured, forced);
}

/**
 * Apply the protocol's catalyst to a rarity-weight table.
 *
 * The input and the output are both **per-ten-thousand integers summing to 10000**,
 * because that is what `finalRarityWeights` returns and what everything downstream
 * expects: the odds bar renders these directly, `probabilityRows` formats them, and
 * `rollWeighted` consumes them. An earlier version of this renormalised to a
 * probability summing to 1, which silently rescaled the entire contract — the numbers
 * on the breeding screen and the roll that produces the child were then reading
 * differently-shaped tables.
 *
 * The remainder from rounding is given to C, which is what `finalRarityWeights` itself
 * does: C is the band that must absorb the rounding error without any single band
 * losing probability that a player was shown.
 */
export function applyCatalyst(
  weights: Record<Rarity, number>,
  id: ProtocolId,
): Record<Rarity, number> {
  const cat = getProtocol(id).catalyst;
  const scaled = {} as Record<Rarity, number>;
  let total = 0;
  for (const r of RARITY_ORDER) {
    // Floored at one part in ten thousand: a protocol that multiplied a band to zero
    // would delete it from the game rather than disfavour it, and the odds bar has
    // nowhere to draw a zero-width segment.
    const w = Math.max(0.0001, (weights[r] ?? 0) * (cat[r] ?? 1));
    scaled[r] = w;
    total += w;
  }
  if (total <= 0) return { ...weights };

  const out = {} as Record<Rarity, number>;
  let sum = 0;
  for (const r of RARITY_ORDER) {
    out[r] = Math.round((scaled[r] / total) * 10000);
    sum += out[r];
  }
  out.C += 10000 - sum;
  return out;
}

/**
 * The headline number the UI leads with: how far up the rarity ladder this protocol
 * shifts the odds, in ladder points — the same 0..5 scale as `RARITY_POINT`.
 *
 * Divided by the table's total so the result is in points rather than in parts per
 * ten thousand. That normalisation is load-bearing: the tables here are per-10000, so
 * without it a +0.05 shift reads out as `426`, which is not a quantity anyone can look
 * at and judge.
 *
 * Derived rather than hand-written, because a hand-written figure would be a second
 * place for the catalyst table to be wrong in.
 */
export function protocolShift(weights: Record<Rarity, number>, id: ProtocolId): number {
  const shifted = applyCatalyst(weights, id);
  const total = RARITY_ORDER.reduce((a, r) => a + (weights[r] ?? 0), 0) || 1;
  const point = (w: Record<Rarity, number>) =>
    RARITY_ORDER.reduce((acc, r) => acc + RARITY_POINT[r] * w[r], 0);
  return (point(shifted) - point(weights)) / total;
}