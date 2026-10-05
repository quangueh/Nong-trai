/**
 * Every screen, photographed.
 *
 * A full pass over the game as a player first meets it. Written to be re-run after any
 * change rather than once: the questions it answers - does anything overflow, is any
 * text clipped, does anything overlap - are invisible in a diff and obvious in a picture.
 *
 * Viewport-sized, never fullPage. A fullPage shot of a shell that is `100dvh` with
 * `overflow: hidden` produces a tall image of the same viewport, which hides precisely
 * the layout bugs worth looking at.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1180, height: 820 },
  { name: "phone", width: 390, height: 844 },
] as const;

// `ascent` included because it is a real screen that ships, and an audit that only knows
// about the screens someone remembered to add is an audit that misses the new ones.
const SCREENS = ["garden", "collection", "breeding", "arena", "ascent", "lab"] as const;

const b = await chromium.launch();
const allErrors: string[] = [];

for (const vp of VIEWPORTS) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.__name = (f: unknown) => f;
  });
  page.on("pageerror", (e) => allErrors.push(`${vp.name}: ${String(e).slice(0, 120)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/GSI_LOGGER|accounts\.google|Failed to load resource/.test(m.text())) {
      allErrors.push(`${vp.name} console: ${m.text().slice(0, 120)}`);
    }
  });

  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(600);

  // A save worth photographing: enough to have plots, plants, coins and a level.
  await page.evaluate(`(() => {
    const g = (window).__game;
    g.store.state.breederLevel = 14;
    g.store.state.leafCoin = 2_400_000;
    g.store.state.geneCrystal = 900;
    g.store.state.items = 40;
    g.store.state.nurseryCap = 24;
    const ids = Object.keys(g.store.state.seeds).filter((id) => (g.store.state.seeds[id] || 0) > 0);
    let n = 0;
    for (const id of ids) {
      g.store.state.seeds[id] = 25;
      const r = g.store.plantSeed(id);
      if (r.ok && r.plantId) n++;
      if (n >= 8) break;
    }
    for (const p of g.store.state.plants) {
      p.growth.stage = "mature";
      p.growth.stageReadyAt = Date.now();
      p.growth.level = 18;
      p.locks.manual = false;
    }
    g.navigate("garden");
  })()`);
  await page.waitForTimeout(900);

  for (const screen of SCREENS) {
    await page.evaluate(`(() => (window).__game.navigate(${JSON.stringify(screen)}))()`);
    await page.waitForTimeout(700);

    // Measured, not eyeballed: overflow and clipping are the failures a screenshot
    // shows only if you know to look for them.
    //
    // Scoped to the shell, not to `.screen`. The top bar is where a wide layout breaks
    // first - seven currency pills overflowed it on a phone and pushed the settings
    // button off the right edge, which this harness reported as clean because it only
    // ever looked inside the screen.
    /* Measured with animation off.

       Every plant in a garden plot runs a sway keyframe whose transform leans the whole
       SVG, and a transformed descendant widens its parent's scroll area - so a card whose
       layout is perfectly correct measures five pixels too wide while the plant is
       leaning. Pausing is not enough, because pausing holds whatever pose the animation
       was in, and rewinding is not enough either, because the pose at 0% is also a lean.

       So the animations are switched off outright. Everything they animate here is a
       transform or an opacity, neither of which participates in layout, so what is left is
       the layout being measured on its own terms - which is the thing an overflow check
       is supposed to be about. */
    await page.addStyleTag({
      content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
    });
    await page.waitForTimeout(80);

    const report = (await page.evaluate(`(() => {
      const doc = document.documentElement;
      const scope = ".screen *, .topbar *, .bottomnav *";
      const overflowing = [...document.querySelectorAll(scope)]
        .filter((n) => n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX !== "auto" && getComputedStyle(n).overflowX !== "scroll")
        .slice(0, 4)
        .map((n) => (n.getAttribute("class") || n.tagName) + " " + n.scrollWidth + ">" + n.clientWidth);
      const clipped = [...document.querySelectorAll(scope)]
        .filter((n) => {
          const cs = getComputedStyle(n);
          return (cs.textOverflow === "ellipsis" || cs.overflow === "hidden") && n.scrollWidth > n.clientWidth + 2;
        })
        .slice(0, 4)
        .map((n) => (n.getAttribute("class") || n.tagName) + " " + (n.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 30));

      // A control that cannot be reached is worse than one that looks wrong, so the last
      // child of each bar is checked against the viewport rather than against its parent.
      const offscreen = [...document.querySelectorAll(".topbar > *, .bottomnav > *")]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.right > doc.clientWidth + 1;
        })
        .map((n) => (n.getAttribute("class") || n.tagName) + " right=" + Math.round(n.getBoundingClientRect().right) + "/" + doc.clientWidth);

      return {
        docScroll: doc.scrollHeight > doc.clientHeight ? doc.scrollHeight + ">" + doc.clientHeight : "none",
        chars: (document.querySelector(".screen") || {}).textContent?.length ?? 0,
        overflowing,
        clipped,
        offscreen,
      };
    })()`)) as { docScroll: string; chars: number; overflowing: string[]; clipped: string[]; offscreen: string[] };

    const flags: string[] = [];
    if (report.docScroll !== "none") flags.push("document scrolls " + report.docScroll);
    if (report.overflowing.length) flags.push("overflow " + JSON.stringify(report.overflowing));
    if (report.clipped.length) flags.push("clipped " + JSON.stringify(report.clipped));
    if (report.offscreen.length) flags.push("UNREACHABLE " + JSON.stringify(report.offscreen));
    if (report.chars < 40) flags.push("suspiciously empty (" + report.chars + " chars)");

    console.log(
      `${vp.name.padEnd(8)} ${screen.padEnd(11)} ${String(report.chars).padStart(6)} chars  ${flags.length ? "ISSUE: " + flags.join(" ") : "clean"}`,
    );
    await page.screenshot({ path: `shots/audit-${vp.name}-${screen}.png` });
  }

  // The garden's tabs.
  await page.evaluate(`(() => (window).__game.navigate("garden"))()`);
  await page.waitForTimeout(600);
  for (const tab of ["Hôm nay", "Túi hạt"]) {
    const clicked = await page.evaluate(`(() => {
      const t = [...document.querySelectorAll(".tab")].find((b) => (b.textContent || "").includes(${JSON.stringify(tab)}));
      if (!t) return false;
      t.click();
      return true;
    })()`);
    await page.waitForTimeout(600);
    const chars = await page.evaluate(`(() => ((document.querySelector(".screen")||{}).textContent||"").length)`);
    console.log(`${vp.name.padEnd(8)} tab:${tab.padEnd(8)} clicked=${clicked} ${chars} chars`);
    await page.screenshot({ path: `shots/audit-${vp.name}-tab-${tab.replace(/\s/g, "")}.png` });
  }

  await page.close();
}

console.log(allErrors.length ? "\nERRORS:\n  " + allErrors.join("\n  ") : "\nno page errors");
await b.close();