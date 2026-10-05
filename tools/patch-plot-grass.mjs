import { readFileSync, writeFileSync } from "node:fs";

/**
 * garden.ts + plotCard.ts — every bed gets its grass fringe.
 *
 * Purely decorative, and it is the decoration that does the work: a hard edge
 * between two surfaces reads as "card", and a few blades of grass crossing that
 * edge read as "soil with grass growing around it". Without it the new ground is
 * just a nicer background for the same tiles.
 *
 * One element per plot rather than per plant, so it is added in both the planted
 * and the empty branch — twenty-four beds, all on screen, and a hundred extra
 * nodes would be paid for on every garden render.
 */

const patches = [
  {
    file: "src/ui/screens/plotCard.ts",
    edits: [
      [
        `  // Plot number, same 1-based figure the empty and locked tiles use.`,
        `  // Grass breaking the bed's edge. First child so it paints under the plant
  // and its labels, and above the soil fill.
  card.appendChild(el("div", { class: "plot-grass", "aria-hidden": "true" }));

  // Plot number, same 1-based figure the empty and locked tiles use.`,
      ],
    ],
  },
  {
    file: "src/ui/screens/garden.ts",
    edits: [
      [
        `function emptyPlot(nav: Navigate, index: number): HTMLElement {
  const plot = el("button", { class: "plot empty-plot" });
  plot.append(`,
        `function emptyPlot(nav: Navigate, index: number): HTMLElement {
  const plot = el("button", { class: "plot empty-plot" });
  // Same fringe as a planted bed, so an empty bed is soil waiting to be planted
  // rather than a different kind of tile.
  plot.appendChild(el("div", { class: "plot-grass", "aria-hidden": "true" }));
  plot.append(`,
      ],
    ],
  },
];

for (const { file, edits } of patches) {
  const original = readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let src = original.replace(/\r\n/g, "\n");
  for (const [needle, next] of edits) {
    if (!src.includes(needle)) throw new Error(`${file}: needle not found\n${needle.slice(0, 90)}`);
    src = src.replace(needle, next);
  }
  writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
}
console.log("grass fringe added to planted and empty beds");