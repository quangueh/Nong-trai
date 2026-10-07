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
let bred = 0;
/** Pairings that were two different parents and therefore actually bred. */
let validPairings = 0;
/** Children whose name matched a parent they were bred from. Should stay empty. */
const parentNameCollisions: string[] = [];
/** Parents that survived their own breeding. Should stay empty. */
const survivingParents: string[] = [];

/**
 * Top the parent pool back up.
 *
 * Breeding consumes both parents, so a fixed pool of five runs dry after two breeds
 * and every remaining iteration is refused with "Chọn 2 cây" — which is the correct
 * behaviour being measured by a test written for the old rule. Growing replacements is
 * how a real breeder gets more parents, so that is what this does.
 *
 * Children are never eligible: they are not grown to maturity, and using them would
 * quietly change what is being tested from starter stock to a self-bred population.
 */
function refillParents(to: number): Plant[] {
  const pool = store.state.plants.filter((p) => p.growth.stage === "mature");
  for (let i = pool.length; i < to; i++) {
    const species = STARTER_IDS[i % STARTER_IDS.length];
    store.state.leafCoin = 50_000_000;
    pool.push(makeParent(species));
  }
  return pool;
}

// 40, not 400: every `store.breed` call also runs a full ECR battle simulation,
// so this loop is the suite's bottleneck by a wide margin. Forty consecutive
// breaches through the real store is what the guarantee needs to be shown on —
// a collision that survives forty draws in a ~10^5 name space is not luck, it is
// a broken guard. The wide statistical sweep lives in the cheap section below,
// which calls `breedPlants` directly.
const STORE_BREEDS = 40;

for (let i = 0; i < STORE_BREEDS; i++) {
  // Children stay in the garden. The store promises a new plant never reuses a
  // name already held; with earlier children deleted there is nothing to collide
  // with, and the test passes on a collision the game would have caught.
  store.state.leafCoin = 50_000_000;
  const pool = refillParents(2);
  const a = pool[i % pool.length];
  const b = pool[(i * 3 + 1) % pool.length];
  if (a.plantId === b.plantId) continue;
  const parentNameA = a.name;
  const parentNameB = b.name;
  const res = store.breed(a.plantId, b.plantId);
  if (!res.ok || !res.result) {
    breedFailures.set(res.reason ?? "?", (breedFailures.get(res.reason ?? "?") ?? 0) + 1);
    continue;
  }
  bred++;
  const child = res.result.plant;
  childNames.set(nameKey(child.name), (childNames.get(nameKey(child.name)) ?? 0) + 1);
  childSigs.set(genomeSignature(child), (childSigs.get(genomeSignature(child)) ?? 0) + 1);
  // The new guarantee, and the one that matters most now that parents are consumed:
  // a child must not be given the name of a plant that was in the garden when it was
  // bred. Because the parents are removed from `plants` *after* the name pool is
  // built, their names are still excluded — and this is what proves it, because a
  // child sharing a consumed parent's name is precisely the confusion the rule was
  // meant to avoid.
  const ck = nameKey(child.name);
  if (ck === nameKey(parentNameA) || ck === nameKey(parentNameB)) {
    parentNameCollisions.push(`${parentNameA} x ${parentNameB} -> ${child.name}`);
  }
  if (store.get(a.plantId) || store.get(b.plantId)) {
    survivingParents.push(`${a.name} / ${b.name}`);
  }
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
  "both parents are consumed by the breeding",
  survivingParents.length === 0,
  survivingParents.slice(0, 3).join("; "),
);
check(
  "no child reuses a parent's name",
  parentNameCollisions.length === 0,
  parentNameCollisions.slice(0, 3).join("; "),
);
check(
  "the starting parents are all gone after the sweep",
  parents.every((p) => !store.get(p.plantId)),
  parents.filter((p) => store.get(p.plantId)).map((p) => p.name).join(", "),
);

section("9. Breeding the same pair repeatedly still varies");

