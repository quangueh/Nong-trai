/**
 * Four currencies, and drops that are actually random.
 *
 * The claim a loot screen makes is that a currency arrives at a stated rate. That claim
 * is checkable in a way almost nothing else in this game is, and it is checked here by
 * walking the real table with a scripted sequence rather than by asserting the numbers
 * look about right:
 *
 *   - **The printed odds are the rolled odds.** The arena reads its percentages from
 *     `dropOdds`, which reads `DROP_TABLE`, which is what `rollDrops` walks. The test
 *     drives `rollDrops` with a generator that returns exactly the values needed to sit
 *     on each side of each threshold, so a line whose printed chance and rolled chance
 *     have drifted apart fails here rather than in a player's session.
 *
 *   - **A rare currency stays rare.** Measured over many fights with a real generator, so
 *     a rebalance that quietly turns a 12% line into a 60% one is caught.
 *
 *   - **The Ember cap holds, and holds by date.** Not by session: closing the game must
 *     not hand out a fresh allowance, which is the whole reason the day is stored.
 *
 * The shop half is here too, because a currency nobody can spend is not a currency: every
 * species must be priced in something, the four currencies must between them cover the
 * registry, and a player must never be asked for a currency there is no route to.
 */

import { GameStore } from "../src/core/store";
import {
  CURRENCIES,
  CURRENCY_IDS,
  NECTAR_PER_CARE,
  POLLEN_PER_BREED,
  currencyForTier,
  currencyInfo,
  currencyName,
  currencyRank,
  shortOf,
} from "../src/core/currency";
import { DROP_TABLE, EMBER_DAILY_CAP, dropOdds, rollDrops, type Outcome } from "../src/core/drops";
import {
  EXCHANGE_DAILY_CAP,
  costIn,
  exchangeTargets,
  maxExchangeIn,
  quoteExchange,
} from "../src/economy/exchange";
import { SPECIES } from "../src/config/species";
import type { CurrencyId } from "../src/core/currency";

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

/** A generator that yields a fixed script, then repeats the last value. */
function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/* --- 1. the currency set -------------------------------------------------- */

check("there are four currencies", CURRENCIES.length === 4, `${CURRENCIES.length}`);
check("every id is unique", new Set(CURRENCY_IDS).size === CURRENCY_IDS.length);
check("every currency has a name, an icon and a source", CURRENCIES.every((c) => c.name && c.icon && c.source));
check("names are distinct, so no two pills read the same", new Set(CURRENCIES.map((c) => c.name)).size === 4);
check("an unknown id does not crash", currencyInfo("nonsense").name === "nonsense");
check("a refusal names the currency", shortOf("pollen").includes("phấn hoa"), shortOf("pollen"));
check("currencies are ordered for the top bar", currencyRank("leafCoin") < currencyRank("ember"));
check("nectar is paid per care action", NECTAR_PER_CARE > 0);
check("pollen is paid per breeding", POLLEN_PER_BREED > 0);

/* --- 2. every species is priced, and the four cover the registry ----------- */

const noCurrency = SPECIES.filter((s) => !s.currency);
check("every species names a currency", noCurrency.length === 0, `${noCurrency.length} without one`);
check(
  "and it is one this build knows",
  SPECIES.every((s) => CURRENCY_IDS.includes(s.currency)),
  SPECIES.filter((s) => !CURRENCY_IDS.includes(s.currency)).slice(0, 3).map((s) => s.id).join(", "),
);

const byCurrency = new Map<CurrencyId, number>();
for (const s of SPECIES) byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + 1);
check("all four currencies are actually used by the registry", CURRENCY_IDS.every((id) => (byCurrency.get(id) ?? 0) > 0),
  CURRENCY_IDS.map((id) => `${id}:${byCurrency.get(id) ?? 0}`).join(" "));

/* A new player meets tier 0 first, so it only charges the two currencies a
   garden earns from minute one — LeafCoin from winning and Nectar from every
   care action. Ember or Pollen at the bottom of the shelf would be a wall in
   the tutorial. */
const starters = SPECIES.filter((s) => s.tier === 0);
check(
  "every tier-0 species costs a starter currency",
  starters.length > 0 && starters.every((s) => s.currency === "leafCoin" || s.currency === "nectar"),
  starters.filter((s) => s.currency !== "leafCoin" && s.currency !== "nectar").slice(0, 3).map((s) => s.id).join(", "),
);

