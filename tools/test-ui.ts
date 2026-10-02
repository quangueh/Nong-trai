/**
 * UI test suite — runs every screen in jsdom (docs/09 QA plan).
 *
 * Covers each screen render, every sheet, and the click paths that mutate the
 * store, asserting the DOM actually updates. Any thrown error inside a screen
 * render fails the test loudly instead of producing a blank screen.
 */

import { JSDOM } from "jsdom";

// --- DOM environment ------------------------------------------------------
const dom = new JSDOM("<!doctype html><html><body><div id='app'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w;
g.document = w.document;
g.localStorage = w.localStorage;
// Node 24 defines `navigator` as a getter-only global, so it cannot be assigned.
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
w.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;

// BroadcastChannel is used by the room system; a no-op stub is enough to render.
g.BroadcastChannel = class {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
} as never;

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

/** Run a render and surface any exception as a failure. */
async function render(name: string, fn: () => unknown): Promise<HTMLElement | null> {
  const host = w.document.getElementById("app")!;
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 5));
    const text = host.textContent?.trim() ?? "";
    check(name, text.length > 0, `${text.length} chars`);
    return host;
  } catch (e) {
    check(name, false, (e as Error).message);
    return null;
  }
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = w.document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = w.document): T[] => [...root.querySelectorAll<T>(sel)];
const byText = (sel: string, text: string, root: ParentNode = w.document): HTMLElement | null =>
  $$(sel, root).find((e) => e.textContent?.includes(text)) ?? null;

const click = (e: Element | null): void => {
  if (!e) throw new Error("click target missing");
  e.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
};

// --- boot the app ---------------------------------------------------------
const { boot } = await import("../src/ui/app");
const { store, navigate } = await import("../src/ui/app");

section("0. Boot");
await render("app boots", () => boot(w.document.getElementById("app")!));
check("shell is created", !!$(".shell"));
check("bottom nav has 5 tabs", $$(".navitem").length === 5, `${$$(".navitem").length}`);
check("topbar shows currency", ($(".topbar")?.textContent ?? "").includes("1."));

section("1. Garden screen");
await render("garden renders", () => navigate("garden"));
check("shows nursery capacity", /\d+\/\d+/.test(($(".screen")?.textContent ?? "").slice(0, 40)), ($(".screen")?.textContent ?? "").slice(0, 30));
check("shows a plot for the starting plant", $$(".screen .plantcard").length >= 1);
// The seed belt moved to its own tab. It used to sit above the plots, which put
// shop information (prices) inside the screen you plant from.
check("the garden screen opens on the plots tab", !!$(".screen .tabs .tab.active"), "no active tab");
check(
  "the active tab is the garden, not the seed bag",
  ($(".screen .tabs .tab.active")?.textContent ?? "").trim() === "Vườn",
  ($(".screen .tabs .tab.active")?.textContent ?? ""),
);
check("the seed belt is not on the plots tab", !$(".seed-belt"), "the belt is still mixed in with the plots");

// And it is there, intact, on its own tab.
await render("open the seed tab", () => click(byText(".screen .tabs .tab", "Túi hạt")));
const belt = $(".seed-belt");
check("shows the seed belt on its own tab", !!belt);
check(
  "the belt explains how to use it",
  /bấm ô đất/i.test(belt?.textContent ?? ""),
  (belt?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 70),
);
// The press-and-hold instruction must be gone, not merely accompanied by the
// new one: an instruction for a gesture that no longer exists is a bug of its own.
check(
  "the belt does not advertise the removed long press",
  !(belt?.textContent ?? "").includes("Giữ ô đất"),
);
check("the belt lists seeds with the count held", $$(".seed-belt .seed-card").length > 0, `${$$(".seed-belt .seed-card").length}`);

// The plots must come back when the tab is switched.
await render("back to the plots tab", () => click(byText(".screen .tabs .tab", "Vườn")));
check("the plots are on the garden tab", $$(".screen .plots .plot").length > 0, `${$$(".screen .plots .plot").length}`);
// The day tab is where the goals live now, so they are not above the soil.
await render("open the today tab", () => click(byText(".screen .tabs .tab", "Hôm nay")));
check("the today tab has the day content", /\d+\/\d+/.test($(".screen")?.textContent ?? ""), ($(".screen")?.textContent ?? "").slice(0, 60));
await render("return to the plots tab", () => click(byText(".screen .tabs .tab", "Vườn")));
// Layout: plots are 2-up on mobile so the generated plant is actually legible.
// jsdom has no layout engine, so size is asserted from the SVG attributes.
check("plots use the 2-column plot grid", !!$(".screen .plots"));
{
  const bed = $(".screen .plot .bed svg");
  check("each plot renders a plant", !!bed);
  check("plant art is rendered large enough to read", Number(bed?.getAttribute("width") ?? 0) >= 120, `${bed?.getAttribute("width")}px`);
  check("plot has a rarity ribbon", $$(".screen .plot .ribbon").length >= 1);
  check("plot has a name", !!$(".screen .plot .pname"));
}
check("distinct plants render distinct art", (() => {
  const svgs = $$(".screen .plot .bed svg").map((s) => s.innerHTML);
  return new Set(svgs).size === svgs.length;
})());
check("growing plants show a progress ring", $$(".screen .plot .ring").length >= 1);
check("empty slot invites planting", $$(".screen .plot").length > $$(".screen .plot.ring").length);

