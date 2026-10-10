/**
process.exit(failed === 0 ? 0 : 1);
if (failures.length) console.log("  failed: " + failures.join("; ") + "\n");
console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
check(
  "each card says how many are held",
  ($$(".picker-card")[0]?.querySelector(".seed-orb")?.textContent ?? "").trim() === "5",
  ($$(".picker-card")[0]?.querySelector(".seed-orb")?.textContent ?? "").trim(),
);
 *
 * The planting moment is the one the player judges the whole game by, and it was
 * previously untested: one click bought a seed if needed, planted, showed a
 * toast, and re-rendered. Nothing about the roll was visible.
 *
 * These run in jsdom, which has no layout engine, so everything here asserts on
 * DOM structure, class names and text — never geometry. The geometry is covered
 * separately by measuring the live page (tools/measure.mjs).
 */

import { JSDOM } from "jsdom";

// --- DOM environment (mirrors tools/test-ui.ts) ---------------------------

const dom = new JSDOM("<!doctype html><html><body><div id='app'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w;
g.document = w.document;
g.localStorage = w.localStorage;
g.sessionStorage = w.sessionStorage;
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true, writable: true });
g.HTMLElement = w.HTMLElement;
g.Element = w.Element;
g.Node = w.Node;
g.SVGElement = w.SVGElement;
g.Event = w.Event;
g.CustomEvent = w.CustomEvent;
g.MouseEvent = w.MouseEvent;
g.getComputedStyle = w.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => w.setTimeout(() => cb(0), 0);
g.cancelAnimationFrame = (id: number) => w.clearTimeout(id);
w.matchMedia = (() => ({ matches: false, addEventListener() {}, removeListener() {} })) as never;

// jsdom has no PointerEvent; the garden listens for pointerdown/up on empty
// plots. A plain Event carrying the right `type` is enough for addEventListener.
g.PointerEvent = w.Event as never;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(t: string): void {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = w.document): T | null =>
  root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = w.document): T[] => [
  ...root.querySelectorAll<T>(sel),
];

const click = (e: Element | null): void => {
  if (!e) throw new Error("click target missing");
  e.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
};

/** The ritual is on timers, so tests need to step them rather than sleep. */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- boot ------------------------------------------------------------------

const { boot } = await import("../src/ui/app");
const { store, navigate } = await import("../src/ui/app");
const { STAT_GENES } = await import("../src/config/species");
const { dayKey } = await import("../src/core/store");

// The timed daily check-in nudge is covered separately, not a planting overlay.
w.sessionStorage.setItem(`ci-shown:${dayKey(Date.now())}`, "1");

await boot(w.document.getElementById("app")!);

// --- arrange a garden with a seed in hand ---------------------------------

function setupGarden(seedId = "thornroot") {
  store.state.leafCoin = 500_000;
  store.state.breederLevel = 12;
  store.state.nurseryCap = 24;
  store.state.seeds[seedId] = 5;
  store.state.plants.length = 1;
  navigate("garden");
  return seedId;
}

/**
 * Tap a plot, pick the row for `want`, then press Trồng.
 *
 * Every planting test goes through this, because planting is now three deliberate
 * steps — open the sheet, select a seed, confirm. A test that reaches past the
 * chooser would not be testing what a player actually does.
 */
async function plantViaChooser(want?: string): Promise<void> {
  click($(".empty-plot"));
  await wait(30);
  const rows = $$(".seed-pick");
  const target = want ? rows.find((c) => c.textContent?.includes(want)) : rows[0];
  if (!target) throw new Error(`no seed row for ${want ?? "(first)"}`);
  click(target);
  await wait(30);
  click($(".seed-cta"));
  await wait(30);
}

section("1. An empty plot offers a real choice");

const seedId = setupGarden();
await wait(20);
const emptyPlots = $$(".empty-plot");
check("empty plots are offered", emptyPlots.length > 0, `${emptyPlots.length}`);
check(
  "the plot invites a choice instead of naming a species",
  /Chọn hạt/.test(emptyPlots[0]?.textContent ?? ""),
  (emptyPlots[0]?.textContent ?? "").replace(/\s+/g, " ").trim(),
);
check(
  "the seed belt no longer advertises a long press",
  !$(".seed-belt")?.textContent?.includes("Giữ ô đất"),
  ($(".seed-belt")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70),
);

// The regression guard for the change: a tap must not spend anything.
const seedsUntouched = store.state.seeds[seedId] ?? 0;
const plantsUntouched = store.state.plants.length;
click(emptyPlots[0]);
await wait(30);
check("tapping a plot opens the chooser", !!$(".seed-sheet"));
check("and plants nothing yet", store.state.plants.length === plantsUntouched);
check("and consumes no seed yet", (store.state.seeds[seedId] ?? 0) === seedsUntouched);
check("the chooser lists the seeds held", $$(".seed-pick").length > 0, `${$$(".seed-pick").length} rows`);
check("with a preview of one", !!$(".seed-hero"));
// The chooser is a bottom sheet now: a dimming overlay behind it is the thing
// that closes on an outside tap, and the surface the phone's thumb reaches.
check("and it opens as a sheet with a scrim", !!$(".overlay") && !!$(".sheet"));