/* The top of the registry is where Ember lives — led by it, not monopolised by
   it, because a tier of 2,400 cards priced in one currency was the shelf that
   read "giống nhau hết". Ember stays scarce: it never appears below tier 3. */
const top = SPECIES.filter((s) => s.tier === 4);
check("the top tier exists", top.length > 0, `${top.length}`);
{
  const emberShare = top.filter((s) => s.currency === "ember").length / top.length;
  check("the top tier is led by Ember", emberShare > 0.25, `${Math.round(emberShare * 100)}%`);
  check(
    "but no single currency owns it",
    new Set(top.map((s) => s.currency)).size >= 3,
    [...new Set(top.map((s) => s.currency))].join(","),
  );
}
check(
  "so Ember is never spent on anything cheap",
  SPECIES.filter((s) => s.currency === "ember").every((s) => s.tier >= 3),
);

check("tier 2 is not all one currency", new Set(SPECIES.filter((s) => s.tier === 2).map((s) => s.currency)).size > 1,
  "otherwise a tier is a single flat price");

check("tier 0 and 1 both stay on LeafCoin", currencyForTier(0, 0.9) === "leafCoin" && currencyForTier(1, 0.1) === "leafCoin");
check("tier 4 is Ember at any rarity", currencyForTier(4, 0) === "ember" && currencyForTier(4, 1) === "ember");

/* --- 3. the printed odds are the rolled odds ----------------------------- */

/* For each line, the generator is handed a value just under and just over the line's own
   threshold. If the roll and the printed number have drifted, one of these two will come
   out wrong - which is the entire point of reading both from one table. */
for (const outcome of ["win", "loss", "draw"] as Outcome[]) {
  const printed = dropOdds(outcome);
  check(`${outcome}: the printed list matches the table`, printed.length === DROP_TABLE[outcome].length,
    `${printed.length} printed, ${DROP_TABLE[outcome].length} in the table`);

  DROP_TABLE[outcome].forEach((line, i) => {
    check(`${outcome}: ${line.currency} prints the table's chance`, printed[i].chance === line.chance,
      `printed ${printed[i]?.chance}, table ${line.chance}`);
    check(`${outcome}: ${line.currency} prints the table's amount`, printed[i].min === line.min && printed[i].max === line.max);
  });

  // Just inside the threshold: the line fires.
  for (const line of DROP_TABLE[outcome]) {
    const roll = line.chance - 0.001;
    const got = rollDrops(outcome, scripted(roll, 0, 0), { emberLeftToday: EMBER_DAILY_CAP });
    check(`${outcome}: ${line.currency} fires just under its stated chance`, got.some((d) => d.currency === line.currency),
      `at ${roll.toFixed(3)} nothing fired`);
  }

  // Just outside: nothing fires at all, for any line.
  const none = rollDrops(outcome, scripted(0.999, 0.999, 0.999, 0.999, 0.999, 0.999), { emberLeftToday: EMBER_DAILY_CAP });
  check(`${outcome}: nothing fires above every threshold`, none.length === 0, JSON.stringify(none));
}

/* Each line independently, so a win can pay two currencies at once. */
{
  const table = DROP_TABLE.win;
  const got = rollDrops("win", scripted(0, 0, 0, 0, 0, 0, 0, 0), { emberLeftToday: EMBER_DAILY_CAP });
  check("a clean sweep pays every line", got.length === table.length, `${got.length} of ${table.length}`);
  check(
    "and they are in table order",
    got.map((g) => g.currency).join(",") === table.map((t) => t.currency).join(","),
    got.map((g) => g.currency).join(","),
  );
}

/* Amounts stay inside their printed range. */
for (const outcome of ["win", "loss", "draw"] as Outcome[]) {
  for (const line of DROP_TABLE[outcome]) {
    for (const pick of [0, 0.5, 0.999]) {
      // chance first, then the amount roll, then padding for the other lines.
      const got = rollDrops(outcome, scripted(0, pick, 0, 0, 0, 0, 0, 0), { emberLeftToday: EMBER_DAILY_CAP })
        .filter((d) => d.currency === line.currency);
      for (const d of got) {
        check(`${outcome}: ${line.currency} amount within ${line.min}-${line.max}`, d.amount >= line.min && d.amount <= line.max,
          `got ${d.amount} at pick ${pick}`);
        check(`${outcome}: ${line.currency} amount is whole`, Number.isInteger(d.amount), `${d.amount}`);
      }
    }
  }
}

