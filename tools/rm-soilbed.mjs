import { readFileSync, writeFileSync } from "node:fs";

/**
 * Remove the leftover `.plot::after` "soil bed" rule.
 *
 * There were two `::after` rules on `.plot` at once. The line-range splice that
 * introduced the garden ground replaced the `.plot` block but not this rule, which
 * was a sibling of it, so the old one stayed and the new furrow rim was added
 * alongside it.
 *
 * The survivor is the brown shelf. It is positioned `left: -10%; right: -10%`, so
 * it is twenty percent wider than the bed on each side, and `bottom: 46px` with
 * `border-radius: 50% / 100% 100% 0 0` draws it as a dome sitting proud of the
 * surface. In a grid that lands it in the gap between rows, where it reads as a
 * plank lying across the bed below.
 *
 * It is also redundant now. It existed to draw a soil band under the plant, and the
 * plant renderer already draws its own mound inside the SVG — so the bed surface
 * and the plant's mound now both say "soil", and the band only muddied it.
 */

const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const dead = `.plot::after {
  /* soil bed */
  content: "";
  position: absolute;
  left: -10%;
  right: -10%;
  bottom: 46px;
  height: 26px;
  background: linear-gradient(180deg, rgba(138, 88, 55, 0) 0%, rgba(138, 88, 55, 0.52) 55%, rgba(92, 57, 35, 0.76) 100%);
  border-radius: 50% / 100% 100% 0 0;
  pointer-events: none;
}`;

if (!src.includes(dead)) throw new Error("the leftover soil-bed rule was not found verbatim");
src = src.replace(dead + "\n\n", "");
src = src.replace(dead, "");

// `.empty-plot::after { bottom: 34px }` positioned the band it no longer has.
const orphan = `.empty-plot::after {
  bottom: 34px;
}

`;
if (src.includes(orphan)) src = src.replace(orphan, "");

// Two `.empty-plot .soil-mark` rules now; the first only added position:relative,
// which nothing uses since the dimple idea was not built out.
const stray = `/* A shallow dimple where a seed goes, so the bed has a place rather than just
   being an empty rectangle. */
.empty-plot .soil-mark {
  position: relative;
}

`;
if (src.includes(stray)) src = src.replace(stray, "");

// Tidy the double blank line the removal left behind.
src = src.replace(/\n{3,}/g, "\n\n");

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("leftover soil-bed rule and its orphans removed");