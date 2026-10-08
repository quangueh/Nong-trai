/** Tiny DOM helpers + shared UI widgets. */

import { Rng, seedToken } from "../core/rng";
import { createSeedPlant } from "../genetics/genomeGenerator";
import { renderPlantSvg } from "../render/plantRenderer";

import type { Plant } from "../core/types";
import { STAGE_LABEL } from "../core/types";
import { canBattle, stageProgress } from "../growth/stages";
import { plantDisplayName } from "../core/plantNames";
import { RARITY_META, RARITY_ORDER, type Rarity } from "../config/rarity";
import { dominantElement, ELEMENT_INFO, ELEMENTS, type ElementId } from "../config/elements";
import { TRAITS_BY_ID } from "../config/traits";
import { ARCHETYPE_KEYS, ARCHETYPE_LABEL, ARCHETYPE_ROLE } from "../config/balance";
import { speciesAffinity, type Archetype, type SpeciesDef, type SpeciesId } from "../config/species";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("data-") || k === "style") node.setAttribute(k, v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function rarityTag(r: Rarity): HTMLElement {
  const meta = RARITY_META[r];
  const tag = el("span", { class: "tag" });
  tag.textContent = r;
  tag.style.color = meta.colour;
  tag.style.borderColor = `${meta.colour}44`;
  tag.style.background = `${meta.colour}18`;
  return tag;
}

export function elementTags(plant: Plant): HTMLElement[] {
  const entries = ELEMENTS.map((id) => [id, plant.dna.elementGenes[id] ?? 0] as [ElementId, number])
    .filter(([, v]) => v > 0.18)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return entries.map(([id, share]) => {
    const info = ELEMENT_INFO[id];
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${info.name} ${Math.round(share * 100)}%`;
    tag.style.color = info.ink;
    tag.style.borderColor = info.tint;
    tag.style.background = info.tint;
    tag.title = info.flavour;
    return tag;
  });
}

export function traitChips(plant: Plant): HTMLElement[] {
  if (!plant.traits.length) return [];
  return plant.traits.map((t) => {
    const def = TRAITS_BY_ID[t];
    const chip = el("span", { class: "traitchip" });
    chip.textContent = def?.name ?? t;
    if (def?.rarity === "rare") chip.style.color = "#0d5f85"; // darkened: #9ad6ff was 1.03:1 on the light theme
    if (def?.rarity === "unstable") chip.style.color = "#a5236b"; // darkened: #ff9ad6 was 1.28:1
    return chip;
  });
}

export function plantThumb(plant: Plant, size = 100, anim = false): HTMLElement {
  const box = el("div", { class: "thumb" });
  box.innerHTML = renderPlantSvg(plant, size, { anim });
  return box;
}

/**
 * Compact plant card used by the collection grid.
 *
 * Shares the garden's card *sizing* and type so the two screens look like one game, but not
 * the island: `plot` paints soil, a grass cap and a root tapering to a point below the card,
 * and a plant standing in the collection is standing on nothing. It was applied anyway, and
 * every collection card hung a cone of earth under itself with nothing holding it up.
 */
export function plantCard(plant: Plant, onClick: () => void): HTMLElement {
  const card = el("div", { class: "plantcard" });
  const meta = RARITY_META[plant.rarity];

  const ribbon = el("div", { class: "ribbon" });
  ribbon.style.background = `linear-gradient(90deg, ${meta.colour}, ${meta.colour}22)`;
  card.appendChild(ribbon);

  const flags = el("div", { class: "flags" });
  if (plant.locks.favorite) flags.appendChild(el("span", {}, ["⭐"]));
  if (plant.locks.manual) flags.appendChild(el("span", {}, ["🔒"]));
  if (flags.children.length) card.appendChild(flags);

  const bed = el("div", { class: "bed" });
  bed.innerHTML = renderPlantSvg(plant, 150);
  card.appendChild(bed);

  const name = el("div", { class: "pname" });
  name.textContent = plant.name;
  card.appendChild(name);

  const row = el("div", { class: "prow" });
  const r = el("span", { class: "rarity" });
  r.textContent = plant.rarity;
  r.style.color = meta.colour;
  const pw = el("span", { class: "mono muted" });
  pw.textContent = `⚔${fmt(plant.powerRating)}`;
  row.append(r, pw);
  card.appendChild(row);

  const dom = dominantElement(plant.dna.elementGenes);
  const chip = el("span", { class: "chip dim" }, [ELEMENT_INFO[dom.id].name]);
  chip.style.color = ELEMENT_INFO[dom.id].ink;
  const foot = el("div", { class: "prow" });
  foot.appendChild(chip);
  if (plant.growth.stage === "mature" || plant.growth.stage === "awakened") {
    foot.appendChild(el("span", { class: "chip gold" }, ["⚔"]));
  }
  card.appendChild(foot);

  card.addEventListener("click", onClick);
  return card;
}

/**
 * "Why this plant cannot be picked", in one phrase, for the picker's dimmed rows.
 *
 * An immature plant's reason is its growth, because that is what will lift the block:
 * "Đang lớn — Mầm 62%" says both that it is out and roughly for how long. Anything
 * battle-ready answers null, and callers then layer their own locks on top.
 */
export function plantGrowingBlock(p: Plant): string | null {
  if (canBattle(p)) return null;
  const pct = Math.round(stageProgress(p, Date.now()) * 100);
  return `Đang lớn — ${STAGE_LABEL[p.growth.stage]} ${pct}%`;
}

/** Battle pickers (arena, rooms, friend duels): grown, and not mid-fight. */
export function battleBlock(p: Plant): string | null {
  return plantGrowingBlock(p) ?? (p.locks.battle ? "Đang trong trận đấu" : null);
}

/** The breeding picker: battle rules plus the fusion lock. */
export function breedBlock(p: Plant): string | null {
  return battleBlock(p) ?? (p.locks.breeding ? "Đang lai tạo" : null);
}

/**
 * The plant-choosing sheet, shared by every "pick one of mine" flow — arena fights,
 * room battles, friend duels, breeding.
 *
 * It lists the *whole* garden, not only the eligible subset: a plant that is missing
 * from the list entirely reads as a bug ("vườn có mà chỗ này không có"), while a plant
 * that is present but dimmed with its reason reads as a rule. `blocked` answers
 * "why can't I take this one" in a phrase; a null answer makes the tile a button.
 *
 * The list is a wrapping grid of square tiles rather than a sideways strip — a row of
 * cards you drag left is fine for three plants and miserable for twelve, while a grid
 * that wraps downward lets the sheet's own vertical scroll do the work.
 */
export function pickPlantSheet(opts: {
  title: string;
  plants: Plant[];
  /** A Vietnamese reason the plant cannot be picked, or null if it can. */
  blocked: (plant: Plant) => string | null;
  emptyText: string;
  onPick: (plant: Plant) => void;
}): void {
  const shell = document.querySelector(".shell") ?? document.body;
  const overlay = el("div", { class: "overlay" });
  const sheet = el("div", { class: "sheet" });
  const dismiss = () => {
    overlay.remove();
    sheet.remove();
  };

  const content = el("div");
  content.appendChild(el("h3", { style: "font-size:16px;margin-bottom:10px" }, [opts.title]));

  // Eligible first, strongest first; the rest follow so the garden is all accounted
  // for and each carries the reason it is out.
  const rows = [...opts.plants].sort((a, b) => {
    const aOk = !opts.blocked(a);
    const bOk = !opts.blocked(b);
    if (aOk !== bOk) return aOk ? -1 : 1;
    return b.powerRating - a.powerRating;
  });

  if (!rows.length) content.appendChild(el("div", { class: "empty" }, [opts.emptyText]));

  const list = el("div", { class: "pickgrid" });
  for (const p of rows) {
    const why = opts.blocked(p);
    // `pickrow` is the test hook for "a plant in the picker" — the class survived the
    // row-to-tile reshape because the tests were written against it.
    const tile = el("button", {
      class: "pickrow pickcell" + (why ? " is-blocked" : ""),
      style: why ? "opacity:.55;cursor:default" : "cursor:pointer",
    });
    tile.append(
      plantThumb(p, 52),
      el("div", {
        class: "small",
        style: "font-weight:700;font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
      }, [plantDisplayName(p, opts.plants)]),
      el("div", { class: "tiny muted mono" }, [`Lv${p.growth.level} · Đ${p.generation} · ⚔${fmt(p.powerRating)}`]),
      rarityTag(p.rarity),
    );
    const chips = el("div", { class: "row wrap", style: "gap:3px;justify-content:center" });
    for (const t of elementTags(p).slice(0, 3)) chips.appendChild(t);
    for (const t of traitChips(p).slice(0, 2)) chips.appendChild(t);
    if (chips.children.length) tile.appendChild(chips);

    if (why) tile.appendChild(el("div", { class: "tiny", style: "color:var(--danger);line-height:1.2" }, [why]));
    else tile.addEventListener("click", () => {
      dismiss();
      opts.onPick(p);
    });
    list.appendChild(tile);
  }
  content.appendChild(list);

  sheet.append(el("div", { class: "handle" }), content);
  overlay.addEventListener("click", dismiss);
  dismissOnEscape(sheet, dismiss);
  shell.append(overlay, sheet);
}

/** Six-axis archetype radar (docs/15 §18). */
export function archetypeRadar(plant: Plant, size = 150): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const n = ARCHETYPE_KEYS.length;
  const pts = ARCHETYPE_KEYS.map((k, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const v = Math.max(0.04, plant.archetype[k]);
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v] as const;
  });
  const poly = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const gridLines = [0.33, 0.66, 1]
    .map(
      (f) =>
        `<polygon points="${ARCHETYPE_KEYS.map((_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return `${(cx + Math.cos(a) * r * f).toFixed(1)},${(cy + Math.sin(a) * r * f).toFixed(1)}`;
        }).join(" ")}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="1"/>`,
    )
    .join("");
  const spokes = ARCHETYPE_KEYS.map((_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="rgba(255,255,255,.13)" stroke-width="1"/>`;
  }).join("");
  const labels = ARCHETYPE_KEYS.map((k, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * (r + 13);
    const y = cy + Math.sin(a) * (r + 13);
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#9fb8ad" font-weight="600">${ARCHETYPE_LABEL[k as Archetype]}</text>`;
  }).join("");
  const dom = dominantElement(plant.dna.elementGenes);
  return `<svg class="radar" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${gridLines}${spokes}
    <polygon points="${poly}" fill="${ELEMENT_INFO[dom.id].color}33" stroke="${ELEMENT_INFO[dom.id].color}" stroke-width="1.6" stroke-linejoin="round"/>
    ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="${ELEMENT_INFO[dom.id].color}"/>`).join("")}
    ${labels}
  </svg>`;
}

/** Six-axis archetype radar, typed helper for reuse outside the string above. */
export function archetypeLabel(key: Archetype): string {
  return ARCHETYPE_LABEL[key];
}

/** Rarity odds bar shown before breeding (docs/16 §22). */
export function oddsBar(weights: Record<Rarity, number>): HTMLElement {
  const wrap = el("div", { class: "odds" });
  for (const r of RARITY_ORDER) {
    const w = weights[r] / 100;
    if (w < 0.001) continue;
    const d = el("div");
    d.style.width = `${w * 100}%`;
    d.style.background = `${RARITY_META[r].colour}${r === "SSS" ? "ff" : "cc"}`;
    // Every rarity fill is dark enough for white text (minimum 5.54:1), so the
    // conditional that once existed for the light-theme palette is no longer needed.
    d.style.color = "#fffdf1";
    d.textContent = w >= 0.06 ? r : "";
    d.title = `${r}: ${(w * 100).toFixed(2)}%`;
    wrap.appendChild(d);
  }
  return wrap;
}

export function probabilityRows(weights: Record<Rarity, number>): HTMLElement[] {
  return RARITY_ORDER.map((r) => {
    const row = el("div", { class: "probbar" });
    const lbl = el("span", { class: "lbl" });
    lbl.textContent = r;
    lbl.style.color = RARITY_META[r].colour;
    const track = el("div", { class: "track" });
    const bar = el("i");
    // Scaled, not resized — same reason as `.bar > i` in the stylesheet.
    bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (weights[r] / 100) * 1.6))})`;
    bar.style.background = RARITY_META[r].colour;
    track.appendChild(bar);
    const val = el("span", { class: "val" });
    val.textContent = `${(weights[r] / 100).toFixed(2)}%`;
    row.append(lbl, track, val);
    return row;
  });
}

