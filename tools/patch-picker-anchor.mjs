import { readFileSync, writeFileSync } from "node:fs";

/**
 * garden.ts — the seed picker becomes a popover anchored to the plot you tapped.
 *
 * It was a full-screen overlay with a bottom sheet. That is the wrong shape for
 * this action: the sheet is tall, it renders below the fold on a phone, and
 * because it replaces the view it throws away the thing you were looking at. The
 * complaint was that choosing a seed meant scrolling, which is exactly what a
 * tall centred sheet forces you to do.
 *
 * A popover keeps the plot visible and the choice next to it. Three details
 * decide whether it feels right:
 *
 *   flip   opening upward when there is no room below, so the plot at the bottom
 *          of a long garden does not push the picker off screen
 *   clamp  clamped horizontally to the viewport, because a plot in the right-hand
 *          column would otherwise anchor the popover off the edge
 *   close  on scroll and on resize, because an anchored popover whose anchor
 *          moves is worse than one that closes
 *
 * Positioning is computed from the anchor's box and applied with `position:
 * fixed`, so it is unaffected by the grid's own layout — no measurement passes,
 * no reflow, and no feedback loop between placing the popover and re-reading a
 * position that the popover itself changed.
 */

const file = "src/ui/screens/garden.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  // --- signature and mount ---------------------------------------------
  [
    `function openSeedPicker(nav: Navigate): void {
  const held = SPECIES.filter((s) => (store.state.seeds[s.id] ?? 0) > 0);
  const body = el("div", { class: "seed-picker" });`,
    `/**
 * \`anchorEl\` is the plot that was tapped. Without it the picker centres itself,
 * which is what the keyboard and the context-menu entry point use — a menu opened
 * without a pointer still has to appear somewhere.
 */
function openSeedPicker(nav: Navigate, anchorEl?: HTMLElement): void {
  const held = SPECIES.filter((s) => (store.state.seeds[s.id] ?? 0) > 0);
  const body = el("div", { class: "seed-picker" });`,
  ],

  // --- the popover instead of the sheet ---------------------------------
  [
    `  const { overlay, sheet: s } = sheet(body, () => close());
  const close = (): void => {
    sfx.play("back");
    overlay.remove();
    s.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  document.querySelector(".shell")!.append(overlay, s);
}`,
    `  const pop = el("div", { class: "seed-pop" });
  pop.appendChild(body);
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Chọn hạt để gieo");

  // A scrim only when there is no anchor to point at. With one, the popover is
  // close enough to its plot that a full-screen dim would be a lie about what is
  // being interacted with.
  const scrim = anchorEl ? null : el("div", { class: "seed-pop-scrim" });
  scrim?.addEventListener("pointerdown", () => close());

  const close = (): void => {
    sfx.play("back");
    pop.remove();
    scrim?.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
    document.removeEventListener("pointerdown", onOutside, true);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  const onOutside = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (t && (pop.contains(t) || anchorEl?.contains(t))) return;
    close();
  };

  const shell = document.querySelector(".shell")!;
  if (scrim) shell.append(scrim);
  shell.appendChild(pop);

  if (anchorEl) {
    placePopover(pop, anchorEl);
    anchorEl.classList.add("is-picking");
  }

  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside, true);
  // Not repositioned on scroll — closed. A popover that follows its anchor while
  // the page scrolls under the player's thumb is a thing they are chasing.
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);
}

/**
 * Put a popover next to its anchor, inside the viewport.
 *
 * \`position: fixed\` with a measured box, rather than CSS anchoring: the browser
 * support for \`anchor-name\` is still uneven, and the fallback for an unsupported
 * browser is usually "centre it", which is the exact thing this change exists to
 * stop happening.
 */
function placePopover(pop: HTMLElement, anchor: HTMLElement): void {
  const GAP = 10;
  const MARGIN = 8;

  const place = (): void => {
    const a = anchor.getBoundingClientRect();
    // Measured after the popover is in the document, so this is its real size.
    const p = pop.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Prefer below. Flip above only when below would genuinely not fit — a
    // popover that flips while there is still room below reads as indecisive.
    const roomBelow = vh - a.bottom;
    const above = roomBelow < p.height + GAP && a.top > p.height + GAP;

    let top = above ? a.top - p.height - GAP : a.bottom + GAP;
    let left = a.left + a.width / 2 - p.width / 2;

    // Clamp horizontally, and prefer aligning to whichever edge has more room so
    // the popover's arrow still points at the plot.
    if (left + p.width > vw - MARGIN) left = a.right - p.width;
    if (left < MARGIN) left = MARGIN;
    left = Math.max(MARGIN, Math.min(left, vw - p.width - MARGIN));

    if (top + p.height > vh - MARGIN) top = Math.max(MARGIN, vh - p.height - MARGIN);

    pop.style.left = \`\${Math.round(left)}px\`;
    pop.style.top = \`\${Math.round(top)}px\`;
    pop.classList.toggle("is-above", above);

    // Where the arrow goes, in the popover's own coordinates. Clamped well inside
    // so it can never slide off the rounded corner.
    const cx = a.left + a.width / 2;
    pop.style.setProperty("--arrow-x", \`\${Math.round(Math.max(14, Math.min(p.width - 14, cx - left)))}px\`);
  };

  // Two frames: one to be in the document, one for the entry transition to have
  // started. Measuring in the same frame it was inserted gives a stale height.
  requestAnimationFrame(() => requestAnimationFrame(place));
}`,
  ],

  // --- the caller passes its own element ---------------------------------
  [
    `  plot.addEventListener("click", () => openSeedPicker(nav));
  plot.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openSeedPicker(nav);
  });`,
    `  plot.addEventListener("click", () => openSeedPicker(nav, plot));
  plot.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openSeedPicker(nav, plot);
  });`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n---\n${needle.slice(0, 120)}\n---`);
  src = src.replace(needle, next);
}

// The anchor must not keep the highlight once the picker is gone.
src = src.replace(
  `  const close = (): void => {
    sfx.play("back");
    pop.remove();`,
  `  const close = (): void => {
    sfx.play("back");
    anchorEl?.classList.remove("is-picking");
    pop.remove();`,
);

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("garden.ts — seed picker is now anchored to the plot");