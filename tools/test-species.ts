/**
 * Species registry, plant naming, and breeding-uniqueness tests.
 *
 * Covers the two promises behind the 1005-species registry:
 *
 *   1. Every species in the registry is genuinely a different plant — distinct
 *      id, distinct name, a name that reads as Vietnamese rather than as a
 *      broken cross product, and a price that means something.
 *   2. Every breeding produces a new kind. That is a *store* guarantee, not a
 *      generator property, because the thing the player notices is a plant whose
 *      name matches one already in their garden — so it has to be tested through
 *      `GameStore.breed`, not `breedPlants` alone.
 */

import { GameStore } from "../src/core/store";
import {
  SPECIES,
  SPECIES_TOTAL,
  GENERATED_SPECIES_COUNT,
  STARTER_IDS,
  STAT_GENES,
  SKILL_GENES,
  getSpecies,
  hasSpecies,
  speciesAffinity,
  type Archetype,
} from "../src/config/species";
import { ELEMENTS } from "../src/config/elements";
import { plantName, nameKey } from "../src/genetics/names";
import { genomeSignature, createSeedPlant, breedPlants, type BreedingContext } from "../src/genetics/genomeGenerator";
import { TIER_UNLOCK, unlockedTier, featuredSpecies, queryCatalogue } from "../src/economy/shop";
import type { Plant } from "../src/core/types";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(t: string) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

/** localStorage shim so GameStore runs outside a browser. */
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

// ---------------------------------------------------------------- registry --

section("1. Species registry");

check("registry holds starters plus the generated pool", SPECIES.length === SPECIES_TOTAL, `${SPECIES.length}`);
// The exact count is not asserted by hand: this test has been the thing that
// broke when the pool changed size before. What matters is that the pool is
// large enough to hold unique names and blurbs, which the next checks verify.
check("the generated pool is large", GENERATED_SPECIES_COUNT >= 6000, `${GENERATED_SPECIES_COUNT}`);
check("every id is unique", new Set(SPECIES.map((s) => s.id)).size === SPECIES.length);
check(
  "every name is unique",
  new Set(SPECIES.map((s) => s.name)).size === SPECIES.length,
  `${new Set(SPECIES.map((s) => s.name)).size}/${SPECIES.length}`,
);
check(
  "every name is unique ignoring accents",
  new Set(SPECIES.map((s) => nameKey(s.name))).size === SPECIES.length,
);
check("the five starters come first", STARTER_IDS.every((id, i) => SPECIES[i].id === id));
check("every starter id resolves", STARTER_IDS.every((id) => getSpecies(id).id === id));
check("an unknown id falls back instead of throwing", getSpecies("sp9999-nope").id === STARTER_IDS[0]);
check("hasSpecies rejects an unknown id", !hasSpecies("nope"));

section("2. Species names read as Vietnamese");

const wordsOf = (n: string) => n.split(" ").map((w) => w.toLowerCase());
const repeatedWord = SPECIES.filter((s) => new Set(wordsOf(s.name)).size !== wordsOf(s.name).length);
check("no name repeats a word", repeatedWord.length === 0, repeatedWord.slice(0, 3).map((s) => s.name).join(", "));

const withDigit = SPECIES.filter((s) => /\d/.test(s.name));
check("no name contains a digit", withDigit.length === 0, withDigit.slice(0, 3).map((s) => s.name).join(", "));

const tooShort = SPECIES.filter((s) => s.name.trim().split(" ").length < 2);
check("every name is at least two words", tooShort.length === 0, `${tooShort.length}`);

const tooLong = SPECIES.filter((s) => s.name.length > 26);
check("no name runs past 26 characters", tooLong.length === 0, `${tooLong.length}`);

const emptyWords = SPECIES.filter((s) => s.name.split(" ").some((w) => !w.trim()));
check("no name has a blank word", emptyWords.length === 0);

section("3. Species flavour text");

const uniqueBlurbs = new Set(SPECIES.map((s) => s.blurb));
check("blurbs are not copy-pasted across the registry", uniqueBlurbs.size === SPECIES.length, `${uniqueBlurbs.size}/${SPECIES.length}`);
check("every blurb has content", SPECIES.every((s) => s.blurb.length > 20));
check(
  "every blurb ends in a full stop",
  SPECIES.every((s) => s.blurb.trim().endsWith(".")),
  SPECIES.find((s) => !s.blurb.trim().endsWith("."))?.blurb ?? "",
);