export function bar(fraction: number, cls = ""): HTMLElement {
  const b = el("div", { class: `bar ${cls}` });
  const i = el("i");
  // Scale instead of resizing so the bar animates on the compositor, not via layout.
  i.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  b.appendChild(i);
  return b;
}

export function statRow(label: string, value: string, extra = ""): HTMLElement {
  const row = el("div", { class: "statrow" });
  row.append(el("span", { class: "muted" }, [label]));
  const v = el("span", { class: `mono ${extra}` });
  v.textContent = value;
  row.appendChild(v);
  return row;
}

/* ---------------------------------------------------------------------------
 * Modal dismissal, once.
 *
 * Two halves that only work together: focus must land inside the modal for
 * keydown to bubble through it, and Escape that reaches the modal must stop
 * there — an Escape that also fires the game input underneath (the battle
 * pause toggle listens on `window`) is a ghost input.
 *
 * Bound to the element, not the document: a document listener outlives its
 * overlay and would stack one handler per reopen.
 * ------------------------------------------------------------------------- */
function focusFirstIn(root: HTMLElement): void {
  queueMicrotask(() => {
    root.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]")?.focus({ preventScroll: true });
  });
}

/**
 * The Escape stack. Overlays push on mount; the single document listener closes
 * the topmost live one.
 *
 * Why a stack and not a listener per overlay on the element: an element-level
 * keydown only sees Escape while focus is inside that overlay. Focus can sit on
 * `body` — the player tapped the scrim, or a screen reader parked it there —
 * and then Escape hits nothing. A document listener per overlay is the opposite
 * leak: it outlives its overlay and stacks one handler per reopen. A shared
 * stack gets both right: capture phase sees every Escape no matter where focus
 * is, dead entries are popped lazily by the isConnected check, and the topmost
 * overlay — not the earliest-registered — is the one that closes.
 */
