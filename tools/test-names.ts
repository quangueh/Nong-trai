/**
 * Telling two same-named plants apart.
 *
 * Names are generated as a species name plus one of four suffixes, so a garden with
 * several plants of one species ends up with two rows reading "Rễ Gai hạt". That is
 * harmless in a list and dangerous in the three places the player picks a plant and
 * cannot undo it: breeding (both parents are consumed), selling, and handing a plant to
 * an NPC order.
 *
 * Two properties carry the weight, and they pull against each other:
 *
 *   1. **Nothing changes without a collision.** With one plant of a name the string is
 *      returned untouched, so no save, no screen and no existing assertion moves. A
 *      resolver that always appended an index would be a larger change than the problem
 *      deserves.
 *   2. **The number is stable.** It is keyed off the plant id, not the array order, so it
 *      does not shuffle when the garden is sorted, filtered or reloaded - and it does not
 *      shift because an unrelated plant was sold.
 */

import { GameStore } from "../src/core/store";
import { plantDisplayName, nameIsAmbiguous } from "../src/core/plantNames";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import type { Plant } from "../src/core/types";
import type { SpeciesId } from "../src/config/species";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/** A garden of named plants, without going near the generator's own naming. */
function garden(...names: string[]): Plant[] {
  const s = new GameStore();
  s.state.plants.length = 0;
  const kinds: SpeciesId[] = ["thornroot", "emberleaf", "voltvine", "gloomcap"];
  const made = names.map((n, i) => {
    // Ids are fixed rather than random so the numeral ordering is deterministic.
    const p = createSeedPlant(kinds[i % kinds.length], s.state.playerId, `names-${i}`, 1_700_000_000_000);
    p.plantId = `plant-${String(i).padStart(2, "0")}`;
    p.name = n;
    return p;
  });
  s.state.plants = made;
  return made;
}

/* --- 1. the common case is untouched -------------------------------------- */

const [solo] = garden("Rễ Gai hạt");
check("a lone plant keeps its exact name", plantDisplayName(solo, [solo]) === "Rễ Gai hạt");
check("and is not reported as ambiguous", !nameIsAmbiguous(solo, [solo]));

const distinct = garden("Rễ Gai hạt", "Lá Lửa non", "Búp Sương nhú");
for (const p of distinct) {
  check(`"${p.name}" is left alone among distinct names`, plantDisplayName(p, distinct) === p.name);
}
check("no distinct name is flagged", distinct.every((p) => !nameIsAmbiguous(p, distinct)));

/* --- 2. collisions are resolved ------------------------------------------- */

const twins = garden("Rễ Gai hạt", "Rễ Gai hạt");
check("both twins are numbered", plantDisplayName(twins[0], twins).endsWith(" I") && plantDisplayName(twins[1], twins).endsWith(" II"),
  `${plantDisplayName(twins[0], twins)} / ${plantDisplayName(twins[1], twins)}`);
check(
  "the two resolved names differ",
  plantDisplayName(twins[0], twins) !== plantDisplayName(twins[1], twins),
);
check("both still start with the real name", plantDisplayName(twins[0], twins).startsWith("Rễ Gai hạt"));
check("both are flagged ambiguous", twins.every((p) => nameIsAmbiguous(p, twins)));

const trio = garden("Lá Lửa non", "Lá Lửa non", "Lá Lửa non");
const roman = trio.map((p) => plantDisplayName(p, trio));
check("three of a kind get I, II, III", roman.join("|") === "Lá Lửa non I|Lá Lửa non II|Lá Lửa non III", roman.join("|"));
check("all three are distinct", new Set(roman).size === 3);

/* Only the colliding name is touched. A garden can hold both a unique name and a
   duplicated one, and the unique one must not acquire a numeral it never needed. */
const mixed = garden("Rễ Gai hạt", "Rễ Gai hạt", "Dây Sét nhú");
check("the unique name in a mixed garden is untouched", plantDisplayName(mixed[2], mixed) === "Dây Sét nhú");
check("the duplicates are still resolved", plantDisplayName(mixed[0], mixed) !== plantDisplayName(mixed[1], mixed));

/* Case and stray spaces must not read as different names - the collision is the same
   collision, and two labels that differ only in case are as indistinguishable as two
   that are byte-identical. */
const cased = garden("Rễ Gai hạt", "  rễ gai hạt  ");
check("case and padding do not dodge the resolver", plantDisplayName(cased[0], cased) !== plantDisplayName(cased[1], cased));
check("and neither is left as a bare duplicate", plantDisplayName(cased[0], cased) !== "Rễ Gai hạt");

/* --- 3. the numeral is stable -------------------------------------------- */

const five = garden("Nảy Cọt", "Nảy Cọt", "Nảy Cọt", "Nảy Cọt", "Nảy Cọt");
const first = five.map((p) => plantDisplayName(p, five));

// Reversed, filtered, duplicated in the list: none of that may move a numeral.
const reversed = five.slice().reverse();
check("order in the array does not matter", five.every((p, i) => plantDisplayName(p, reversed) === first[i]),
  `${first.join("|")} vs ${five.map((p) => plantDisplayName(p, reversed)).join("|")}`);

const shuffledIds = [five[3], five[0], five[4], five[2], five[1]];
check("nor does the order it was called in", shuffledIds.every((p) => plantDisplayName(p, five) === first[five.indexOf(p)]));

// A roster that includes plants not in the list, which is the normal case: the caller
// passes the whole garden while the screen shows six of them.
const withExtras = [...five, ...garden("Lá Lửa non")];
check(
  "a larger roster does not renumber anyone",
  five.every((p, i) => plantDisplayName(p, withExtras) === first[i]),
);

/* Selling the first twin is the case where a "first means something" scheme would go
   wrong. Keyed by id, the survivor is now alone, so there is nothing left to distinguish
   it from and the honest label is the bare name again - not "I", which would imply a
   first plant that no longer exists, and not a frozen "II", which would remember a plant
   the player no longer owns. The label describes the garden as it is now. */
const afterSell = [five[1]];
check(
  "a survivor drops back to its bare name once its twin is gone",
  plantDisplayName(five[1], afterSell) === "Nảy Cọt",
  `got ${plantDisplayName(five[1], afterSell)}`,
);
check("and is no longer reported as ambiguous", !nameIsAmbiguous(five[1], afterSell));
check(
  "a survivor is never labelled 'I' on its own",
  plantDisplayName(five[1], afterSell) !== "Nảy Cọt I",
  "that would imply a first plant which is gone",
);

/* --- 4. it survives the real load path ----------------------------------- */

const saved = new GameStore();
saved.state.plants.length = 0;
saved.state.leafCoin = 900;
saved.state.seeds.thornroot = 4;
saved.state.seeds.emberleaf = 4;
saved.plantSeed("thornroot");
saved.plantSeed("thornroot");
saved.plantSeed("emberleaf");
const reloaded = new GameStore();
const roster = reloaded.state.plants;
const rendered = roster.map((p) => plantDisplayName(p, roster));
check("a reloaded garden renders", rendered.length === 3, `got ${rendered.length}`);
check(
  "and every label in it is unique",
  new Set(rendered).size === rendered.length,
  rendered.join(" | "),
);

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
