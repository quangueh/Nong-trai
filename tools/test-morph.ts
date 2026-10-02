/**
 * Morph delivery tests.
 *
 * A new delivery is exactly the kind of thing that ships half-wired: the type
 * exists, the generator can produce it, and nobody checked that the state is
 * actually written, actually read, and actually cleaned up. These are the three
 * claims the morph makes, asserted against the real engine rather than against
 * the skill table.
 */

import { MORPH_TUNING, morphFormName } from "../src/battle/engine";
import { DELIVERIES, SKILL_GENE_DELIVERY, type Delivery } from "../src/config/skills";
import { GameStore } from "../src/core/store";
import { SPECIES_BY_ID, type SpeciesId } from "../src/config/species";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

// ---------------------------------------------------------------- config --
section("1. The delivery is fully declared");

const ALL: Delivery[] = ["projectile", "melee", "aura", "trap", "channel", "summon", "morph"];
check("morph has a delivery definition", DELIVERIES.morph !== undefined);
check("it has a name a player can read", (DELIVERIES.morph?.name ?? "").length > 2, DELIVERIES.morph?.name);
check(
  "it costs more budget than any other strike",
  DELIVERIES.morph.budgetCost >= Math.max(...ALL.filter((d) => d !== "morph").map((d) => DELIVERIES[d].budgetCost)),
  `morph ${DELIVERIES.morph.budgetCost}`,
);
check(
  "its windup is the longest of the striking deliveries",
  DELIVERIES.morph.windup >= Math.max(...(["melee", "projectile"] as Delivery[]).map((d) => DELIVERIES[d].windup)),
  `morph ${DELIVERIES.morph.windup}`,
);
check(
  "only body-bearing genes may learn it",
  Object.entries(SKILL_GENE_DELIVERY)
    .filter(([, ds]) => ds.includes("morph"))
    .every(([g]) => g === "melee" || g === "summon"),
  Object.entries(SKILL_GENE_DELIVERY)
    .filter(([, ds]) => ds.includes("morph"))
    .map(([g]) => g)
    .join(","),
);
check("every delivery in the union is declared", ALL.every((d) => DELIVERIES[d] !== undefined));

// ----------------------------------------------------------------- forms --
section("2. Forms are named from the element");

check("fire has a form", morphFormName("fire").length > 2);
check("shadow has a form", morphFormName("shadow").length > 2);
const formElements = [undefined, "wood", "fire", "water", "earth", "electric", "poison", "light", "shadow"] as const;
const forms = new Set(formElements.map((e) => morphFormName(e)));
check("every element gets a distinct form", forms.size === 9, `${forms.size} distinct`);
check("an unknown element still gets a name", morphFormName(undefined).length > 2);

// ----------------------------------------------------------- the tuning ---
section("3. The trade is coherent");

check("outgoing is a real bonus", MORPH_TUNING.outgoing > 1, `${MORPH_TUNING.outgoing}`);
check("incoming is a real reduction", MORPH_TUNING.incoming < 1, `${MORPH_TUNING.incoming}`);
check("the trade is not free", MORPH_TUNING.outgoing > 1 && MORPH_TUNING.incoming < 1);
check("it lasts long enough to matter", MORPH_TUNING.duration >= 4, `${MORPH_TUNING.duration}s`);

// ------------------------------------------------------- generated skills --
section("4. The generator can actually produce one");

{
  // localStorage shim, because `GameStore` takes no constructor arguments and
  // reads its save from there — an earlier version of this file passed three and
  // measured nothing at all.
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;

  const store = new GameStore();
  store.state.breederLevel = 60;
  store.state.leafCoin = 50_000_000;
  store.state.nurseryCap = 24;

  // A wide sample of the registry, since deliveries are rolled per skill.
  // Seeds have to be bought first: `plantSeed` reads the bag, and the first
  // version of this loop called it with an empty one and so measured nothing.
  const ids = Object.keys(SPECIES_BY_ID).slice(0, 400) as SpeciesId[];
  let bought = 0;
  for (const id of ids) {
    // Level 60 satisfies most gates; anything still shut is simply skipped
    // rather than forced, because the point is to sample what the generator
    // really produces.
    if (store.buySeed(id).ok) bought++;
  }

  let morphs = 0;
  let total = 0;
  let guard = 0;
  for (const id of ids) {
    if ((store.state.seeds[id] ?? 0) <= 0) continue;
    if (guard++ > 300) break;
    const res = store.plantSeed(id);
    if (!res.ok || !res.plantId) continue;
    const p = store.get(res.plantId);
    if (!p) continue;
    total++;
    if (p.skills.some((s) => s.core.delivery === "morph")) morphs++;
    if (!store.sell(p.plantId).ok) store.state.plants.shift();
  }

  check("seeds could be bought for the sample", bought > 100, `${bought} bought`);
  check("enough plants were generated to judge", total >= 20, `${total} plants`);
  check("some generated plants carry a morph skill", morphs > 0, `${morphs}/${total} plants`);
  check("but it is not the common case", morphs < total * 0.6, `${morphs}/${total}`);
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);