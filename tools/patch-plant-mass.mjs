import { readFileSync, writeFileSync } from "node:fs";

/**
 * Make the plants look like plants.
 *
 * A contact sheet of eighteen species, rendered at the size a garden tile actually
 * shows them, showed three problems and none of them were about the genome:
 *
 *   Four or five leaves each. `leafBudget` was `complexity * 9`, and complexity
 *   for a typical plant is 0.3-0.6, so almost everything got four or five. A plant
 *   is recognised by the *mass* of its foliage, not by having a leaf on it; four
 *   leaves on a bare stem is a stick with props.
 *
 *   The frame was barely used. `fill` capped at 1.15 of the available height, so
 *   each plant stood in the middle of a wide tile with a band of dead space either
 *   side. A plant drawn small reads as unfinished rather than as delicate.
 *
 *   Everything was pale. Saturation could floor at 0.2 while the leaf colours sit
 *   in a narrow band around a fixed anchor. Both were deliberate once, to stop
 *   plants coming out as wireframe outlines, and together they went too far the
 *   other way: light foliage on light soil has no separation, and on the sheet
 *   several plants were nearly invisible against their own bed.
 *
 * The leaf count is the change that matters most and the cheapest: one number, and
 * the silhouette fills out without touching the genome at all.
 */

const file = "src/render/plantRenderer.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

/** Single-line needles: a multi-line template literal in a patch script never matches. */
const edits = [
  [
    'const leafBudget = Math.max(stage === "seed" ? 2 : 4, Math.round(complexity * 9) + (stage === "young" ? 2 : 0));',
    'const leafBudget = Math.max(stage === "seed" ? 3 : stage === "young" ? 7 : 9, Math.round(complexity * 22) + (stage === "young" ? 2 : 0));',
    2,
  ],
  [
    "const fill = Math.min(1.15, 0.72 + v.scale * 0.3);",
    "const fill = Math.min(1.32, 0.88 + v.scale * 0.32);",
    1,
  ],
  [
    "let bloomScale = 1;",
    "let bloomScale = 1;\n  // Bigger leaves: with the count raised, each leaf also has to carry more of the\n  // silhouette, or a full plant reads as clutter instead of foliage.",
    1,
  ],
  [
    "let leafScale = 1;",
    "let leafScale = 1.18;",
    1,
  ],
];

for (const [needle, next, times] of edits) {
  const count = src.split(needle).length - 1;
  if (count !== times) {
    throw new Error(`expected ${times} of:\n${needle.slice(0, 90)}\nfound ${count}`);
  }
  src = src.split(needle).join(next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("plantRenderer.ts — leaf budget 9->22, fill cap 1.15->1.32, leaves 18% bigger");