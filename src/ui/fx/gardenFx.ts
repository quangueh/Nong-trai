/**
 * Garden feel: the small effects that make tending soil read as tending a garden.
 *
 * Everything here is DOM nodes animated by CSS transform/opacity and removed on
 * `animationend` (with a timer backstop for backgrounded tabs). Nothing runs a
 * per-frame loop, and nothing is left behind in the tree.
 *
 * ## What lives here
 *
 *   waterPlotFx   droplets falling onto a plot, a ripple in the soil, and the
 *                 plant acknowledging with a wiggle. Played on the card that was
 *                 watered, so the feedback lands exactly where the tap was.
 *   harvestFx     a burst of sparkles when a mature plant is sent to earn.
 *   markStageUp / consumeStageUp — the tick loop in app.ts marks a plant the
 *                 moment its stage turns over; the plot card that renders next
 *                 picks the mark up and plays the "it grew!" bounce once. A set,
 *                 not a flag on the plant, because the event is UI news, not
 *                 save data.
 *   markUnlock / consumeUnlock — same pattern for a freshly bought plot: the new
 *                 tile arrives with its cloud veil lifting instead of just being
 *                 there.
 *   rewardFly     chips that fly from a control into the HUD pills — the quest
 *                 claim's answer to "reward bay vào HUD".
 */

import { el } from "../components";
import { reducedMotion, sfx } from "../../audio/audio";

/* ------------------------------------------------------------------ */
/* one-shot marks: tick/buy → next render plays them once              */
/* ------------------------------------------------------------------ */

const stageUpMarks = new Set<string>();
const unlockMarks = new Set<number>();

export function markStageUp(plantId: string): void {
  stageUpMarks.add(plantId);
}

/** True once per mark. The card calls it while rendering, so the effect plays on arrival. */
export function consumeStageUp(plantId: string): boolean {
  const had = stageUpMarks.has(plantId);
  stageUpMarks.delete(plantId);
  return had;
}

export function markUnlock(plotIndex: number): void {
  unlockMarks.add(plotIndex);
}

export function consumeUnlock(plotIndex: number): boolean {
  const had = unlockMarks.has(plotIndex);
  unlockMarks.delete(plotIndex);
  return had;
}

/* ------------------------------------------------------------------ */
/* watering                                                             */
/* ------------------------------------------------------------------ */

/**
 * Water lands on the plot: a row of drops falling through the plant, a ripple
 * ring in the soil, and the plant leaning into the drink.
 *
 * The card keeps its own class (`is-watered`) for a beat so the soil stays
 * darkened a moment after the drops are gone — the visual answer to "this one
 * just got water", which is otherwise invisible until the next repaint.
 */
export function waterPlotFx(card: HTMLElement): void {
  card.classList.add("is-watered");
  card.querySelector(".need-water")?.remove();
  const bed = card.querySelector(".bed");
  bed?.classList.add("plant-wiggle");

  if (reducedMotion()) {
    window.setTimeout(() => {
      card.classList.remove("is-watered");
      bed?.classList.remove("plant-wiggle");
    }, 900);
    return;
  }

  const fx = el("div", { class: "water-fx", "aria-hidden": "true" });
  const DROPS = 7;
  for (let i = 0; i < DROPS; i++) {
    const drop = el("i", { class: "water-drop" });
    drop.style.setProperty("--dx", `${(i - (DROPS - 1) / 2) * 14 + (i % 2 ? 5 : -5)}px`);
    drop.style.setProperty("--d", `${i * 70}ms`);
    fx.appendChild(drop);
  }
  fx.appendChild(el("i", { class: "water-ripple" }));
  card.appendChild(fx);

  const done = (): void => {
    fx.remove();
    card.classList.remove("is-watered");
    bed?.classList.remove("plant-wiggle");
  };
  fx.addEventListener("animationend", (e) => {
    if (e.target === fx.lastElementChild) done();
  });
  window.setTimeout(done, 1800);
}

/* ------------------------------------------------------------------ */
/* harvest / send-off                                                   */
/* ------------------------------------------------------------------ */

/**
 * A mature plant being sent to earn: gold motes rising out of the soil. Small
 * on purpose — the battle hand-off is a door, not a celebration.
 */
