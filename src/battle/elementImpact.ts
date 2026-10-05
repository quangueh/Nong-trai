/**
 * Elemental impacts.
 *
 * Every hit already landed as a generic burst: a white star, some shards, a number.
 * That is a correct rendering of "damage happened" and a poor rendering of *which
 * element* did it. Fire, water, wood and shadow all looked identical, so the element
 * — the single most visible piece of identity a plant has in a fight — existed only
 * as a colour on a log line nobody reads mid-combat.
 *
 * One particle system, eight behaviours.
 *
 * The decision was deliberately not to write eight effect functions. What makes an
 * element readable is the *shape of its motion*, and that is a distribution, not a
 * drawing: fire throws embers up and out, water throws a low arc that falls back,
 * wood whips sideways and curls, shadow pulls inward instead of pushing out. So each
 * element is described by how it distributes particles, and one spawner renders all
 * of them. That keeps them honest to the same physics, which is what makes the
 * difference read as the element rather than as decoration.
 *
 * All motion is transform/opacity. No width, height, top or left.
 */

import type { ElementId } from "../config/elements";
import { ELEMENT_INFO } from "../config/elements";
import type { FxSide } from "./battleFx";

/**
 * How an element distributes its particles.
 *
 * `dx`/`dy` are the end offsets in px at full power, scaled per hit. `spin` is the
 * rotation in degrees. `fall` adds gravity to the vertical component, which is the
 * difference between an ember and a spark.
 */
interface ElementMotion {
  /** Particles per hit. Water throws fewer but slower; shadow throws none outward. */
  count: number;
  /** Bias of the base angle in degrees. 0 is straight right, -90 is straight up. */
  fan: number;
  /** Arc width in degrees, centred on `fan`. */
  spread: number;
  /** Horizontal reach multiplier. */
  dx: number;
  /** Vertical reach multiplier. Negative goes up. */
  dy: number;
  /** Per-particle rotation, degrees. */
  spin: number;
  /** Stagger between particles, ms. */
  stagger: number;
  /** Life, ms. */
  life: number;
  /** Upward acceleration during flight, px. Positive = arcs back down. */
  fall: number;
  /** Particle scale at birth. */
  scale: number;
  /** Ring/burst radius multiplier; 0 draws no ring. */
  ring: number;
  /** Glyph drawn at the contact point, as SVG path data in a 24x24 box. */
  glyph?: string;
  /** Word shown for a moment at the contact point. */
  word?: string;
}

/**
 * Per-element motion.
 *
 * Tuned against how each element is described in play rather than by formula, and
 * checked rather than eyeballed: `tools/diag-element-fx.ts` measures the resulting
 * signature for each one and fails if any two share all three of direction class,
 * vertical class and lopsidedness class.
 *
 * The eight, and what each is doing:
 *
 *   wood      a horizontal whip. Widest reach of the set, heavy spin so it curls.
 *   water     a low arc that comes back down. Largest fall after earth.
 *   earth     debris. Chunky, slow, longest life, drops steeply.
 *   fire      embers rising and scattering, drifting down only slightly at the end.
 *   electric  a tight vertical snap. Narrowest fan, shortest life — over before you
 *             can follow it, which is what electricity looks like.
 *   poison    slow wide bubbles. Buoyant: `fall` is negative so they keep climbing.
 *   light     rays in a plane. Full 360 fan and no fall, so nothing has a "up".
 *   shadow    converges instead of scattering. Its geometry is deliberately short
 *             reach; the visible behaviour is in the CSS, which pulls the particles
 *             back to the contact point.
 */
