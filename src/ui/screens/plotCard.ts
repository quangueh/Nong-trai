/**
 * Garden plot card.
 *
 * A plot reads as a patch of soil with the plant standing in it, so the plant
 * is the hero. State is carried by the tile itself: a droplet badge when the
 * plant can take water, a gold glow and drifting motes when it is ready to
 * earn, and a growth ring while it is still developing — not a stack of
 * micro-text.
 */

import { el } from "../components";
import { renderPlantSvg } from "../../render/plantRenderer";
import { RARITY_META } from "../../config/rarity";
import { STAGE_LABEL, type Plant } from "../../core/types";
import { canBattle, canBreed, stageProgress } from "../../growth/stages";
import { CARE_ACTIONS } from "../../config/careActions";
import { plantSnapshot, xpRemainingText } from "../../progression/levels";
import { consumeStageUp, consumeUnlock } from "../fx/gardenFx";

/**
 * Whether the plant can take water right now.
 *
 * The garden's "cần tưới" badge is honest rather than decorative: it appears
 * exactly when the water action would succeed — never on cooldown, never on a
 * plant that just drank, and never on a mature plant that no longer needs it to
 * grow. Mature plants still gain from care, but a permanent droplet on every
 * finished plant turns the badge into noise, which is how players stop reading
 * badges.
 */
export function canWaterNow(plant: Plant, now: number): boolean {
  if (canBattle(plant)) return false;
  const last = plant.careMemory.lastAction;
  if (last && last.id === "water" && now - last.at < CARE_ACTIONS.water.cooldownSeconds * 1000) return false;
  return true;
}

/**
 * `plotNumber` is optional so the card still renders where a position is not
 * known — the collection grid, where plants are not in soil.
 *
 * `onClick` receives the card element, so a caller that wants to play an effect
 * on the tile itself (watering, harvesting) has it without a DOM lookup.
 */
export function plotCard(plant: Plant, onClick: (card: HTMLElement) => void, plotNumber?: number): HTMLElement {
  const now = Date.now();
  const mature = plant.growth.stage === "mature" || plant.growth.stage === "awakened";
  const progress = stageProgress(plant, now);
  const meta = RARITY_META[plant.rarity];
  const thirsty = canWaterNow(plant, now);

  /* `plot` paints the island: soil, grass cap, and a root tapering to a point below the card.

     Only in the garden. A plant on the collection screen is standing on nothing, and the doc
     comment above already says so - but the class was applied unconditionally, so every
     collection card hung a cone of earth under itself with no soil attached to it. That is
     what put the stray pot beneath the card in the collection screenshot. */
  const inSoil = plotNumber !== undefined;
  const card = el("div", {
    class:
      "plantcard" +
      (inSoil ? " plot" : "") +
      ` stage-${plant.growth.stage}` +
      (mature ? " ready" : "") +
      (canBreed(plant) ? " bred" : "") +
      (thirsty ? " needs-water" : ""),
  });
  card.dataset.plantId = plant.plantId;

  /* One-shot effects picked up from the tick loop and the plot purchase.

     They are consumed here, at render, so they fire exactly once on the card that
     arrived after the event — a stage that turned over pops open, a plot that was
     just bought lifts its cloud. */
  if (inSoil && consumeStageUp(plant.plantId)) {
    card.classList.add("stage-pop");
    window.setTimeout(() => card.classList.remove("stage-pop"), 1200);
  }
  if (inSoil && consumeUnlock(plotNumber)) {
    const veil = el("div", { class: "unlock-veil" }, [el("i"), el("i")]);
    card.appendChild(veil);
    window.setTimeout(() => veil.remove(), 1400);
  }

  // Rarity ribbon across the top.
  const ribbon = el("div", { class: "ribbon" });
  ribbon.style.background = `linear-gradient(90deg, ${meta.colour}, ${meta.colour}22)`;
  card.appendChild(ribbon);

  // Plot number, same 1-based figure the empty and locked tiles use. Garden only - it
  // refers to a position on the field, which is exactly what the collection has not got.
  if (inSoil) {
    card.appendChild(el("div", { class: "soil-mark" + (mature ? " dim" : "") }, [String(plotNumber)]));
  }

  // Flags (favourite / locked).
  const flags = el("div", { class: "flags" });
  if (plant.locks.favorite) flags.appendChild(el("span", {}, ["⭐"]));
  if (plant.locks.manual) flags.appendChild(el("span", {}, ["🔒"]));
  if (flags.children.length) card.appendChild(flags);

  /* The "can take water" badge. A droplet on the crown edge, floating gently —
     the same icon the care sheet uses for the action, so the badge and the
     button never disagree about what a droplet means. */
  if (inSoil && thirsty) {
    card.appendChild(el("div", { class: "need-water", title: "Có thể tưới cây" }, ["💧"]));
  }

  // The plant itself.
  const bed = el("div", { class: "bed" });
  bed.innerHTML = renderPlantSvg(plant, 150);
  card.appendChild(bed);

  /* Ready-to-earn shine: three motes drifting over the crown. Kept to three
     elements because this exists on every mature plot at once. */
  if (inSoil && mature) {
    card.appendChild(el("div", { class: "plot-shine", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]));
  }

  // Name.
  const name = el("div", { class: "pname" });
  name.textContent = plant.name;
  card.appendChild(name);

  // Rarity + power.
  const row = el("div", { class: "prow" });
  const r = el("span", { class: "rarity" });
  r.textContent = plant.rarity;
  r.style.color = meta.colour;
  const pw = el("span", { class: "mono muted" });
  pw.textContent = `⚔${Math.round(plant.powerRating)}`;
  row.append(r, pw);
  card.appendChild(row);

  // The plant's own level and how far to the next one.
  card.appendChild(levelStrip(plant));

  // Status chip, or a growth ring while the plant is still developing.
  if (mature) {
    const flagsRow = el("div", { class: "prow" });
    if (plant.growth.stage === "awakened") {
      flagsRow.appendChild(el("span", { class: "chip gold" }, ["✨ Thức tỉnh"]));
    } else if (canBreed(plant)) {
      flagsRow.appendChild(el("span", { class: "chip ok" }, ["🧬 Lai được"]));
    } else {
      flagsRow.appendChild(el("span", { class: "chip dim" }, [STAGE_LABEL[plant.growth.stage]]));
    }
    if (canBattle(plant)) flagsRow.appendChild(el("span", { class: "chip gold" }, ["⚔ Đấu"]));
    card.appendChild(flagsRow);
  } else {
    /* The stage word travels with the ring, so "đã gieo hạt" and "đang lớn" are
       different things on the tile and not just different numbers. */
    card.appendChild(
      el("div", { class: "prow grow-stage" }, [
        el("span", { class: "chip dim stage-chip" }, [STAGE_LABEL[plant.growth.stage]]),
        growthRing(progress, plant.growth.stageReadyAt - now, plant.growth.stageReadyAt),
      ]),
    );
  }

  card.addEventListener("click", () => onClick(card));
  return card;
}