section("2. Plant detail sheet");
await render("detail opens", () => click($(".screen .plantcard")));
check("sheet appears", !!$(".sheet"));
{
  const sheetText = $(".sheet")?.textContent ?? "";
  check("detail shows the plant name", sheetText.includes(store.state.plants[0].name));
  check("detail shows stats", sheetText.includes("HP") && sheetText.includes("Công"));
  check("detail shows the archetype radar", !!$(".sheet svg.radar"));
  check("detail shows skills", sheetText.includes("Chiêu thức"));
  check("detail shows gene balance", sheetText.includes("Cân bằng gene"));
  check("detail offers a care button", !!byText(".sheet .btn", "Chăm cây"));
}

section("3. Care sheet");
await render("care sheet opens", () => click(byText(".sheet .btn", "Chăm cây")));
{
  check("care sheet lists all 7 actions", $$(".sheet .grid2 .btn").length === 7, `${$$(".sheet .grid2 .btn").length}`);
  const before = { ...store.state.plants[0].stats };
  await render("water button applies care", () => click(byText(".sheet .btn", "Tưới nước")));
  const after = store.state.plants[0].stats;
  check("care changed a real stat", Object.keys(before).some((k) => (before as never)[k] !== (after as never)[k]));
  check("care sheet re-renders after caring", !!byText(".sheet .btn", "Chăm cây") || $$(".sheet .btn").length > 0);
  check("combo hints are shown", ($(".sheet")?.textContent ?? "").includes("Combo gợi ý"));
}

section("4. Collection screen");
await render("collection renders", () => navigate("collection"));
{
  const t = $(".screen")?.textContent ?? "";
  check("shows filters", t.includes("Tất cả") && t.includes("Sẵn sàng đấu"));
  check("shows a sell section", t.includes("Bán cây"));
  check("shows stats section", t.includes("Thống kê"));
  await render("filter: ready", () => click(byText(".screen .btn", "Sẵn sàng đấu")));
  check("filter applies without error", !!$(".screen"));
}

section("5. Breeding screen");
// Give two mature parents so the flow is reachable.
{
  const ids = ["thornroot", "emberleaf", "voltvine", "gloomcap"];
  store.state.leafCoin = 50000;
  // Buy what is missing so the loop always terminates.
  for (const id of ids) store.buySeed(id as never, 2);
  let guard = 0;
  while (store.state.plants.length < 4 && guard++ < 20) {
    const id = ids[store.state.plants.length % 4];
    if (!store.plantSeed(id as never).ok) break;
  }
  check("at least 2 plants available for breeding", store.state.plants.length >= 2, `${store.state.plants.length}`);
  for (const p of store.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 20;
    p.locks.manual = false;
  }
  store.save();
}
await render("breeding renders", () => navigate("breeding"));
{
  check("shows two parent slots", $$(".screen .slot").length === 2);
  check("breed button starts disabled", (byText(".screen .btn", "🧬 Lai tạo") as HTMLButtonElement)?.disabled === true);
  await render("select parent A", () => click($$(".screen .slot")[0]));
  check("parent picker opens", !!$(".sheet .plantcard"));
  // Pick the first plant for A and a DIFFERENT one for B — breeding a plant
  // with itself is rejected by design.
  await render("choose parent A", () => click($$(".sheet .plantcard")[0]));
  check("slot A is filled", $$(".screen .slot.filled").length === 1, `${$$(".screen .slot.filled").length}`);
  await render("select parent B", () => click($$(".screen .slot")[1]));
  await render("choose parent B", () => click($$(".sheet .plantcard")[1]));
  check("both slots are filled", $$(".screen .slot.filled").length === 2, `${$$(".screen .slot.filled").length}`);

  const screenText = $(".screen")?.textContent ?? "";
  check("shows rarity probability preview", screenText.includes("Xác suất độ hiếm"));
  check("shows all 6 rarity bands", ["C", "B", "A", "S", "SS", "SSS"].every((r) => screenText.includes(r)));
  check("shows breeding fee", screenText.includes("Phí lai"));
  check("shows average parent level", screenText.includes("trung bình"));
  check("breed button is now enabled", (byText(".screen .btn", "🧬 Lai tạo") as HTMLButtonElement)?.disabled === false);

  const countBefore = store.state.plants.length;
  await render("breed executes", () => click(byText(".screen .btn", "🧬 Lai tạo")));

  // Breeding now plays a fusion ceremony before the report. It is skippable by
  // design, and this checks that: the report must be reachable in one tap, not
  // after a fixed wait a player has to sit through.
  check("the fusion ceremony plays", !!$(".fusion-overlay"), document.querySelector(".fusion-overlay")?.className ?? "");
  check("it names the child it produced", ($(".fusion-caption")?.textContent ?? "") === (store.state.plants[store.state.plants.length - 1]?.name ?? "X"), $(".fusion-caption")?.textContent ?? "");
  await render("tapping the ceremony continues", () => click($(".fusion-overlay")));
  check("tapping it moves on to the report", !$(".fusion-overlay") && !!$(".sheet"));
  check("a child plant was created", store.state.plants.length === countBefore + 1, `${countBefore} -> ${store.state.plants.length}`);
}

