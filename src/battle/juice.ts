/**
 * Combat juice (docs/13).
 *
 * The battle had effects, but they were not *synchronised*: a skill's projectile
 * was scheduled 120ms after the cast, the impact burst fired whenever the damage
 * event happened to be processed, the screen shake was triggered separately, and
 * the damage number floated up on its own timer. Research on game feel is
 * unambiguous that this destroys the effect — if the flash, the shake, the
 * particles, the number and the sound land more than ~50ms apart, the brain
 * stops reading them as one event and the impact collapses. Ten effects badly
 * synchronised feel worse than three well synchronised.
 *
 * So the rule here is: `impact()` is the only place a hit is expressed, and it
 * fires every channel inside one synchronous block. The travelling projectile is
 * the only thing scheduled ahead of time, and it is scheduled to *arrive* at the
 * contact frame rather than merely to start at it.
 *
 * The rest is the checklist that the game was missing outright:
 *
 *   hitstop    a freeze at contact. The single most-missed piece of juice; it is
 *              what makes two objects look like they collided rather than passing
 *              through each other. Parameterised by weight, because a uniform
 *              pause makes a jab and a killing blow feel identical.
 *   recoil     the target is visibly pushed. Hits that land but move nothing read
 *              as mush.
 *   shake      trauma-based, and with rotation — pure translation reads as a
 *              glitch, whereas a few tenths of a degree reads as force.
 *   squash     volume-preserving, anchored to the bottom edge, so the plant
 *              presses into the ground instead of pulsing in place.
 *
 * Everything here is gated on `prefers-reduced-motion`. Screen shake is a
 * vestibular trigger for some players, and the research is clear that an
 * accessibility gate is not decoration.
 */

import { sfx } from "../audio/audio";
import type { Delivery } from "../config/skills";

export type FxSide = "a" | "b";

/** How hard the hit was. Drives hitstop, shake, recoil and volume together. */
export type Weight = "light" | "heavy" | "crit" | "kill";

/**
 * Per-weight tuning. Every channel scales off the same number on purpose: a crit
 * that shakes the screen but does not pause longer reads as two separate things
 * happening, which is the failure this whole module exists to avoid.
 */
const TUNING: Record<
  Weight,
  {
    /** Simulation freeze at contact, in ms. */
    stop: number;
    /** Shake trauma added. Trauma is not amplitude — see `Shake`. */
    trauma: number;
    /** Knockback distance, in px. */
    recoil: number;
    /** How far the victim squashes, as a fraction. */
    squash: number;
    /** Peak brightness of the contact flash, 0..1. */
    flash: number;
    /** Particle count. */
    bits: number;
  }
> = {
  // A chip of chip damage and a basic attack should barely register. If everything
  // is loud, nothing is.
  light: { stop: 42, trauma: 0.16, recoil: 4, squash: 0.04, flash: 0.22, bits: 5 },
  heavy: { stop: 72, trauma: 0.34, recoil: 9, squash: 0.08, flash: 0.4, bits: 9 },
  crit: { stop: 108, trauma: 0.58, recoil: 15, squash: 0.13, flash: 0.66, bits: 16 },
  kill: { stop: 168, trauma: 0.8, recoil: 20, squash: 0.17, flash: 0.9, bits: 26 },
};

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How long a travelling delivery should take, by delivery kind. */
export function travelMs(delivery: Delivery): number {
  switch (delivery) {
    case "projectile":
      return 170;
    case "channel":
      return 120;
    case "melee":
      return 90;
    case "aura":
      return 130;
    case "trap":
      return 200;
    case "summon":
      return 210;
    default:
      return 150;
  }
}

// ---------------------------------------------------------------------------
// Shake
// ---------------------------------------------------------------------------

/**
 * Trauma-based shake.
 *
 * Amplitude is trauma *squared*, so small hits are barely felt and big ones are
 * felt hard — the curve is what makes one shake setting cover four weights
 * without a table of magic numbers. Trauma decays linearly and never goes
 * negative.
 *
 * Rotation is not a garnish: translation alone reads as a rendering glitch, while
 * a fraction of a degree of rotation reads as force.
 */
