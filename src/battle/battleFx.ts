/**
 * Battle effects layer (docs/07, docs/13).
 *
 * The battle used to be a dark box with two plant thumbnails and a text log.
 * Nothing on screen ever moved except a number: the log said "gây 14 sát thương"
 * and the arena showed nothing at all, so a fight read as a spreadsheet ticking.
 *
 * Everything here is driven by the engine's own events — nothing is decorative
 * noise. A `SKILL_CAST_STARTED` carries the skill id, so the windup is shaped by
 * the skill's actual delivery; the `DAMAGE_APPLIED` that follows carries `side`
 * (the attacker) and `other` (who was hit), so the impact lands on the right
 * fighter. If the engine says nothing happened, nothing is drawn.
 *
 * All motion is transform/opacity. Nothing here animates width, height, top or
 * left, so a fight cannot force layout on every frame.
 */

import { el } from "../ui/components";
import type { Delivery, EffectKind } from "../config/skills";
import { DELIVERIES } from "../config/skills";
import type { ElementId } from "../config/elements";
import { ELEMENT_INFO } from "../config/elements";
import { ELEMENT_MOTION, elementClasses, elementPower, particleOffset } from "./elementImpact";

export type FxSide = "a" | "b";

/** Where a fighter stands, and how big it is, in layer coordinates. */
interface Anchor {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const TICK_MS = 1000 / 30;

/**
 * How hard a hit landed.
 *
 * Named type rather than a repeated union of four literals at each call site, because
 * it is now the parameter of two methods and one local — and a union spelled out three
 * times is a union that will be spelled wrong once.
 */
export type ImpactWeight = "light" | "heavy" | "crit" | "kill";

/**
 * Effects are absolutely positioned inside the arena, so they need the arena's
 * own box rather than the viewport's. Measured once per call rather than cached,
 * because the arena resizes and because a scroll must not leave them stranded.
 */
export class FxLayer {
  readonly root: HTMLElement;
  private anchors: Record<FxSide, HTMLElement> | null = null;
  private shakeUntil = 0;

  constructor(host: HTMLElement) {
    this.root = el("div", { class: "fx-layer", "aria-hidden": "true" });
    host.appendChild(this.root);
  }

  /** Point at the two fighter elements so effects can be placed between them. */
  bind(a: HTMLElement, b: HTMLElement): void {
    this.anchors = { a, b };
  }

  private anchor(side: FxSide): Anchor {
    const node = this.anchors?.[side];
    if (!node) return { cx: this.root.clientWidth / 2, cy: this.root.clientHeight / 2, w: 60, h: 60 };
    const box = node.getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    return {
      // The chest, not the centre of the portrait: hits read better landing on
      // the plant's mass than on the top of its head.
      cx: box.left - host.left + box.width / 2,
      cy: box.top - host.top + box.height * 0.62,
      w: box.width,
      h: box.height,
    };
  }

  private spawn(node: HTMLElement, lifeMs: number): void {
    this.root.appendChild(node);
    window.setTimeout(() => node.remove(), lifeMs);
  }

  // --- casts -------------------------------------------------------------

  /**
   * Windup: the caster coils before the skill lands.
   *
   * Shaped by delivery, because the delivery *is* how the skill is delivered —
   * a trap winds up by arming, an aura winds up by gathering, a projectile winds
   * up by drawing back.
   */
  castStart(side: FxSide, delivery: Delivery, colour: string): void {
    const at = this.anchor(side);
    switch (delivery) {
      case "aura": {
        // Gathered inward, then released outward by `impact`.
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const d = at.w * 0.9;
          const mote = el("span", { class: "fx-mote", style: `--c:${colour}` });
          mote.style.left = `${at.cx + Math.cos(a) * d}px`;
          mote.style.top = `${at.cy + Math.sin(a) * d * 0.7}px`;
          this.spawn(mote, 520);
        }
        break;
      }
      case "trap": {
        // Armed on the ground in front of the caster: it has to be there before
        // the target walks into it.
        const trap = el("div", { class: "fx-trap", style: `--c:${colour}` });
        trap.style.left = `${at.cx + (side === "a" ? -1 : 1) * at.w * 0.6}px`;
        trap.style.top = `${at.cy + at.h * 0.36}px`;
        this.spawn(trap, 620);
        break;
      }
      case "summon": {
        const spirit = el("div", { class: "fx-spirit", style: `--c:${colour}` });
        spirit.style.left = `${at.cx + (side === "a" ? -1 : 1) * at.w * 0.75}px`;
        spirit.style.top = `${at.cy + at.h * 0.2}px`;
        this.spawn(spirit, 700);
        break;
      }
      default: {
        const charge = el("div", { class: "fx-charge", style: `--c:${colour}` });
        charge.style.left = `${at.cx}px`;
        charge.style.top = `${at.cy}px`;
        this.spawn(charge, 420);
        break;
      }
    }
  }