export function harvestFx(card: HTMLElement): void {
  if (reducedMotion()) return;
  const fx = el("div", { class: "harvest-fx", "aria-hidden": "true" });
  for (let i = 0; i < 6; i++) {
    const mote = el("i", { class: "harvest-mote" });
    mote.style.setProperty("--dx", `${(i - 2.5) * 16}px`);
    mote.style.setProperty("--d", `${i * 55}ms`);
    fx.appendChild(mote);
  }
  card.appendChild(fx);
  window.setTimeout(() => fx.remove(), 1400);
}

/* ------------------------------------------------------------------ */
/* reward → HUD                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fly currency chips from wherever the claim happened into the HUD pills.
 *
 * Selector-based rather than element-passed: the pills belong to the shell, and
 * the caller (a quest row deep in a sheet) should not need to know their names.
 * Any pill that is not found simply gets no chip — the claim itself already
 * paid, so a missing chip is never a wrong number.
 */
export function rewardFly(
  from: Element,
  rewards: { coins?: number; exp?: number; breederXp?: number; items?: number; geneCrystal?: number },
): void {
  const jobs: { icon: string; amount: number; target: string }[] = [];
  if (rewards.coins) jobs.push({ icon: "🪙", amount: rewards.coins, target: ".pill.coin" });
  if (rewards.items) jobs.push({ icon: "🧺", amount: rewards.items, target: ".pill.item" });
  if (rewards.geneCrystal) jobs.push({ icon: "💎", amount: rewards.geneCrystal, target: ".pill.crystal" });
  const xp = (rewards.breederXp ?? 0) + (rewards.exp ?? 0);
  if (xp) jobs.push({ icon: "✨", amount: xp, target: ".levelbadge" });

  const start = from.getBoundingClientRect();
  for (const job of jobs) {
    const pill = document.querySelector(job.target);
    if (!pill) continue;
    const to = pill.getBoundingClientRect();
    const chips = Math.min(4, Math.max(1, Math.round(job.amount / 120)));
    for (let i = 0; i < chips; i++) {
      const chip = el("div", { class: "rewardfly" }, [job.icon]);
      const x = start.left + start.width / 2 + (i - chips / 2) * 14;
      const y = start.top;
      chip.style.left = `${x}px`;
      chip.style.top = `${y}px`;
      chip.style.setProperty("--tx", `${to.left + to.width / 2 - x}px`);
      chip.style.setProperty("--ty", `${to.top + to.height / 2 - y}px`);
      chip.style.setProperty("--d", `${i * 70}ms`);
      document.body.appendChild(chip);
      chip.addEventListener("animationend", () => chip.remove(), { once: true });
      window.setTimeout(() => chip.remove(), 1600);
    }
    // The pill acknowledges the landing.
    window.setTimeout(() => {
      pill.classList.remove("bump");
      void (pill as HTMLElement).offsetWidth;
      pill.classList.add("bump");
    }, reducedMotion() ? 0 : 620);
  }
  if (!reducedMotion()) sfx.play("reward");
}

/**
 * The spend twin of `rewardFly`: a "-98🪙" chip that rises off the button that
 * paid it.
 *
 * Fixed-position and parented to the body rather than the card, because the
 * shelf repaints the same tick the balance moves — a chip inside the card would
 * be destroyed before its first frame. The coin pill bumps to acknowledge the
 * ledger moving, which is the part of "bought" that is on screen the longest.
 */
export function spendChip(from: Element, label: string): void {
  const pill = document.querySelector(".pill.coin");
  if (pill) {
    pill.classList.remove("bump");
    void (pill as HTMLElement).offsetWidth;
    pill.classList.add("bump");
  }
  if (reducedMotion()) return;
  const r = from.getBoundingClientRect();
  const chip = el("div", { class: "spendchip" }, [label]);
  chip.style.left = `${r.left + r.width / 2}px`;
  chip.style.top = `${r.top - 4}px`;
  document.body.appendChild(chip);
  chip.addEventListener("animationend", () => chip.remove(), { once: true });
  window.setTimeout(() => chip.remove(), 1200);
}
