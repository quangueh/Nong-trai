/**
 * The shop's price order, checked by reading the prices off the cards.
 *
 * Counting sorted prices in a screenshot is not something a person can do reliably, and
 * asserting the sort function's own output is not the same thing - the function could be
 * right while the screen shows something else. So this drives the real chips and reads the
 * real cards, and checks three things a sort can get wrong that a unit test on the
 * comparator would miss:
 *
 *   1. **The order is monotonic across the visible page.** Ascending really is ascending
 *      on screen, not just in the array behind it.
 *   2. **It is applied before paging.** Sorting after the slice would leave page one and
 *      page two in orders that contradict each other, and only turning the page finds it.
 *   3. **Cheapest-first is not a trap.** With four currencies on the shelf, the cheapest
 *      card can be priced in something the player holds none of - so "ascending" has to be
 *      paired with the affordability toggle to be any use.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(600);

/* A player with plenty of coins and nothing else, so the affordability toggle has
   something to exclude: every Pollen and Ember species is out of reach. */
await page.evaluate(`(() => {
  const g = (window).__game;
  g.store.state.breederLevel = 40;
  g.store.state.leafCoin = 5_000_000;
  g.store.state.nectar = 40;
  g.store.state.pollen = 0;
  g.store.state.ember = 0;
  g.navigate("lab");
})()`);
await page.waitForTimeout(1200);

type Reading = { prices: number[]; currencies: number[]; page: string; order: string[] };

/**
 * Click a chip by its leading text.
 *
 * Prefix rather than equality: the currency chips carry their balance ("🌼 Phấn hoa 0"), so
 * an exact match finds nothing, the click silently does nothing, and the shelf is still the
 * old one - which is precisely how the first run of this check concluded the currency
 * filter did not work when it had simply never been clicked.
 */
async function clickChip(label: string): Promise<boolean> {
  const hit = await page.evaluate(`(() => {
    const want = ${JSON.stringify(label)};
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith(want));
    if (b) b.click();
    return Boolean(b);
  })()`);
  await page.waitForTimeout(800);
  return hit === true;
}