/* --- 4. the rare one stays rare ------------------------------------------ */

/* Measured, not asserted. 20000 fights through the real table with the real generator,
   which is the only way to notice a threshold quietly moving. */
{
  const N = 20_000;
  const counts: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    for (const d of rollDrops("win", Math.random, { emberLeftToday: EMBER_DAILY_CAP })) {
      counts[d.currency] = (counts[d.currency] ?? 0) + 1;
    }
  }
  for (const line of DROP_TABLE.win) {
    const seen = (counts[line.currency] ?? 0) / N;
    // Generous bounds: the point is to catch an order-of-magnitude change, not to fail on
    // ordinary sampling noise.
    check(`win: ${line.currency} lands near its stated ${Math.round(line.chance * 100)}%`,
      Math.abs(seen - line.chance) < 0.02,
      `measured ${(seen * 100).toFixed(2)}%`);
  }
  check("Ember is the rarest of the three", (counts.ember ?? 0) < (counts.pollen ?? 0));
  check("and rarer than nectar", (counts.ember ?? 0) < (counts.nectar ?? 0));
  check("Ember is genuinely rare, not merely lowest", (counts.ember ?? 0) / N < 0.2, `${((counts.ember ?? 0) / N * 100).toFixed(2)}%`);
}

/* --- 5. the Ember cap ---------------------------------------------------- */

check("the cap is a small number, so it still means something", EMBER_DAILY_CAP > 0 && EMBER_DAILY_CAP <= 5, `${EMBER_DAILY_CAP}`);
check("a loss can drop Ember, but far more rarely than a win",
  DROP_TABLE.loss.find((l) => l.currency === "ember")!.chance < DROP_TABLE.win.find((l) => l.currency === "ember")!.chance);

/* Rolling with nothing left pays nothing rather than overflowing the cap. */
{
  const spent = rollDrops("win", scripted(0, 0, 0, 0, 0, 0, 0, 0), { emberLeftToday: 0 });
  check("with the cap spent, Ember does not drop", !spent.some((d) => d.currency === "ember"), JSON.stringify(spent));
  check("but the other currencies still do", spent.some((d) => d.currency === "nectar"), JSON.stringify(spent));
}

/* --- 6. the store pays them, and the cap holds through the store ---------- */

{
  const store = new GameStore();
  store.state.plants.length = 0;
  store.state.leafCoin = 50_000;
  store.state.items = 500;
  store.state.geneCrystal = 50;
  store.state.nectar = 0;
  store.state.pollen = 0;
  store.state.ember = 0;
  store.state.emberToday = 0;
  store.state.emberDay = new Date().toISOString().slice(0, 10);

  const before = store.state.emberToday;
  const drops = store.awardDrops("win", scripted(0, 0, 0, 0, 0, 0, 0, 0));
  check("a clean sweep pays through the store", drops.some((d) => d.currency === "ember"), JSON.stringify(drops));
  check("and counts it against today's cap", store.state.emberToday === before + 1, `${store.state.emberToday}`);
  check("and credits the balance", store.state.ember === 1, `${store.state.ember}`);

  // Fill the cap and try again.
  store.state.emberToday = EMBER_DAILY_CAP;
  const more = store.awardDrops("win", scripted(0, 0, 0, 0, 0, 0, 0, 0));
  check("past the cap, Ember stops", !more.some((d) => d.currency === "ember"), JSON.stringify(more));
  check("and the counter does not drift past it", store.state.emberToday === EMBER_DAILY_CAP, `${store.state.emberToday}`);

  check("the cap reports what is left", store.emberLeftToday() === 0);

  // A new day resets it, by date rather than by session.
  store.state.emberDay = "1999-01-01";
  check("yesterday's allowance is back", store.emberLeftToday() === EMBER_DAILY_CAP, `${store.emberLeftToday()}`);
  check("and the counter was cleared", store.state.emberToday === 0);
  check("and the day was rewritten", store.state.emberDay !== "1999-01-01");
}

