/**
 * Preferences: one answer, two controls, both persistent.
 *
 * ## What is actually being checked
 *
 * `reducedMotion()` existed three times — in `audio/audio.ts`, `battle/juice.ts` and inline in
 * `battle/battleFx.ts` — each reading `matchMedia` itself. Three answers to one question, none
 * of which a player could overrule. The refactor's claim is that they are now one answer, and a
 * claim like that is worth nothing unless something fails when it stops being true.
 *
 * So the first half of this suite is **structural**: it reads the source and fails if a second
 * place ever starts asking the operating system directly. A fourth copy is the exact
 * regression, and no behavioural test would catch it — three copies agreeing is indistinguishable
 * from three copies disagreeing if you only ever compare their outputs on a machine whose OS
 * says one particular thing.
 *
 * The second half is behavioural, in node: the resolution rules, persistence, and the clamp.
 * The third is the part a player touches — the controls in the settings sheet, and whether
 * they survive a reload.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/ux", { recursive: true });

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* ------------------------------------------------------ 1. structurally, one answer */

console.log("only one place asks the operating system:");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.includes("tools")) out.push(p);
  }
  return out;
}

const sources = walk("src").map((p) => ({ path: p, text: readFileSync(p, "utf8") }));

/*
 * Every file that asks `matchMedia("(prefers-reduced-motion` directly, minus the one that owns
 * the preference. `prefs.ts` is the owner; anything else is a second opinion.
 */