const escapeStack: { root: HTMLElement; close: () => void; returnFocus: HTMLElement | null }[] = [];
let escapeBound = false;

/*
 * Give the opener its focus back when the modal it opened goes away — whether
 * the dismissal was Escape, the scrim, or the sheet's own X. A keyboard user
 * whose focus vanished into a detached node is left at document top, three
 * dozen Tab presses from where they were.
 */
function restoreFocus(entry: { returnFocus: HTMLElement | null }): void {
  const back = entry.returnFocus;
  if (back?.isConnected) back.focus({ preventScroll: true });
}

/**
 * Keep Tab inside the topmost sheet: cycle first↔last, and pull focus in when
 * it is parked outside (on `body`, say). Focusable means rendered — a button
 * in a `display:none` branch is not a stop, so the check is layout, not markup.
 */
function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
  )].filter((n) => n.getClientRects().length > 0);
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    i < 0
      ? items[0]
      : e.shiftKey
        ? items[(i - 1 + items.length) % items.length]
        : items[(i + 1) % items.length];
  next.focus({ preventScroll: true });
}

function onModalKey(e: KeyboardEvent): void {
  while (escapeStack.length && !escapeStack[escapeStack.length - 1].root.isConnected) {
    restoreFocus(escapeStack.pop()!);
  }
  if (e.key === "Escape") {
    const top = escapeStack.pop();
    if (!top) return;
    /* Escape consumed by a modal must not fall through to the game underneath —
       battle pause, tool disarm, or a second overlay closing at once. */
    e.stopPropagation();
    top.close();
    restoreFocus(top);
    return;
  }
  const top = escapeStack[escapeStack.length - 1];
  if (top && e.key === "Tab") trapTab(e, top.root);
}