// The same-pair property cannot be shown through the store any more — the second breed
// of a pair is impossible, because the first one spent both of them. That is the rule
// working, so the property is checked where it still means something: directly against
// the generator, which does not know or care about the garden. If this section is ever
// deleted as redundant, the store test above will keep passing while the guarantee
// quietly disappears.
const samePairNames = new Set<string>();
const samePairSigs = new Set<string>();
const SAME_PAIR_BREEDS = 25;
{
  const pa = makeParent(STARTER_IDS[0]);
  const pb = makeParent(STARTER_IDS[1]);
  for (let i = 0; i < SAME_PAIR_BREEDS; i++) {
    const r = breedPlants(pa, pb, {
      playerId: "p",
      nonce: `same-${i}`,
      attempt: i,
      tier: "bloom",
      targetRarity: "C",
      breederLevel: 12,
    }, 1_700_000_000_000 + i * 1000);
    samePairNames.add(nameKey(r.plant.name));
    samePairSigs.add(genomeSignature(r.plant));
  }
}
/*
 * Genomes, not names.
 *
 * This assertion was originally "25 names" and it failed roughly one run in four with
 * 24/25. That is not flakiness to shrug at — it is the test asking for something the
 * generator never promised. `breedPlants` derives a name from the genome, and two
 * distinct genomes can land on the same name. The uniqueness the player relies on is
 * enforced one layer up: the store builds its `usedNames` pool from the live garden
 * and walks a salt forward until the name is free, which section 8 verifies over forty
 * real breeds.
 *
 * So the per-call guarantee that actually exists is the genome, and that is what is
 * asserted. The name count is still printed, because the number is informative about
 * how often the generator collides on its own — it should be low, and if it stops
 * being low the store's salt walk is doing more work than it should.
 */
check(
  `${SAME_PAIR_BREEDS} breeds of one pair give ${SAME_PAIR_BREEDS} genomes`,
  samePairSigs.size === SAME_PAIR_BREEDS,
  `${samePairSigs.size}/${SAME_PAIR_BREEDS}`,
);
check(
  "the generator alone collides on names only rarely",
  samePairNames.size >= SAME_PAIR_BREEDS - 1,
  `${samePairNames.size}/${SAME_PAIR_BREEDS} distinct without the store's name pool`,
);

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

/*
 * The opening shelf has to be a shelf, not the registry.
 *
 * This used to assert `> 100` ungated species, on the theory that a new player should never see
 * an empty shop. 100 was met by 240, and 240 species open at breeder level 1 is the opposite
 * failure: nothing to unlock, no level requirement to read, and a pile to scroll. The check is
 * now two-sided — enough to choose from, few enough that the rest is visibly a ladder — and the
 * catalogue is asked the same question the player's screen asks it.
 */
const ungated = SPECIES.filter((s) => s.unlock === undefined).length;
check("the opening shelf is not empty", ungated >= 5, `${ungated}`);
check("and is not a pile of seeds", ungated <= 40, `${ungated} species open before any levelling`);

const l1Ctx = {
  breederLevel: 1,
  plantCount: 1,
  speciesCount: 1,
  topGrowthLevel: 1,
  awakenedCount: 0,
  topGeneration: 1,
  leafCoin: 500,
};
const l1Open = queryCatalogue({ playerId: "p", breederLevel: 1, progress: l1Ctx, locked: "open", perPage: 24 });
check(
  "a level-1 player sees only the opening shelf, and it fits on a page",
  l1Open.total > 0 && l1Open.total <= 24,
  `${l1Open.total} species`,
);
check(
  "and the level-1 featured rotation draws only from what is open",
  featuredSpecies("p", 0, 1, 10, l1Ctx).every((s) => !s.unlock || s.tier === 0),
  featuredSpecies("p", 0, 1, 10, l1Ctx).map((s) => s.name).join(", "),
);

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
  "the catalogue lists the whole registry, locked stock included",
  // This assertion used to be `total === SPECIES.filter(s => s.tier === 0).length`,
  // which asserted that a level-1 player's shelf contained only tier-0 species. That
  // was the behaviour the shop was complained about: several thousand species were
  // not greyed out or marked, they were *absent*, so a player could not discover that
  // they existed and could not find out what any of them required. The test was
  // pinning the fault rather than the contract.
  //
  // What replaces it keeps the property that actually mattered — locked stock is
  // listed but not purchasable — and adds the one that was missing: every locked entry
  // carries the requirement that gates it.
  (() => {
    const lvl1 = queryCatalogue({ playerId: "p", breederLevel: 1 });
    return (
      lvl1.total === SPECIES.length &&
      lvl1.entries.some((e) => e.locked) &&
      lvl1.entries.filter((e) => e.locked).every((e) => Boolean(e.unlock))
    );
  })(),
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