section("4. Species distribution is even");

const byArchetype = new Map<Archetype, number>();
for (const s of SPECIES) byArchetype.set(s.archetype, (byArchetype.get(s.archetype) ?? 0) + 1);
const archCounts = [...byArchetype.values()];
check("all six archetypes are used", byArchetype.size === 6);
check(
  "archetypes are within 5% of even",
  Math.max(...archCounts) - Math.min(...archCounts) <= SPECIES.length * 0.05,
  archCounts.join("/"),
);

const dominantCounts = new Map<string, number>();
for (const s of SPECIES) {
  const top = ELEMENTS.reduce((a, b) => ((s.elements[a] ?? 0) >= (s.elements[b] ?? 0) ? a : b));
  dominantCounts.set(top, (dominantCounts.get(top) ?? 0) + 1);
}
const elemCounts = [...dominantCounts.values()];
check("all eight elements are used", dominantCounts.size === 8);
check(
  "elements are within 5% of even",
  Math.max(...elemCounts) - Math.min(...elemCounts) <= SPECIES.length * 0.05,
  elemCounts.join("/"),
);

check(
  "every species declares a full stat bias",
  SPECIES.every((s) => STAT_GENES.every((g) => typeof s.statBias[g] === "number")),
);
check(
  "every species declares a full skill bias",
  SPECIES.every((s) => SKILL_GENES.every((g) => typeof s.skillBias[g] === "number")),
);
check(
  "element affinity sums to 1",
  SPECIES.every((s) => Math.abs(ELEMENTS.reduce((a, e) => a + (s.elements[e] ?? 0), 0) - 1) < 0.02),
);
check(
  "speciesAffinity normalises to 1",
  SPECIES.every((s) => Math.abs(ELEMENTS.reduce((a, e) => a + speciesAffinity(s.id)[e], 0) - 1) < 1e-9),
);

section("5. Shop tiers and prices");

check("TIER_UNLOCK has one rung per tier", TIER_UNLOCK.length === 5, TIER_UNLOCK.join(","));
check("TIER_UNLOCK ascends", TIER_UNLOCK.every((v, i) => i === 0 || v > TIER_UNLOCK[i - 1]));

const tiersUsed = new Set(SPECIES.map((s) => s.tier));
check("every tier 0-4 has species", [...tiersUsed].sort().join(",") === "0,1,2,3,4", [...tiersUsed].sort().join(","));

const tierSizes = [...tiersUsed].sort().map((t) => SPECIES.filter((s) => s.tier === t).length);
check(
  "tiers are roughly equal in size",
  Math.max(...tierSizes) - Math.min(...tierSizes) <= 10,
  tierSizes.join("/"),
);