/**
 * Focus `root`'s first control on mount, run `close` on Escape, keep Tab
 * inside, and return focus to whatever opened it. The element the player was
 * on is captured here — by the time `close` runs, `activeElement` is already
 * inside the sheet being closed.
 */
export function dismissOnEscape(root: HTMLElement, close: () => void): void {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  /* Every sheet that can be dismissed this way is a modal dialog as far as a
     screen reader is concerned — set it once here rather than in each of the
     forty places a sheet is built. */
  if (!root.hasAttribute("role")) root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  focusFirstIn(root);
  escapeStack.push({ root, close, returnFocus });
  if (!escapeBound) {
    document.addEventListener("keydown", onModalKey, true);
    escapeBound = true;
  }
}

export function sheet(content: HTMLElement, onClose?: () => void): { overlay: HTMLElement; sheet: HTMLElement } {
  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet" });
  s.appendChild(el("div", { class: "handle" }));
  s.appendChild(content);
  /* A double-click that opened this sheet lands its second click on the scrim —
     detail 2 — which would slam the sheet shut before it was ever read. The
     opening gesture is not a dismiss gesture. */
  overlay.addEventListener("click", (e) => {
    if (e.detail <= 1) onClose?.();
  });
  /* Mouse users see no focus ring — :focus-visible follows the last input
     modality — but the position is set for whoever reaches for the keyboard. */
  if (onClose) dismissOnEscape(s, onClose);
  else focusFirstIn(s);
  return { overlay, sheet: s };
}

