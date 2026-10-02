/**
 * The fusion ceremony (docs/05 §2, docs/13).
 *
 * Breeding used to be: press a button, and a sheet of text appears describing
 * what happened. The plant that took two parents and a genome to produce got no
 * moment at all — it just appeared as a row of labels.
 *
 * This is that moment, and it follows the same rules as combat juice:
 *
 *   anticipation  the two parents drift in and hold, so there is something to
 *                 break
 *   contact       one bright frame where they meet, with a shockwave
 *   recoil        the burst throws motes outward under gravity
 *   payoff        the child scales in with an overshoot and settles
 *
 * Short on purpose. A ceremony the player has to sit through on the fourth
 * breeding attempt is a tax, not a reward. It auto-advances, and any tap skips
 * to the end — so it is never a barrier, only a beat.
 */

import { el } from "./components";
import { sfx, reducedMotion } from "../audio/audio";
import { store } from "./app";
import { renderPlantSvg } from "../render/plantRenderer";
import type { Plant } from "../core/types";

/** How long the whole thing runs if nobody touches anything. */
const TOTAL_MS = 1750;

function parentOf(child: Plant): Plant | undefined {
  // `parents` is a fixed pair, not a list, and either side can be null on a
  // generated first generation.
  const pair = child.parents;
  for (const id of [pair?.a, pair?.b]) {
    if (!id) continue;
    const p = store.get(id);
    if (p) return p;
  }
  return undefined;
}

/**
 * Play the fusion, then hand back.
 *
 * `skip` is not an afterthought: `prefers-reduced-motion` users get the same
 * information with none of the movement, which is why the reveal is a plain fade
 * rather than a scaled-in child.
 */
export function playFusion(child: Plant, onDone: () => void): void {
  const shell = document.querySelector(".shell");
  if (!shell) {
    onDone();
    return;
  }
  const parent = parentOf(child);
  const calm = reducedMotion();

  const overlay = el("div", { class: "overlay fusion-overlay", role: "dialog", "aria-label": "Hợp nhất hai cây" });
  const stage = el("div", { class: "fusion-stage" + (calm ? " is-calm" : "") });

  const art = (p: Plant, cls: string): HTMLElement => {
    const box = el("div", { class: cls });
    box.innerHTML = renderPlantSvg(p, 128, { anim: !calm });
    return box;
  };

  const core = el("div", { class: "fusion-core" });
  stage.append(core);

  if (parent && !calm) {
    const a = art(parent, "fusion-parent is-left");
    const b = art(parent, "fusion-parent is-right");
    a.style.animationDelay = "0ms";
    b.style.animationDelay = "120ms";
    stage.append(a, b);
    // Gene motes thrown out of the contact point. Spawned now and left to run
    // on their own timeline, so the caller is not holding a timer per particle.
    for (let i = 0; i < 18; i++) {
      const mote = el("i", { class: "fusion-mote" });
      const a2 = (i / 18) * Math.PI * 2 + Math.random();
      const reach = 46 + Math.random() * 74;
      mote.style.setProperty("--dx", `${(Math.cos(a2) * reach).toFixed(0)}px`);
      mote.style.setProperty("--dy", `${(Math.sin(a2) * reach - 18).toFixed(0)}px`);
      mote.style.setProperty("--hue", String(Math.round(Math.random() * 70 + 60)));
      mote.style.animationDelay = `${620 + Math.round(Math.random() * 220)}ms`;
      stage.appendChild(mote);
    }
  }

  const childBox = el("div", { class: "fusion-child" });
  childBox.innerHTML = renderPlantSvg(child, 168, { anim: !calm });
  stage.appendChild(childBox);

  const caption = el("div", { class: "fusion-caption" }, [child.name]);
  const hint = el("div", { class: "fusion-hint" }, ["Chạm để tiếp tục"]);

  const panel = el("div", { class: "fusion-panel" }, [caption, hint]);
  overlay.append(stage, panel);
  shell.appendChild(overlay);

  sfx.play("breed");
  // The payoff lands on the child's reveal, not on the press — otherwise the
  // sound anticipates the picture by a second and a half.
  const revealTimer = window.setTimeout(() => sfx.play("levelUp", { gain: 0.7 }), calm ? 60 : 900);

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    window.clearTimeout(revealTimer);
    sfx.play("tap", { gain: 0.5 });
    overlay.remove();
    onDone();
  };
  const timer = window.setTimeout(finish, calm ? 700 : TOTAL_MS);

  overlay.addEventListener("click", finish);
  // Escape should leave, not trap.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") finish();
  };
  document.addEventListener("keydown", onKey);
  window.setTimeout(() => document.removeEventListener("keydown", onKey), TOTAL_MS + 200);
}

/**
 * Reveal a block of the report with a stagger.
 *
 * The mutation list used to appear all at once, which gives the eye no order to
 * read it in. Staggering by index means the list reads top to bottom on its own,
 * and the player's attention lands on the mutation tiers in order — which is
 * exactly the information they came for.
 */
export function stagger(nodes: HTMLElement[], stepMs = 55, startMs = 0): void {
  if (reducedMotion()) return;
  nodes.forEach((n, i) => {
    n.style.setProperty("--d", `${startMs + i * stepMs}ms`);
    n.classList.add("rise-in");
  });
}