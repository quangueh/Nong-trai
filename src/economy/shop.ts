/** Shop, sell quotes, NPC orders (docs/16). */

import { Rng, clamp, round2 } from "../core/rng";
import type { Plant } from "../core/types";
import { SPECIES, STARTER_IDS, speciesAffinity, type SpeciesId, type SpeciesDef, type Archetype } from "../config/species";
import { dominantElement } from "../config/elements";
import { checkUnlock, type UnlockContext, type UnlockReq } from "../config/unlocks";
import { RARITY_META, type Rarity } from "../config/rarity";
import { canSell } from "../growth/stages";
import { costIn } from "./exchange";

export function sellPrice(plant: Plant, demandMultiplier = 1): number {
  const base = 100;
  const rarityMult = RARITY_META[plant.rarity].sellMult;
  const maturity = plant.growth.stage === "awakened" ? 1.25 : 1.1;
  const care = careQualityMultiplier(plant);
  const novelty = 1.05;
  const ancestry = 1 + Math.min(0.3, plant.generation * 0.03);
  const stability = plant.growthStats.stability > 0.7 ? 1.05 : plant.growthStats.stability < 0.4 ? 0.9 : 1;
  const raw = base * rarityMult * maturity * care * novelty * ancestry * stability * demandMultiplier + plant.economy.investedMaterialValue * 0.15;
  return Math.floor(clamp(raw, 10, RARITY_META[plant.rarity].priceCap));
}

export function careQualityMultiplier(plant: Plant): number {
  const c = plant.careMemory.counts;
  const counts: number[] = Object.values(c) as number[];
  const total = counts.reduce((a, b) => a + b, 0);
  const variety = new Set(Object.keys(c)).size;
  const stressValues: (number | undefined)[] = Object.values(plant.stress);
  const stressTotal = stressValues.reduce<number>((a, b) => a + (b ?? 0), 0);
  const consistency = clamp(total / 20, 0, 1);
  const diversity = clamp(variety / 5, 0, 1);
  const stressControl = clamp(1 - stressTotal / 4, 0, 1);
  const stageTiming = plant.growth.stage === "mature" || plant.growth.stage === "awakened" ? 1 : 0.5;
  const quality = 0.45 * consistency + 0.25 * diversity + 0.2 * stressControl + 0.1 * stageTiming;
  return round2(0.85 + quality * 0.4);
}

export interface ShopEntry {
  species: SpeciesId;
  name: string;
  price: number;
  blurb: string;
  growMinutes: number;
  owned: number;
  archetype: Archetype;
  tier: number;
  element: string;
  /**
   * True when this species cannot be bought yet.
   *
   * Resolved here rather than in the view, because the view has no save state and
   * an unlock rule evaluated in two places is one that eventually disagrees with
   * itself.
   */
  locked: boolean;
  /** The requirement verbatim, so the card prints it instead of describing it. */
  unlock?: UnlockReq;
}

// --- catalogue (docs/16 §21) ------------------------------------------------
//
// The registry holds 1005 species, so it cannot be rendered as a list — that is
// 1005 cards of scrolling. The shop is built from three views over the same
// registry instead:
//
//   featured  a per-player daily rotation, always including the five starters,
//             so a new player is never shown an empty shelf
//   filters   search by name plus tier/element/archetype, paginated
//   owned     whatever the player already has seeds for
//
// Every tier stays gated on breeder level, so 1005 species read as a long-term
// collection to fill rather than 1005 things to buy on day one.

/** Breeder level required to buy seeds at a tier. Breeder level caps at 60. */
export const TIER_UNLOCK: readonly number[] = [1, 8, 18, 30, 45];

/** Highest tier this player's level can reach. */
export function unlockedTier(breederLevel: number): number {
  let best = 0;
  for (let t = 0; t < TIER_UNLOCK.length; t++) {
    if (breederLevel >= TIER_UNLOCK[t]) best = t;
  }
  return best;
}

/** Species the player is allowed to see and buy. */
export function availableSpecies(breederLevel: number): SpeciesDef[] {
  const max = unlockedTier(breederLevel);
  return SPECIES.filter((s) => s.tier <= max);
}

/**
 * Today's featured stock.
 *
 * Seeded on player + day, so it is stable if the player reopens the shop but
 * changes at midnight — the shelf feels alive without any server state.
 * Weighted towards low tiers so the featured row is always affordable.
 */