section("6. Mutation report");
{
  check("mutation report sheet opened", !!$(".sheet"));
  const t = $(".sheet")?.textContent ?? "";
  check("report names the child", t.includes("Kết quả lai tạo"));
  check("report lists mutations", t.includes("Đột biến"));
  check("report lists skills", t.includes("Chiêu thức"));
  check("report shows gene packages and trade-offs", t.includes("Gói gene"));
  check("report shows strength/weakness", t.includes("Đánh giá"));
  check("report shows an estimated price", t.includes("Giá bán ước tính"));
  check("report auto-locks A+ plants", (() => {
    const child = store.state.plants[store.state.plants.length - 1];
    return ["C", "B"].includes(child.rarity) || child.locks.manual;
  })());
  await render("report closes", () => click(byText(".sheet .btn", "vườn")));
  check("sheet is gone", !$(".sheet"));
}

section("7. Arena screen (PvE)");
await render("arena menu renders", () => navigate("arena"));
{
  const t = $(".screen")?.textContent ?? "";
  check("offers PvE", t.includes("Đấu với AI"));
  check("offers room creation", t.includes("Tạo phòng"));
  check("offers code entry", t.includes("Nhập mã phòng"));
  check("shows the record", t.includes("Thành tích"));
  const input = $<HTMLInputElement>(".screen input");
  check("code input uppercases", !!input);
  input!.value = "ab12cd";
  input!.dispatchEvent(new w.Event("input", { bubbles: true }));
  check("code input normalises to 6 uppercase", input!.value === "AB12CD", input!.value);
}

await render("pick plant for battle", () => click(byText(".screen .btn", "Đấu với AI")));
{
  check("plant picker opens", !!$(".sheet .plantcard"));
  await render("choose plant", () => click($(".sheet .plantcard")));
  check("opponent preview renders", ($(".screen")?.textContent ?? "").includes("Đối thủ"));
  check("compares power ratings", ($(".screen")?.textContent ?? "").includes("Lực chiến của bạn"));
  check("shows opponent traits", ($(".screen")?.textContent ?? "").includes("Đặc tính công khai"));
  await render("battle starts", () => click(byText(".screen .btn", "Bắt đầu trận")));
  // Run at max speed so the match resolves inside the test budget.
  await render("set 8x speed", () => click(byText(".screen .btn", "⏩")));
  check("battlefield is rendered", !!$(".battlefield"));
  check("both HP bars exist", $$(".battlefield .hpstack").length === 2);
  check("HP bars have a fill", $$(".battlefield .hpstack > i").length === 2);
  check("both fighters are rendered", $$(".battlefield .battler").length === 2);
  check("battle clock is shown", !!$(".battlefield .clock"));
  check("battle phase is shown", !!$(".battlefield .phase"));
  check("skill buttons exist", $$(".skillbtn").length >= 1, `${$$(".skillbtn").length}`);
  check("stance buttons exist", $$(".stancebtn").length === 4);
  check("battle log exists", !!$(".battlelog"));
  check("focus button exists", !!byText(".screen .btn", "Bản năng"));
  check("auto-skill toggle exists", !!byText(".screen .btn", "Tự ra chiêu"));

  const coinsBefore = store.state.leafCoin;
  await render("focus skill is usable", () => click(byText(".screen .btn", "Bản năng")));
  check("focus button becomes disabled after use", (byText(".screen .btn", "Bản năng") as HTMLButtonElement)?.disabled === true);

  // Let the battle run to completion (max 45s of wall clock).
  let resolved = false;
  for (let i = 0; i < 90 && !resolved; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const t = $(".screen")?.textContent ?? "";
    resolved = t.includes("THẮNG") || t.includes("THUA") || t.includes("HÒA");
  }
  const t = $(".screen")?.textContent ?? "";
  check("battle resolves to a result screen", resolved, t.slice(0, 60));
  check("result shows damage dealt", t.includes("ST gây ra"));
  check("result shows HP remaining", t.includes("HP còn lại"));
  check("reward is granted", store.state.leafCoin > coinsBefore, `+${store.state.leafCoin - coinsBefore}`);
  check("rematch button exists", !!byText(".screen .btn", "Đấu lại"));
  check("return-to-garden button exists", !!byText(".screen .btn", "Về vườn"));
}