/** Turn the affordability filter off, whichever label it is currently wearing. */
async function affordabilityOff(): Promise<void> {
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /đủ tiền/.test(x.textContent || ""));
    if (b && /✓/.test(b.textContent || "")) b.click();
  })()`);
  await page.waitForTimeout(700);
}

/**
 * Click a currency chip.
 *
 * By tooltip, not by text. The chips read "🌼 860" so that five of them fit a phone-width
 * row, which means the currency name now lives in `title` - and clicking by the old
 * "🌼 Phấn hoa" text finds nothing at all, clicks nothing, and leaves the previous shelf
 * standing there looking like the filter is broken.
 */
async function clickCurrency(name: string): Promise<boolean> {
  const hit = await page.evaluate(`(() => {
    const want = ${JSON.stringify(name)};
    const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith(want));
    if (b) b.click();
    return Boolean(b);
  })()`);
  await page.waitForTimeout(800);
  return hit === true;
}

async function read(): Promise<Reading> {
  return (await page.evaluate(`(() => {
    const COIN = 0x1fa99, HONEY = 0x1f36f, BLOSSOM = 0x1f33c, FLAME = 0x1f525;
    const cards = [...document.querySelectorAll(".seed-grid > *")];
    const prices = [], currencies = [];
    for (const c of cards) {
      const btn = c.querySelector("button.primary") || c.querySelector("button");
      const txt = btn ? btn.textContent || "" : "";
      const codes = [...txt].map((ch) => ch.codePointAt(0) ?? 0);
      const cur = codes.includes(FLAME) ? FLAME : codes.includes(BLOSSOM) ? BLOSSOM : codes.includes(HONEY) ? HONEY : codes.includes(COIN) ? COIN : 0;
      const m = txt.replace(/[^0-9]/g, "");
      if (cur && m) { prices.push(Number(m)); currencies.push(cur); }
    }
    const pager = [...document.querySelectorAll(".pager, .small")].map((n) => (n.textContent || "").trim()).find((t) => /^\\d+ \\/ \\d+$/.test(t));
    const order = [...document.querySelectorAll("button.primary")].map((x) => (x.textContent || "").trim())
      .filter((t) => /Mặc định|Giá thấp|Giá cao|đủ tiền/.test(t));
    return { prices, currencies, page: pager || "1/1", order };
  })()`)) as Reading;
}

const CODES = { coin: 0x1fa99, honey: 0x1f36f, blossom: 0x1f33c, flame: 0x1f525 };
const isAsc = (a: number[]) => a.every((v, i) => i === 0 || a[i - 1] <= v);
const isDesc = (a: number[]) => a.every((v, i) => i === 0 || a[i - 1] >= v);

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const dflt = await read();
console.log(`default: ${dflt.prices.length} cards, page ${dflt.page}, chips ${JSON.stringify(dflt.order)}`);
check("the default shelf has cards", dflt.prices.length > 0);
check("the default chip is the one marked", dflt.order.some((t) => /Mặc định/.test(t)), JSON.stringify(dflt.order));

/* Every chip inside the scrollbars, on both layouts.
   The failure this catches is invisible in a DOM dump and in tsc: nine chips in a row
   that is too narrow still *exist*, still carry their listeners, and still sort correctly -
   but four of them sit past the right edge of a scrolling row, so a player never learns
   they are there. Only their geometry gives it away. */
async function offscreenChips(): Promise<string[]> {
  return (await page.evaluate(`(() => {
    const row = document.querySelector(".screen .scrollx");
    const out = [];
    for (const r of document.querySelectorAll(".screen .scrollx")) {
      for (const b of r.querySelectorAll("button")) {
        const a = b.getBoundingClientRect(), c = r.getBoundingClientRect();
        if (a.left >= c.right - 1) out.push((b.textContent || "").trim());
      }
    }
    return out;
  })()`)) as string[];
}

const hidden = await offscreenChips();
console.log(`chips past the right edge: ${hidden.length ? hidden.join(" | ") : "none"}`);
check("no chip sits past the right edge of its row", hidden.length === 0, hidden.join(" | "));

await clickChip("💰 Giá thấp → cao");
const lo = await read();
console.log(`ascending: ${lo.prices.slice(0, 8).join(", ")} … page ${lo.page}`);
check("the ascending chip is marked", lo.order.some((t) => /Giá thấp/.test(t)), JSON.stringify(lo.order));
check("prices ascend on the page", isAsc(lo.prices), lo.prices.join(","));
check("the page is populated", lo.prices.length > 0);

await clickChip("💎 Giá cao → thấp");
const hi = await read();
console.log(`descending: ${hi.prices.slice(0, 8).join(", ")} … page ${hi.page}`);
check("the descending chip is marked", hi.order.some((t) => /Giá cao/.test(t)), JSON.stringify(hi.order));
check("prices descend on the page", isDesc(hi.prices), hi.prices.join(","));
check("the two orders are opposites at the top", hi.prices[0] !== lo.prices[0], `${hi.prices[0]} vs ${lo.prices[0]}`);

// Paging. The failure this catches is sorting after the slice: page two would then carry
// prices that break the order page one established.
await clickChip("💰 Giá thấp → cao");
await page.evaluate(`(() => {
  // The pager's own label is "Sau ›", not "Trang sau". Matching loosely picked nothing and
  // the page never moved, so the check below passed on page one and proved nothing.
  const next = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Sau ›");
  if (next && !next.disabled) next.click();
})()`);
await page.waitForTimeout(800);
const page2 = await read();
console.log(`ascending page 2: ${page2.prices.slice(0, 8).join(", ")} … page ${page2.page}`);
check("page two is also ascending", isAsc(page2.prices), page2.prices.join(","));
check(
  "page two continues from page one rather than restarting",
  page2.prices.length === 0 || lo.prices[lo.prices.length - 1] <= page2.prices[0],
  `page 1 ended ${lo.prices[lo.prices.length - 1]}, page 2 starts ${page2.prices[0]}`,
);

// Affordability. The player holds coins and nectar only, so every Pollen and Ember card
// should disappear.
await clickChip("↕ Mặc định");
await clickChip("Chỉ loài tôi đủ tiền");
const afford = await read();
const shown = [...new Set(afford.currencies)];
console.log(`affordable-only: ${afford.prices.length} cards, currencies ${shown.map((c) => c.toString(16)).join(",")}`);
check("the affordability chip is marked", afford.order.some((t) => /đủ tiền/.test(t)), JSON.stringify(afford.order));
check("nothing unaffordable survives", !shown.includes(CODES.blossom) && !shown.includes(CODES.flame), shown.map((c) => c.toString(16)).join(","));
check("and something affordable remains", afford.prices.length > 0);

/* The default shelf leads with tier 0, which is entirely LeafCoin, so the other three
   currencies are invisible until asked for. That is why the currency chips exist, and this
   is the check that they work - not that every currency appears unprompted. */
check("the default shelf is all LeafCoin, which is the problem the chips solve", new Set(dflt.currencies).size === 1, [...new Set(dflt.currencies)].map((c) => c.toString(16)).join(","));

for (const [label, code] of [["Phấn hoa", CODES.blossom], ["Mảnh lửa", CODES.flame]] as const) {
  // Affordability off first: it is still on from the block above, and the player holds none
  // of either of these currencies - so leaving it on filters the whole shelf away and the
  // currency filter looks broken when it is doing exactly what it was told.
  await affordabilityOff();
  await clickChip("Mọi tiền tệ");
  check(`the ${label} chip is on screen and clickable`, await clickCurrency(label));
  const one = await read();
  const only = [...new Set(one.currencies)];
  console.log(`  ${label}: ${one.prices.length} cards, currencies ${only.map((c) => c.toString(16)).join(",")}`);
  check(`${label} shows only that currency`, only.length === 1 && only[0] === code, only.map((c) => c.toString(16)).join(","));
  check(`${label} shelf is not empty`, one.prices.length > 0);
  check(`${label} shelf is ordered by price ascending`, isAsc(one.prices), one.prices.join(","));
}

await clickChip("Mọi tiền tệ");

await page.screenshot({ path: "shots/shop-price-sort.png" });
console.log(bad ? `\n${bad} failed` : "\nshop price order behaves");
console.log(errs.length ? "\nPAGE ERRORS:\n  " + errs.join("\n  ") : "\nno page errors");
await b.close();
if (bad) process.exit(1);
