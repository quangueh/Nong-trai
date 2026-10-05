import { readFileSync, writeFileSync } from "node:fs";

/**
 * garden.ts — re-place the popover when its content changes size.
 *
 * Found by measurement, not by reading: the popover opened at top 366 with a
 * height of 460 in an 820px viewport, which is six pixels past the bottom edge.
 * The clamp in `placePopover` was correct and did not fire, which meant the height
 * it measured was smaller than the height the popover ended up.
 *
 * The cause is the font. `index.html` loads Be Vietnam Pro from Google Fonts, so
 * the text inside the preview reflows after the popover has been positioned, and
 * the box grows. Every anchored popover that does not watch its own size has this
 * bug, and it only appears on a real network — which is why the local check passed
 * with the font already cached.
 *
 * A `ResizeObserver` is the fix rather than waiting on `document.fonts.ready`,
 * because the seed list can also change height — the preview for a species with
 * six stat rows is taller than one with three.
 *
 * The guard matters: placing writes `left`/`top`, and re-placing on any change
 * would observe its own writes and loop. Only a change in *size* re-places.
 */

const file = "src/ui/screens/garden.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  [
    `  const place = (): void => {
    const a = anchor.getBoundingClientRect();
    // Measured after the popover is in the document, so this is its real size.
    const p = pop.getBoundingClientRect();`,
    `  let lastW = -1;
  let lastH = -1;

  const place = (force = false): void => {
    const a = anchor.getBoundingClientRect();
    // Measured after the popover is in the document, so this is its real size.
    const p = pop.getBoundingClientRect();

    // Placing writes \`left\`/\`top\`, so an observer that reacted to every change
    // would be reacting to its own writes. Only a size change re-places, and the
    // first pass always places.
    if (!force && Math.abs(p.width - lastW) < 0.5 && Math.abs(p.height - lastH) < 0.5) return;
    lastW = p.width;
    lastH = p.height;`,
  ],

  [
    `  // Two frames: one to be in the document, one for the entry transition to have
  // started. Measuring in the same frame it was inserted gives a stale height.
  requestAnimationFrame(() => requestAnimationFrame(place));
}`,
    `  // Two frames: one to be in the document, one for the entry transition to have
  // started. Measuring in the same frame it was inserted gives a stale height.
  requestAnimationFrame(() => requestAnimationFrame(() => place(true)));

  // Content that arrives late. The webfont is the case that actually bites — the
  // preview text reflows after positioning and the box grows past the edge — but
  // a longer species description does the same thing.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => place());
    ro.observe(pop);
    // Disconnected on close, so a dismissed popover stops observing. Without this
    // the observer outlives the popover and holds its whole subtree alive.
    pop.addEventListener("pop:closed", () => ro.disconnect(), { once: true });
  }

  // Belt and braces for the one case the observer would catch late: fonts.
  if (typeof document !== "undefined" && "fonts" in document) {
    void (document as Document & { fonts: FontFaceSet }).fonts.ready.then(() => place(true));
  }
}`,
  ],

  [
    `    sfx.play("back");
    anchorEl?.classList.remove("is-picking");
    pop.remove();`,
    `    sfx.play("back");
    anchorEl?.classList.remove("is-picking");
    // Signals the ResizeObserver to disconnect. Fired before removal so the
    // handler is still attached.
    pop.dispatchEvent(new Event("pop:closed"));
    pop.remove();`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 110)}`);
  src = src.replace(needle, next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("garden.ts — popover re-places when its content resizes");