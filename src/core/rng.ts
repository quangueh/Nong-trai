/**
 * Deterministic random (docs/06 §5).
 *
 * Every gene roll, care gain and battle tick draws from a stream derived from a
 * string seed, so a result can always be replayed or diffed between clients.
 */

/** FNV-1a 32-bit string hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Turn any string into a 36-char seed token we can persist. */
export function seedToken(...parts: (string | number)[]): string {
  return hashString(parts.join("|")).toString(36).padStart(7, "0");
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = (typeof seed === "number" ? seed >>> 0 : hashString(seed)) || 0x9e3779b9;
  }

  /** mulberry32 — small, fast, good enough distribution for gameplay. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick. Weights need not be normalised. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weight(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** `count` distinct entries (or as many as exist). */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = items.slice();
    const out: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }

  /** Fisher-Yates on a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Independent child stream — lets a subsystem draw without shifting others. */
 fork(tag: string): Rng {
    return new Rng(`${this.state}:${tag}`);
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Weighted random that can also be expressed in basis points (per mille). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}