/**
 * Level, and a bar to the next one.
 *
 * This is the number that decides when a plant crosses into the next combat tier — level 5,
 * 15, 30 — and it was only visible on the detail sheet. So a player tending twenty plants
 * had no way to tell which one was close to a tier without opening each in turn, and
 * "tending a plant" had no visible progress attached to it at all.
 *
 * The figures come from `progression/levels`, the same source the celebration and the stage
 * preview read, so the card cannot disagree with either.
 */
function levelStrip(plant: Plant): HTMLElement {
  const snap = plantSnapshot(plant);
  const wrap = el("div", { class: "lvstrip" });

  const bar = el("span", {
    class: "lvstrip-bar",
    role: "progressbar",
    "aria-valuenow": String(Math.round(snap.pct)),
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-label": `Cấp ${snap.level}, ${xpRemainingText(snap)}`,
  });
  bar.appendChild(el("i", { style: `transform:scaleX(${(snap.pct / 100).toFixed(3)})` }));

  wrap.append(
    el("span", { class: "lvstrip-level mono" }, [`Lv${snap.level}`]),
    bar,
    el("span", { class: "lvstrip-xp tiny mono" }, [
      snap.capped ? "MAX" : `${Math.round(snap.xp)}/${Math.round(snap.need)}`,
    ]),
  );
  return wrap;
}

/** Small circular progress indicator drawn over the soil. */
function growthRing(progress: number, msRemaining: number, readyAt: number): HTMLElement {
  const r = 10;
  const c = 2 * Math.PI * r;
  const initial = Math.ceil(Math.max(0, msRemaining) / 1000);
  const svg = `<svg class="ring" viewBox="0 0 26 26">
    <circle class="track" cx="13" cy="13" r="${r}"></circle>
    <circle class="fill" cx="13" cy="13" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - progress)).toFixed(1)}"></circle>
    <text x="13" y="16" text-anchor="middle" font-size="8.5" font-weight="700" fill="#435636">${initial}</text>
  </svg>`;
  const wrap = el("div");
  wrap.innerHTML = svg;
  const holder = el("div", { class: "grow-timer" });
  const text = el("span", { class: "grow-timer-text mono" }, [`${formatRemaining(initial)}`]);
  const svgEl = wrap.firstElementChild as SVGElement;
  const label = svgEl.querySelector("text");
  const interval = window.setInterval(() => {
    if (!holder.isConnected) {
      window.clearInterval(interval);
      return;
    }
    const seconds = Math.ceil(Math.max(0, readyAt - Date.now()) / 1000);
    if (label) label.textContent = String(seconds);
    text.textContent = seconds > 0 ? formatRemaining(seconds) : "xong";
  }, 1000);
  holder.appendChild(wrap.firstElementChild as Node);
  holder.appendChild(text);
  return holder;
}

function formatRemaining(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return `${seconds}s`;
}