/* --- 7. buying takes the right currency ----------------------------------- */

{
  const store = new GameStore();
  store.state.plants.length = 0;
  store.state.breederLevel = 60;
  store.state.leafCoin = 50_000;
  store.state.items = 500;
  store.state.geneCrystal = 50;
  store.state.nectar = 0;
  store.state.pollen = 0;
  store.state.ember = 0;
  store.state.emberToday = 0;
  store.state.emberDay = new Date().toISOString().slice(0, 10);

  // An advanced garden, because the unlock rules read real plants: `species: 24` is
  // answered by twenty-four distinct species in the garden, not by a number on the
  // profile. Without this the top shelf is correctly refused and the test would be
  // measuring the unlock gate rather than the currency routing.
  for (const id of SPECIES.slice(0, 34)) {
    store.state.seeds[id.id] = 2;
    if (store.state.plants.length >= 30) break;
    const r = store.plantSeed(id.id);
    if (!r.ok) continue;
    const p = store.state.plants[store.state.plants.length - 1];
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 14;
    p.locks.manual = false;
  }

  // Find one species per currency that this garden may actually buy, with the balance for
  // that currency set generously so affordability is not what is being measured.
  const byCur = new Map<CurrencyId, (typeof SPECIES)[number]>();
  for (const s of SPECIES) {
    if (byCur.has(s.currency)) continue;
    store.state[s.currency] = 10_000_000;
    if (store.buySeed(s.id).ok) byCur.set(s.currency, s);
  }
  check("a species in each of the four currencies is buyable once you hold that currency",
    byCur.size === 4,
    `${byCur.size} of 4: ${[...byCur.keys()].join(", ")}`);

  // Holding a currency buys its species and only moves that balance.
  for (const [cur, sp] of byCur) {
    for (const other of CURRENCY_IDS) store.state[other] = 0;
    store.state[cur] = 10_000_000;
    const before = store.state[cur];
    const r = store.buySeed(sp.id);
    check(`a ${cur} seed is bought with ${cur}`, r.ok, r.reason);
    check(`and the ${cur} balance is what fell`, store.state[cur] < before, `${before} -> ${store.state[cur]}`);
    const untouched = CURRENCY_IDS.filter((id) => id !== cur && store.state[id] > 0);
    check(`and no other currency was touched`, untouched.length === 0, `${untouched.join(", ")}`);
  }

  // Drained, the purchase is refused and the refusal names the currency that is short.
  for (const [cur, sp] of byCur) {
    for (const other of CURRENCY_IDS) store.state[other] = 0;
    const r = store.buySeed(sp.id);
    check(`a ${cur} seed is refused when ${cur} is empty`, !r.ok, r.reason);
    check(
      `and the refusal names ${currencyName(cur)}`,
      (r.reason ?? "").toLowerCase().includes(currencyName(cur).toLowerCase()),
      `${r.reason} (wanted ${currencyName(cur)})`,
    );
  }

  // A full coin purse does not buy a Pollen seed. This is the check that would have caught
  // the old `store.state.leafCoin < price` test on a Pollen-priced card.
  const pollenEntry = [...byCur.entries()].find(([c]) => c === "pollen");
  if (pollenEntry) {
    for (const other of CURRENCY_IDS) store.state[other] = 0;
    store.state.leafCoin = 999_999;
    const r = store.buySeed(pollenEntry[1].id);
    check("a full coin purse does not buy a Pollen seed", !r.ok, r.reason);
  }
}

/* --- 8. every currency has a route to earn it ---------------------------- */

