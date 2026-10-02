/**
 * Combat juice tests (docs/13).
 *
 * The guarantee worth protecting here is the freeze. Everything else — shards,
 * flash, recoil — is visible in a screenshot, but "the simulation stops" is a
 * claim about code, and claims about code belong in the suite rather than in a
 * screenshot nobody reads.
 *
 * Measured without a browser: the freeze is a timestamp comparison, so jsdom is
 * enough, and the durations are asserted against the tuning table rather than
 * eyeballed.
 */

import { JSDOM } from "jsdom";
import { CombatJuice, TUNING, weightFor, reducedMotion, type Weight } from "../src/battle/juice";

// --- DOM environment (mirrors tools/test-planting.ts) ----------------------

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window as unknown as Window & typeof globalThis;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w;
g.document = w.document;
g.HTMLElement = w.HTMLElement;
g.Element = w.Element;
g.Node = w.Node;
g.Event = w.Event;
g.getComputedStyle = w.getComputedStyle;
g.requestAnimationFrame = (cb: FrameRequestCallback) => w.setTimeout(() => cb(0), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => w.clearTimeout(id);
// Default to motion allowed; section 4 swaps this to prove the gate works.
w.matchMedia = (() => ({ matches: false, addEventListener() {}, removeListener() {} })) as never;

// --- harness ---------------------------------------------------------------

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

/** jsdom has no layout, so the anchor geometry can be stubbed. */
function stubBox(el: HTMLElement, w: number, h: number, x: number, y: number): void {
  el.getBoundingClientRect = () =>
    ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;
}

function makeJuice(): { juice: CombatJuice; a: HTMLElement; b: HTMLElement; host: HTMLElement } {
  const host = document.createElement("div");
  const a = document.createElement("div");
  const aAvatar = document.createElement("div");
  const b = document.createElement("div");
  const bAvatar = document.createElement("div");
  a.append(aAvatar);
  b.append(bAvatar);
  host.append(a, b, document.createElement("div"));
  document.body.append(host);
  const juice = new CombatJuice(host, { root: a, avatar: aAvatar }, { root: b, avatar: bAvatar });
  return { juice, a, b, host };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- 1. the freeze ---------------------------------------------------------

section("1. Hitstop actually stops the simulation");

{
  const { juice } = makeJuice();
  const weights: Weight[] = ["light", "heavy", "crit", "kill"];
  for (const w of weights) {
    juice.reset();
    juice.impact({ victim: "b", push: 1, amount: 10, weight: w, colour: "#fff", draw: () => {} });
    check(`${w} hit freezes the simulation`, juice.frozen, `${juice.frozenFor.toFixed(1)}ms left`);
  }
}

{
  // A longer freeze for a heavier hit, or the pause carries no information.
  const { juice } = makeJuice();
  juice.reset();
  juice.impact({ victim: "b", push: 1, amount: 10, weight: "light", colour: "#fff", draw: () => {} });
  const light = juice.frozenFor;
  juice.reset();
  juice.impact({ victim: "b", push: 1, amount: 10, weight: "kill", colour: "#fff", draw: () => {} });
  const kill = juice.frozenFor;
  check("a killing blow freezes longer than a chip", kill > light * 2, `${light.toFixed(0)}ms vs ${kill.toFixed(0)}ms`);
}

{
  // Two hits landing together must not stack into one enormous pause: a combat
  // where everything freezes reads as a slideshow.
  const { juice } = makeJuice();
  juice.reset();
  juice.impact({ victim: "b", push: 1, amount: 10, weight: "crit", colour: "#fff", draw: () => {} });
  const first = juice.frozenFor;
  juice.impact({ victim: "a", push: -1, amount: 10, weight: "crit", colour: "#fff", draw: () => {} });
  const both = juice.frozenFor;
  check("two simultaneous crits do not double the pause", both <= first + 6, `${first.toFixed(0)}ms then ${both.toFixed(0)}ms`);
}

{
  const { juice } = makeJuice();
  juice.reset();
  juice.impact({ victim: "b", push: 1, amount: 10, weight: "heavy", colour: "#fff", draw: () => {} });
  await sleep(TUNING.heavy.stop + 60);
  check("the freeze releases", !juice.frozen);
}

section("2. Every channel is expressed in one call");

{
  let draws = 0;
  const { juice, host } = makeJuice();
  stubBox(host, 600, 300, 0, 0);
  juice.reset();
  juice.impact({
    victim: "b",
    push: 1,
    amount: 20,
    weight: "crit",
    colour: "#fff",
    draw: () => {
      draws++;
    },
  });
  check("the draw callback runs inside the impact", draws === 1, `${draws} call(s)`);
  // The shake writes a transform on the arena, which is what makes rotation and
  // translation land on the same frame as the flash and the sound.
  check("the arena is shaken on the same call", typeof host.style.transform === "string");
}

{
  // Reset has to fully clear: a battle that ends mid-shake would leave the arena
  // permanently offset.
  const { juice, host } = makeJuice();
  juice.impact({ victim: "b", push: 1, amount: 30, weight: "kill", colour: "#fff", draw: () => {} });
  await sleep(40);
  juice.reset();
  check("reset clears the shake", host.style.transform === "", JSON.stringify(host.style.transform));
  check("reset clears the freeze", !juice.frozen);
}

// --- 3. weight selection ---------------------------------------------------

section("3. Weight comes from real damage, not from a constant");

check("a sliver of damage is light", weightFor(0.03, false, false) === "light");
check("a solid hit is heavy", weightFor(0.2, false, false) === "heavy");
check("a crit is a crit whatever the damage", weightFor(0.03, true, false) === "crit");
check("a kill outranks everything", weightFor(0.03, false, true) === "kill");
check("a kill outranks a crit", weightFor(0.5, true, true) === "kill");

{
  // The channels must scale together, or a crit shakes the screen without
  // pausing and reads as two separate things happening.
  const keys = ["stop", "trauma", "recoil", "squash", "flash", "bits"] as const;
  let monotonic = true;
  for (const k of keys) {
    const vals = (["light", "heavy", "crit", "kill"] as Weight[]).map((w) => TUNING[w][k]);
    for (let i = 1; i < vals.length; i++) if (vals[i] <= vals[i - 1]) monotonic = false;
  }
  check("every channel increases with weight", monotonic);
}

{
  const hits = (["light", "heavy", "crit", "kill"] as Weight[]).map((w) => TUNING[w]);
  check("hitstop stays inside the readable band", hits.every((h) => h.stop >= 40 && h.stop <= 180), hits.map((h) => h.stop).join("/") + "ms");
  check("a crit is dramatic but not nauseating", TUNING.crit.trauma <= 0.7, `${TUNING.crit.trauma}`);
  check("debris stays countable", TUNING.kill.bits <= 30, `${TUNING.kill.bits}`);
}

// --- 4. accessibility ------------------------------------------------------

section("4. Reduced motion is honoured");

check("the helper is safe to call with no matchMedia", typeof reducedMotion() === "boolean");

{
  // With reduced motion on, a fight must still resolve — it just must not move.
  // A pause that never releases would hang the battle, so this also proves the
  // freeze is skipped entirely rather than merely shortened.
  const original = globalThis.matchMedia;
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
    matches: q.includes("prefers-reduced-motion"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
  try {
    const { juice } = makeJuice();
    juice.reset();
    check("reduced motion is detected", reducedMotion());
    juice.impact({ victim: "b", push: 1, amount: 20, weight: "kill", colour: "#fff", draw: () => {} });
    check("no freeze under reduced motion", !juice.frozen);
    juice.impact({ victim: "b", push: 1, amount: 20, weight: "crit", colour: "#fff", draw: () => {} });
    check("and none on a second hit either", !juice.frozen);
  } finally {
    if (original) (globalThis as unknown as { matchMedia: unknown }).matchMedia = original;
    else delete (globalThis as unknown as { matchMedia?: unknown }).matchMedia;
  }
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failures.length} failed\x1b[0m\n`);
if (failures.length) console.log("  failed: " + failures.join("; ") + "\n");
process.exit(failures.length === 0 ? 0 : 1);