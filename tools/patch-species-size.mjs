import { readFileSync, writeFileSync } from "node:fs";

/**
 * Follow-up: the size band has to come from somewhere real.
 *
 * The first attempt read `body.size`, but `generateSpecies` has no `body` — it
 * builds a `statBias` record rather than a full body, and there is no `BodySize`
 * type in the project at all (the size union lives on `VisualGenes`).
 *
 * So the size is derived from the bulk the species already carries. Which is
 * better than rolling it: a plant with a lot of health *is* a big plant, so the
 * number agrees with what the player sees on the card, and a player who notices
 * that big plants take longer can predict the next one. A random size would have
 * contradicted the stats often enough to be noticed.
 */

const file = "src/config/species.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

// --- type the size union off the real declaration -------------------------
const swaps = [
  ['function timingFor(archetype: Archetype, dominant: ElementId, size: BodySize, rng: Rng)',
   'function timingFor(archetype: Archetype, dominant: ElementId, size: SpeciesSize, rng: Rng)'],
  ['const bySize: Record<BodySize, number> = {', 'const bySize: Record<SpeciesSize, number> = {'],
  ['    medium: 1.0,', '    normal: 1.0,'],
  ['...timingFor(archetype, dominant, body.size, rng),', '...timingFor(archetype, dominant, sizeFor(statBias), rng),'],
];
for (const [needle, next] of swaps) {
  if (!src.includes(needle)) throw new Error(`needle not found: ${needle.slice(0, 80)}`);
  src = src.replace(needle, next);
}

// --- add the size union ----------------------------------------------------
const declAnchor = "function sizeFor(";
src = src.replace(
  declAnchor,
  `/**
 * The five size bands, spelled out here so the species generator does not have to
 * reach into the plant module for a type it only reads.
 */
export type SpeciesSize = "tiny" | "small" | "normal" | "large" | "colossal";

${declAnchor}`,
);
// --- add the derivation ----------------------------------------------------
const timingAnchor = "/**\n * How long a species takes, in minutes, and what its seed costs.";
if (!src.includes(timingAnchor)) throw new Error("timingFor doc comment not found");

src = src.replace(
  timingAnchor,
  [
    "/**",
    " * The size band a species falls into, read off its own stats.",
    " *",
    " * Derived rather than rolled so it cannot contradict the card: a plant with a lot",
    " * of health *is* a big plant, and if the two disagreed a player would eventually",
    " * meet a tiny-looking plant that took forty minutes and rightly stop trusting the",
    " * whole schedule.",
    " */",
    'function sizeFor(statBias: Partial<Record<StatGeneId, number>>): SpeciesSize {',
    '  const bulk = (statBias.hp ?? 0.5) * 0.6 + (statBias.defense ?? 0.5) * 0.4;',
    '  if (bulk >= 0.82) return "colossal";',
    '  if (bulk >= 0.66) return "large";',
    '  if (bulk >= 0.44) return "normal";',
    '  if (bulk >= 0.3) return "small";',
    '  return "tiny";',
    "}",
    "",
    timingAnchor,
  ].join("\n"),
);

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("species.ts — size band derived from stat bulk");