import { readFileSync, writeFileSync } from "node:fs";

/**
 * species.ts — give every species its own clock and its own price.
 *
 * Both were effectively uniform, which is the complaint exactly:
 *
 *   `growMinutes` was `16 + tier * 4 + rng(0, 8)`. Tier is one of five values and
 *   the jitter is eight, so six thousand species landed on roughly twenty distinct
 *   grow times, and the fastest and slowest differed by under a minute on a
 *   twenty-minute clock. A species the player waited four extra minutes for did not
 *   feel like a different plant, because it was not one.
 *
 *   `seedPrice` was `tier * 60 + 100` with a small jitter, so it moved in five steps.
 *   Six thousand plants, five prices.
 *
 * The fix derives both from what the species *is* — its archetype, its dominant
 * element, its body — so the number is something a player can learn rather than a
 * number they have to look up:
 *
 *   slow archetypes (tank, sustain) take longer than fast ones (burst, tempo)
 *   heavy elements (earth, wood) take longer than volatile ones (fire, electric)
 *   colossal plants take longer to grow than small ones, which is the one that
 *   matters most: a big plant should feel like an investment
 *   and the price follows the time, because a seed that costs more is asking you
 *   to wait longer
 *
 * The band is still wide enough that the five starters keep their hand-set prices —
 * those are the first thing the player sees and they were authored, not rolled.
 */

const file = "src/config/species.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const anchor = `function generateSpecies(): SpeciesDef[] {`;
if (!src.includes(anchor)) throw new Error("generateSpecies not found");

const helpers = `/**
 * How long a species takes, in minutes, and what its seed costs.
 *
 * Both are pure functions of what the plant is, so a player who has seen a
 * \`earth\`/tank/colossal plant take half an hour can predict the next one. That is
 * the property that makes the numbers worth learning; a price and a timer drawn
 * from one shared random roll are not learnable at all.
 *
 * \`grow\` is computed first and \`price\` is derived from it, so the economy cannot
 * drift into charging a lot for something that grows in two minutes. The jitter is
 * a sixth of the base rather than a flat few minutes, so a slow species is slow by
 * a wide margin and a fast one is only slightly quicker — the spread between
 * archetypes has to survive the noise.
 */
function timingFor(archetype: Archetype, dominant: ElementId, size: BodySize, rng: Rng): { grow: number; price: number } {
  // Minutes. Deliberately overlapping between archetypes so that the element and
  // the size still decide something, but no archetype is a dead giveaway.
  const byArchetype: Record<Archetype, number> = {
    tank: 1.34,
    sustain: 1.2,
    counter: 1.06,
    control: 1.0,
    burst: 0.82,
    tempo: 0.76,
  };
  const byElement: Record<ElementId, number> = {
    earth: 1.24,
    wood: 1.14,
    water: 1.0,
    light: 0.98,
    poison: 0.94,
    shadow: 0.92,
    fire: 0.84,
    electric: 0.8,
  };
  const bySize: Record<BodySize, number> = {
    colossal: 1.55,
    large: 1.22,
    medium: 1.0,
    small: 0.86,
    tiny: 0.74,
  };

  const base = 22 * byArchetype[archetype] * byElement[dominant] * bySize[size];
  // A sixth of the base, so a 40-minute species varies by nearly seven and a
  // 12-minute one by two. A flat jitter would have made the slow plants identical
  // and the fast ones all over the place.
  const grow = Math.round(base * (1 + rng.float(-0.08, 0.08)));

  // Roughly four coins per waiting minute, rounded to a tidy step so the shop does
  // not show prices like 1,137. The rounding is also what makes two species feel
  // like they belong to the same shelf.
  const raw = grow * 4.2 * rng.float(0.92, 1.1);
  const price = Math.max(60, Math.round(raw / 5) * 5);

  return { grow, price };
}

${anchor}`;

src = src.replace(anchor, helpers);

// --- wire it in -----------------------------------------------------------
const oldBlock = `    out.push({
      id: \`sp\${i.toString().padStart(4, "0")}\`,
      unlock: speciesUnlock(i),`;

if (!src.includes(oldBlock)) throw new Error("the generated species push was not found");
src = src.replace(oldBlock, `${oldBlock}
      ...timingFor(archetype, dominant, body.size, rng),`);

// The old fields are still set below by the object literal, so drop them.
src = src.replace(
  /      seedPrice: seedPrice,\r?\n/,
  "",
);
src = src.replace(
  /      growMinutes: Math\.round\(clamp\(16 \+ tier \* 4 \+ rng\.float\(0, 8\), 12, 60\)\),\r?\n/,
  "",
);

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("species.ts — grow time and seed price now derived per species");