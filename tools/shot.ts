/**
 * Screenshot harness.
 *
 * The one thing that was missing from this project's feedback loop: actually
 * looking at the game. `browser.screenshot` needs a visible desktop window,
 * which this environment does not have, so every earlier visual judgement was
 * an inference from numbers. This drives a headless Chromium against the dev
 * server and writes PNGs that can be opened directly.
 *
 * Usage:
 *   npx tsx tools/shot.ts                 # all screens, desktop width
 *   npx tsx tools/shot.ts --mobile        # 390px viewport
 *   npx tsx tools/shot.ts --plants        # contact sheet of 24 plants
 *   npx tsx tools/shot.ts --battle        # mid-battle frame
 *   npx tsx tools/shot.ts --audit         # contrast / tap-target / overflow audit
 *   npx tsx tools/shot.ts --planting      # planting ceremony, four frames
 *   npx tsx tsx tools/shot.ts --out shots
 */

import { chromium, type Browser } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string, d: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const OUT = resolve(val("--out", "shots"));
const URL = val("--url", "http://localhost:5173");
const MOBILE = has("--mobile");
const WIDTH = MOBILE ? 390 : 1180;
const HEIGHT = MOBILE ? 844 : 900;

mkdirSync(OUT, { recursive: true });

/** Seed a game with a varied, mature collection so screens have real content. */
const SEED_SCRIPT = () => {
  const g = (window as unknown as { __game: any }).__game;
  const s = g.store;
  s.state.leafCoin = 900000;
  s.state.geneCrystal = 400;
  s.state.items = 900;
  s.state.breederLevel = 12;
  const species = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud"];
  for (const sp of species) s.buySeed(sp, 8);
  let guard = 0;
  while (s.state.plants.length < 14 && guard++ < 60) {
    if (!s.plantSeed(species[s.state.plants.length % species.length]).ok) break;
  }
  // Plots now cost coins and need an unlock condition, so there is nothing to
  // loop on. The seed state wants a full garden for the layout shots, which is
  // what the cap is for.
  s.state.nurseryCap = 24;
  s.state.breederLevel = 60;
  const mature = (p: any) => {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 30;
    p.locks.manual = false;
  };
  for (const p of s.state.plants) mature(p);
  for (let i = 0; i < 12; i++) {
    const a = s.state.plants[i % s.state.plants.length];
    const b = s.state.plants[(i + 3) % s.state.plants.length];
    s.breed(a.plantId, b.plantId);
  }
  for (const p of s.state.plants) mature(p);
  // A few short names so the contact sheet is readable.
  s.save();
};

/**
 * Confirm the page is running the stylesheet in `src/styles.css`.
 *
 * Reads a selector that only exists in the current source. A stale CSS bundle
 * means every screenshot below is a picture of the old design with the new
 * markup, and every judgement drawn from it is wrong.
 */
/**
 * Refuse to take a screenshot against a stylesheet the page has not loaded.
 *
 * A dev server left over from an earlier session served a stale CSS bundle while
 * the JavaScript stayed current. Every screenshot taken through it showed the new
 * markup with the old styling, and I read the result as "the new CSS is broken"
 * and started changing working rules to fix a fault that had never been applied.
 *
 * The check is *coverage*, not a single marker: every top-level class selector in
 * `src/styles.css` must be present in the page's stylesheets. A stale bundle is
 * missing some of them by definition. An earlier version checked one selector
 * derived from the file — which resolved to `.hpstack`, an old rule a stale
 * bundle would very likely still contain, so it would have passed exactly when it
 * was needed.
 *
 * Because the selector list is read from the source on every run, the test cannot
 * rot into always passing the way a hardcoded marker would.
 */
