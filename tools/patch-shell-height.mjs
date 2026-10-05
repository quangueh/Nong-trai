import { readFileSync, writeFileSync } from "node:fs";

/**
 * The app shell was never actually constrained to the viewport.
 *
 * Found by probing rather than by looking, which is the only way it could have been
 * found: `#app` and `.shell` both said `min-height: 100dvh`, so the shell grew to
 * the height of its content — 2,299px on a garden with 24 plots. `.screen` has
 * `flex: 1; overflow-y: auto`, but a flex item in a column of unbounded height is
 * not bounded by anything, so the screen grew too and the *document* scrolled
 * instead of the screen.
 *
 * Everything positioned against the shell was therefore wrong:
 *
 *   the bottom nav, `position: absolute; bottom: 0`, sat at 2,299px — off screen
 *   every sheet, also `absolute; bottom: 0`, opened below the fold
 *
 * Tapping a plant did nothing visible. The detail sheet rendered at `top: 932` in
 * an 820px viewport.
 *
 * Why every screenshot missed it: they were all `fullPage: true`, so the capture
 * was 2,299px tall and the navigation bar appeared — at the bottom of the *image*,
 * which is not where it appears to a player. The art looked right, the garden
 * looked right, and the one thing a player would notice first was invisible in
 * every single capture.
 *
 * The fix is the height chain, and `min-height: 0` on the screen is the load-
 * bearing part: without it a flex item refuses to shrink below its content, which
 * is the exact behaviour that caused this.
 */

const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  [
    `#app {
  display: flex;
  justify-content: center;
  min-height: 100dvh;
}`,
    `#app {
  display: flex;
  justify-content: center;
  /* Height, not min-height. With \`min-height\` the shell grew to whatever its
     content was, and every absolutely-positioned child — the nav, every sheet —
     resolved against a container thousands of pixels tall. */
  height: 100dvh;
  overflow: hidden;
}`,
  ],

  [
    `  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background:`,
    `  display: flex;
  flex-direction: column;
  /* Exactly one viewport, and no scrolling of its own. The screen inside scrolls;
     the shell does not. */
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  background:`,
  ],

  [
    `.screen {
  flex: 1;
  overflow-y: auto;`,
    `.screen {
  flex: 1 1 auto;
  /* The load-bearing line. A flex item defaults to \`min-height: auto\`, which
     refuses to shrink below its content — so this element grew to the height of a
     24-plot garden and the document scrolled instead of it, taking the shell's
     bottom-anchored children with it. */
  min-height: 0;
  overflow-y: auto;`,
  ],

  // The top bar was sticky for a scroll container that never scrolled. Harmless
  // where it is, but it was sticky *because* of the same misunderstanding.
  [
    `  background: rgba(255, 248, 226, 0.88);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  z-index: 30;
}`,
    `  background: rgba(255, 248, 226, 0.88);
  backdrop-filter: blur(12px);
  /* Was \`sticky\`, on the assumption that the document scrolled. It does not —
     the screen does — so this is a plain flex child and stays put because there is
     nothing to scroll past it. */
  position: relative;
  z-index: 30;
  flex: none;
}`,
  ],

  // The garden tab rail was sticky against the document too.
  [
    `  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(90, 104, 78, 0.14);
  position: sticky;
  top: 0;
  z-index: 20;`,
    `  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(90, 104, 78, 0.14);
  /* Sticky against the screen, which is now the real scroller, so the rail stays
     put while a 24-plot garden scrolls under it. It needs a top offset because
     the screen's own padding is what it sticks against, not a page edge. */
  position: sticky;
  top: -12px;
  z-index: 20;`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 100)}`);
  src = src.replace(needle, next);
}

// The notice host was positioned against the viewport, which was fine; it stays.

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("styles.css — the shell is one viewport tall and the screen is the scroller");