class Shake {
  private trauma = 0;
  private raf = 0;
  private last = 0;

  constructor(
    private host: HTMLElement,
    private maxMs = 260,
    private maxDeg = 1.5,
    private maxPx = 9,
  ) {}

  add(amount: number): void {
    if (reducedMotion()) return;
    // Trauma sums but clamps: two simultaneous hits should not shake twice as hard
    // as the heavier of them, or the screen becomes unreadable.
    this.trauma = Math.min(1, this.trauma + amount);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    this.trauma = Math.max(0, this.trauma - dt / this.maxMs);

    if (this.trauma <= 0) {
      this.host.style.transform = "";
      this.raf = 0;
      return;
    }
    const s = this.trauma * this.trauma;
    // Two out-of-phase sine waves rather than random: random per frame looks like
    // static, this looks like a jolt that settles.
    const t = now / 1000;
    const dx = Math.sin(t * 61) * this.maxPx * s;
    const dy = Math.cos(t * 47) * this.maxPx * 0.7 * s;
    const rot = Math.sin(t * 39) * this.maxDeg * s;
    this.host.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) rotate(${rot.toFixed(3)}deg)`;
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Drop any shake in progress — used when a battle ends or is destroyed. */
  clear(): void {
    this.trauma = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.host.style.transform = "";
  }
}

// ---------------------------------------------------------------------------
// Per-fighter transform channels
// ---------------------------------------------------------------------------

/**
 * The transform stack for one fighter.
 *
 * Each channel owns one property of a single `transform` string rather than
 * setting `transform` itself, so a recoil, a squash and an idle bob can all be
 * active at once without the last writer winning. Written out longhand on purpose:
 * at 30Hz the string is rebuilt ~30 times a second for two elements, which costs
 * nothing, and it removes the whole class of "why did the lunge cancel the
 * recoil" bugs.
 */
class FighterFx {
  private recoil = 0;
  private recoilTarget = 0;
  private squash = 0;
  private squashV = 0;
  /**
   * Extra scale while transformed, eased toward its target.
   *
   * A channel rather than a stylesheet rule, because this class writes
   * `avatar.style.transform` every frame and an inline style would win over the
   * CSS that sets it — the plant would enlarge only while the spring was asleep.
   */
  private morphScale = 1;
  private morphTarget = 1;
  private raf = 0;
  private last = 0;

  constructor(
    private root: HTMLElement,
    private avatar: HTMLElement,
  ) {}

  /**
   * Enlarge while transformed, and release it afterwards.
   *
   * `on` rather than a magnitude: the decision of how big a morph should be
   * belongs in the battle's tuning table, not in the animation code.
   */
  setMorph(on: boolean, scale = 1.16): void {
    this.morphTarget = on ? scale : 1;
    this.start();
  }

  /** Kick the fighter backwards, away from `dirX`. */
  knock(dirX: number, distance: number): void {
    if (reducedMotion()) return;
    this.recoilTarget = dirX * distance;
    this.start();
  }

  /** Compress then rebound. Volume-preserving: wide and short, then tall and thin. */
  press(amount: number): void {
    if (reducedMotion()) return;
    this.squash = amount;
    this.squashV = 0;
    this.start();
  }

  private start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    const dt = Math.min(48, now - this.last) / 1000;
    this.last = now;

    // Spring back from recoil.
    this.recoil += (this.recoilTarget - this.recoil) * Math.min(1, dt * 13);
    if (Math.abs(this.recoilTarget - this.recoil) < 0.15) this.recoil = this.recoilTarget;
    this.recoilTarget *= Math.pow(0.0016, dt);

    // Critically-damped spring on the squash, so it settles instead of ringing.
    const k = 210;
    const c = 2 * Math.sqrt(k);
    this.squashV += (-k * this.squash - c * this.squashV) * dt;
    this.squash += this.squashV * dt;

    const idle = Math.sin(now / 520) * 0.5;
    // Bottom-anchored: a squash that pivots on its centre reads as a heartbeat,
    // one anchored at the base reads as weight pressing into the ground.
    //
    // Morph multiplies the result rather than replacing it, so a transformed
    // plant that gets hit still squashes — the two read as one body rather than
    // as two effects fighting over one property.
    this.morphScale += (this.morphTarget - this.morphScale) * Math.min(1, dt * 7);
    const sx = (1 + this.squash * 0.55 + idle * 0.004) * this.morphScale;
    const sy = (1 - this.squash - idle * 0.004) * this.morphScale;

    this.root.style.transform = `translate3d(${this.recoil.toFixed(2)}px, 0, 0)`;
    this.avatar.style.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

    if (
      Math.abs(this.recoil) < 0.1 &&
      Math.abs(this.squash) < 0.002 &&
      Math.abs(this.squashV) < 0.01 &&
      Math.abs(this.morphScale - this.morphTarget) < 0.001
    ) {
      this.root.style.transform = "";
      this.avatar.style.transform = "";
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  clear(): void {
    this.recoil = 0;
    this.recoilTarget = 0;
    this.squash = 0;
    this.squashV = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root.style.transform = "";
    this.avatar.style.transform = "";
  }
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export interface ImpactSpec {
  victim: FxSide;
  /** Direction the victim is pushed: -1 left, +1 right. */
  push: number;
  amount: number;
  weight: Weight;
  colour: string;
  /** Rendered by the effects layer; kept here so the whole bundle is one object. */
  draw: (weight: Weight) => void;
}

export class CombatJuice {
  private shake: Shake;
  private fighters: Record<FxSide, FighterFx> = { a: new FighterFx(document.createElement("div"), document.createElement("div")), b: new FighterFx(document.createElement("div"), document.createElement("div")) };
  /** Absolute time the simulation is frozen until. */
  private frozenUntil = 0;
  private flashEl: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    a: { root: HTMLElement; avatar: HTMLElement },
    b: { root: HTMLElement; avatar: HTMLElement },
  ) {
    this.fighters = { a: new FighterFx(a.root, a.avatar), b: new FighterFx(b.root, b.avatar) };
    this.shake = new Shake(host);
    this.flashEl = null;
  }

  /** True while hitstop is holding the simulation. */
  get frozen(): boolean {
    return performance.now() < this.frozenUntil;
  }

  /** How much longer the freeze lasts, for a progress indicator if one is wanted. */
  get frozenFor(): number {
    return Math.max(0, this.frozenUntil - performance.now());
  }

  /**
   * Hold the simulation still for `ms`, with no impact attached.
   *
   * Separate from \`impact\` because a transformation is not a hit: it needs the
   * freeze and the shake without a recoil in the wrong direction, damage shards,
   * or a floating number in the wrong colour. Reusing \`impact\` and discarding
   * most of it would have left a recoil pushing the wrong way, which is the sort
   * of thing that reads as a bug and not as a feature.
   */
  /**
   * Enlarge a transformed fighter, and release it.
   *
   * The animation layer also toggles a class; this is the half that actually
   * changes the picture, because a class cannot override an inline transform.
   */
  setMorph(side: FxSide, on: boolean, scale = 1.16): void {
    this.fighters[side].setMorph(on, scale);
  }

  hold(ms: number): void {
    if (reducedMotion()) return;
    this.frozenUntil = Math.max(this.frozenUntil, performance.now() + ms);
  }

  /**
   * The whole point of this class.
   *
   * Every channel fires here, in one synchronous block, so the flash, the shake,
   * the hitstop, the recoil, the particles, the number and the sound all land on
   * the same frame. `draw` is the effects layer's own burst; it is a callback
   * rather than a call so the layer stays responsible for its own markup.
   */
  impact(spec: ImpactSpec): void {
    const t = TUNING[spec.weight];

    // 1. Freeze first. It is the temporal landmark everything else aligns to, so
    //    it has to be committed before anything can paint this frame.
    if (!reducedMotion()) this.frozenUntil = Math.max(this.frozenUntil, performance.now() + t.stop);

    // 2. Motion.
    this.shake.add(t.trauma);
    const dir = spec.victim === "a" ? -1 : 1;
    this.fighters[spec.victim].knock(spec.push !== 0 ? spec.push : dir, t.recoil);
    this.fighters[spec.victim].press(t.squash);

    // 3. Light. A brief white-out over the whole arena at contact: the cheapest
    //    confirmation that something connected, and the channel that most often
    //    fails to arrive on the right frame.
    this.flash(t.flash);

    // 4. Debris and the number, drawn by the effects layer.
    spec.draw(spec.weight);

    // 5. Sound. Same frame, or the impact is silent and reads as weightless.
    if (spec.weight === "crit" || spec.weight === "kill") sfx.play("crit", { gain: spec.weight === "kill" ? 1 : 0.9 });
    else sfx.play("hit", { gain: 0.6 + spec.amount / 90 });
  }

  /**
   * Non-damage beats: heal, shield, miss, cast, morph, death. Each has its own shape.
   *
   * `morph` is the heaviest of them. Reusing `cast` would have given it the cast
   * numbers, and since most casts are projectiles the transformation would have
   * been the same picture as an ordinary hit — which is the one thing it must not
   * be.
   */
  cue(kind: "heal" | "shield" | "miss" | "cast" | "morph" | "death" | "revive", side: FxSide, draw: () => void, amount = 0): void {
    switch (kind) {
      case "morph":
        // The heaviest non-damage beat there is: a near-crit freeze, a crit's
        // worth of shake, and a colour wash tinted by the element rather than
        // white. It is the largest thing that can happen to a plant that is not
        // a plant dying, and it should be felt as one.
        sfx.play("levelUp", { gain: 0.8 });
        this.fighters[side].press(0.16);
        this.hold(74);
        this.shake.add(0.5);
        this.flash(0.3);
        return;
      case "heal":
        sfx.play("heal");
        this.fighters[side].press(-0.05);
        break;
      case "shield":
        sfx.play("shield");
        this.fighters[side].press(0.05);
        break;
      case "miss":
        sfx.play("miss", { gain: 0.7 });
        break;
      case "cast":
        sfx.play("cast");
        break;
      case "death":
        sfx.play("death");
        this.shake.add(0.3);
        this.fighters[side].press(0.16);
        break;
      case "revive":
        sfx.play("levelUp", { gain: 0.8 });
        this.fighters[side].press(-0.1);
        break;
      default:
        void amount;
        break;
    }
    draw();
  }

  /** A full-screen colour wash at the contact frame. */
  private flash(peak: number): void {
    if (reducedMotion()) return;
    if (!this.flashEl) return;
    const el = this.flashEl;
    // Cancel any wash still running so a rapid second hit restarts cleanly instead
    // of interpolating from the first one's halfway point.
    el.style.transition = "none";
    el.style.opacity = String(peak);
    // Force a reflow so the opacity change takes effect as a fresh transition.
    void el.offsetWidth;
    el.style.transition = "opacity 0.22s cubic-bezier(0.2, 0, 0.3, 1)";
    el.style.opacity = "0";
  }

  /** Attach the wash element the arena owns. */
  attachFlash(el: HTMLElement): void {
    this.flashEl = el;
  }

  reset(): void {
    this.shake.clear();
    this.fighters.a.clear();
    this.fighters.b.clear();
    this.frozenUntil = 0;
  }

  destroy(): void {
    this.reset();
    this.flashEl = null;
  }
}

/** Choose a weight from how much damage landed, as a fraction of max HP. */
export function weightFor(frac: number, isCrit: boolean, kills: boolean): Weight {
  if (kills) return "kill";
  if (isCrit) return "crit";
  if (frac >= 0.14) return "heavy";
  return "light";
}

export { TUNING };