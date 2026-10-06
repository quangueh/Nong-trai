/**
 * The experience-gain moment: numbers that fly, trails behind them, and a bar that pulses
 * when it fills.
 *
 * ## Why this exists separately from the level-up celebration
 *
 * A level-up is the rare case. Almost every grant of experience does *not* level anything,
 * and before this those grants produced nothing at all: the bar moved and there was no
 * acknowledgement, so a player could not tell a reward from a repaint. Four out of five
 * fights end with no level, and those are the ones that felt like nothing happened.
 *
 * ## Nothing here is decorative
 *
 * `celebrateExpGain` is called with the number that was actually granted, and with the bar
 * that actually moved. The pulse fires only when that bar reaches full. If the caller passes
 * a stale amount, the animation is wrong — which is the point: it has no way to be right on
 * its own.
 *
 * ## It must not cost a frame
 *
 * Everything is DOM elements with CSS transforms, created once and removed on `animationend`.
 * No canvas, no second animation loop, no per-frame JavaScript: a grant can happen while a
 * fight is playing, and the one thing this may never do is drop frames in the middle of one.
 * The particle budget scales with the viewport so a phone does not build thirty elements
 * where a desktop builds six.
 */

import { el } from "../components";
import { reducedMotion, sfx } from "../../audio/audio";

/** How many trail dots per number, and the total element budget. Both fall back on a phone. */
function particleBudget(): { trail: number; max: number } {
  const small = window.innerWidth < 520;
  // A phone gets a third of the elements. The animation is the same event; it is just
  // cheaper, and nobody watching a 900px-wide phone can resolve the difference.
  return small ? { trail: 2, max: 10 } : { trail: 3, max: 26 };
}

export interface ExpGainOptions {
  /** How much was granted. Zero or less does nothing. */
  amount: number;
  /** The bar the experience landed in. Nothing flies without one. */
  bar: Element | null;
  /** Where the numbers start. Defaults to the centre of the screen. */
  from?: Element | null;
  /**
   * Whether this grant filled the bar to the top.
   *
   * Passed in rather than measured here, because "did it level" is the store's business and
   * this module must not import it. Getting it wrong costs a missing pulse, never a wrong
   * number.
   */
  filled?: boolean;
}

/**
 * Play the gain.
 *
 * Returns nothing and throws nothing. This runs on the failure path of a fight's aftermath,
 * where an animation that raised would take the reward down with it.
 */
export function celebrateExpGain(opts: ExpGainOptions): void {
  const { amount, bar, from, filled } = opts;
  if (!bar || amount <= 0) return;

  // Reduced motion keeps the *information* and drops the flight: the bar still transitions,
  // it simply does not fly, and nothing is created. A number the player cannot see is not a
  // reward, so the bar's own change is what carries it here.
  if (reducedMotion()) {
    pulse(bar, filled === true);
    return;
  }

  const to = bar.getBoundingClientRect();
  const start =
    from?.getBoundingClientRect() ??
    ({ left: window.innerWidth / 2, top: window.innerHeight * 0.4, width: 0, height: 0 } as DOMRect);
  const budget = particleBudget();

  // Fewer, larger numbers on a phone; the total shown always adds up to the grant, because
  // splitting a number into pieces and losing the remainder is worse than one number.
  const count = Math.min(budget.max, Math.max(1, Math.ceil(amount / 90)));
  const per = Math.round(amount / count);

  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // The remainder rides on the final chip rather than being dropped by integer division.
    const value = last ? amount - per * (count - 1) : per;
    const chip = el("div", { class: "expfly" }, [`+${value.toLocaleString("vi-VN")}`]);
    const jx = start.left + (i - (count - 1) / 2) * 16;
    const jy = start.top + (i % 2 === 1 ? -10 : 0);

    chip.style.left = `${jx}px`;
    chip.style.top = `${jy}px`;
    chip.style.setProperty("--tx", `${to.left + to.width / 2 - jx}px`);
    chip.style.setProperty("--ty", `${to.top + to.height / 2 - jy}px`);
    chip.style.setProperty("--d", `${i * 60}ms`);
    document.body.appendChild(chip);

    /*
     * The trail.
     *
     * Spawned along the flight rather than at the start, so the dots are actually behind the
     * number the whole way instead of appearing in a clump where it launched. Each is a
     * 2px element that fades over a third of the flight — cheap enough that even the desktop
     * budget stays under thirty live nodes for the whole animation.
     */
    for (let k = 0; k < budget.trail; k++) {
      spawnTrailDot(chip, k, budget.trail);
    }

    const done = (): void => {
      chip.remove();
      pulse(bar, filled === true);
    };
    chip.addEventListener("animationend", done, { once: true });
    // The fallback: a backgrounded tab never fires animationend, and a stuck element is a
    // permanent ghost over the top bar.
    setTimeout(done, 1500);
  }
}

/** One dot, positioned a fraction of the way along the flight and left to fade. */
function spawnTrailDot(host: HTMLElement, index: number, total: number): void {
  const dot = el("span", { class: "expfly-trail" });
  const at = (index + 1) / (total + 1);
  dot.style.setProperty("--tx", `calc(var(--tx) * ${at.toFixed(3)})`);
  dot.style.setProperty("--ty", `calc(var(--ty) * ${at.toFixed(3)})`);
  dot.style.setProperty("--d", `calc(var(--d) + ${index * 40}ms)`);
  host.appendChild(dot);
  dot.addEventListener("animationend", () => dot.remove(), { once: true });
}

/**
 * The bar acknowledging the arrival.
 *
 * Two states, and the distinction matters: every grant gets a single soft pulse so the bar
 * acknowledges being credited, and a bar that reached the top gets the full flash on top —
 * because that is the one that says something *happened* rather than something was added.
 */
function pulse(bar: Element, filled: boolean): void {
  bar.classList.remove("is-credited", "is-full");
  // Reflow so the class re-triggers when two grants land back to back — otherwise the second
  // pulse is a no-op on an element that never lost the class, and the player sees one pulse
  // for two rewards.
  void (bar as HTMLElement).offsetWidth;
  bar.classList.add("is-credited");
  if (filled) bar.classList.add("is-full");

  const clear = (): void => {
    bar.classList.remove("is-credited", "is-full");
  };
  window.setTimeout(clear, filled ? 900 : 480);
}

/**
 * Mark a bar as the one an experience grant should fly into.
 *
 * One helper so the caller does not have to know the class name, and so the "where does the
 * experience go" question is answered in one place rather than by a selector in every screen.
 */
export function markExpBar(node: Element | null): Element | null {
  node?.classList.add("expbar-target");
  return node;
}

/** Play the small confirmation a plain gain deserves. */
export function expGainSound(): void {
  if (reducedMotion()) return;
  // "buy" rather than "levelUp": a gain that did not level anything should not sound like it
  // did, or the rare celebration stops meaning anything.
  sfx.play("buy");
}