/**
 * A designed confirm dialog — the replacement for native `confirm()`.
 *
 * Native confirm is a browser chrome alert: unstyled, unlabelled buttons, no
 * Escape/Tab/focus behaviour, and it blocks the thread. Destructive actions
 * (breeding consumes the parents, selling is permanent) deserve the real
 * thing: named buttons, the cost spelled out, focus parked on the safe choice.
 */
export function confirmDialog(opts: {
  title: string;
  body?: string | HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling on the confirm button — for actions that cannot be undone. */
  danger?: boolean;
  onConfirm: () => void;
}): void {
  const shell = document.querySelector(".shell") ?? document.body;
  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet confirm-sheet" });
  const close = (): void => {
    overlay.remove();
    s.remove();
  };

  const cancel = el("button", { class: "btn ghost" }, [opts.cancelLabel ?? "Huỷ"]);
  cancel.addEventListener("click", close);
  const ok = el("button", { class: `btn${opts.danger ? " danger" : " primary"}` }, [
    opts.confirmLabel ?? "Đồng ý",
  ]);
  ok.addEventListener("click", () => {
    close();
    opts.onConfirm();
  });

  s.append(
    el("h3", { style: "font-size:17px;margin:4px 0 8px" }, [opts.title]),
    typeof opts.body === "string" || !opts.body
      ? el("div", { class: "small muted", style: "line-height:1.55" }, [opts.body ?? ""])
      : opts.body,
    el("div", { class: "row", style: "gap:8px;justify-content:flex-end;margin-top:16px" }, [cancel, ok]),
  );
  overlay.addEventListener("click", close);
  dismissOnEscape(s, close);
  shell.append(overlay, s);
  /*
   * Focus lands on Huỷ, not the destructive button — confirmDialog is for
   * actions that hurt, and Enter-by-habit should not fire them. The Escape
   * entry is already pushed; moving focus afterwards is safe.
   */
  queueMicrotask(() => cancel.focus({ preventScroll: true }));
}