const askers = sources
  .filter((s) => !s.path.replace(/\\/g, "/").endsWith("core/prefs.ts"))
  .filter((s) => /matchMedia\(\s*["'`]prefers-reduced-motion/.test(s.text))
  .map((s) => s.path.replace(/\\/g, "/"));

console.log(`  files still asking the OS directly: ${askers.length ? askers.join(", ") : "none"}`);
check(
  "no module outside core/prefs reads the OS preference itself",
  askers.length === 0,
  askers.join(", "),
);

/* The three that used to be separate must now route through prefs. */
const ROUTED = ["src/audio/audio.ts", "src/battle/juice.ts", "src/battle/battleFx.ts"];
for (const p of ROUTED) {
  const s = sources.find((x) => x.path.replace(/\\/g, "/").endsWith(p));
  const routes = Boolean(s && /core\/prefs/.test(s.text));
  check(`${p} asks core/prefs instead of deciding for itself`, routes);
}

/* ----------------------------------------------- 2. behaviourally, in node, with stubs */

console.log("\nthe rules, with a stubbed operating system:");

/*
 * `matchMedia` is defined here rather than shimmed through a global, because the module reads it
 * at call time but `prefs.ts` decides between `system`, `full` and `reduce` from stored state —
 * and the point of the test is that an explicit choice survives a hostile OS.
 */
let osReduced = false;
(globalThis as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({
  matches: q.includes("prefers-reduced-motion") ? osReduced : false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

/* Imported after the globals exist, because the module reads them at load time.
 *
 * The specifier is built from parts so `tsc` does not reject a `.ts` extension — this is a
 * dynamic import at runtime, not a build-time module edge. */
const SPEC = "../src/core/prefs.ts";
const prefs = await import(SPEC);

/**
 * A second, independent copy of the module.
 *
 * Needed because `prefs` reads storage exactly once, at load — which is correct: a preference
 * is not something to re-parse on every animation frame. It also means writing to storage by
 * hand does not change a live module, and an earlier version of this suite did exactly that
 * and reported two failures that were really about the test.
 *
 * Re-importing under a different query string is a fresh module instance, so this exercises the
 * real load path: what a player gets after a reload.
 */
let copy = 1;
async function reload(): Promise<typeof prefs> {
  copy++;
  return (await import(`${SPEC}?copy=${copy}`)) as typeof prefs;
}

/* --- the three states resolve independently of the OS, in both directions --- */
prefs.setMotionPref("system");
osReduced = false;
check("system follows an OS that says animate", prefs.reducedMotion() === false);

osReduced = true;
check("system follows an OS that says reduce", prefs.reducedMotion() === true);

/* An explicit 'full' must win against an OS asking for less. */
prefs.setMotionPref("full");
osReduced = true;
check("'full' overrides an OS that asks for less motion", prefs.reducedMotion() === false);

/* An explicit 'reduce' must win against an OS that is perfectly happy. */
prefs.setMotionPref("reduce");
osReduced = false;
check("'reduce' overrides an OS that is happy", prefs.reducedMotion() === true);

/*
 * The case a boolean cannot hold: a player who turned motion down and later changes their OS.
 * Under `system` the answer follows the OS again — which is what "follow the system" means, and
 * why the preference is three states rather than one.
 */
prefs.setMotionPref("system");
osReduced = true;
check("'system' keeps following when the OS changes", prefs.reducedMotion() === true);

/* --- the load path, which is what a player actually gets after a reload --- */
mem.set("nongtrai.motion", "reduce");
osReduced = false;
{
  const fresh = await reload();
  check("a reload restores 'reduce' even against an OS asking for animation", fresh.reducedMotion() === true);
  check("and the fresh copy reports the same preference", fresh.motionPref() === "reduce", fresh.motionPref());
}

/* An unrecognised stored value is not trusted; it falls back to following the OS. */
mem.set("nongtrai.motion", "yes please");
osReduced = true;
{
  const fresh = await reload();
  check(
    "an unrecognised stored value falls back to the OS, not to a guess",
    fresh.reducedMotion() === true && fresh.motionPref() === "system",
    `${fresh.motionPref()} / reduced=${fresh.reducedMotion()}`,
  );
}

/* --- the setter persists, which is the half that is easy to leave out --- */
mem.delete("nongtrai.motion");
prefs.setMotionPref("reduce");
check("setMotionPref writes to storage", mem.get("nongtrai.motion") === "reduce", String(mem.get("nongtrai.motion")));
check("and takes effect immediately", prefs.reducedMotion() === true);

/* --- volume is clamped and persisted --- */
mem.delete("nongtrai.volume");
prefs.setVolume(0.4);
check("setVolume persists a sane value", mem.get("nongtrai.volume") === "40", String(mem.get("nongtrai.volume")));
check("and reads it back", Math.abs(prefs.volume() - 0.4) < 1e-9, String(prefs.volume()));

prefs.setVolume(9);
check("a slider dragged past the end is clamped, not stored", prefs.volume() === 1, String(prefs.volume()));
prefs.setVolume(-4);
check("and so is one dragged before the start", prefs.volume() === 0, String(prefs.volume()));
prefs.setVolume(Number.NaN);
check("and a slider reporting NaN falls back to a usable value", prefs.volume() > 0 && prefs.volume() <= 1, String(prefs.volume()));

/* A private-mode throw must not take the settings screen down with it. */
const hostile = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};
(globalThis as unknown as { localStorage: unknown }).localStorage = hostile;
prefs.setMotionPref("full");
prefs.setVolume(0.5);
check("storage being blocked is survivable, not fatal", prefs.motionPref() === "full" && prefs.volume() === 0.5);
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

/* ------------------------------------------------- 3. what the player actually touches */

console.log("\nthe controls, as a player reaches them:");

const browser = await chromium.launch();
try {
  /* A phone, because that is where the settings sheet is opened on. */
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error" && !/GSI_LOGGER|403|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200));
  });

  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(`(() => {
    const a = [...document.querySelectorAll("a, button")].find(x => /không cần tài khoản/i.test(x.textContent || ""));
    if (a) a.click();
  })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => localStorage.clear())()`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(800);

  /* Opened through its real button, not by calling the function. The gear is
     an SVG icon now, so the handle is its accessible name, not a glyph. */
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      x => /Cài đặt/.test(x.getAttribute("aria-label") || "") || /⚙/.test(x.textContent || ""),
    );
    if (b) b.click();
  })()`);
  await page.waitForTimeout(600);

  const shown = (await page.evaluate(`(() => ({
    slider: Boolean(document.querySelector(".volumeslider")),
    motion: Boolean(document.querySelector(".account-value")),
    rows: document.querySelectorAll(".account-rowbtn").length,
    overflows: document.querySelector(".sheet") ? document.querySelector(".sheet").scrollWidth > document.querySelector(".sheet").clientWidth : null,
  }))()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(shown)}`);
  check("a volume slider is in the settings", shown.slider === true);
  check("a motion control is in the settings", shown.motion === true);
  check("the settings sheet does not overflow its own width", shown.overflows === false, String(shown.overflows));
  await page.screenshot({ path: "shots/ux/prefs-settings-phone.png" });

  /* --- the motion control cycles through all three and names the current one --- */
  const cycle = (await page.evaluate(`(() => {
    const row = [...document.querySelectorAll(".account-rowbtn")].find(x => /Chuyển động/.test(x.textContent || ""));
    if (!row) return { error: "no motion row" };
    const read = () => (row.querySelector(".account-value")?.textContent ?? "").trim();
    const seen = [read()];
    for (let i = 0; i < 3; i++) {
      row.click();
      seen.push(read());
    }
    return { seen, stored: localStorage.getItem("nongtrai.motion") };
  })()`)) as { seen?: string[]; error?: string; stored?: string };
  console.log(`  motion cycle: ${JSON.stringify(cycle)}`);
  check(
    "the motion control names the current state, and all three are reachable",
    Array.isArray(cycle.seen) && new Set(cycle.seen).size === 3,
    JSON.stringify(cycle),
  );

  /* --- the slider persists across a reload, which is the half that is easy to leave out --- */
  const vol = (await page.evaluate(`(() => {
    const s = document.querySelector(".volumeslider");
    s.value = "40";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    return { stored: localStorage.getItem("nongtrai.volume"), label: document.querySelector(".account-volume .tiny")?.textContent ?? "" };
  })()`)) as Record<string, unknown>;
  console.log(`  after dragging to 40: ${JSON.stringify(vol)}`);
  check("dragging the slider persists the value", vol.stored === "40", String(vol.stored));
  check("and the caption follows the handle", String(vol.label).includes("40"), String(vol.label));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(800);
  const after = (await page.evaluate(`(() => ({
    volume: localStorage.getItem("nongtrai.volume"),
    motion: localStorage.getItem("nongtrai.motion"),
  }))()`)) as Record<string, unknown>;
  console.log(`  after reload: ${JSON.stringify(after)}`);
  check("the volume survives a reload", after.volume === "40", String(after.volume));
  check("and so does the motion choice", typeof after.motion === "string" && (after.motion as string).length > 0, String(after.motion));

  /* --- reduced motion reachable without an OS setting --- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const forced = await ctx.newPage();
  await forced.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await forced.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await forced.waitForTimeout(800);
  const osSays = (await forced.evaluate(`(() => matchMedia("(prefers-reduced-motion: reduce)").matches)()`)) as boolean;
  check("the emulated OS preference reaches the page", osSays === true);

  await forced.evaluate(`(() => localStorage.setItem("nongtrai.motion", "full"))()`);
  await forced.reload({ waitUntil: "networkidle" });
  await forced.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await forced.waitForTimeout(700);
  await forced.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      x => /Cài đặt/.test(x.getAttribute("aria-label") || "") || /⚙/.test(x.textContent || ""),
    );
    if (b) b.click();
  })()`);
  await forced.waitForTimeout(600);
  const label = (await forced.evaluate(`(() => {
    const row = [...document.querySelectorAll(".account-rowbtn")].find(x => /Chuyển động/.test(x.textContent || ""));
    return row?.querySelector(".account-value")?.textContent?.trim() ?? "";
  })()`)) as string;
  check("an explicit 'full' survives an OS that asks for less motion", label === "Đầy đủ", label);
  await ctx.close();

  check("no page errors across the whole settings flow", errs.length === 0, errs.join(" | "));
} finally {
  await browser.close();
}

console.log(bad ? `\n${bad} failed` : "\none answer, two controls, both persistent");
if (bad) process.exit(1);