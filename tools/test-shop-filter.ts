/**
 * The shop's "only what I have unlocked" filter, driven through the real buttons.
 *
 * The complaint was that asking for the species you already own still returned the locked
 * ones. The cause was a boolean filter where "Chỉ loài đã mở" and "Tất cả" were the same
 * value, so the chip set `onlyLocked = false` - which means "no filter" - and both chips lit
 * up because they were the same choice.
 *
 * Checked by counting, not by reading the label: a filter that shows the right *count* is
 * what matters, and a test that only asserted the button's pressed state would have passed
 * against the original bug.
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

/* A garden that has genuinely unlocked some of the registry and genuinely not others, so
   all three states have something to show and the counts can be told apart. */
await page.evaluate(`(() => {
  const g = (window).__game;
  // Deliberately low level, so the shelf is mostly locked. At a high level only a couple
  // of the first page's cards are gated, and a filter test needs both populations to be
  // big enough to tell apart.
  g.store.state.breederLevel = 3;
  g.store.state.leafCoin = 900_000;
  g.store.state.nectar = 900;
  g.store.state.pollen = 900;
  g.store.state.ember = 900;
  g.store.state.items = 400;
  g.store.state.geneCrystal = 90;
  for (const id of Object.keys(g.store.state.seeds).slice(0, 40)) {
    g.store.state.seeds[id] = 4;
    const r = g.store.plantSeed(id);
    if (r.ok) {
      const p = g.store.get(r.plantId);
      if (p) { p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now(); p.growth.level = 16; }
    }
  }
  g.store.state.nurseryCap = 40;
  g.navigate("lab");
})()`);
await page.waitForTimeout(1200);

type Reading = { total: number; locked: number; open: number; active: string[]; currencies: number[] };

async function clickFilter(label: string): Promise<Reading> {
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)});
    if (b) b.click();
    return Boolean(b);
  })()`);
  await page.waitForTimeout(700);
  return (await page.evaluate(`(() => {
    // Only the shelf grid. A looser selector also picks up the "nổi bật hôm nay" rail
    // above it, and those cards are never locked, which quietly drags the locked count
    // towards zero - which is how the first version of this check reported that the
    // "locked" filter was showing open species.
    const cards = [...document.querySelectorAll(".seed-grid > *")];
    // Compared by code point rather than by substring. An astral character inside a
    // string literal is two UTF-16 units, and a match that depends on the pair surviving
    // a trip through a shell is a match that will quietly stop happening.
    const LOCK = 0x1f512; // padlock
    const PAID = [0x1fa99, 0x1f36f, 0x1f33c, 0x1f525]; // coin, honey, blossom, flame
    // No type annotations in here: this whole block is a *string* that the browser
    // evaluates, so anything TypeScript-shaped is a syntax error at runtime and not at
    // compile time, because tsx never sees it.
    const codes = (s) => [...s].map((ch) => ch.codePointAt(0) ?? 0);
    const isLocked = (c) => codes(c.textContent || "").includes(LOCK);
    const locked = cards.filter(isLocked).length;
    // Only the three lock chips, so the tier chip that is also .primary is not counted.
    const active = [...document.querySelectorAll("button.primary")]
      .map((x) => (x.textContent || "").trim())
      .filter((t) => t === "Tất cả" || /đã mở/.test(t) || /đang khoá/.test(t));
    // Read the currency off the buy button rather than anywhere in the card: the card also
    // carries the padlock and the species art, and "any emoji present" would pass for a
    // shelf that names one currency.
    const currencies = [...new Set(cards.map((c) => {
      const btn = c.querySelector("button.primary") || c.querySelector("button");
      const found = codes(btn ? btn.textContent || "" : "").filter((n) => PAID.includes(n));
      return found.length ? found[found.length - 1] : 0;
    }))];
    return { total: cards.length, locked, open: cards.length - locked, active, currencies };
  })()`)) as Reading;
}

const all = await clickFilter("Tất cả");
const open = await clickFilter("Chỉ loài đã mở");
const locked = await clickFilter("Chỉ loài đang khoá");

const line = (label: string, r: Reading) =>
  console.log(`${label.padEnd(20)} ${String(r.total).padStart(3)} cards, ${String(r.locked).padStart(3)} locked, ${String(r.open).padStart(3)} open, chips=${JSON.stringify(r.active)}`);

line("Tất cả", all);
line("Chỉ loài đã mở", open);
line("Chỉ loài đang khoá", locked);

console.log("");
const ok = [
  ["the open filter shows no locked card", open.locked === 0, `${open.locked} locked showed through`],
  ["the locked filter shows only locked cards", locked.open === 0, `${locked.open} open leaked in`],
  ["the two filters are not the same list", open.total !== locked.total || open.locked !== locked.locked, `${open.total} vs ${locked.total}`],
  ["exactly one chip is active at a time", open.active.length === 1, JSON.stringify(open.active)],
  ["the active chip is the one that was pressed", open.active.some((t) => /đã mở/.test(t)), JSON.stringify(open.active)],
  ["all shows both kinds", all.locked > 0 && all.open > 0, `${all.locked} locked / ${all.open} open`],
  ["the shelf is not empty under any filter", all.total > 0 && open.total > 0 && locked.total > 0],
  ["every card names a currency", all.currencies.every((c) => c !== 0), `${all.currencies.filter((c) => c === 0).length} cards with none`],
  ["the starters are all LeafCoin", all.currencies.length === 1 && all.currencies[0] === 0x1fa99,
    `found ${all.currencies.map((c) => c.toString(16)).join(",")}`],
] as const;

let bad = 0;
for (const [name, pass, detail] of ok) {
  if (!pass) {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* Second pass with an advanced garden, walking the tiers, because at level 3 the whole
   shelf is tier 0-1 and legitimately costs only LeafCoin. Asking a new player's shelf for
   several currencies proves nothing - the tiers are where the design lives. */
async function tierShelf(chip: string): Promise<number[]> {
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(chip)});
    if (b) b.click();
  })()`);
  await page.waitForTimeout(700);
  const r = await clickFilter("Tất cả");
  return r.currencies.filter((c) => c !== 0);
}