  /**
   * The strike itself.
   *
   * `to` is the victim. Every delivery travels from caster to victim, so the
   * motion reads as an attack rather than as a flash on a static picture.
   */
  strike(from: FxSide, to: FxSide, delivery: Delivery, effect: EffectKind, colour: string, crit: boolean): void {
    const a = this.anchor(from);
    const b = this.anchor(to);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const travel = Math.max(90, Math.hypot(dx, dy));

    switch (delivery) {
      case "projectile": {
        // Drawn at the victim and aimed back at the attacker — a streak along the
        // attack line rather than a bolt in flight. Launching it from the caster
        // made it arrive hundreds of milliseconds after the damage it caused.
        const bolt = el("div", { class: `fx-bolt is-struck${crit ? " is-crit" : ""}`, style: `--c:${colour};--tilt:${Math.atan2(dy, dx)}rad;--len:${Math.min(240, travel * 0.55)}px` });
        bolt.style.left = `${b.cx}px`;
        bolt.style.top = `${b.cy}px`;
        this.spawn(bolt, 320);
        break;
      }
      case "channel": {
        const line = el("div", { class: "fx-tether", style: `--c:${colour};--tilt:${Math.atan2(dy, dx)}rad;--len:${travel}px` });
        line.style.left = `${a.cx}px`;
        line.style.top = `${a.cy}px`;
        this.spawn(line, 560);
        break;
      }
      case "melee": {
        // A swept arc across the target, not a line between the two.
        const arc = el("div", { class: `fx-slash${crit ? " is-crit" : ""}`, style: `--c:${colour};--flip:${dx < 0 ? 1 : -1}` });
        arc.style.left = `${b.cx}px`;
        arc.style.top = `${b.cy}px`;
        this.spawn(arc, 380);
        break;
      }
      case "aura": {
        const ring = el("div", { class: "fx-ring", style: `--c:${colour};--r:${Math.max(60, b.w)}px` });
        ring.style.left = `${b.cx}px`;
        ring.style.top = `${b.cy}px`;
        this.spawn(ring, 560);
        break;
      }
      case "trap": {
        const spike = el("div", { class: `fx-spike${crit ? " is-crit" : ""}`, style: `--c:${colour};--flip:${dx < 0 ? -1 : 1}` });
        spike.style.left = `${b.cx}px`;
        spike.style.top = `${b.cy + b.h * 0.3}px`;
        this.spawn(spike, 480);
        break;
      }
      case "summon": {
        const minion = el("div", { class: "fx-minion", style: `--c:${colour}` });
        minion.style.setProperty("--dx", `${dx * 0.55}px`);
        minion.style.setProperty("--dy", `${dy * 0.5}px`);
        minion.style.left = `${a.cx + dx * 0.15}px`;
        minion.style.top = `${a.cy + dy * 0.15}px`;
        this.spawn(minion, 620);
        break;
      }
      default:
        break;
    }
    void effect;
  }

