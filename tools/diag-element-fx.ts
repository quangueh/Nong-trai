/**
 * Are the eight elements actually distinguishable, or did I write eight colours?
 *
 * The claim behind `elementImpact.ts` is that an element reads from the *shape of
 * its motion*. That claim is falsifiable without a browser: `particleOffset` returns
 * the offsets, so the signature can be measured directly.
 *
 * For each element I report the centroid direction, the mean reach, the spread of
 * angles and the fall. Then I assert that no two elements have a signature within a
 * tolerance — which is the actual requirement, since a player does not compare fire
 * to water, they just notice whether the same thing happened again.
 *
 * Run: npx tsx tools/diag-element-fx.ts
 */

import {
  ELEMENT_MOTION,
  elementPower,
  particleOffset,
} from "../src/battle/elementImpact";
import { ELEMENTS, type ElementId } from "../src/config/elements";

/** Centroid direction in degrees, 0 = right, -90 = up. */
function centroidDeg(dxs: number[], dys: number[]): number {
  return (Math.atan2(dys.reduce((a, b) => a + b, 0), dxs.reduce((a, b) => a + b, 0)) * 180) / Math.PI;
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}



interface Sig {
  count: number;
  /** Mean distance from the contact point, px. */
  reach: number;
  /** Angle of the centroid, degrees. */
  dir: number;
  /** How lopsided the fan is: 0 = evenly spread, 1 = a single direction. */
  lopsided: number;
  /** Vertical velocity sign at the end of flight: negative rises, positive falls. */
  vertical: string;
  fall: number;
  life: number;
}

function signature(el: ElementId, samples: number): Sig {
  const m = ELEMENT_MOTION[el];
  const power = elementPower(0.5);
  const dxs: number[] = [];
  const dys: number[] = [];
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < m.count; i++) {
      const o = particleOffset(m, i, m.count, power);
      dxs.push(o.dx);
      dys.push(o.dy);
    }
  }
  const dists = dxs.map((d, i) => Math.hypot(d, dys[i]));
  // Lopsidedness: resultant length over total length. A uniform full circle gives
  // ~0; everything going one way gives ~1. This is what separates light's 360° fan
  // from wood's 74° whip even though both mostly move rightwards.
  const resultant = Math.hypot(dxs.reduce((a, b) => a + b, 0), dys.reduce((a, b) => a + b, 0));
  const total = dists.reduce((a, b) => a + b, 0);
  const vert = mean(dys);
  return {
    count: m.count,
    reach: mean(dists),
    dir: centroidDeg(dxs, dys),
    lopsided: resultant / total,
    vertical: vert < -8 ? "rise" : vert > 8 ? "fall" : "flat",
    fall: m.fall,
    life: m.life,
  };
}

// --- measure ---------------------------------------------------------------
const SAMPLES = 400;
const sigs = new Map<ElementId, Sig>();
for (const el of ELEMENTS) sigs.set(el, signature(el, SAMPLES));

/**
 * Direction class. Four buckets, because a player does not perceive 12° of
 * difference between two impacts — they perceive "it went that way".
 *
 * Returns "n/a" for an even fan, and this matters: an even 360° fan has no
 * centroid, so the number that comes back is numerical noise (light measured 180°,
 * shadow 180°, neither of which means anything). Classifying it as a direction
 * would invent a distinction that is not on screen.
 */
function dirClass(deg: number, lop: string): string {
  if (lop === "even") return "n/a";
  // Wrap to [-180, 180). The first version of this was `((deg + 360) % 360) - 180`,
  // which is off by 180: it reported 3° (straight right) as "up", and the whole
  // classification silently shifted by half a turn.
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (d < -135) return "up";
  if (d < -55) return "up-slight";
  if (d < 40) return "right";
  return "down-right";
}

/** Lopsidedness band: even fan, medium, tight. */
function lopClass(v: number): string {
  return v < 0.5 ? "even" : v < 0.9 ? "medium" : "tight";
}