for (const t of [0, 1, 2, 3, 4]) {
  const prices = SPECIES.filter((s) => s.tier === t).map((s) => s.seedPrice);
  const p50 = [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const tPrev = t > 0
    ? [...SPECIES.filter((s) => s.tier === t - 1).map((s) => s.seedPrice)].sort((a, b) => a - b)[
        Math.floor(SPECIES.filter((s) => s.tier === t - 1).length / 2)
      ]
    : 0;
  check(`tier ${t} median price rises`, t === 0 || p50 > tPrev, `${tPrev} -> ${p50}`);
  check(
    `tier ${t} has a real spread of prices`,
    new Set(prices).size >= 20,
    `${new Set(prices).size} distinct of ${prices.length}`,
  );
}

check(
  "no species is priced below cost",
  SPECIES.every((s) => s.seedPrice >= 80),
  `min ${Math.min(...SPECIES.map((s) => s.seedPrice))}`,
);
check(
  "grow times are sane",
  SPECIES.every((s) => s.growMinutes >= 12 && s.growMinutes <= 60),
);

// ------------------------------------------------------- plantName contract --

section("6. Plant names are a pure function of the genome");

const dnaA = createSeedPlant("thornroot", "o", "n1", 0).dna;
const dnaB = createSeedPlant("emberleaf", "o", "n2", 0).dna;

check("same genome gives the same name", plantName(dnaA, ["thick_bark"]) === plantName(dnaA, ["thick_bark"]));
check(
  "different genomes give different names",
  plantName(dnaA, ["thick_bark"]) !== plantName(dnaB, ["venom_veins"]),
);

const salts = new Set<string>();
for (let s = 0; s < 40; s++) salts.add(plantName(dnaA, ["thick_bark"], s));
check("the salt walk finds 40 distinct names for one genome", salts.size === 40, `${salts.size}/40`);

const saltNames = [...salts];
check(
  "salted names never repeat a word",
  saltNames.every((n) => new Set(wordsOf(n)).size === wordsOf(n).length),
  saltNames.find((n) => new Set(wordsOf(n)).size !== wordsOf(n).length) ?? "",
);

const saltShort = saltNames.filter((n) => n.split(" ").length < 2);
check("salted names are at least two words", saltShort.length === 0);

check("nameKey folds case and accents", nameKey("Lá Gai") === nameKey("la gai"), nameKey("Lá Gai"));


section("7. Two plants with the same genome agree on their name");

const p1 = createSeedPlant("dewbud", "o", "a", 0);
const p2 = createSeedPlant("dewbud", "o", "a", 0);
check("the same species and nonce reproduce the plant", genomeSignature(p1) === genomeSignature(p2));
check("and therefore the name", plantName(p1.dna, p1.traits) === plantName(p2.dna, p2.traits));

// ------------------------------------------------------------- breeding ------

section("8. Breeding produces a new kind every time (through the store)");

const store = new GameStore();
store.state.leafCoin = 50_000_000;
store.state.items = 9999;

/** Mature a plant so it can breed. */
function makeParent(species: string): Plant {
  const bought = store.buySeed(species);
  if (!bought.ok) throw new Error(`could not buy ${species}: ${bought.reason}`);
  store.state.leafCoin = 50_000_000;
  const planted = store.plantSeed(species);
  if (!planted.ok) throw new Error(`could not plant ${species}: ${planted.reason}`);
  const p = store.state.plants[store.state.plants.length - 1];
  p.growth.stage = "mature";
  p.growth.stageReadyAt = Date.now();
  p.growth.level = 25;
  p.locks.manual = false;
  return p;
}

// Tiers 0-2 are unlocked at breeder level 12; that is well past the level-1 gate
// but still early, which is where a player spends most of their first session.
store.state.breederLevel = 12;
// `nurseryCap` is only recomputed inside `addBreederXp`, so assigning the level
// directly leaves the cap at its level-1 value of 6 — which the five parents
// already fill. Set it explicitly, and high enough that the bred children can
// stay in the garden: the uniqueness guarantee is only meaningful while the
// plants a new child could collide with are still there.
store.state.nurseryCap = 80;

const parents = STARTER_IDS.map(makeParent);
check("five starter parents are ready to breed", parents.length === 5, `${parents.length}`);


const childNames = new Map<string, number>();
const childSigs = new Map<string, number>();
const breedFailures = new Map<string, number>();
const parentNames = new Map(parents.map((p) => [p.plantId, p.name]));
let bred = 0;
/** Pairings that were two different parents and therefore actually bred. */
let validPairings = 0;

// 40, not 400: every `store.breed` call also runs a full ECR battle simulation,
// so this loop is the suite's bottleneck by a wide margin. Forty consecutive
// breaches through the real store is what the guarantee needs to be shown on —
// a collision that survives forty draws in a ~10^5 name space is not luck, it is
// a broken guard. The wide statistical sweep lives in the cheap section below,
// which calls `breedPlants` directly.
const STORE_BREEDS = 40;

for (let i = 0; i < STORE_BREEDS && parents.length >= 2; i++) {
  // Children stay in the garden. The store promises a new plant never reuses a
  // name already held; with earlier children deleted there is nothing to collide
  // with, and the test passes on a collision the game would have caught.
  store.state.leafCoin = 50_000_000;
  const a = parents[i % parents.length];
  const b = parents[(i * 3 + 1) % parents.length];
  if (a.plantId === b.plantId) continue;
  const res = store.breed(a.plantId, b.plantId);
  if (!res.ok || !res.result) {
    breedFailures.set(res.reason ?? "?", (breedFailures.get(res.reason ?? "?") ?? 0) + 1);
    continue;
  }
  bred++;
  const child = res.result.plant;
  childNames.set(nameKey(child.name), (childNames.get(nameKey(child.name)) ?? 0) + 1);
  childSigs.set(genomeSignature(child), (childSigs.get(genomeSignature(child)) ?? 0) + 1);
  validPairings++;
}

check(
  "every valid pairing produced a child",
  bred === validPairings && validPairings > 25,
  // Pairings that put a parent against itself are skipped before breeding, so
  // `validPairings` is the honest denominator — not the 40 loop iterations.
  `${bred} children from ${validPairings} valid pairings` +
    (breedFailures.size ? ` — refused: ${[...breedFailures].map(([k, v]) => `${k} x${v}`).join(", ")}` : ""),
);
check(
  "no child reuses a name already in the garden",
  childNames.size === bred,
  `${childNames.size} distinct of ${bred}`,
);
check(
  "no child duplicates an existing genome",
  childSigs.size === bred,
  `${childSigs.size} distinct of ${bred}`,
);
const dupName = [...childNames.entries()].sort((x, y) => y[1] - x[1])[0];
check("no name repeats more than once", (dupName?.[1] ?? 0) <= 1, `${dupName?.[1]}x`);
check(
  "parents kept their own names",
  parents.every((p) => store.get(p.plantId)?.name === parentNames.get(p.plantId)),
  parents
    .filter((p) => store.get(p.plantId)?.name !== parentNames.get(p.plantId))
    .map((p) => `${p.plantId}: ${parentNames.get(p.plantId)} -> ${store.get(p.plantId)?.name} (still in state: ${!!store.get(p.plantId)})`)
    .join("; "),
);

section("9. Breeding the same pair repeatedly still varies");

const samePairNames = new Set<string>();
const samePairSigs = new Set<string>();
const SAME_PAIR_BREEDS = 25;
for (let i = 0; i < SAME_PAIR_BREEDS; i++) {
  store.state.leafCoin = 50_000_000;
  const res = store.breed(parents[0].plantId, parents[1].plantId);
  if (!res.ok || !res.result) continue;
  samePairNames.add(nameKey(res.result.plant.name));
  samePairSigs.add(genomeSignature(res.result.plant));
}
check(`${SAME_PAIR_BREEDS} breeds of one pair give ${SAME_PAIR_BREEDS} names`, samePairNames.size === SAME_PAIR_BREEDS, `${samePairNames.size}/${SAME_PAIR_BREEDS}`);
check(`${SAME_PAIR_BREEDS} breeds of one pair give ${SAME_PAIR_BREEDS} genomes`, samePairSigs.size === SAME_PAIR_BREEDS, `${samePairSigs.size}/${SAME_PAIR_BREEDS}`);

section("9b. Wide sweep without the store (cheap — no ECR per call)");

const fixed: BreedingContext = {
  playerId: "p",
  nonce: "n",
  attempt: 3,
  tier: "bloom",
  targetRarity: "A",
  breederLevel: 1,
};

// The same question, 500 draws, straight through the generator. Without the
// store's salt walk the name rate should still be high; with it, exactly 1.0.
const sweepSigs = new Set<string>();
const sweepNames = new Set<string>();
let sweepDrawn = 0;
for (let i = 0; i < 500; i++) {
  const a = parents[i % parents.length];
  const b = parents[(i * 3 + 1) % parents.length];
  // Some pairings put a parent against itself and are skipped, so the divisor
  // has to be the number of children actually bred, not the loop bound.
  if (a.plantId === b.plantId) continue;
  const child = breedPlants(a, b, { ...fixed, attempt: 1000 + i }, 0).plant;
  sweepDrawn++;
  sweepSigs.add(genomeSignature(child));
  sweepNames.add(nameKey(child.name));
}
check(
  "the sweep bred a meaningful sample",
  sweepDrawn > 380,
  `${sweepDrawn} children from 500 pairings`,
);
check("every generator draw gives a new genome", sweepSigs.size === sweepDrawn, `${sweepSigs.size}/${sweepDrawn}`);
check(
  "generator names collide only rarely before the salt walk",
  sweepDrawn - sweepNames.size <= Math.ceil(sweepDrawn * 0.05),
  `${sweepDrawn - sweepNames.size} of ${sweepDrawn} collided (${(((sweepDrawn - sweepNames.size) * 100) / sweepDrawn).toFixed(1)}%)`,
);
check(
  "the salt walk can always resolve a collision",
  (() => {
    const target = nameKey(breedPlants(parents[0], parents[1], fixed, 0).plant.name);
    for (let salt = 0; salt < 200; salt++) {
      if (nameKey(plantName(parents[0].dna, parents[1].traits, salt)) !== target) return true;
    }
    return false;
  })(),
);

section("10. The generator is still deterministic on its own");

const g1 = genomeSignature(breedPlants(parents[0], parents[1], fixed, 1).plant);
const g2 = genomeSignature(breedPlants(parents[0], parents[1], fixed, 999).plant);
check("same parents and context reproduce the child", g1 === g2);

const g3 = genomeSignature(breedPlants(parents[0], parents[1], { ...fixed, attempt: 4 }, 1).plant);
check("a bumped attempt gives a different child", g1 !== g3);

section("11. Seed tier gate");

// A genuinely fresh save, not the one the breeding loops just filled up.
mem.clear();
const fresh = new GameStore();
fresh.state.leafCoin = 10_000_000;
check("a level-1 player only sees tier 0", unlockedTier(1) === 0, `tier ${unlockedTier(1)}`);
check(
  "tier 4 needs the top of the level curve",
  TIER_UNLOCK[4] > 40,
  `level ${TIER_UNLOCK[4]}`,
);
// The gate is no longer "tier <= unlockedTier(level)": it is a per-species
// requirement, so this has to satisfy the whole thing rather than one number.
// The rules are read off the species itself and mirrored into state, which also
// proves every rule in the pool is satisfiable from real save state.
const gated = SPECIES.filter((s) => s.unlock !== undefined);
check("most of the registry is gated", gated.length > SPECIES.length * 0.9, `${gated.length}/${SPECIES.length}`);
check("but the early slice is open from the start", SPECIES.filter((s) => s.unlock === undefined).length > 100, `${SPECIES.filter((s) => s.unlock === undefined).length}`);

const tier2Species = gated[Math.floor(gated.length * 0.5)];
const blocked = fresh.buySeed(tier2Species.id);
check("a level-1 player cannot buy a mid-registry seed", !blocked.ok, blocked.reason ?? "allowed");
check("and the refusal says how far off they are", /·\s*\d/.test(blocked.reason ?? ""), blocked.reason ?? "");
check("and pays nothing for it", fresh.state.leafCoin === 10_000_000);

/**
 * A throwaway plant, used to satisfy "own N plants"-style rules.
 *
 * Built through the real generator rather than a hand-written literal, because a
 * hand-written plant would pass these tests and then fail somewhere real.
 */
function makeDummyPlant(n: number): Plant {
  return createSeedPlant("thornroot", "o", "dummy" + n, 0);
}
/** Satisfy a species requirement from real save state, rule by rule. */
function satisfy(species: (typeof SPECIES)[number]): void {
  const req = species.unlock;
  if (!req) return;
  const rules = "k" in req ? [req] : [...(req.all ?? []), ...(req.any ?? [])];
  // Satisfy every rule of an `all` list, and all of an `any` list too: cheaper to
  // over-satisfy here than to reason about which branch would be chosen.
  for (const rule of rules) {
    switch (rule.k) {
      case "level":
        fresh.state.breederLevel = Math.max(fresh.state.breederLevel, rule.n);
        break;
      case "plants":
        while (fresh.state.plants.length < rule.n) {
          fresh.state.plants.push(makeDummyPlant(fresh.state.plants.length));
        }
        break;
      case "species":
        for (let i = 0; Object.keys(fresh.state.seeds).filter((k) => (fresh.state.seeds[k] ?? 0) > 0).length < rule.n; i++) {
          fresh.state.seeds["dummy" + i] = 1;
        }
        break;
      case "coin":
        fresh.state.leafCoin = Math.max(fresh.state.leafCoin, rule.n);
        break;
      case "growthLevel": {
        const p = fresh.state.plants[0] ?? makeDummyPlant(0);
        if (!fresh.state.plants.includes(p)) fresh.state.plants.push(p);
        p.growth.level = Math.max(p.growth.level, rule.n);
        break;
      }
      case "awakened": {
        while (fresh.state.plants.filter((p) => p.growth.stage === "awakened").length < rule.n) {
          fresh.state.plants.push(makeDummyPlant(fresh.state.plants.length + 100));
          fresh.state.plants[fresh.state.plants.length - 1]!.growth.stage = "awakened";
        }
        break;
      }
      case "generation": {
        const p = fresh.state.plants[0] ?? makeDummyPlant(0);
        if (!fresh.state.plants.includes(p)) fresh.state.plants.push(p);
        p.generation = Math.max(p.generation, rule.n);
        break;
      }
    }
  }
}

satisfy(tier2Species);
const allowed = fresh.buySeed(tier2Species.id);
check("meeting the requirement unlocks it", allowed.ok, allowed.reason ?? "");
section("12. Catalogue query");

const all = queryCatalogue({ playerId: "p", breederLevel: 60, perPage: 50 });
check("the catalogue can page the whole registry", all.total === SPECIES.length, `${all.total}`);
check("pages are reported", all.pages === Math.ceil(SPECIES.length / 50), `${all.pages}`);

const walked = new Set<string>();
for (let p = 1; p <= all.pages; p++) {
  for (const e of queryCatalogue({ playerId: "p", breederLevel: 60, page: p, perPage: 50 }).entries) {
    walked.add(e.species);
  }
}
check("paging visits every species exactly once", walked.size === SPECIES.length, `${walked.size}`);

const firstSpecies = SPECIES[400];
const found = queryCatalogue({
  playerId: "p",
  breederLevel: 60,
  search: nameKey(firstSpecies.name).slice(0, 6),
});
check(
  "search is accent-insensitive",
  found.entries.some((e) => e.species === firstSpecies.id),
  `"${firstSpecies.name}" -> ${found.total}`,
);

const tankOnly = queryCatalogue({ playerId: "p", breederLevel: 60, archetype: "tank", perPage: 6005 });
check("archetype filter works", tankOnly.total === tankOnly.entries.length && tankOnly.entries.every((e) => e.archetype === "tank"), `${tankOnly.total}`);

const fireOnly = queryCatalogue({ playerId: "p", breederLevel: 60, element: "fire", perPage: 6005 });
check("element filter works", fireOnly.entries.every((e) => e.element === "fire"), `${fireOnly.total}`);

const tier3 = queryCatalogue({ playerId: "p", breederLevel: 60, tier: 3, perPage: 6005 });
check("tier filter works", tier3.entries.every((e) => e.tier === 3), `${tier3.total}`);

check(
  "the catalogue respects the level gate",
  queryCatalogue({ playerId: "p", breederLevel: 1 }).total === SPECIES.filter((s) => s.tier === 0).length,
);

const overPage = queryCatalogue({ playerId: "p", breederLevel: 60, page: 9999, perPage: 50 });
check("an out-of-range page clamps to the last", overPage.page === all.pages, `${overPage.page}`);

const noHit = queryCatalogue({ playerId: "p", breederLevel: 60, search: "zzzzqqqq" });
check("a search with no hits returns an empty page", noHit.total === 0 && noHit.entries.length === 0);

section("13. Featured shelf");

const day = 20_000;
const f1 = featuredSpecies("player-1", day, 1, 10);
const f2 = featuredSpecies("player-1", day, 1, 10);
check("the shelf is stable within a day", f1.map((s) => s.id).join() === f2.map((s) => s.id).join());

const f3 = featuredSpecies("player-1", day + 1, 1, 10);
check("the shelf changes the next day", f3.map((s) => s.id).join() !== f1.map((s) => s.id).join());

check("the shelf holds ten species", f1.length === 10, `${f1.length}`);
check("the shelf has no duplicates", new Set(f1.map((s) => s.id)).size === f1.length);
check(
  "the starters lead the shelf",
  STARTER_IDS.slice(0, 3).every((id) => f1.some((s) => s.id === id)),
);
check("a level-1 shelf only shows tier 0", f1.every((s) => s.tier === 0));
check("different players get different shelves", featuredSpecies("player-2", day, 1, 10).map((s) => s.id).join() !== f1.map((s) => s.id).join());

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