export const ELEMENT_MOTION: Record<ElementId, ElementMotion> = {
  // Wood: the horizontal lash. Widest horizontal reach of the set.
  wood: {
    count: 10,
    fan: 0,
    spread: 80,
    dx: 112,
    dy: 36,
    spin: 420,
    stagger: 18,
    life: 640,
    fall: 10,
    scale: 1.05,
    ring: 1,
    glyph: "M12 3c-3 0-5.4 2.4-5.4 5.4C6.6 13 12 21 12 21s5.4-8 5.4-12.6C17.4 5.4 15 3 12 3Z",
    word: "Quấn",
  },
  // Fire: embers rise and scatter, with only a slight settle at the end of travel.
  fire: {
    count: 11,
    fan: -72,
    spread: 130,
    dx: 64,
    dy: 80,
    spin: 180,
    stagger: 26,
    life: 780,
    fall: 14,
    scale: 1.15,
    ring: 1.25,
    glyph: "M12 3c2.5 3.5 4.2 5.6 4.2 8a4.2 4.2 0 0 1-8.4 0c0-1.5.7-2.6 1.7-3.8.2 1.3.9 2 1.7 2.2-.4-2.3-.2-4.4.8-6.4Z",
    word: "Cháy",
  },
  // Water: a low sweeping arc that returns to the ground.
  //
  // `fall` has to out-weigh the lift of `dy` here. At the reach this was first given,
  // a `fall` of 58 exactly cancelled the -20px the -25° fan produces, water measured
  // as flat, and it collapsed onto wood's signature — two elements throwing the same
  // thing sideways. The diagnostic caught it; 95 puts the arc decisively downward.
  water: {
    count: 9,
    fan: -25,
    spread: 100,
    dx: 92,
    dy: 48,
    spin: 40,
    stagger: 22,
    life: 700,
    fall: 95,
    scale: 1,
    ring: 1.1,
    glyph: "M12 3.5c3.4 4.2 5.4 6.9 5.4 9.3a5.4 5.4 0 1 1-10.8 0c0-2.4 2-5.1 5.4-9.3Z",
    word: "Xung kích",
  },
  // Earth: fewest particles of the aggressive elements, longest life, steepest fall.
  earth: {
    count: 7,
    fan: -45,
    spread: 140,
    dx: 50,
    dy: 31,
    spin: 240,
    stagger: 34,
    life: 900,
    fall: 92,
    scale: 1.5,
    ring: 0.7,
    glyph: "M4 17h16l-2.5-6.5-3 3L12 8l-2.5 5.5-3-3L4 17Z",
    word: "Đè nén",
  },
  // Electric: the tightest fan and the shortest life of the set.
  electric: {
    count: 8,
    fan: -140,
    spread: 26,
    dx: 36,
    dy: 112,
    spin: 90,
    stagger: 8,
    life: 420,
    fall: 4,
    scale: 0.9,
    ring: 0.85,
    glyph: "M13.5 2 6 13h4l-1.5 9L18 10h-4.5l1-8Z",
    word: "Giật",
  },
  // Poison: buoyant bubbles. A negative `fall` means they are still climbing when the
  // animation ends, which is the only element for which that is true.
  poison: {
    count: 8,
    fan: 0,
    spread: 200,
    dx: 48,
    dy: 64,
    spin: 30,
    stagger: 40,
    life: 1000,
    fall: -34,
    scale: 1.25,
    ring: 0.6,
    glyph: "M12 3a4 4 0 0 1 4 4 4 4 0 0 1-1.2 2.9A3.4 3.4 0 1 1 12 18a3.4 3.4 0 1 1-2.8-5.1A4 4 0 0 1 12 3Z",
    word: "Ức",
  },
  // Light: rays. A full circle and no fall, so no particle has a distinct "up".
  light: {
    count: 12,
    fan: 0,
    spread: 360,
    dx: 76,
    dy: 28,
    spin: 90,
    stagger: 10,
    life: 560,
    fall: 0,
    scale: 0.85,
    ring: 1.5,
    glyph: "M12 4a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 12 4Zm0 12.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM4 12a1.6 1.6 0 1 1 3.2 0A1.6 1.6 0 0 1 4 12Zm12.8 0a1.6 1.6 0 1 1 3.2 0 1.6 1.6 0 0 1-3.2 0Z",
    word: "Chói",
  },
  // Shadow: short reach and a tight fan, because what matters is not how far it goes
  // but that it comes back. `.fx-elem.is-shadow` inverts the keyframe so the particles
  // converge on the contact point, and the ring contracts to match.
  shadow: {
    count: 10,
    fan: -140,
    spread: 120,
    dx: 34,
    dy: 0,
    spin: -60,
    stagger: 30,
    life: 820,
    fall: 0,
    scale: 1.3,
    ring: 1.2,
    glyph: "M14.5 3.2c-4.6 1.4-7.8 5-7.8 9.4 0 1.9.6 3.6 1.6 5H5.1c1 2 2.7 3.4 5.2 3.6-.4 1-.6 1.9-.6 2.6h6.3c0-.7-.2-1.6-.6-2.6 2.5-.2 4.2-1.6 5.2-3.6h-3.2c1-1.4 1.6-3.1 1.6-5 0-3.3-1.7-6.3-4.5-8.4Z",
    word: "Hút",
  },
};

/** How hard the hit landed, 0..1, mapped onto particle count and reach. */
export function elementPower(fraction: number): number {
  return Math.max(0.35, Math.min(1.6, 0.55 + fraction * 1.05));
}

/**
 * Geometry for one particle, shared by the spawner and the tests.
 *
 * Split out so the motion can be asserted without a browser: jsdom has no layout
 * engine, so the offsets are the only part of this that can be checked in a unit
 * test, and they are the part that determines whether an element is distinguishable.
 */
export function particleOffset(m: ElementMotion, i: number, n: number, power: number): {
  dx: number;
  dy: number;
  rot: number;
} {
  // Even spread across the fan, jittered, so a 12-ray fan looks even but not stamped.
  const step = n > 1 ? m.spread / (n - 1) : 0;
  // Note the angle is deliberately NOT scaled by `power`: a bigger hit throws further,
  // it does not throw at a different angle. Scaling the angle would have made each
  // element's signature depend on how hard the hit landed, so the same element could
  // read as two different things in a fast fight.
  const a = ((m.fan - m.spread / 2 + step * i) * Math.PI) / 180;
  const jitter = 0.72 + Math.random() * 0.5;
  // `Math.abs` on dy is load-bearing. The fan is in compass degrees, where -90 means
  // straight up and sin(-90) is -1, so a negative dy already points the particle up.
  // Without the abs, the negative flipped every particle downward and the whole fan
  // collapsed onto one axis — which is exactly what the first measurement showed:
  // seven of the eight elements reported "fall", and fire measured as firing sideways.
  return {
    dx: Math.cos(a) * m.dx * power * jitter,
    dy: (Math.sin(a) * Math.abs(m.dy) + m.fall * 0.35) * power * jitter,
    rot: m.spin * (0.4 + Math.random() * 0.8) * (i % 2 === 0 ? 1 : -1),
  };
}

/** The class list an element's particle layer needs. */
export function elementClasses(el: ElementId): string {
  return `fx-elem is-${el}`;
}

/** Colour for an element's particles, from the shared element table. */
export function elementFxColour(el: ElementId): string {
  return ELEMENT_INFO[el].color;
}

/** Re-exported so callers do not need to import both modules for one effect. */
export type { FxSide };