console.log("element    n   reach  dir   class      lopsided  band    vert   fall  life");
for (const el of ELEMENTS) {
  const s = sigs.get(el)!;
  const band = lopClass(s.lopsided);
  console.log(
    `${el.padEnd(10)} ${String(s.count).padStart(2)}  ${s.reach.toFixed(1).padStart(5)}  ${s.dir.toFixed(0).padStart(4)}  ` +
      `${dirClass(s.dir, band).padEnd(10)}  ${s.lopsided.toFixed(3).padStart(7)}  ${band.padEnd(6)}  ` +
      `${s.vertical.padEnd(5)} ${String(s.fall).padStart(5)}  ${s.life}`,
  );
}

// --- the actual requirement ------------------------------------------------
//
// Not "no two elements are within epsilon" — that is a continuous measure with an
// arbitrary threshold, and tuning it to pass is how a diagnostic becomes decoration.
// The requirement is categorical and checkable: **no two elements share all three of
// direction class, vertical class and lopsidedness band.** Share two of the three and
// the third still has to carry the difference; share all three and they are the same
// effect in a different colour.
const keys = new Map<ElementId, string>();
for (const el of ELEMENTS) {
  const s = sigs.get(el)!;
  const band = lopClass(s.lopsided);
  keys.set(el, `${dirClass(s.dir, band)}|${s.vertical}|${band}`);
}

let collisions = 0;
for (let i = 0; i < ELEMENTS.length; i++) {
  for (let j = i + 1; j < ELEMENTS.length; j++) {
    const a = ELEMENTS[i];
    const b = ELEMENTS[j];
    if (keys.get(a) === keys.get(b)) {
      console.error(`\nFAIL: ${a} and ${b} share a full signature (${keys.get(a)})`);
      collisions++;
    }
  }
}
if (collisions === 0) {
  console.log(`\nall ${ELEMENTS.length} signatures distinct:`);
  for (const el of ELEMENTS) console.log(`  ${el.padEnd(10)} ${keys.get(el)}`);
} else {
  process.exitCode = 1;
}

// --- the family must cover the shape space ---------------------------------
// If every element rose the same way, or all fell, the layer would be one effect
// eight times. These are the specific behaviours the file promises.
const mustRise = ELEMENTS.filter((e) => sigs.get(e)!.vertical === "rise");
const mustFall = ELEMENTS.filter((e) => sigs.get(e)!.vertical === "fall");
const mustFlat = ELEMENTS.filter((e) => sigs.get(e)!.vertical === "flat");
console.log(`\nrise: ${mustRise.join(", ")}`);
console.log(`fall: ${mustFall.join(", ")}`);
console.log(`flat: ${mustFlat.join(", ")}`);
if (mustRise.length < 2 || mustFall.length < 2 || mustFlat.length < 2) {
  console.error(
    `\nFAIL: the vertical spread collapsed — need >=2 each of rise, fall, flat, got ` +
      `${mustRise.length}/${mustFall.length}/${mustFlat.length}`,
  );
  process.exitCode = 1;
}

// Every element must use all three lopsidedness bands somewhere in the set, or the
// "fan" parameter is decorative for most of them.
const bands = new Set(ELEMENTS.map((e) => lopClass(sigs.get(e)!.lopsided)));
console.log(`lopsided bands in use: ${[...bands].join(", ")}`);
if (bands.size < 3) {
  console.error("\nFAIL: the fan width is not doing work - fewer than 3 lopsidedness bands");
  process.exitCode = 1;
}

// --- assert power actually scales -----------------------------------------
const light = ELEMENT_MOTION.light;
const chip = particleOffset(light, 0, light.count, elementPower(0.02));
const big = particleOffset(light, 0, light.count, elementPower(0.95));
console.log(`\npower scaling on light: chip ${Math.hypot(chip.dx, chip.dy).toFixed(1)}px, big ${Math.hypot(big.dx, big.dy).toFixed(1)}px`);
if (Math.hypot(big.dx, big.dy) <= Math.hypot(chip.dx, chip.dy)) {
  console.error("\nFAIL: a bigger hit throws no further than a chip");
  process.exitCode = 1;
}

// --- report ----------------------------------------------------------------
const ok = !process.exitCode;
console.log(ok ? "\nelement fx: distinguishable" : "\nelement fx: NOT distinguishable");