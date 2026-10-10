/**
 * Lazy plant art — the DOM budget guard.
 *
 * A mature plant is ~300 SVG nodes; a 24-plot garden is ~7.500 of them just in
 * beds, over the 5.000-node ceiling the runtime budget sets for F03 (docs/27
 * §12). `content-visibility:auto` already skips layout and paint for offscreen
 * plots, but the nodes still exist — the ceiling counts them.
 *
 * So offscreen beds start *empty* — the island card, element glow, flags and
 * labels all still render, only the plant portrait is deferred — and an
 * IntersectionObserver mounts the full art ~200px before the card can scroll
 * into view. The art that arrives is the same `renderPlantSvg` string it would
 * have been, so nothing about the visible garden changes; what changes is
 * that the DOM only ever holds the art the player can actually see.
 *
 * Each bed is observed until its first intersection, then unobserved — the
 * observer never holds more than one generation of not-yet-seen beds, and a
 * repaint that throws the cards away takes its pending observations with it
 * through the WeakMap.
 */
import type { Plant } from "../core/types";
import { renderPlantSvg } from "./plantRenderer";

/** bed → art thunk, held weakly so detached beds die with their card. */
const pending = new WeakMap<Element, () => string>();

let observer: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const bed = e.target as HTMLElement;
        observer!.unobserve(bed);
        const makeSvg = pending.get(bed);
        if (!makeSvg) continue;
        pending.delete(bed);
        bed.innerHTML = makeSvg();
        bed.dataset.lod = "full";
      }
    },
    // Mount a card-length early: a fast flick should still land on finished
    // art, not watch a bed fill in.
    { rootMargin: "240px 0px" },
  );
  return observer;
}

/**
 * Fill `bed` with whatever `makeSvg` produces — now if the platform cannot
 * observe intersections, deferred if it can. Safe to call on every card
 * build; the observer deduplicates via `unobserve` after the first mount.
 */
export function lazySvgArt(bed: HTMLElement, makeSvg: () => string): void {
  if (typeof IntersectionObserver !== "function") {
    bed.innerHTML = makeSvg();
    bed.dataset.lod = "full";
    return;
  }
  pending.set(bed, makeSvg);
  bed.dataset.lod = "deferred";
  ensureObserver().observe(bed);
}

/* Plant art is deterministic on (dna, growth, size): every garden repaint and
 * every bed that scrolls in asks for the same string. dna/visual never mutate
 * in place — a new plant is a new object — so the identity-bearing key parts
 * are the ones that can change under a living object: stage, level, and the
 * `updatedAt` stamp care/stage writes. Stringifying the genome for a key cost
 * ~2ms per plant per repaint — more than the cache saved. */
const svgCache = new WeakMap<Plant, { key: string; svg: string }>();

function cachedPlantSvg(plant: Plant, size: number, anim: boolean): string {
  const key = `${size}|${anim}|${plant.growth.stage}|${plant.growth.level}|${plant.updatedAt}`;
  const hit = svgCache.get(plant);
  if (hit && hit.key === key) return hit.svg;
  const svg = renderPlantSvg(plant, size, { anim });
  svgCache.set(plant, { key, svg });
  return svg;
}

/**
 * Fill `bed` with the plant's SVG through `lazySvgArt`.
 */
export function plantBedArt(bed: HTMLElement, plant: Plant, size = 150): void {
  bed.dataset.svgSize = String(size);
  lazySvgArt(bed, () => cachedPlantSvg(plant, size, false));
}