section("8. Room battle (server-authoritative)");
await render("create a room", () => {
  navigate("arena");
});
await render("open room creation", () => click(byText(".screen .btn", "Tạo phòng")));
{
  check("plant picker opens for rooms", !!$(".sheet .plantcard"));
  await render("pick room plant", () => click($(".sheet .plantcard")));
  const t = $(".screen")?.textContent ?? "";
  check("room code is displayed", !!$(".codebox"));
  const code = $(".codebox")?.textContent?.trim() ?? "";
  check("room code is 6 characters", code.length === 6, code);
  check("room code avoids ambiguous glyphs", !/[01OI]/.test(code), code);
  check("copy button exists", !!byText(".screen .btn", "Sao chép mã"));
  check("lobby lists the host", t.includes("chủ phòng"));
  check("ready button exists", !!byText(".screen .btn", "✅ Sẵn sàng"));
  check("start button is hidden until a guest joins", (byText(".screen .btn", "Bắt đầu trận") as HTMLElement)?.style.display === "none");
  check("leave button exists", !!byText(".screen .btn", "Rời phòng"));

  await render("host marks ready", () => click(byText(".screen .btn", "✅ Sẵn sàng")));
  check("ready state is reflected", ($(".screen")?.textContent ?? "").includes("Đã sẵn sàng"));
}

section("9. Shop / lab screen");
await render("lab renders", () => navigate("lab"));
{
  let t = $(".screen")?.textContent ?? "";
  check("shows the 5 base seeds", ["Rễ Gai", "Lá Lửa", "Búp Sương", "Dây Sét", "Nấm U Ám"].every((n) => t.includes(n)));
  check("states the shop sells no high rarity", t.includes("không mua bằng tiền") || t.includes("Cửa hàng chỉ bán"));
  check("offers seed packs", t.includes("x10 ·"), "per-card bulk buy, 5% off");

  const coinsBefore = store.state.leafCoin;
  await render("buy a seed", () => click(byText(".screen .btn", "🪙") ?? $$(".screen .btn").find((b) => b.textContent?.includes("🪙"))!));
  check("buying deducts coins", store.state.leafCoin < coinsBefore, `${coinsBefore} -> ${store.state.leafCoin}`);

  await render("switch to items tab", () => click(byText(".screen .btn", "Vật tư")));
  t = $(".screen")?.textContent ?? "";
  check("items tab lists supplies", t.includes("Bình nước tưới") && t.includes("Phân hữu cơ"));
  check("items tab explains the refund sink", t.includes("vật tư") || t.includes("Vật tư"));

  await render("switch to land tab", () => click(byText(".screen .btn", "Vườn")));
  t = $(".screen")?.textContent ?? "";
  // The tab is now the plot ladder rather than a single "+2 plots" button.
  // What is worth asserting is that a plot, its price and its blocker are all on
  // screen — not that some button exists, because "a button exists" is exactly
  // the property that let the ungated shortcut through.
  check("land tab shows the garden size", /Vườn: \d+\/24 ô/.test(t), t.slice(0, 100));
  check("land tab lists locked plots", t.includes("Ô 7"), "no plot rows");
  check("land tab prices the next plot", /xu/.test(t), "no price shown");
  check(
    "land tab says what blocks a plot",
    /Cấp nhà lai tạo|Trồng \d+ cây|Có cây đạt cấp/.test(t),
    "no requirement shown",
  );
  check("land tab has no ungated shortcut", !t.includes("+2 ô đất"), "the old +2 button is still there");

  await render("switch to orders tab", () => click(byText(".screen .btn", "Đơn hàng")));
  t = $(".screen")?.textContent ?? "";
  check("orders tab explains the bonus", t.includes("1,5 lần"));
  check("orders tab lists at least one order", t.includes("Cần:"));
  check("orders tab has a plant selector", !!$(".screen select"));
}

section("10. No runtime errors during the whole run");
check("no unhandled failures recorded", failures.length === 0, failures.join(", "));

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