export function featuredSpecies(
  playerId: string,
  dayIndex: number,
  breederLevel: number,
  count = 10,
  ctx?: UnlockContext,
): SpeciesDef[] {
  const pool = availableSpecies(breederLevel);
  // Do not surface a seed the player cannot actually buy: its unlock rule has already failed.
  const unlockedPool = ctx
    ? pool.filter((s) => !s.unlock || checkUnlock(ctx, s.unlock).met)
    : pool.filter((s) => !s.unlock || (s.unlock && unlockReqAlreadyMet(breederLevel, s.unlock)));
  const rng = new Rng(`featured:${playerId}:${dayIndex}`);

  // The starters lead every rotation: the tutorial needs them, and they are the
  // cheapest seeds, so a fresh save sees a shelf it can actually buy from.
  const out = SPECIES.filter((s) => STARTER_IDS.includes(s.id)).slice(0, 5);
  const rest = unlockedPool.filter((s) => !out.includes(s));

  // `** 1.6` biases the draw towards the front of the pool, and the pool is
  // ordered by tier, so the rotation favours species the player can afford.
  while (out.length < count && rest.length > 0) {
    const idx = Math.floor(rng.next() ** 1.6 * rest.length);
    out.push(rest[idx]);
    rest.splice(idx, 1);
  }
  return out.slice(0, count);
}

/**
 * Whether a level-only unlock is already open at this breeder level.
 *
 * Used as the fallback when no full unlock context is available. Rules that look at plants,
 * species or currency, rather than level, are treated as not yet satisfied so the featured
 * shelf never claims it can be bought when it cannot.
 */
function unlockReqAlreadyMet(breederLevel: number, req: UnlockReq): boolean {
  const { all, any } = req && "k" in req ? { all: [req], any: [] } : { all: req.all ?? [], any: req.any ?? [] };
  const allMet = all.every((r) => r.k === "level" && breederLevel >= r.n);
  const anyMet = any.length === 0 || any.some((r) => r.k === "level" && breederLevel >= r.n);
  return allMet && anyMet && all.every((r) => r.k === "level");
}

export interface CatalogueQuery {
  playerId: string;
  breederLevel: number;
  /**
   * The player's progress, for judging unlock requirements.
   *
   * Supplied by the caller rather than built here: this module is pure, and it has
   * no access to the nursery. Building a context from an empty one would mark every
   * rule that needs plants, seeds or coins as unmet, i.e. the whole registry
   * locked.
   */
  progress?: UnlockContext;
  /**
   * The player's balances, keyed by currency, for `affordableOnly`.
   *
   * Passed in for the same reason `progress` is: this module is pure and has no access to
   * the store. A partial map is fine - a currency that is absent reads as zero, which is
   * the honest reading of "we were not told you hold any of that".
   */
  balances?: Partial<Record<string, number>>;
  search?: string;
  tier?: number | null;
  element?: string | null;
  archetype?: string | null;
  page?: number;
  perPage?: number;
  /**
   * How the shelf is ordered.
   *
   * "default" is the order the registry is meant to be read in: cheapest tier first, and
   * cheapest first within it, so the shelf leads with what a new player can actually buy.
   *
   * The price orders are here rather than in the screen because **the shelf is paginated**.
   * Sorting a page after it has been sliced sorts twenty-four cards in isolation, and the
   * second page then arrives in an order that contradicts the first - which is not a sort at
   * all, it is a shuffle with extra steps.
   */
  sort?: CatalogueSort;
  /**
   * Only species whose price the player can currently pay.
   *
   * Not a filter on `locked`: a species can be unlocked and still unaffordable, and
   * "unlocked" is the wrong word for what a price-ordered shelf actually needs. Reads each
   * balance in the currency that species is *sold* in, which is why it cannot be answered
   * without the multi-currency shop.
   */
  affordableOnly?: boolean;
  /**
   * Which species to show by lock state.
   *
   * In the query rather than the view, because the shelf is paginated: filtering a page after
   * it has been sliced can leave a page with nothing on it while the pager still claims there
   * are more, and the totals stop matching the list.
   */
  locked?: "all" | "open" | "locked";
  /**
   * Show only the species sold in one currency.
   *
   * Exists because the default order leads with tier 0, and the deep currencies never
   * appear there - so a player browsing the shop has no way to learn that Pollen or Ember
   * species exist. Sorting by price did not fix that either: cheapest-first across four currencies
   * is still cheapest-first, and the cheapest card on the shelf may be priced in a
   * currency its reader holds none of. Being able to say "show me the Pollen shelf" is the
   * thing that makes a four-currency shop usable.
   */
  currency?: string | null;
  /**
   * Pin the shelf to exactly one species.
   *
   * Used by the quest deep-link: "Mở giống X" lands here and should show that one
   * card, gate and all, not a name-search that may also match a longer-named species.
   */
  species?: string;
}

/**
 * The orders offered.
 *
 * Named for what they do rather than where they point, so adding one does not mean
 * renumbering the others.
 */
export type CatalogueSort = "default" | "price-asc" | "price-desc";