// Tapping the scrim closes it — the sheet's own dismiss path.
click($(".overlay"));
await wait(20);
check("tapping outside closes it", !$(".seed-sheet"));

// And it can be reopened, so the dismissal did not leave the plot dead.
click(emptyPlots[0]);
await wait(30);
check("the plot still opens the chooser again", !!$(".seed-sheet"));
// A real Escape targets the focused element inside the sheet and bubbles up through
// it — dispatching on `document` skips the sheet entirely, which is not what a key
// press does.
(w.document.activeElement ?? w.document).dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(20);
check("escape closes it", !$(".seed-sheet"));

section("2. Choosing a seed runs the ceremony");

const plantsBefore = store.state.plants.length;
const seedsBefore = store.state.seeds[seedId] ?? 0;
await plantViaChooser();

check("a seed was consumed", (store.state.seeds[seedId] ?? 0) === seedsBefore - 1);
check("a plant was added", store.state.plants.length === plantsBefore + 1);

const overlay = $(".plant-overlay");
check("the ceremony overlay appears", !!overlay);
check("it is announced as a dialog", overlay?.getAttribute("role") === "dialog");
check(
  "it is labelled with the new plant",
  (overlay?.getAttribute("aria-label") ?? "").startsWith("Gieo "),
  overlay?.getAttribute("aria-label") ?? "",
);
check("the page behind cannot scroll", w.document.body.classList.contains("planting"));
check("there is a skip control", !!$(".plant-skip"));
check("the soil is present", !!$(".plant-pot"));
check("the seed is present", !!$(".plant-seedviz"));

section("3. The ritual beats fire in order");

check("the soil has not opened yet", !$(".plant-pot")?.classList.contains("is-open"));
await wait(200);
check("the soil opens", !!$(".plant-pot")?.classList.contains("is-open"));
await wait(400);
check("the seed starts falling", !!$(".plant-seedviz")?.classList.contains("is-dropped"));
await wait(900);
check("the soil closes over the seed", !!$(".plant-pot")?.classList.contains("is-closed"));
check("the dust puffs on the bury beat", !!$(".plant-dust")?.classList.contains("is-puff"));
await wait(500);
check("the sprout emerges", !!$(".plant-sprout")?.classList.contains("is-growing"));
check(
  "the sprout carries the real plant art",
  !!$(".plant-sprout .plantart"),
  ($(".plant-sprout")?.innerHTML.length ?? 0) + " chars of svg",
);
check("no reveal while the ritual is running", !$(".plant-reveal"));

section("4. The reveal reports the roll, not a guess");

await wait(1400);
const reveal = $(".plant-reveal");
check("the reveal appears", !!reveal);
check("the stage dims behind it", !!$(".plant-overlay--reveal"));

const planted = store.state.plants[store.state.plants.length - 1];
const revealText = reveal?.textContent ?? "";

check("it names the plant", revealText.includes(planted.name), planted.name);
check("it names the source species", revealText.includes("thế hệ 1"));
check("it labels the growth stage", revealText.includes("Hạt"));

// The four hidden mutation genes are the point of the panel: they decide how the
// plant behaves for the rest of its life and were previously invisible.
const geneChips = $$(".plant-gene", reveal!);
check("all four hidden genes are shown", geneChips.length === 4, `${geneChips.length}`);
for (const key of ["Bất ổn", "Độ thuần", "Hoang dã", "May mắn hiếm"]) {
  check(`the roll shows "${key}"`, revealText.includes(key));
}
const shownInstability = geneChips.find((c) => c.textContent?.includes("Bất ổn"));
const realInstability = Math.round((planted.dna.mutationGenes.instability ?? 0) * 100);
check(
  "the displayed value matches the genome",
  shownInstability?.textContent?.includes(String(realInstability)) ?? false,
  `panel ${shownInstability?.textContent?.replace(/\s+/g, " ") ?? "?"} vs genome ${realInstability}`,
);

check("it says traits are not yet unlocked", revealText.includes("Chưa có đặc tính"));
check("it explains what to do next", revealText.includes("Bước kế"));

const statCells = $$(".plant-stat", reveal!);
check("every stat is shown with its ceiling", statCells.length === STAT_GENES.length, `${statCells.length}`);
const hpCell = statCells.find((c) => c.textContent?.startsWith("HP"));
const hpCap = planted.potential.hp?.softCap ?? 0;
check(
  "the ceiling shown is the real one",
  hpCell?.textContent?.includes(`→ ${hpCap}`) ?? false,
  `panel "${hpCell?.textContent?.replace(/\s+/g, " ")}" vs softCap ${hpCap}`,
);

const confirm = $(".plant-reveal-foot .btn");
check("there is a confirm button", !!confirm, confirm?.textContent ?? "");

section("5. Confirming hands the screen back");

