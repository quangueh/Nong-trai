/**
 * Telling two plants apart when they are called the same thing.
 *
 * Names are generated as a species name plus one of four suffixes, so a garden holding
 * several plants of one species regularly ends up with "Rễ Gai hạt" twice. In a game
 * whose core loop is breeding, that is worse than cosmetic: the sheet for choosing a
 * fighter lists plants side by side, and the breeding parents are picked from a list of
 * the same. Two rows reading identically, differing by a couple of power points, cannot
 * be chosen between on purpose - and breeding destroys both parents, so a mis-pick costs
 * the player the plant they meant to keep.
 *
 * So a name is qualified, but only when it has to be. With one plant of a name the string
 * is returned untouched, so every screen, every test and every existing save behave
 * exactly as before for the overwhelming majority of plants. Nothing changes until there
 * is a genuine ambiguity to resolve.
 *
 * When several share a name, each gets a Roman numeral: "Rễ Gai hạt I", "Rễ Gai hạt II".
 * Every one of them is numbered, including the first. Numbering only the second and
 * later would read more prettily in isolation, but it means the first plant's label
 * silently changes the moment a second one is born - and this game already takes both
 * parents at breeding, so "a label changed while you were not looking" is not a
 * reassuring property.
 *
 * The numeral is keyed off `plantId` rather than array position, so it does not shuffle
 * when the garden is sorted, filtered or reloaded.
 *
 * **Resolve against the whole garden, not the subset on screen.** Callers are tempted to
 * pass the list they happen to be rendering, and that is how a plant ends up called
 * "Rễ Gai hạt" in the shop and "Rễ Gai hạt II" in the arena - because its twin happens
 * to be immature, or filtered out, or on another tab. A name that means different things
 * in two places in the same game is worse than a name that is merely ambiguous, so every
 * caller passes `store.state.plants`. The parameter stays general because the function
 * has no business knowing what a store is.
 */

import type { Plant } from "./types";

/** Uppercase and trimmed, so "Rễ Gai hạt" and "rễ gai hạt" are recognised as one name. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The numerals, in the order they are handed out.
 *
 * Twenty covers any realistic garden. Past that it falls back to decimal rather than to
 * an empty string, because an unlabelled duplicate is exactly the case this exists for.
 */
const NUMERALS = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
];

function numeralFor(index: number): string {
  return NUMERALS[index] ?? String(index + 1);
}

/**
 * The name to print for this plant among these plants.
 *
 * @param plant  the plant being named
 * @param roster every plant it will be listed beside, including `plant` itself
 */
export function plantDisplayName(plant: Plant, roster: readonly Plant[]): string {
  const key = nameKey(plant.name);
  const twins = roster.filter((p) => nameKey(p.name) === key);

  // The common case, and the only case that matters until the player has bred: the name
  // is already unambiguous, so it is printed exactly as stored.
  if (twins.length < 2) return plant.name;

  // Ordered by id, so the same plant keeps the same numeral every time this is called.
  const ordered = twins.slice().sort((a, b) => (a.plantId < b.plantId ? -1 : a.plantId > b.plantId ? 1 : 0));
  const at = ordered.findIndex((p) => p.plantId === plant.plantId);

  // Not in the roster it was given. Falling back to a numeral is still better than
  // silently printing an ambiguous name, and it can only happen from a caller bug.
  return `${plant.name} ${numeralFor(at < 0 ? 0 : at)}`;
}

/**
 * Whether this plant shares its name with another.
 *
 * Worth knowing separately from the resolved name: a screen that wants to warn a player
 * before breeding two identical names needs the fact, not the string.
 */
export function nameIsAmbiguous(plant: Plant, roster: readonly Plant[]): boolean {
  const key = nameKey(plant.name);
  let seen = 0;
  for (const p of roster) if (nameKey(p.name) === key) seen++;
  return seen > 1;
}