  /**
   * Impact on the fighter that was hit.
   *
   * Split by what landed rather than by how much, because the player learns to
   * read the shape: a burst for a hit, motes rising for a heal, a shell for a
   * shield, stars for a stun.
   */
  /**
   * Play a transformation.
   *
   * A morph is the one thing in this fight that is not a strike, so it should not
   * look like one. Three beats, because fewer do not read: the plant pulls in and
   * brightens, snaps outward with a ring, then settles at an enlarged scale and
   * keeps it.
   *
   * The lingering scale is not decoration. It is the thing that tells a player,
   * half a second before they press anything, that this plant is dangerous right
   * now — without it the state lives only in a log line.
   *
   * `form` is shown as a label because the name is meant to be learned: "Cuồng
   * Nham" is something to recognise in a later fight, where the log is all there
   * is to go on.
   */
  morph(to: FxSide, element: ElementId | undefined, form: string, onEnlarged?: (on: boolean) => void): void {
    const host = this.anchors?.[to];
    if (!host) return;
    const colour = elementColour(element);
    host.style.setProperty("--morph-colour", colour);

    // Contract first. A transform that only expands reads as a hit landing, which
    // is the exact confusion it exists to prevent.
    host.classList.add("fx-morph-contract");
    window.setTimeout(() => {
      host.classList.remove("fx-morph-contract");

      const ring = document.createElement("div");
      ring.className = "fx-morph-ring";
      ring.style.setProperty("--morph-colour", colour);
      host.appendChild(ring);

      const label = document.createElement("div");
      label.className = "fx-morph-label";
      label.textContent = form;
      host.appendChild(label);

      host.classList.add("is-morphed");
      onEnlarged?.(true);

      for (const n of [ring, label]) {
        n.addEventListener("animationend", () => n.remove(), { once: true });
      }
      // Reduced motion removes both animations, and then nothing would ever
      // remove these nodes — so they go on a timer as well.
      window.setTimeout(() => {
        ring.remove();
        label.remove();
      }, 2400);
    }, 220);
  }

  /**
   * End a transformation.
   *
   * Called from MORPH_ENDED rather than on a timer of our own, so the state the
   * engine dropped and the picture the player sees end on the same tick.
   */
  endMorph(to: FxSide, onReleased?: (on: boolean) => void): void {
    const host = this.anchors?.[to];
    if (!host) return;
    host.classList.remove("is-morphed", "fx-morph-contract");
    onReleased?.(false);
    const ring = host.querySelector(".fx-morph-ring");
    const label = host.querySelector(".fx-morph-label");
    if (ring) {
      ring.classList.add("is-out");
      ring.addEventListener("animationend", () => ring.remove(), { once: true });
      window.setTimeout(() => ring.remove(), 700);
    }
    if (label) label.remove();
  }

  impact(
    to: FxSide,
    kind: "hit" | "crit" | "heal" | "shield" | "status" | "miss" | "dot" | "death",
    status?: string,
    weight: ImpactWeight = "light",
  ): void {
    const at = this.anchor(to);
    // Shard count by weight. A fixed count is what made every hit look the same.
    const bits = { light: 5, heavy: 9, crit: 16, kill: 26 }[weight];
    switch (kind) {
      case "crit": {
        const star = el("div", { class: "fx-burst is-crit" });
        star.style.left = `${at.cx}px`;
        star.style.top = `${at.cy}px`;
        this.spawn(star, 460);
        this.shards(at, bits, 1);
        break;
      }
      case "hit": {
        const star = el("div", { class: "fx-burst" });
        star.style.left = `${at.cx}px`;
        star.style.top = `${at.cy}px`;
        this.spawn(star, 360);
        this.shards(at, bits, weight === "light" ? 0.7 : 1);
        break;
      }
      case "death": {
        // Not "a bigger hit". A ring that expands past the fighter while the plant
        // drops out of frame, so the loss is legible without reading the log.
        const ring = el("div", { class: "fx-death" });
        ring.style.left = `${at.cx}px`;
        ring.style.top = `${at.cy}px`;
        this.spawn(ring, 700);
        this.shards(at, 26, 1.5);
        break;
      }
      case "heal": {
        for (let i = 0; i < 5; i++) {
          const mote = el("span", { class: "fx-heal" });
          mote.style.left = `${at.cx + (i - 2) * 7}px`;
          mote.style.top = `${at.cy + 10}px`;
          mote.style.animationDelay = `${i * 70}ms`;
          this.spawn(mote, 900);
        }
        break;
      }
      case "shield": {
        const shell = el("div", { class: "fx-shield" });
        shell.style.left = `${at.cx}px`;
        shell.style.top = `${at.cy}px`;
        shell.style.setProperty("--r", `${Math.max(40, at.w * 0.8)}px`);
        this.spawn(shell, 620);
        break;
      }
      case "miss": {
        const word = el("div", { class: "fx-word" }, ["Hụt"]);
        word.style.left = `${at.cx}px`;
        word.style.top = `${at.cy - 14}px`;
        this.spawn(word, 800);
        break;
      }
      case "dot": {
        // Damage over time bleeds rather than bursts: small droplets that fall.
        for (let i = 0; i < 3; i++) {
          const drop = el("span", { class: "fx-drop", style: `--i:${i}` });
          drop.style.left = `${at.cx + (i - 1) * 11}px`;
          drop.style.top = `${at.cy - 12}px`;
          drop.style.animationDelay = `${i * 60}ms`;
          this.spawn(drop, 700);
        }
        break;
      }
      default: {
        const icon = el("div", { class: `fx-status s-${status ?? "dot"}` });
        icon.style.left = `${at.cx}px`;
        icon.style.top = `${at.cy - 26}px`;
        this.spawn(icon, 900);
        break;
      }
    }
  }