click(confirm);
await wait(350);
check("the overlay is gone", !$(".plant-overlay"));
check("the page can scroll again", !w.document.body.classList.contains("planting"));
check("the garden re-rendered with the new plot", $$(".screen .plantcard").length === store.state.plants.length);
check(
  "the new plot shows the planted name",
  $$(".screen .plantcard").some((c) => c.textContent?.includes(planted.name)),
  planted.name,
);

section("6. Skipping the ritual still lands on the reveal");

setupGarden();
await wait(20);
await plantViaChooser();
check("the ritual started", !!$(".plant-overlay"));
// Tap immediately: the whole point of skip is that it does not cost anything.
click($(".plant-skip"));
await wait(60);
check("skipping jumps straight to the reveal", !!$(".plant-reveal"));
check("and drops the empty stage", !$(".plant-pot"));
check("the skip control is gone", !$(".plant-skip"));
click($(".plant-reveal-foot .btn"));
await wait(350);
check("and it still confirms cleanly", !$(".plant-overlay"));

section("7. The chooser is reachable by tapping, and by nothing else");

setupGarden();
await wait(20);
const plot = $(".empty-plot");
// The 480ms press-and-hold is gone. Holding must now do nothing at all — not
// open the chooser, and certainly not plant — because a leftover path that can
// spend a seed is worse than no path at all.
plot?.dispatchEvent(new w.Event("pointerdown", { bubbles: true, cancelable: true }));
await wait(600);
check("holding alone does nothing", !$(".seed-sheet"));
check("and plants nothing", store.state.plants.length === 1, `${store.state.plants.length}`);

plot?.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
await wait(30);
check("tapping opens the chooser", !!$(".seed-sheet"));
check("it is titled", ($(".seed-sheet")?.textContent ?? "").includes("Chọn hạt"));
check(
  "it lists the seeds actually held",
  store.state.seeds[seedId] !== undefined && $$(".seed-pick").length > 0,
);
check(
  "each row says how many are held",
  ($$(".seed-pick")[0]?.querySelector(".seed-orb")?.textContent ?? "").trim() === "5",
  ($$(".seed-pick")[0]?.querySelector(".seed-orb")?.textContent ?? "").trim(),
);
(w.document.activeElement ?? w.document).dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(20);
check("Escape closes it", !$(".seed-sheet"));

section("8. Planting with an empty bag buys the seed first");

store.state.leafCoin = 500_000;
store.state.seeds = {};
store.state.plants.length = 1;
navigate("garden");
await wait(20);
const coinsBefore = store.state.leafCoin;
// The chooser opens before anything is read off it.
click($(".empty-plot"));
await wait(30);
// A leafCoin row, deterministically: featured stock can price in other
// currencies, and the assertion below only watches the coin ledger.
const priceCard = $$(".seed-pick").find((c) => c.textContent?.includes("🪙"));
const price = Number(
  ((priceCard?.querySelector(".seed-pick-meta")?.textContent ?? "").match(/([\d.]+)🪙/)?.[1] ?? "0").replace(/\./g, ""),
);
check("an empty bag offers seeds to buy", $$(".seed-pick").length > 0);
check("and the row states its price", price > 0, `price=${price}`);
const plantsBeforeBuy = store.state.plants.length;
click(priceCard ?? null);
await wait(30);
check("the buy row updates the CTA to purchase", ($(".seed-cta")?.textContent ?? "").includes("Mua"));
click($(".seed-cta"));
await wait(40);
// Bought then planted from a single card press, so the bag ends up back at zero.
// The evidence that it was bought is the coin movement, not the seed count.
check("the seed was bought and sown from that card", store.state.plants.length === plantsBeforeBuy + 1, `${store.state.plants.length}`);
check("and nothing was left in the bag", Object.values(store.state.seeds).every((n) => n === 0), JSON.stringify(store.state.seeds));
check("coins were deducted exactly once", coinsBefore - store.state.leafCoin === price, `${coinsBefore - store.state.leafCoin} vs ${price}`);
check("and the ceremony ran", !!$(".plant-overlay"));
click($(".plant-skip"));
await wait(40);
click($(".plant-reveal-foot .btn"));
await wait(350);

section("9. Nothing leaks between plantings");

setupGarden();
await wait(20);
// Opening and dismissing the chooser must leave nothing behind. Dismissal is a
// tap on the scrim behind the sheet.
click($(".empty-plot"));
await wait(30);
click($(".overlay"));
await wait(20);
check("closing the chooser leaves nothing behind", !$(".seed-sheet") && !$(".overlay"));
await plantViaChooser();
await wait(20);
click($(".plant-skip"));
await wait(50);
click($(".plant-reveal-foot .btn"));
await wait(400);
check("exactly one overlay, cleaned up", $$(".plant-overlay").length === 0);
check("no orphan timers left the page planting", !w.document.body.classList.contains("planting"));

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
if (failures.length) console.log("  failed: " + failures.join("; ") + "\n");
process.exit(failed === 0 ? 0 : 1);