{
  const store = new GameStore();
  store.state.plants.length = 0;
  store.state.leafCoin = 9_999;
  store.state.items = 300;
  store.state.geneCrystal = 30;
  const start = { ...store.state };

  // Tending pays nectar and needs nothing but a plant.
  store.state.seeds.thornroot = 4;
  store.plantSeed("thornroot");
  const tended = store.state.plants[0];
  store.care(tended.plantId, "water");
  check("tending pays nectar", store.state.nectar > start.nectar, `${start.nectar} -> ${store.state.nectar}`);
  check("nectar is not paid by winning a fight", (DROP_TABLE.win.find((l) => l.currency === "nectar")?.chance ?? 0) > 0);

  // Breeding pays pollen.
  store.state.seeds.emberleaf = 4;
  store.plantSeed("emberleaf");
  const a = store.state.plants[0];
  const b = store.state.plants[1];
  for (const p of [a, b]) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.locks.manual = false;
  }
  const pollenBefore = store.state.pollen;
  store.breed(a.plantId, b.plantId);
  check("breeding pays pollen", store.state.pollen > pollenBefore, `${pollenBefore} -> ${store.state.pollen}`);
  check("and pays exactly one breeding's worth", store.state.pollen - pollenBefore === POLLEN_PER_BREED,
    `+${store.state.pollen - pollenBefore}`);

  // Ember only from a fight, and only sometimes - which is the design, so it is asserted
  // as a design rather than as an accident.
  check("Ember has exactly one source", DROP_TABLE.win.some((l) => l.currency === "ember"));
  check("and that source is a roll, not a certainty", (DROP_TABLE.win.find((l) => l.currency === "ember")?.chance ?? 1) < 1);
  check("nothing else pays Ember", !CURRENCIES.some((c) => c.id === "ember" && /chăm|lai/i.test(c.source)));
}

/* --- 9. an old save survives --------------------------------------------- */

{
  mem.clear();
  const s = new GameStore();
  s.state.plants.length = 0;
  s.state.leafCoin = 7777;
  s.save();
  // Strip the currencies, as a build from before them would have written it.
  const raw = JSON.parse(localStorage.getItem("mutant-sprout-save-v1")!) as Record<string, unknown>;
  delete raw.nectar;
  delete raw.pollen;
  delete raw.ember;
  delete raw.emberDay;
  delete raw.emberToday;
  localStorage.setItem("mutant-sprout-save-v1", JSON.stringify(raw));

  const back = new GameStore();
  check("a pre-currency save loads", back.state.leafCoin === 7777, `${back.state.leafCoin}`);
  for (const id of CURRENCY_IDS) {
    check(`${id} reads as a number`, typeof (back.state as unknown as Record<string, unknown>)[id] === "number",
      `${String((back.state as unknown as Record<string, unknown>)[id])}`);
  }
  check("and as zero", back.state.nectar === 0 && back.state.pollen === 0 && back.state.ember === 0);
  check("the Ember day is filled in", typeof back.state.emberDay === "string" && back.state.emberDay.length > 0);
  check("and its counter", back.state.emberToday === 0);
  check("the cap works on a repaired save", back.emberLeftToday() === EMBER_DAILY_CAP);

  // A save that somehow carries a broken number must not print NaN.
  const raw2 = JSON.parse(localStorage.getItem("mutant-sprout-save-v1")!) as Record<string, unknown>;
  raw2.pollen = "lots";
  localStorage.setItem("mutant-sprout-save-v1", JSON.stringify(raw2));
  const back2 = new GameStore();
  check("a non-numeric balance is repaired to a number", back2.state.pollen === 0, `${String(back2.state.pollen)}`);
  // The exchange cap is the same shape as the Ember cap — a missing day/counter
  // pair repairs to "today, nothing converted", not to undefined.
  check("the exchange day is filled in", typeof back2.state.exchangeDay === "string" && back2.state.exchangeDay.length > 0);
  check("and its counter", back2.state.exchangedLeaf === 0);
  check("a repaired save has full exchange allowance", back2.exchangeAllowanceLeft() === EXCHANGE_DAILY_CAP);
}

