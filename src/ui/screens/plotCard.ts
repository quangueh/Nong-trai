/**
 * Garden plot card.
 *
 * A plot reads as a patch of soil with the plant standing in it, so the plant
 * is the hero. State is one chip, growth is a ring — not a stack of micro-text.
 */

import { el } from "../components";
import { renderPlantSvg } from "../../render/plantRenderer";
import { RARITY_META } from "../../config/rarity";
import { STAGE_LABEL, type Plant } from "../../core/types";
import { canBattle, canBreed, stageProgress } from "../../growth/stages";

/**
 * `plotNumber` is optional so the card still renders where a position is not
 * known — the collection grid, where plants are not in soil.
 */
export function plotCard(plant: Plant, onClick: () => void, plotNumber?: number): HTMLElement {
  const now = Date.now();
  const mature = plant.growth.stage === "mature" || plant.growth.stage === "awakened";
  const progress = stageProgress(plant, now);
  const meta = RARITY_META[plant.rarity];

  const card = el("div", { class: "plantcard plot" + (mature ? " ready" : "") + (canBreed(plant) ? " bred" : "") });

  // Rarity ribbon across the top.
  const ribbon = el("div", { class: "ribbon" });
  ribbon.style.background = `linear-gradient(90deg, ${meta.colour}, ${meta.colour}22)`;
  card.appendChild(ribbon);

  // Plot number, same 1-based figure the empty and locked tiles use.
  if (plotNumber !== undefined) {
    card.appendChild(el("div", { class: "soil-mark" + (mature ? " dim" : "") }, [String(plotNumber)]));
  }

  // Flags (favourite / locked).
  const flags = el("div", { class: "flags" });
  if (plant.locks.favorite) flags.appendChild(el("span", {}, ["⭐"]));
  if (plant.locks.manual) flags.appendChild(el("span", {}, ["🔒"]));
  if (flags.children.length) card.appendChild(flags);

  // The plant itself.
  const bed = el("div", { class: "bed" });
  bed.innerHTML = renderPlantSvg(plant, 150);
  card.appendChild(bed);

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
    card.appendChild(growthRing(progress, plant.growth.stageReadyAt - now, plant.growth.stageReadyAt));
  }

  card.addEventListener("click", onClick);
  return card;
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
  const wrap = el("div", { class: "plot" });
  wrap.style.cssText = "all:unset;display:block";
  wrap.innerHTML = svg;
  const holder = el("div", { class: "grow-timer" });
  const text = el("span", { class: "grow-timer-text mono" }, [`Còn ${formatRemaining(initial)} nữa lớn`]);
  const svgEl = wrap.firstElementChild as SVGElement;
  const label = svgEl.querySelector("text");
  const interval = window.setInterval(() => {
    if (!holder.isConnected) {
      window.clearInterval(interval);
      return;
    }
    const seconds = Math.ceil(Math.max(0, readyAt - Date.now()) / 1000);
    if (label) label.textContent = String(seconds);
    text.textContent = seconds > 0 ? `Còn ${formatRemaining(seconds)} nữa lớn` : "Sẵn sàng lớn";
  }, 1000);
  holder.appendChild(wrap.firstElementChild as Node);
  holder.appendChild(text);
  return holder;
}

function formatRemaining(seconds: number): string {
  if (seconds >= 60) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return `${seconds}s`;
}
