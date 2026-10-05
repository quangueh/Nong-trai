import { readFileSync, writeFileSync } from "node:fs";

/** Drop the plot-grass nodes; the CSS rule they matched is already gone. */

const patches = [
  {
    file: "src/ui/screens/plotCard.ts",
    needle: `  // Grass breaking the bed's edge. First child so it paints under the plant
  // and its labels, and above the soil fill.
  card.appendChild(el("div", { class: "plot-grass", "aria-hidden": "true" }));

`,
  },
  {
    file: "src/ui/screens/garden.ts",
    needle: `  // Same fringe as a planted bed, so an empty bed is soil waiting to be planted
  // rather than a different kind of tile.
  plot.appendChild(el("div", { class: "plot-grass", "aria-hidden": "true" }));
`,
  },
];

for (const { file, needle } of patches) {
  const original = readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let src = original.replace(/\r\n/g, "\n");
  if (!src.includes(needle)) throw new Error(`${file}: needle not found`);
  src = src.replace(needle, "");
  writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
}
console.log("plot-grass nodes removed");