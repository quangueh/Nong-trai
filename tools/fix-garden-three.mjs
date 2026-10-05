import { readFileSync, writeFileSync } from "node:fs";

/**
 * Fix the three things the screenshot of the new garden showed.
 *
 * 1. A black dashed border on every empty bed. `.empty-plot` set only
 *    `border-style: dashed`, and the new `.plot` rule no longer sets a border at
 *    all — so the browser fell back to its initial `medium none currentcolor`,
 *    which with a style of dashed and no colour resolves to a hard black dashes.
 *    A bed waiting to be planted is untilled, and untilled is a change in tone
 *    and texture rather than a dotted outline.
 *
 * 2. A brown shelf across the top of every bed. The contact shadow was placed
 *    `top: 6%` and blurred, which put the top of its blur *above* the bed, and at
 *    6% of a 190px tile that is a visible ledge. It now hangs entirely below the
 *    bed, which is the only direction a mound's shadow goes.
 *
 * 3. The lawn was saturated enough to read as a highlight. Pulled down toward the
 *    rest of the palette so the soil is the brightest thing in the garden — which
 *    is correct, because the plants are what the eye is for.
 */

const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  // --- 1. the empty bed ---------------------------------------------------
  [
    `.empty-plot {
  min-height: 188px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  border-style: dashed;
  color: var(--text);
  text-align: center;
}`,
    `.empty-plot {
  min-height: 188px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--text);
  text-align: center;
  /* Unplanted, not unfinished. A dashed outline said "form to fill in"; a paler,
     softer bed says "soil waiting". The dashed border that was here resolved to
     black once .plot stopped declaring one. */
  background-image:
    repeating-linear-gradient(180deg, rgba(122, 88, 52, 0.05) 0 4px, transparent 4px 9px),
    radial-gradient(86% 74% at 50% 30%, #e6dcbe 0%, #d8c9a5 50%, #c2ae82 84%, #b09665 100%);
  box-shadow: inset 0 2px 6px rgba(74, 48, 22, 0.14);
}

/* A shallow dimple where a seed goes, so the bed has a place rather than just
   being an empty rectangle. */
.empty-plot .soil-mark {
  position: relative;
}`,
  ],

  // --- 2. the contact shadow hangs below -----------------------------------
  [
    `.plot::before {
  content: "";
  position: absolute;
  left: 3%;
  right: 3%;
  top: 6%;
  bottom: -4px;
  border-radius: 10px;
  background: rgba(46, 62, 24, 0.16);
  filter: blur(6px);
  z-index: -1;
  pointer-events: none;
}`,
    `.plot::before {
  content: "";
  position: absolute;
  left: 5%;
  right: 5%;
  /* Entirely below the bed. At \`top: 6%\` the top of the blur sat above the bed
     and read as a brown shelf lying across it — a shadow with no light source. */
  top: calc(100% - 2px);
  bottom: -7px;
  border-radius: 10px;
  background: rgba(44, 60, 24, 0.2);
  filter: blur(6px);
  z-index: -1;
  pointer-events: none;
}`,
  ],

  // --- 3. the lawn sits back ----------------------------------------------
  [
    `    linear-gradient(178deg, #a4d582 0%, #8dc068 52%, #7bb25a 100%);`,
    `    /* Deliberately the dullest green in the game. The soil and the plants are
       what the eye is for; a lawn brighter than either competes with them. */
    linear-gradient(178deg, #8fbc६f 0%, #7cae5d 52%, #6d9e4e 100%);`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 90)}`);
  src = src.replace(needle, next);
}

// A Devanagari digit slipped into the gradient above; use plain ASCII.
src = src.replace("#8fbc६f", "#8fbc6f");

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("empty bed, contact shadow and lawn tone fixed");