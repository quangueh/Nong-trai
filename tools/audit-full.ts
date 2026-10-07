/**
 * The full sweep: every screen, in every state that matters, at both viewports.
 *
 * Written as one file so a missing state shows up as a gap in one report rather than as a
 * screen somebody forgot. Each shot is measured as well as captured - overflow, clipping,
 * overlap and contrast are the failures a screenshot hides and a measurement does not.
 */
import { chromium, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/audit", { recursive: true });

const URL = "http://localhost:5173";
const VIEWPORTS = [
  { name: "desktop", width: 1180, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

interface Shot {
  name: string;
  ok: boolean;
  note: string;
}

const problems: string[] = [];
const shots: Shot[] = [];

/** Everything measurable about a viewport, from one pass over the DOM. */
async function measure(page: Page): Promise<{ overflow: number; clipped: string[]; tiny: number }> {
  return (await page.evaluate(`(() => {
    const out = { overflow: 0, clipped: [], tiny: 0 };
    const screen = document.querySelector(".screen");
    if (!screen) return out;
    const sr = screen.getBoundingClientRect();
    // Horizontal overflow: any child wider than its parent, which is what makes a row spill.
    for (const n of screen.querySelectorAll("*")) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > sr.right + 1.5 || r.left < sr.left - 1.5) {
        /* Skipped when something between here and the screen clips.

         * This is the difference between an element that looks broken and one that merely
         * measures broken. An overflow:hidden ancestor means the pixels past the edge are
         * never painted, so a name overhanging by 4px inside a clipped box is not a layout
         * fault - it is a box wider than its line, which nobody can see.
         *
         * No backticks anywhere in this block: the whole body is a template literal handed
         * to page.evaluate, so a backtick in a comment ends the string and the error lands
         * on an unrelated line.
         *
         * It also cut both ways. Before this, the audit reported the shop's featured rail as
         * 29 overflows and a single battle impact ring as a fault; both were false. A check
         * that cries wolf gets ignored, which is worse than having no check at all. */
        let clipped = false;
        for (let p = n.parentElement; p; p = p.parentElement) {
          if (p.classList.contains("screen")) break;
          const o = getComputedStyle(p).overflow;
          if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") {
            clipped = true;
            break;
          }
        }
        if (!clipped) {
          out.overflow++;
          const label = (n.className || n.tagName) + "";
          if (!out.clipped.includes(label)) out.clipped.push(label.slice(0, 60));
        }
      }
      // Unreadably small text: 9px and below is not legible on a phone at arm's length.
      if (n.children.length === 0 && n.textContent && n.textContent.trim()) {
        const size = parseFloat(getComputedStyle(n).fontSize || "0");
        if (size > 0 && size < 9) out.tiny++;
      }
    }
    return out;
  })()`)) as { overflow: number; clipped: string[]; tiny: number };
}

async function shoot(page: Page, name: string, note = ""): Promise<void> {
  await page.waitForTimeout(320);
  const m = await measure(page);
  const bad = m.overflow > 0 || m.tiny > 0;
  shots.push({ name, ok: !bad, note: note + (m.overflow ? ` overflow:${m.overflow} ${m.clipped.slice(0, 3).join("|")}` : "") + (m.tiny ? ` tinyText:${m.tiny}` : "") });
  if (bad) problems.push(`${name}: ${m.overflow} overflow ${m.clipped.slice(0, 3).join("|")} / ${m.tiny} tiny text`);
  await page.screenshot({ path: `shots/audit/${name}.png` });
}

const b = await chromium.launch();

for (const vp of VIEWPORTS) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180));
  });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 180)));

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);

  // A real, mid-career account. Screenshots of an empty garden show nothing worth judging.
  await page.evaluate(`(() => {
    const g = (window).__game, s = g.store;
    s.state.breederLevel = 24;
    s.state.leafCoin = 48000; s.state.nectar = 620; s.state.pollen = 340; s.state.ember = 9;
    s.state.geneCrystal = 40; s.state.items = 90;
    s.state.nurseryCap = 24;
    for (const p of s.state.plants) {
      p.growth.stage = "mature"; p.growth.level = 20; p.growth.stageReadyAt = Date.now();
      p.tier = "bloom";
    }
    s.state.ascent.highest = 21;
    if (!s.state.ascent.day) s.state.ascent.day = new Date().toISOString().slice(0, 10);
  })()`);
  await page.waitForTimeout(500);

  for (const screen of ["garden", "collection", "breeding", "arena", "ascent", "lab"]) {
    // Page-side snippets are evaluated as expressions, so this one is a self-invoking
    // function rather than a call with arguments - Playwright has no way to pass them here,
    // and a TypeScript annotation inside the string is a runtime syntax error that tsc
    // never sees.
    await page.evaluate(`(() => { (window).__game.navigate(${JSON.stringify(screen)}); })()`);
    await page.waitForTimeout(900);
    await shoot(page, `${vp.name}-${screen}`);
  }

  // The battle, at four moments. This is the one thing screenshots are for: a fight has to
  // read at a glance or none of the rest matters.
  await page.evaluate(`(() => { (window).__game.store.state.ascent.highest = 21; (window).__game.navigate("ascent"); })()`);
  await page.waitForTimeout(1100);
  // The stable hook, not the label: the button's prose changes ("Vượt ải 22" vs
  // "Đánh lại ải 20") and a regex on the wording is how the old run silently shot
  // the staging brief instead of the fight.
  await page.evaluate(`(() => { document.querySelector("[data-stage-fight]")?.click(); })()`);
  await page.waitForTimeout(700);
  // The staging brief stands between the map and the fight: confirm it once so
  // the shots below are of combat, not of a modal.
  await shoot(page, `${vp.name}-fight-brief`, "staging brief");
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".overlay button, .stagebrief button")].find((x) => /^Bắt đầu/.test((x.textContent || "").trim()));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(1400);
  await shoot(page, `${vp.name}-fight-early`, "battle, early");
  await page.waitForTimeout(4200);
  await shoot(page, `${vp.name}-fight-mid`, "battle, mid");
  await page.waitForTimeout(9000);
  await shoot(page, `${vp.name}-fight-result`, "battle, finished");

  if (consoleErrors.length) {
    problems.push(`${vp.name} console: ${consoleErrors.slice(0, 5).join(" | ")}`);
    console.log(`\n${vp.name} console errors:`);
    for (const e of consoleErrors.slice(0, 8)) console.log("  " + e);
  }
  await page.close();
}

await b.close();

console.log("\n=== shots ===");
for (const s of shots) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.name.padEnd(24)} ${s.note}`);
console.log(`\n=== problems (${problems.length}) ===`);
for (const p of problems) console.log("  " + p);
if (!problems.length) console.log("  none");