async function assertStylesheetIsCurrent(page: import("playwright-core").Page): Promise<void> {
  const css = readFileSync("src/styles.css", "utf8");
  // Top-level class selectors only: indented ones live inside media queries and
  // are still real rules, but this list is for coverage, not for a complete census.
  const wanted = [...new Set([...css.matchAll(/^\.([a-z][a-z0-9-]*)\s*[,{]/gm)].map((m) => "." + m[1]))];
  if (wanted.length === 0) {
    console.error("!! No class selectors found in src/styles.css — cannot verify the stylesheet.");
    process.exitCode = 1;
    return;
  }

  // The selector list is embedded rather than passed as an argument: `evaluate`
  // given a string evaluates it as an expression and silently drops any second
  // argument, so a `(sels) => ...` form arrives with `sels === undefined`.
  const missing = (await page.evaluate(`(() => {
    const sels = ${JSON.stringify(wanted)};
    const have = new Set();
    for (const sh of [...document.styleSheets]) {
      let rules;
      try {
        rules = sh.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of rules) {
        const sel = rule.selectorText;
        if (!sel) continue;
        // Split on commas: ".a, .b {}" lists both, and an exact compare on the
        // whole selector would miss either half.
        for (const part of sel.split(",")) have.add(part.trim());
      }
    }
    return sels.filter((s) => !have.has(s));
  })()`)) as string[];

  if (missing.length > 0) {
    const pct = ((1 - missing.length / wanted.length) * 100).toFixed(1);
    console.error(
      `\n!! The page has NOT loaded the current stylesheet.\n` +
        `   ${missing.length}/${wanted.length} top-level selectors from src/styles.css are\n` +
        `   missing from the page (${pct}% present). First few: ${missing.slice(0, 6).join(", ")}\n` +
        `\n` +
        `   Any screenshot now would show the OLD design with the NEW markup, and\n` +
        `   judging it would be judging a fault that was never on screen.\n` +
        `   Restart the dev server, then re-run.\n`,
    );
    process.exitCode = 1;
  }
}

/**
 * Capture what a player actually sees: the viewport, not the document.
 *
 * The old default was `fullPage: true` and it concealed a complete layout failure
 * for a whole session. The shell was 2,299px tall with the navigation bar and
 * every sheet anchored to its bottom, so on an 820px screen none of them were
 * visible and tapping a plant did nothing at all. Every screenshot looked correct,
 * because a full-page image is exactly as tall as the bug.
 *
 * `full` is now opt-in, for a contact sheet of many specimens where the point is
 * to see them side by side rather than to answer "what is on screen".
 */
async function shot(page: import("playwright-core").Page, name: string, full = false): Promise<void> {
  const path = `${OUT}/${name}.png`;

  if (!full) {
    // The one measurement that would have caught it. Worth a round trip.
    //
    // The trailing `()` is load-bearing. Playwright evaluates a string argument as
    // an *expression*, so `(() => ({ … }))` is the function object, which does not
    // serialise and comes back as the value `undefined`. Third time this has cost
    // an hour in this project; every page-side snippet is now a called expression.
    const m = (await page.evaluate(`(() => {
      return { doc: document.documentElement.scrollHeight, view: window.innerHeight };
    })()`)) as { doc: number; view: number };
    if (m.doc > m.view + 2) {
      console.log(
        `  WARN ${name}: document is ${m.doc}px in a ${m.view}px viewport — ` +
          `something is positioned against the page instead of the shell.`,
      );
    }
  }

  await page.screenshot({ path, fullPage: full });
  console.log(`  ${name}.png`);
}

/**
 * Page-side snippets are passed to `page.evaluate` as source strings.
 *
 * They have to be strings, not functions: they do a dynamic import of
 * `/src/render/plantRenderer.ts`, which is a browser absolute specifier that
 * Node-side tsc cannot resolve, and a string keeps it out of the type check
 * entirely.
 */
const PLANTS_SHEET = `(async () => {
  const g = window.__game;
  const mod = await import("/src/render/plantRenderer.ts");
  const plants = g.store.state.plants.filter((p) => p.growth.stage === "mature").slice(0, 24);
  document.body.innerHTML = '<div id="sheet" style="background:#f6ecd2;padding:20px;display:grid;grid-template-columns:repeat(6,1fr);gap:14px;font:11px/1.35 system-ui;color:#26351d"></div>';
  const sheet = document.getElementById("sheet");
  for (const p of plants) {
    const cell = document.createElement("div");
    cell.style.cssText = "background:#fdf6e3;border:1px solid #d8c9a0;border-radius:14px;padding:8px;text-align:center";
    cell.innerHTML = mod.renderPlantSvg(p, 150)
      + '<div style="margin-top:6px;font-weight:700">' + p.rarity + ' \\u00b7 \\u0110\\u1ed7i ' + p.generation + '</div>'
      + '<div style="color:#5f7b4d">' + p.dna.bodyGenes.stem + '/' + p.dna.bodyGenes.flower + '</div>';
    sheet.appendChild(cell);
  }
})()`;

const STAGES_SHEET = `(async () => {
  const g = window.__game;
  const mod = await import("/src/render/plantRenderer.ts");
  const stages = ["seed", "sprout", "young", "mature", "awakened"];
  const base = g.store.state.plants.find((p) => p.growth.stage === "mature");
  document.body.innerHTML = '<div id="sheet" style="background:#f6ecd2;padding:20px;display:grid;grid-template-columns:repeat(5,1fr);gap:14px;font:12px system-ui;color:#26351d"></div>';
  const sheet = document.getElementById("sheet");
  for (const st of stages) {
    const q = structuredClone(base);
    q.growth.stage = st;
    const cell = document.createElement("div");
    cell.style.cssText = "background:#fdf6e3;border:1px solid #d8c9a0;border-radius:14px;padding:8px;text-align:center";
    cell.innerHTML = mod.renderPlantSvg(q, 170) + '<div style="font-weight:700;margin-top:6px">' + st + '</div>';
    sheet.appendChild(cell);
  }
})()`;

/** One plant at large size, for judging the silhouette and leaf shapes. */
const ZOOM_SHEET = `(async () => {
  const g = window.__game;
  const mod = await import("/src/render/plantRenderer.ts");
  const plants = g.store.state.plants.filter((p) => p.growth.stage === "mature").slice(0, 4);
  document.body.innerHTML = '<div id="sheet" style="background:#f6ecd2;padding:24px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px;font:13px system-ui;color:#26351d"></div>';
  const sheet = document.getElementById("sheet");
  for (const p of plants) {
    const cell = document.createElement("div");
    cell.style.cssText = "background:#fdf6e3;border:1px solid #d8c9a0;border-radius:16px;padding:10px;text-align:center";
    cell.innerHTML = mod.renderPlantSvg(p, 320)
      + '<div style="margin-top:8px;font-weight:700">' + p.name + '</div>'
      + '<div style="color:#5f7b4d">cx' + Math.round(p.visual.complexity*100) + ' hue' + Math.round(p.visual.hue) + '</div>';
    sheet.appendChild(cell);
  }
})()`;

/**
 * Report any geometry that leaves the 100x100 viewBox, per layer.
 *
 * The solver in the renderer is supposed to keep every plant inside the frame;
 * this is how that claim is checked against a real layout engine rather than
 * against the renderer's own arithmetic.
 */
const BOUNDS_CHECK = `(async () => {
  const g = window.__game;
  const mod = await import("/src/render/plantRenderer.ts");
  const stages = ["seed", "sprout", "young", "mature", "awakened"];
  const bad = [];
  const stats = {};
  for (const p of g.store.state.plants) {
    for (const stage of stages) {
      const q = structuredClone(p);
      q.growth.stage = stage;
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-9999px;top:0;width:150px;height:150px";
      host.innerHTML = mod.renderPlantSvg(q, 150);
      document.body.appendChild(host);
      const svg = host.querySelector("svg");
      const bb = svg.getBBox();
      for (const layer of svg.querySelectorAll(":scope > g")) {
        const b = layer.getBBox();
        const over = Math.max(-b.x, -b.y, b.x + b.width - 100, b.y + b.height - 100);
        const cls = layer.getAttribute("class") || "?";
        stats[cls] = Math.max(stats[cls] || 0, Math.round(over * 10) / 10);
        if (over > 0.5) bad.push(p.name.slice(0, 14) + "/" + stage + " " + cls + " +" + over.toFixed(1));
      }
      host.remove();
    }
  }
  return { bad: bad.slice(0, 20), badCount: bad.length, stats };
})()`;

async function main(): Promise<void> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error("Khong khoi dong duoc Chromium:", (e as Error).message);
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  // tsx compiles with esbuild's `keepNames`, which rewrites every arrow function
  // into a `__name()` helper call. That helper does not exist in the page, so any
  // snippet passed to `evaluate` fails with "__name is not defined". Installing a
  // pass-through before navigation makes the snippets run unmodified.
  await page.addInitScript(() => {
    (window as unknown as { __name?: (f: unknown) => unknown }).__name = (f) => f;
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  // Checked right after load, before anything else can fail.
  //
  // It was previously called after `waitForFunction(__game)`, which meant a page
  // that failed to boot — precisely the situation where you most want to know the
  // styling is stale — timed out before the guard ever ran. A stale stylesheet is
  // also the usual reason a dev server misbehaves, so checking first turns a
  // bare 30-second timeout into the actual cause.
  await assertStylesheetIsCurrent(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });

  await page.evaluate(SEED_SCRIPT);
  await page.waitForTimeout(400);

  if (has("--plants")) {
    await page.evaluate(PLANTS_SHEET);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/plants.png`, fullPage: true });
    console.log("  plants.png");
  }

  if (has("--bounds")) {
    const r = (await page.evaluate(BOUNDS_CHECK)) as { bad: string[]; badCount: number; stats: Record<string, number> };
    console.log(`\n  vuot khung: ${r.badCount}`);
    for (const b of r.bad) console.log("   " + b);
    console.log("  layer worst overflow:", JSON.stringify(r.stats));
  }
  if (has("--zoom")) {
    await page.evaluate(ZOOM_SHEET);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/zoom.png`, fullPage: true });
    console.log("  zoom.png");
  }
  if (has("--stages")) {
    await page.evaluate(STAGES_SHEET);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/stages.png`, fullPage: true });
    console.log("  stages.png");
  }
  // --- planting ceremony ---
  //
  // Captured mid-ritual, because the whole point of the ceremony is what happens
  // between the tap and the reveal. Four frames: seed in the air, soil closing,
  // sprout emerging, and the reveal panel.
  if (has("--planting")) {
    await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game;
      const s = g.store;
      // Exactly one empty plot so the click lands on a known target.
      while (s.state.plants.length >= s.state.nurseryCap) s.state.plants.pop();
      s.state.breederLevel = 12;
      s.state.nurseryCap = 24;
      s.buySeed("gloomcap", 2);
      s.buySeed("voltvine", 2);
      s.buySeed("thornroot", 2);
      g.navigate("garden");
    });
    await page.waitForTimeout(400);
    // press a card. Tapping the plot alone opens the chooser and photographs
    // the garden, which is how this harness quietly stopped capturing the
    // ceremony at all without reporting anything wrong.
    await page.evaluate(() => {
      const plot = document.querySelector(".empty-plot") as HTMLElement | null;
      plot?.click();
    });
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const card = document.querySelector(".picker-card") as HTMLElement | null;
      card?.click();
    });

    await page.waitForTimeout(560);
    await page.screenshot({ path: `${OUT}/plant-1-seed.png`, fullPage: false });
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/plant-2-bury.png`, fullPage: false });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/plant-3-sprout.png`, fullPage: false });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/plant-4-reveal.png`, fullPage: false });
    console.log("  plant-1-seed.png / plant-2-bury.png / plant-3-sprout.png / plant-4-reveal.png");
  }

  // Mid-game states that the default seed never shows: locked garden plots and a
  // shop shelf that is mostly gated. Neither can be judged from a normal
  // screenshot, and both are exactly what the unlock system exists to produce.
  //
  // Runs here rather than in a standalone script so it goes through
  // `assertStylesheetIsCurrent` — a private script that opens the page does not
  // get that check, which is how a stale bundle went unnoticed once already.
  if (has("--unlocks")) {
    await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game;
      const s = g.store;
      s.state.breederLevel = 9;
      s.state.leafCoin = 4200;
      s.state.nurseryCap = 6;
      while (s.state.plants.length > 4) s.state.plants.pop();
      g.navigate("garden");
    });
    await page.waitForTimeout(600);
    await shot(page, "garden-locked", true);

    // A *separate* state for the shop. The garden state leaves four plants in the
    // ground, which already satisfies the early "plant 3" requirements — so the
    // shelf came back with nothing locked and proved nothing. One plant and a
    // lower level is the state where the gates are actually visible.
    await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game;
      const s = g.store;
      s.state.breederLevel = 6;
      while (s.state.plants.length > 1) s.state.plants.pop();
      g.navigate("lab");
    });
    await page.waitForTimeout(700);
    await shot(page, "shop-locked", true);

    const report = (await page.evaluate(() => {
      const locks = [...document.querySelectorAll(".unlock-lock")];
      return {
        lockedCards: locks.length,
        sample: locks.slice(0, 2).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90)),
      };
    })) as { lockedCards: number; sample: string[] };
    console.log(`  locked shop cards: ${report.lockedCards}`);
    for (const s of report.sample) console.log(`    ${s}`);
  }
  if (!has("--plants") && !has("--stages") && !has("--zoom") && !has("--bounds") && !has("--planting")) {
    for (const screen of ["garden", "collection", "breeding", "arena", "lab"]) {
      await page.evaluate((s) => (window as unknown as { __game: any }).__game.navigate(s), screen);
      await page.waitForTimeout(350);
      await shot(page, screen);
    }

    // Battle: start a fight and capture it mid-round, plus the result screen.
    const started = await page.evaluate(async () => {
      const g = (window as unknown as { __game: any }).__game;
      const p = g.store.state.plants.find((x: any) => x.growth.stage === "mature");
      g.navigate("arena", { plantId: p.plantId });
      await new Promise((r) => setTimeout(r, 250));
      const btn = [...document.querySelectorAll(".screen .btn")].find((b) => b.textContent?.includes("Bắt đầu trận"));
      if (!btn) return false;
      (btn as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 1400));
      return true;
    });
    if (started) {
      await shot(page, "battle");
      await page.evaluate(() => {
        const spd = [...document.querySelectorAll(".screen .btn")].find((b) => b.textContent?.trim() === "»");
        if (spd) (spd as HTMLButtonElement).click();
      });
      await page.waitForTimeout(2500);
      await shot(page, "battle-late");
    }

    // Plant detail sheet — the one animated view.
    await page.evaluate(() => {
      const g = (window as unknown as { __game: any }).__game;
      g.navigate("garden");
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const card = document.querySelector(".screen .plot") as HTMLElement | null;
      card?.click();
    });
    await page.waitForTimeout(1400);
    await shot(page, "detail", false);
  }

  // --- accessibility / layout audit ---
  //
  // `ui-audit.ts` installs `window.__audit` when the app boots, so it has to run
  // in the page, not in Node. Driven here because a contrast regression on the
  // shop shelf would otherwise only be found by squinting at a screenshot.
  if (has("--audit")) {
    // Passed as a string, not a real function: `import("/tools/ui-audit.ts")` is a
    // browser-absolute specifier that Node's tsc cannot resolve, and this code
    // only ever runs inside the page anyway.
    const auditSnippet = `(async () => {
      if (!window.__audit) await import("/tools/ui-audit.ts");
      if (!window.__audit) return "ui-audit did not register on the page";
      await window.__audit();
      return window.__auditResult ?? "(no result)";
    })()`;
    const result = await page.evaluate(auditSnippet);
    console.log(`\n=== UI AUDIT ===\n${String(result).replace(/\x1b\[\d+m/g, "")}`);
  }

  await browser.close();
  console.log(errors.length ? `\n${errors.length} loi console:\n  ${errors.join("\n  ")}` : "\n0 loi console.");
}

void main();