const COIN = 0x1fa99;
const HONEY = 0x1f36f;
const BLOSSOM = 0x1f33c;
const FLAME = 0x1f525;

await page.evaluate(`(() => { (window).__game.store.state.breederLevel = 30; (window).__game.navigate("lab"); })()`);
await page.waitForTimeout(900);

const t2 = await tierShelf("II");
const t3 = await tierShelf("III");
const t4 = await tierShelf("IIII");
const t5 = await tierShelf("IIIII");
console.log(`\ntier II   currencies ${t2.map((c) => c.toString(16)).join(",")}`);
console.log(`tier III  currencies ${t3.map((c) => c.toString(16)).join(",")}`);
console.log(`tier IIII currencies ${t4.map((c) => c.toString(16)).join(",")}`);
console.log(`tier IIIII currencies ${t5.map((c) => c.toString(16)).join(",")}`);

const deep = [
  ["tier 5 is Ember and nothing else", t5.length === 1 && t5[0] === FLAME, t5.map((c) => c.toString(16)).join(",")],
  ["tier 4 is Pollen", t4.length === 1 && t4[0] === BLOSSOM, t4.map((c) => c.toString(16)).join(",")],
  ["tier 3 is Nectar or LeafCoin, never the rare ones", t3.every((c) => c === HONEY || c === COIN), t3.map((c) => c.toString(16)).join(",")],
  ["tier 3 has more than one price currency", t3.length > 1, `${t3.length} distinct`],
  ["no tier below 5 sells Ember", ![t2, t3, t4].some((t) => t.includes(FLAME))],
  ["the tiers between them use all four currencies",
    new Set([...t3, ...t4, ...t5]).size === 4, [...new Set([...t3, ...t4, ...t5])].map((c) => c.toString(16)).join(",")],
] as const;

for (const [name, pass, detail] of deep) {
  if (!pass) {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}
console.log(bad ? `\n${bad} failed` : "\nshop filter behaves");

await page.screenshot({ path: "shots/shop-open-only.png" });
console.log(errs.length ? "\nPAGE ERRORS:\n  " + errs.join("\n  ") : "\nno page errors");
await b.close();
if (bad) process.exit(1);