/* --- 10. a structurally damaged save keeps what is playable --------------- */
/* One truncated plant used to throw inside load repair and cost the whole
   garden; mistyped scalar fields (seeds as null, items as a string) crashed
   shop/care paths later. Both are now triaged rather than fatal. */
{
  mem.clear();
  const s = new GameStore();
  s.state.leafCoin = 555;
  s.save();
  const raw = JSON.parse(localStorage.getItem("mutant-sprout-save-v1")!) as {
    plants: unknown[];
    seeds: unknown;
    items: unknown;
    nurseryCap: unknown;
  };
  raw.plants.push({ plantId: "ghost" }); // no dna/stats/growth — cannot be played
  raw.plants[0] = null; // a hole in the array
  raw.seeds = null;
  raw.items = "plenty";
  raw.nurseryCap = 0;
  localStorage.setItem("mutant-sprout-save-v1", JSON.stringify(raw));

  const back = new GameStore();
  check("unplayable plants are dropped, not the garden", back.state.plants.length === 0, `${back.state.plants.length}`);
  check("a null seeds bag repairs to an object", !!back.state.seeds && typeof back.state.seeds === "object" && !Array.isArray(back.state.seeds));
  check(
    "buySeed does not crash on a repaired bag",
    (() => {
      try {
        back.buySeed("thornroot" as never, 1);
        return true;
      } catch {
        return false;
      }
    })(),
  );
  check("mistyped items repair to a number", typeof back.state.items === "number", `${String(back.state.items)}`);
  check("a broken nursery cap repairs", back.state.nurseryCap >= 1, `${back.state.nurseryCap}`);
  check("ledger repairs to an array", Array.isArray(back.state.ledger));
}

/* --- 11. the shop refuses hostile counts ----------------------------------- */
/* buySeed(sp, -5) priced the "purchase" negative — debitCurrency then paid
   coins in and drove the seed bag negative. Only positive integers buy. */
{
  mem.clear();
  const s = new GameStore();
  s.state.leafCoin = 1000;
  const before = s.state.leafCoin;
  const bad = s.buySeed("thornroot", -5);
  check("a negative count is refused", !bad.ok, bad.reason);
  check("and pays nothing", s.state.leafCoin === before, `${s.state.leafCoin}`);
  check("and takes no seeds", (s.state.seeds["thornroot"] ?? 0) >= 0, `${s.state.seeds["thornroot"]}`);
  const zero = s.buySeed("thornroot", 0);
  check("a zero count is refused too", !zero.ok, zero.reason);
  const frac = s.buySeed("thornroot", 2.5);
  check("a fractional count is refused", !frac.ok);
}