  /**
   * The impact, dressed as the element that dealt it.
   *
   * Called alongside `impact`, never instead of it: the generic burst and number stay
   * because they carry the *magnitude*, and this carries the *cause*. Folding the two
   * together would have meant the number became unreadable on a busy impact.
   *
   * `fraction` is the hit's share of the victim's max HP, which scales both count and
   * reach so a chip and a crit do not throw the same amount of everything.
   */
  elementalHit(to: FxSide, element: ElementId, fraction: number, weight: ImpactWeight): void {
    const m = ELEMENT_MOTION[element];
    const at = this.anchor(to);
    const power = elementPower(fraction) * (weight === "kill" ? 1.35 : weight === "crit" ? 1.2 : 1);
    const n = Math.round(m.count * Math.min(1.5, power));

    // The layer is one node holding every particle, because they share a colour and a
    // class; spawning `n` siblings on the arena would put `n` more elements in the DOM
    // for the life of a single hit.
    const layer = el("div", { class: elementClasses(element) });
    layer.style.left = `${at.cx}px`;
    layer.style.top = `${at.cy}px`;
    layer.style.setProperty("--power", power.toFixed(3));
    layer.style.setProperty("--c", ELEMENT_INFO[element].color);
    layer.style.setProperty("--glow", ELEMENT_INFO[element].glow);
    layer.style.setProperty("--i", String(n));

    for (let i = 0; i < n; i++) {
      const off = particleOffset(m, i, n, power);
      const p = el("i", { class: "fx-elem-p" });
      p.style.setProperty("--dx", `${off.dx.toFixed(1)}px`);
      p.style.setProperty("--dy", `${off.dy.toFixed(1)}px`);
      p.style.setProperty("--rot", `${Math.round(off.rot)}deg`);
      p.style.setProperty("--fall", `${(m.fall * power).toFixed(1)}px`);
      p.style.setProperty("--delay", `${Math.round(i * m.stagger)}ms`);
      p.style.setProperty("--life", `${Math.round(m.life)}ms`);
      p.style.setProperty("--scale", (m.scale * (0.75 + Math.random() * 0.5)).toFixed(2));
      layer.appendChild(p);
    }

    // A ring in the element's colour, scaled by how hard the element reads at a glance.
    // Shadow's ring is the only one that contracts, which is in the CSS, not here.
    if (m.ring > 0) {
      const ring = el("div", { class: "fx-elem-ring" });
      ring.style.animationDuration = `${Math.round(m.life * 0.8)}ms`;
      layer.appendChild(ring);
    }

    // The glyph, once. `word` is the label the log already uses, so the picture and
    // the text agree instead of inventing a second vocabulary.
    if (m.glyph) {
      const mark = el("div", {
        class: "fx-elem-glyph",
        html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${m.glyph}"/></svg>`,
      });
      layer.appendChild(mark);
    }

    this.spawn(layer, m.life + 260);
  }