/** What each order is called on the filter chip. */
export const SORT_LABEL: Record<CatalogueSort, string> = {
  default: "Mặc định",
  "price-asc": "Giá thấp → cao",
  "price-desc": "Giá cao → thấp",
};

export interface CataloguePage {
  entries: ShopEntry[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

/** Accent-insensitive so "la gai" finds "Lá Gai". */
function searchable(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** One collator for the shelf sort — `localeCompare` resolves the locale on
 *  every comparison, and a 20k-species sort is ~300k comparisons. */
const VI_COLL = new Intl.Collator("vi");

/** The unfiltered default-shelf order, computed once — see `queryCatalogue`. */
let sortedAll: SpeciesDef[] | null = null;

/** Filtered, paginated view of the registry. Never renders the whole thing. */
export function queryCatalogue(q: CatalogueQuery): CataloguePage {
  const perPage = q.perPage ?? 24;
  const needle = q.search ? searchable(q.search.trim()) : "";
  // Built once for the page rather than per entry — every card is judged against the
  // same save state, and recomputing it would walk the nursery once per card.
  const ctx: UnlockContext = q.progress ?? {
    breederLevel: q.breederLevel,
    plantCount: 0,
    speciesCount: 0,
    topGrowthLevel: 0,
    awakenedCount: 0,
    topGeneration: 0,
    leafCoin: 0,
    ascentHighest: 0,
    battleCount: 0,
    breedCount: 0,
    questClaims: 0,
    elementCount: 0,
  };

  // The whole registry, not `availableSpecies`. That helper is `tier <=
  // unlockedTier`, which is the gate from before the per-species rules existed and
  // no longer describes what can actually be bought.
  const matched = SPECIES.filter((s) => {
    if (q.species && s.id !== q.species) return false;
    if (q.tier != null && s.tier !== q.tier) return false;
    if (q.archetype && s.archetype !== q.archetype) return false;
    if (q.element && dominantElement(speciesAffinity(s.id)).id !== q.element) return false;
    if (q.currency && s.currency !== q.currency) return false;
    if (needle && !searchable(s.name).includes(needle)) return false;
    return true;
  });

  // Affordability, judged before anything is ordered, because a price sort is only
  // meaningful against a balance. A species costs its own currency, so this compares each
  // price against the balance for *that* currency rather than against one purse - which is
  // the whole point of having more than one.
  // Lock state, applied before slicing so a page is never empty while the pager claims more.
  const lockFiltered =
    q.locked && q.locked !== "all"
      ? matched.filter((s) => {
          const met = checkUnlock(ctx, s.unlock).met;
          return q.locked === "open" ? met : !met;
        })
      : matched;

  const affordable = q.affordableOnly
    ? lockFiltered.filter((s) => {
        const held = q.balances?.[s.currency] ?? 0;
        return held >= s.seedPrice;
      })
    : lockFiltered;

  /*
   * Ordered here, before the slice, because the shelf is paginated. Ordering after the
   * slice would sort each page in isolation and the second page would contradict the
   * first.
   *
   * Every comparator ends in the name, and that is not decoration: `Array.sort` is stable
   * in modern engines, but stability is only a tie-break between *equal* keys, and two
   * species can share a price. Without the name the order of equal-priced cards would
   * depend on the order the registry happened to be generated in, so paging through the
   * same shelf twice could show the same species on two pages.
   */
  const byName = (a: (typeof affordable)[number], b: (typeof affordable)[number]) => VI_COLL.compare(a.name, b.name);
  /* "Cheapest" means cheap *within its own currency* on the default shelf:
     ranking by leafCoin-equivalent collapses a tier into a single-currency
     page — nectar (1:1) always undercuts pollen (1:8) and ember cannot be
     bought at all. Instead each species is ranked by where its price sits
     inside its own currency's range for that tier, so page one of a deep tier
     shows the tier's real mix — a few cheap coins, a few cheap nectar, the
     entry pollen cards — rather than twenty-four of one currency. */
  const range = new Map<string, { min: number; max: number }>();
  for (const s of affordable) {
    const k = `${s.tier}:${s.currency}`;
    const r = range.get(k);
    if (r) {
      if (s.seedPrice < r.min) r.min = s.seedPrice;
      if (s.seedPrice > r.max) r.max = s.seedPrice;
    } else range.set(k, { min: s.seedPrice, max: s.seedPrice });
  }
  const rel = (s: (typeof affordable)[number]): number => {
    const r = range.get(`${s.tier}:${s.currency}`)!;
    return r.max > r.min ? (s.seedPrice - r.min) / (r.max - r.min) : 0.5;
  };
  const sort = q.sort ?? "default";
  /* The unfiltered default shelf is a pure function of the static registry —
     tier, price, currency and name never change inside a session — so its
     order is computed once and every later identical query only slices.
     Filtered or explicitly sorted queries still take the full path. */
  const wholeRegistry = affordable.length === SPECIES.length;
  let ordered: (typeof affordable)[number][];
  if (sort === "default" && wholeRegistry && sortedAll) {
    ordered = sortedAll;
  } else if (sort === "price-asc" || sort === "price-desc") {
    /* An explicit price sort is a real-cost question, so here the
       leafCoin-equivalent is the honest comparator — and Ember, which no
       conversion can buy, sinks to the end of "asc" rather than leading it. */
    const leafPrice = new Map<SpeciesId, number>();
    for (const s of affordable) {
      leafPrice.set(s.id, costIn(s.seedPrice, s.currency, "leafCoin") ?? Number.MAX_SAFE_INTEGER);
    }
    const eff = (s: (typeof affordable)[number]) => leafPrice.get(s.id) ?? 0;
    /* Equal real-cost ranks (a run of Ember, all priceless) still need the
       printed numbers to move in the direction the sort promised — sort those
       runs by the face value, or a "descending" page reads 53, 63, 51, 56. */
    if (sort === "price-asc") affordable.sort((a, b) => eff(a) - eff(b) || a.seedPrice - b.seedPrice || byName(a, b));
    else affordable.sort((a, b) => eff(b) - eff(a) || b.seedPrice - a.seedPrice || byName(a, b));
    ordered = affordable;
  } else {
    /* Cheapest tier first, cheapest within its currency's range inside it.
       `rel` is per-species, so compute it once into a single numeric key —
       tier*2+rel stays order-isomorphic because rel ∈ [0,1] — and the sort's
       ~300k comparisons become arithmetic, with the collator reached only on
       exact ties. */
    const relKey = new Map<SpeciesId, number>();
    for (const s of affordable) relKey.set(s.id, s.tier * 2 + rel(s));
    affordable.sort((a, b) => relKey.get(a.id)! - relKey.get(b.id)! || byName(a, b));
    ordered = affordable;
    if (sort === "default" && wholeRegistry) sortedAll = ordered;
  }

  const total = ordered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  const slice = ordered.slice((page - 1) * perPage, page * perPage);

  return {
    entries: slice.map((s) => {
      const gate = checkUnlock(ctx, s.unlock);
      return {
        species: s.id,
        name: s.name,
        price: s.seedPrice,
        blurb: s.blurb,
        growMinutes: s.growMinutes,
        owned: 0,
        archetype: s.archetype,
        tier: s.tier,
        element: dominantElement(speciesAffinity(s.id)).id,
        locked: !gate.met,
        unlock: s.unlock,
      };
    }),
    total,
    page,
    pages,
    perPage,
  };
}

// --- NPC orders (docs/16 §19) --------------------------------------------

export interface NpcOrder {
  id: string;
  require: { element?: string; minRarity: Rarity; keyword: string };
  rewardMultiplier: number;
  expiresAt: number;
}

const ORDER_KEYWORDS: { keyword: string; element?: string; minRarity: Rarity }[] = [
  { keyword: "Lá Lửa", element: "fire", minRarity: "C" },
  { keyword: "Búp Sương", element: "water", minRarity: "C" },
  { keyword: "Dây Sét", element: "electric", minRarity: "C" },
  { keyword: "Nấm U Ám", element: "poison", minRarity: "B" },
  { keyword: "Đột biến", minRarity: "A" },
];

export function generateOrders(playerId: string, now: number, count = 4): NpcOrder[] {
  const rng = new Rng(`orders:${playerId}:${Math.floor(now / 86400000)}`);
  const picked = rng.sample(ORDER_KEYWORDS, count);
  return picked.map((req, i) => ({
    id: `ord_${i}_${now}`,
    require: { element: req.element, minRarity: req.minRarity, keyword: req.keyword },
    rewardMultiplier: round2(1.2 + rng.next() * 0.3),
    expiresAt: now + 86400000,
  }));
}

export function fulfillOrder(order: NpcOrder, plant: Plant): { ok: boolean; reason: string; payout: number } {
  if (!canSell(plant)) return { ok: false, reason: "Cây không thể bán", payout: 0 };
  const rarityIndex = ["C", "B", "A", "S", "SS", "SSS"].indexOf(plant.rarity);
  const minIndex = ["C", "B", "A", "S", "SS", "SSS"].indexOf(order.require.minRarity);
  if (rarityIndex < minIndex) return { ok: false, reason: `Cần tối thiểu ${order.require.minRarity}`, payout: 0 };
  if (order.require.element && (plant.dna.elementGenes[order.require.element as never] ?? 0) < 0.2) {
    return { ok: false, reason: `Cần cây hệ ${order.require.element}`, payout: 0 };
  }
  const base = sellPrice(plant);
  return { ok: true, reason: "Giao thành công", payout: Math.floor(base * order.rewardMultiplier) };
}
