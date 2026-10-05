/**
 * Photograph the eight elemental impacts and confirm the wiring is real.
 *
 * Two things are being checked, and the second matters more than the first:
 *
 *   1. That a *real* `DAMAGE_APPLIED` produces an `.fx-elem` node with the right
 *      element class. Photographed by calling the spawner directly this would prove
 *      nothing about the wiring — the layer could render beautifully and never be
 *      called, which is exactly what happened with the morph layer once.
 *
 *   2. That the eight are distinguishable by eye. `tools/diag-element-fx.ts` proves
 *      the *geometry* differs; this proves the CSS renders that difference, which is
 *      a separate claim and has failed before for purely CSS reasons.
 *
 * The contact point is identical for all eight on purpose. Same origin, same hit
 * magnitude: any difference in the picture is the element.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
await page.addInitScript(() => {
  window.__name = (f) => f;
});

const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(400);

// --- 1. a real battle, a real hit -------------------------------------------
const built = await page.evaluate(`(async () => {
  const g = window.__game;
  const store = g.store;
  store.state.breederLevel = 60;
  store.state.leafCoin = 50_000_000;
  store.state.nurseryCap = 24;
  const mature = (p) => {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 30;
    p.locks.manual = false;
  };
  for (const p of store.state.plants) mature(p);
  if (store.state.plants.length < 2) {
    for (const id of Object.keys(store.state.seeds)) {
      if ((store.state.seeds[id] || 0) <= 0) continue;
      const r = store.plantSeed(id);
      if (r.ok && r.plantId) {
        const p = store.get(r.plantId);
        if (p) mature(p);
      }
      if (store.state.plants.length >= 2) break;
    }
  }
  const plants = store.state.plants;
  if (plants.length < 2) return "not enough plants";

  const { BattleView } = await import("/src/battle/battleView.ts");
  const container = document.createElement("div");
  document.querySelector(".screen").style.display = "none";
  document.querySelector(".bottomnav").style.display = "none";
  document.querySelector(".shell").appendChild(container);
  window.__view = new BattleView({
    container, plantA: plants[0], plantB: plants[1],
    maxSeconds: 90, mySide: "a", interactive: true,
    onIntent: function () {}, onFinish: function () {},
  });
  window.__view.start();
  return "ok";
})()`);
console.log("battle:", built);

// Slow the clock so an impact's particles are still alive when the shutter fires.
// At full speed a 780ms ember is gone in a frame.
await page.evaluate(`(() => { window.__view.speed = 0.22; })()`);

let realHit: string | null = null;
for (let i = 0; i < 260; i++) {
  // `as string` rather than trusting the inference: Playwright types `evaluate` on its
  // argument, and a string expression comes back as `unknown` rather than as string.
  const found = (await page.evaluate(`(() => {
    const n = document.querySelector(".fx-elem");
    return n ? (n.className || "") : "";
  })()`)) as string;
  if (found) {
    realHit = found;
    break;
  }
  await page.waitForTimeout(25);
}
console.log(
  realHit
    ? `real DAMAGE_APPLIED spawned: ${realHit}`
    : "FAILED: no .fx-elem appeared from a real hit — the wiring is not there",
);
if (!realHit) process.exitCode = 1;

// --- 2. the contact sheet ----------------------------------------------------
//
// One screenshot per element, arena-clipped, at the same origin and the same hit
// magnitude. Sequential rather than composited because there is no image library in
// the toolchain and a stitched sheet would have to be assembled from clip buffers.
const ELEMENTS = ["wood", "fire", "water", "earth", "electric", "poison", "light", "shadow"];

for (const el of ELEMENTS) {
  await page.evaluate(`(() => {
    window.__view.fx.clear();
    document.querySelectorAll(".fx-elem").forEach((n) => n.remove());
    // The quest-complete banner sits over the top of the arena and was covering the
    // glyph in the first run. It is unrelated to this effect, so it is removed rather
    // than tolerated in the photograph.
    document.querySelectorAll(".notice").forEach((n) => (n.style.display = "none"));
  })()`);
  await page.evaluate(`(() => {
    window.__view.fx.elementalHit("b", "${el}", 0.42, "heavy");
  })()`);
  // The longest life in the set is 1000ms; 190ms in is past the stagger, mid-flight.
  await page.waitForTimeout(190);

  // Clipped to the contact point rather than the whole battlefield. The arena is about
  // 760x250 with the fighters at either end, so a full shot renders each impact at
  // roughly 40px across — too small to tell one element from another, which is the
  // only thing this harness exists to judge.
  const clip = await page.evaluate(`(() => {
    const host = document.querySelector(".battle-arena");
    const foe = document.querySelector(".b-enemy");
    if (!host || !foe) return null;
    const hb = host.getBoundingClientRect();
    const fb = foe.getBoundingClientRect();
    const cx = fb.left + fb.width / 2;
    const cy = fb.top + fb.height / 2;
    const half = 118;
    return {
      x: Math.max(0, cx - half),
      y: Math.max(0, cy - half - 20),
      width: Math.min(2 * half, hb.right - Math.max(0, cx - half)),
      height: 2 * half,
    };
  })()`);
  const box = (clip as { x: number; y: number; width: number; height: number } | null) ?? null;
  if (!box) {
    console.error("could not locate the arena; the battle markup changed?");
    process.exitCode = 1;
    break;
  }
  await page.screenshot({ path: `shots/elem-${el}.png`, clip: box });
  const shape = await page.evaluate(`(() => {
    const layer = document.querySelector(".fx-elem");
    if (!layer) return "nothing rendered";
    const ps = [...layer.querySelectorAll(".fx-elem-p")];
    return {
      cls: layer.className,
      particles: ps.length,
      glyph: Boolean(layer.querySelector(".fx-elem-glyph svg")),
      ring: Boolean(layer.querySelector(".fx-elem-ring")),
      // Read the custom properties back off the DOM: this is what the CSS actually
      // receives, not what the module intended to write.
      power: layer.style.getPropertyValue("--power"),
      colour: layer.style.getPropertyValue("--c"),
      firstDx: ps[0]?.style.getPropertyValue("--dx"),
      firstFall: ps[0]?.style.getPropertyValue("--fall"),
    };
  })()`);
  console.log(el.padEnd(9), JSON.stringify(shape));

  // Read the *computed* colours, not the requested ones. A glyph that renders in the
  // wrong colour is invisible in a 236px crop but obvious here, and the previous
  // attempt to judge it by eye produced a confident and wrong conclusion about fire
  // drawing a green flame.
  const computed = await page.evaluate(`(() => {
    const layer = document.querySelector(".fx-elem");
    const p = layer && layer.querySelector(".fx-elem-p");
    const g = layer && layer.querySelector(".fx-elem-glyph path");
    const cs = p ? getComputedStyle(p) : null;
    return {
      particleBg: cs ? cs.backgroundColor : null,
      particleW: cs ? cs.width : null,
      particleH: cs ? cs.height : null,
      glyphFill: g ? getComputedStyle(g).fill : null,
      // Sampled from the layer itself so a colour that never reaches a particle is
      // still visible in the report.
      layerVar: layer ? layer.style.getPropertyValue("--c") : null,
      liveParticles: layer ? [...layer.querySelectorAll(".fx-elem-p")]
        .filter((n) => Number(getComputedStyle(n).opacity) > 0.05).length : 0,
    };
  })()`);
  console.log(" ".repeat(9), JSON.stringify(computed));
}

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();