export function toast(message: string, ms = 2000): void {
  const host = document.querySelector(".shell");
  if (!host) return;
  const t = el("div", { class: "toast" });
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function floatNumber(x: number, y: number, text: string, kind: "dmg" | "heal" | "crit"): void {
  const n = el("div", { class: `float-num ${kind}` });
  n.textContent = text;
  n.style.left = `${x}px`;
  n.style.top = `${y}px`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 950);
}

export function statGainFloat(target: HTMLElement, text: string): void {
  const r = target.getBoundingClientRect();
  const n = el("div", { class: "float-up", style: `left:${r.left + r.width / 2}px;top:${r.top}px` });
  n.textContent = text;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1100);
}


/**
 * Compact seed chip — orb with the owned count, species name, role and price.
 *
 * Lives here because the garden's seed belt and the shop's featured shelf both
 * need it, and the two drifting apart is how you end up with a `.card` squeezed
 * into a 154px flex slot and one word per line.
 */
export function seedChip(sp: SpeciesDef, count: number, opts: { active?: boolean; onPick?: (chip: HTMLElement) => void; showPrice?: boolean } = {}): HTMLElement {
  const role = ARCHETYPE_ROLE[sp.archetype] ?? sp.archetype;
  const b = el("button", {
    class: `seed-card ${opts.active ? "active" : ""} ${count <= 0 ? "empty-seed" : ""}`,
  });
  b.append(
    el("span", { class: "seed-orb", style: `--seed:${seedColor(sp.id)}` }, [String(count)]),
    el("span", { class: "seed-info" }, [
      el("b", {}, [sp.name]),
      // The chooser puts the price on a badge of its own. Showing it here too
      // gave every card two prices and made the badge look like a duplicate.
      el("small", {}, [opts.showPrice === false ? role : `${role} · ${sp.seedPrice} xu`]),
    ]),
  );
  /* The chip itself is handed to the picker: a buy wants the spend chip to rise
     off the card that was tapped, not off a remembered coordinate. */
  if (opts.onPick) b.addEventListener("click", () => opts.onPick!(b));
  return b;
}

/**
 * Species colour for the seed orb.
 *
 * The five starters have hand-picked colours. Everything else is tinted by its
 * dominant element, because the id space is open-ended and a hardcoded lookup
 * would return nothing for the 1000 generated species.
 */
export function seedColor(id: SpeciesId): string {
  const starter: Record<string, string> = {
    thornroot: "#54b66f",
    emberleaf: "#f06a3d",
    dewbud: "#56a9e8",
    voltvine: "#e8c93d",
    gloomcap: "#9b72d9",
  };
  return starter[id] ?? ELEMENT_TINT[dominantElement(speciesAffinity(id)).id] ?? "#54b66f";
}

const ELEMENT_TINT: Record<string, string> = {
  wood: "#54b66f",
  fire: "#f06a3d",
  water: "#56a9e8",
  earth: "#c08a52",
  electric: "#e8c93d",
  poison: "#9b72d9",
  light: "#f2e28a",
  shadow: "#7d6aa8",
};

/**
 * A plant portrait for a species, drawn from the real generator.
 *
 * Deterministic per species id, so the same seed always looks the same on the
 * shop shelf, in the seed picker and in an unlock banner. That consistency is the
 * point: a player who recognises a plant from the banner can find it on the
 * shelf.
 *
 * Builds a full genome per call, so it is for one-off portraits and not for lists
 * of hundreds.
 */
export function seedIcon(speciesId: string, size = 52): string {
  const rng = new Rng(`icon:${speciesId}`);
  const plant = createSeedPlant(speciesId as SpeciesId, "icon", seedToken(rng.next()), 0);
  return renderPlantSvg(plant, size);
}