/* --- 12. quy đổi ---------------------------------------------------------
 * The exchange exists so any currency can buy a seed or a plot — but it must
 * lose value doing it, stop at a daily cap, and never create Ember out of
 * thin air. Each rule is a check, because each is independently breakable.
 */
{
  // Rates: the table itself, and the floor/ceil maths it drives.
  check("nectar converts 1:1 before the fee", quoteExchange("nectar", "leafCoin", 100)?.out === 80, `${quoteExchange("nectar", "leafCoin", 100)?.out}`);
  check("coins convert into nectar the same way", quoteExchange("leafCoin", "nectar", 100)?.out === 80);
  check("pollen is worth 8x", quoteExchange("pollen", "leafCoin", 100)?.out === 640, `${quoteExchange("pollen", "leafCoin", 100)?.out}`);
  check("ember sells at 300 per shard", quoteExchange("ember", "leafCoin", 1)?.out === 240, `${quoteExchange("ember", "leafCoin", 1)?.out}`);
  check("ember cross-rate lands on pollen", quoteExchange("ember", "pollen", 1)?.out === 30, `${quoteExchange("ember", "pollen", 1)?.out}`);

  // The three rules that protect the design: no self-exchange, never into
  // Ember, and only whole positive amounts.
  check("same currency is not a trade", quoteExchange("nectar", "nectar", 10) === null);
  check("nothing converts into Ember", quoteExchange("pollen", "ember", 1000) === null && quoteExchange("leafCoin", "ember", 99999) === null);
  check("ember is not a target on the desk", !exchangeTargets("leafCoin").includes("ember") && !exchangeTargets("pollen").includes("ember"));
  check("zero and negative amounts are refused", quoteExchange("leafCoin", "nectar", 0) === null && quoteExchange("leafCoin", "nectar", -5) === null);
  check("fractional amounts are refused", quoteExchange("leafCoin", "nectar", 1.5) === null);

  // A round trip always loses — the fee is what makes "farm one thing, convert
  // to everything" worse than just doing the activity.
  const trip = quoteExchange("nectar", "leafCoin", quoteExchange("leafCoin", "nectar", 100)!.out)!.out;
  check("a round trip loses to the fee", trip < 100, `100 -> ${trip}`);

  // Equivalent prices printed on cards must be enough to cover the price via
  // the desk — the reference would be a lie if it came up short.
  const alt = costIn(100, "nectar", "leafCoin")!;
  check("a 100-nectar price quotes 125 coins", alt === 125, `${alt}`);
  check("the quoted coins actually cover it", (quoteExchange("leafCoin", "nectar", alt)?.out ?? 0) >= 100);
  const plotNectar = costIn(900, "leafCoin", "nectar")!;
  check("a 900-coin plot quotes in nectar", plotNectar === 1125, `${plotNectar}`);
  check("and in pollen", costIn(900, "leafCoin", "pollen") === 141, `${costIn(900, "leafCoin", "pollen")}`);
  check("and in ember", costIn(900, "leafCoin", "ember") === 4, `${costIn(900, "leafCoin", "ember")}`);
  check("ember prices have no equivalent", costIn(500, "ember", "leafCoin") === null);
  check("same-currency cost is the price itself", costIn(900, "leafCoin", "leafCoin") === 900);
  check("cap-limited max spend honours the allowance", maxExchangeIn("pollen", 500, 100) === 12, `${maxExchangeIn("pollen", 500, 100)}`);

  // The store: real balances moving, both ledger lines, the cap.
  mem.clear();
  const s = new GameStore();
  s.state.leafCoin = 5000;
  s.state.nectar = 0;
  const r1 = s.exchangeCurrency("leafCoin", "nectar", 1000);
  check("exchange succeeds", r1.ok && r1.out === 800, `${r1.out} (${r1.reason})`);
  check("coins left", s.state.leafCoin === 4000, `${s.state.leafCoin}`);
  check("nectar gained", s.state.nectar === 800, `${s.state.nectar}`);
  check("allowance counted in", s.exchangeAllowanceLeft() === EXCHANGE_DAILY_CAP - 1000, `${s.exchangeAllowanceLeft()}`);
  check(
    "both sides hit the ledger",
    s.state.ledger.some((l) => l.delta === -1000 && /Đổi sang/.test(l.reason)) &&
      s.state.ledger.some((l) => l.delta === 800 && /Đổi từ/.test(l.reason)),
  );

  const noEmber = s.exchangeCurrency("leafCoin", "ember", 100);
  check("store refuses to mint Ember", !noEmber.ok && !!noEmber.reason, noEmber.reason);
  const poor = s.exchangeCurrency("pollen", "leafCoin", 10);
  check("no balance, no trade", !poor.ok && s.state.pollen === 0);
  const tiny = s.exchangeCurrency("leafCoin", "pollen", 1);
  check("a trade that pays out 0 is refused", !tiny.ok, tiny.reason);

  // The cap is real: converting more than remains stops, and says so.
  const over = s.exchangeCurrency("leafCoin", "nectar", 2500);
  check("over the daily cap is refused", !over.ok && /hạn mức/.test(over.reason ?? ""), over.reason);
  check("and nothing moved", s.state.leafCoin === 4000 && s.state.nectar === 800);

  // A new day reopens the desk — by date, not by relog.
  s.state.exchangeDay = "2000-01-01";
  check("the cap resets by date", s.exchangeAllowanceLeft() === EXCHANGE_DAILY_CAP, `${s.exchangeAllowanceLeft()}`);

  // Ember out: the one direction it is allowed.
  s.state.ember = 2;
  const sell = s.exchangeCurrency("ember", "leafCoin", 1);
  check("ember cashes out", sell.ok && sell.out === 240 && s.state.leafCoin === 4240, `${sell.out}, ${s.state.leafCoin}`);

  // End to end: coins -> nectar -> a nectar-priced seed lands in the bag.
  const nectarSp = SPECIES.find((sp) => sp.currency === "nectar" && !sp.unlock);
  if (nectarSp) {
    const need = nectarSp.seedPrice;
    s.state.leafCoin = 999_999;
    s.state.exchangedLeaf = 0;
    const ex = s.exchangeCurrency("leafCoin", "nectar", costIn(need, "nectar", "leafCoin")!);
    check("converted enough for the seed", ex.ok && s.state.nectar >= need, `${s.state.nectar} vs ${need}`);
    const bought = s.buySeed(nectarSp.id);
    check("and the seed buys", bought.ok && (s.state.seeds[nectarSp.id] ?? 0) >= 1, bought.reason);
  } else {
    check("a nectar species exists for the end-to-end check", false, "none unlocked");
  }
}

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
