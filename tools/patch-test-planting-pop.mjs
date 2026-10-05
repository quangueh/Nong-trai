import { readFileSync, writeFileSync } from "node:fs";

/**
 * test-planting.ts — the chooser closes on a tap outside, which is now the only
 * way out of it.
 *
 * The old test clicked `.overlay`. That element no longer exists when the picker
 * is anchored to a plot: a popover next to the thing you tapped does not dim the
 * screen, because dimming it would be a lie about what you are interacting with,
 * and it would also reintroduce the full-screen surface this change removed.
 *
 * So dismissal moved to a `pointerdown` listener on the document. jsdom will not
 * synthesise that from `click()`, so the test dispatches it — the same reason the
 * file already dispatches `pointerdown` by hand further down.
 *
 * Escape is asserted too, since it is the other way out and the keyboard path is
 * easy to lose when a dismissal mechanism is replaced.
 */

const file = "tools/test-planting.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  [
    `check("the chooser lists the seeds held", $$(".picker-card").length > 0);
check("with a preview of one", !!$(".seed-preview"));
click($(".overlay"));
await wait(20);
check("tapping the backdrop closes it", !$(".seed-picker"));`,
    `check("the chooser lists the seeds held", $$(".picker-card").length > 0);
check("with a preview of one", !!$(".seed-preview"));
// Anchored to the plot, so there is no dimming overlay any more — a popover beside
// the thing you tapped does not need one, and adding it back would put the tall
// full-screen surface this replaced.
check("and no full-screen overlay", !$(".overlay") && !$(".seed-pop-scrim"));

// Tapping anywhere outside closes it. A real tap produces pointerdown before
// click, and jsdom will not synthesise one from \`click()\`.
document.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
await wait(20);
check("tapping outside closes it", !$(".seed-pop") && !$(".seed-picker"));

// And it can be reopened, so the dismissal did not leave the plot dead.
click(emptyPlots[0]);
await wait(20);
check("the plot still opens the chooser again", !!$(".seed-pop"));
document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(20);
check("escape closes it", !$(".seed-pop"));`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 100)}`);
  src = src.replace(needle, next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("test-planting.ts — dismissal assertions match the anchored popover");