  /**
   * Debris thrown off the contact point.
   *
   * Direction and distance are randomised per shard, which is the difference
   * between "something broke" and "a specific thing broke in a specific
   * direction". Falls under gravity so it reads as debris rather than confetti.
   */
  private shards(at: Anchor, n: number, power: number): void {
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.7;
      const reach = (14 + Math.random() * 40) * power;
      const shard = el("i", { class: "fx-shard" });
      shard.style.setProperty("--dx", `${(Math.cos(a) * reach).toFixed(1)}px`);
      shard.style.setProperty("--dy", `${(Math.sin(a) * reach - 12).toFixed(1)}px`);
      shard.style.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 640)}deg`);
      shard.style.animationDelay = `${Math.round(Math.random() * 40)}ms`;
      shard.style.left = `${at.cx}px`;
      shard.style.top = `${at.cy}px`;
      this.spawn(shard, 900);
    }
  }

  /**
   * A floating number.
   *
   * Clamped inside the arena. The old version placed these at the portrait's top
   * edge, which for a fighter near the top of the box put the number outside the
   * battlefield entirely, over the page background.
   */
  /**
   * `hi` is for text that is not a number — the name of a form, a word of state.
   * It is the one kind that does not read as a quantity, which is why it is
   * spelled differently from the damage kinds rather than reusing one of them.
   */
  float(to: FxSide, text: string, kind: "dmg" | "crit" | "heal" | "shield" | "hi", weight: ImpactWeight = "light"): void {
    const at = this.anchor(to);
    // Bigger numbers for bigger hits, so magnitude is readable at a glance rather
    // than only by counting digits.
    const node = el("div", { class: `fx-num is-${kind} w-${weight}` }, [text]);
    const half = 46;
    const x = Math.max(half, Math.min(this.root.clientWidth - half, at.cx + (kind === "heal" ? 10 : -10)));
    const y = Math.max(30, Math.min(this.root.clientHeight - 20, at.cy - at.h * 0.28));
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    this.spawn(node, 1000);
  }

  /** A skill banner across the middle of the arena. */
  banner(side: FxSide, name: string, delivery: Delivery): void {
    const def = DELIVERIES[delivery];
    const node = el("div", { class: `fx-banner${side === "a" ? " from-a" : " from-b"}` });
    node.style.setProperty("--c", def?.colour ?? "#ffd166");
    node.append(el("span", { class: "fx-banner-ico" }, [deliveryGlyph(delivery)]), el("span", {}, [name]));
    this.spawn(node, 1000);
  }

  /**
   * Screen shake.
   *
   * Kept for the one thing the juice layer does not drive: a whole-arena tremor
   * for events with no single contact point. Per-hit shake moved to `juice.ts`,
   * where it shares a trauma pool with the hitstop and the recoil so they cannot
   * drift apart.
   */
  shake(ms: number): void {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    if (now < this.shakeUntil) return;
    this.shakeUntil = now + ms;
    this.root.classList.add("is-shaking");
    window.setTimeout(() => this.root.classList.remove("is-shaking"), ms);
  }

  clear(): void {
    this.root.replaceChildren();
    this.root.classList.remove("is-shaking");
  }

  destroy(): void {
    this.clear();
    this.anchors = null;
    this.root.remove();
  }
}

/** Compact glyph for a delivery, used on the cast banner. */
export function deliveryGlyph(delivery: Delivery): string {
  return (
    {
      projectile: "➤",
      melee: "⚔",
      aura: "◎",
      trap: "✦",
      channel: "〜",
      summon: "❋",
      // A spiral: the caster turning into something rather than throwing something.
      morph: "☯",
    } satisfies Record<Delivery, string>
  )[delivery];
}

/** Element tint for an effect, so a hit reads as the element that caused it. */
export function elementColour(id: ElementId | undefined): string {
  if (!id) return "#ffd166";
  return (
    {
      wood: "#8fd66a",
      fire: "#ff8a5c",
      water: "#6fc3f0",
      earth: "#d3a06a",
      electric: "#ffe07a",
      poison: "#c79ae8",
      light: "#fff3b8",
      shadow: "#9b8ad0",
    }[id] ?? "#ffd166"
  );
}

export { TICK_MS };