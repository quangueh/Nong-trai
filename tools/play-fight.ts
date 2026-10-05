/**
 * Play a fight for real, and photograph the result.
 *
 * The streak is only worth having if it survives contact with an actual battle, and the
 * one thing a unit test cannot see is whether the receipt matches the arithmetic. So
 * this drives the real UI: it clicks the real button, waits for the real battle to run,
 * and then reads the three numbers that have to agree - the multiplier the arena
 * promised before the fight, the coins the result screen reports, and what the ledger
 * actually recorded.
 *
 * Also catches the class of failure a screenshot hides: text present in the DOM but
 * invisible, which is what `.notice` did for a while.
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
await page.waitForTimeout(500);

// A garden with fighters, and enough level that nothing on the way is locked.
await page.evaluate(`(() => {
  const g = (window).__game;
  g.store.state.breederLevel = 20;
  g.store.state.leafCoin = 500_000;
  g.store.state.items = 200;
  for (const id of ["thornroot", "emberleaf", "voltvine", "gloomcap"]) {
    g.store.state.seeds[id] = 9;
    for (let i = 0; i < 3; i++) g.store.plantSeed(id);
  }
  for (const p of g.store.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 30;
    p.locks.manual = false;
  }
  g.navigate("arena");
})()`);
await page.waitForTimeout(800);

/* Fight until the streak reaches three, clicking the real "Đấu với AI" button each
   time and confirming on the fighter sheet each time - exactly what a player does. */
const log: string[] = [];
for (let fight = 1; fight <= 3; fight++) {
  await page.evaluate(`(() => (window).__game.navigate("arena"))()`);
  await page.waitForTimeout(500);

  // The promise, read off the arena menu before the fight.
  const promise = (await page.evaluate(`(() => {
    const kvs = [...document.querySelectorAll(".kv")].map((r) => r.textContent.replace(/\\s+/g, " ").trim());
    const roster = [...document.querySelectorAll(".roster-card")].length;
    const streakBadges = [...document.querySelectorAll(".roster-streak")].map((n) => n.textContent.trim());
    return { kvs, roster, streakBadges };
  })()`)) as { kvs: string[]; roster: number; streakBadges: string[] };

  await page.click(".btn.primary.block");
  await page.waitForTimeout(600);

  // The fighter sheet is a bottom sheet of plant cards; picking is done by clicking a
  // card, not by confirming. Selecting "the button whose label mentions a fight" grabbed
  // the "Đấu với AI" button still sitting behind the overlay, so the battle never started
  // and the run reported three fights that never happened.
  //
  // `.sheet`, not `.overlay`: the backdrop is an empty sibling, not the sheet's parent,
  // so the obvious descendant selector matches nothing.
  const sheet = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll(".sheet .plantcard")];
    if (!cards.length) return 0;
    cards[0].click();
    return cards.length;
  })()`);
  if (!sheet) {
    log.push(`fight ${fight}: the fighter sheet listed no plants`);
    await page.screenshot({ path: `shots/fight-${fight}-stuck.png` });
    break;
  }

  // A third step stands between the sheet and the fight: the opponent preview, which
  // shows the matchup and the traits before anything is committed. Its button is found
  // by its own label so a reworded screen does not silently skip the fight.
  const preview = (await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Bắt đầu trận/.test(b.textContent || ""));
    if (!btn) return null;
    const rows = [...document.querySelectorAll(".screen .row")].map((r) => r.textContent.replace(/\\s+/g, " ").trim());
    btn.click();
    return rows;
  })()`)) as string[] | null;
  if (!preview) {
    log.push(`fight ${fight}: no "Bắt đầu trận" button on the opponent preview`);
    await page.screenshot({ path: `shots/fight-${fight}-stuck.png` });
    break;
  }
  if (fight === 1) await page.screenshot({ path: "shots/opponent-preview.png" });

  // Two seconds in, the fight should be on screen: two plants, live numbers, whatever
  // the impact effects are. A result card appearing without anything in between would
  // mean the battle is resolved off-screen and the whole of the game's feedback never
  // reaches the player.
  await page.waitForTimeout(2000);
  const mid = (await page.evaluate(`(() => {
    const screen = document.querySelector(".screen");
    const root = document.querySelector(".arena, .battle, .battlefield, .fight") || screen;
    const nodes = root ? root.querySelectorAll("svg, canvas, .fx, .particle, .shake") : [];
    return {
      svgs: document.querySelectorAll(".screen svg").length,
      fxNodes: nodes.length,
      hpBars: [...document.querySelectorAll(".screen *")]
        .filter((n) => /HP|hp/i.test(n.getAttribute("class") || ""))
        .map((n) => (n.getAttribute("class") || "") + " " + (n.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 24)),
      // getAttribute rather than .className: on an SVG element that is an
      // SVGAnimatedString, and calling .split on it throws.
      classes: screen
        ? [...new Set([...screen.querySelectorAll("*")].map((n) => (n.getAttribute("class") || "").split(" ")[0]).filter(Boolean))].slice(0, 18)
        : [],
    };
  })()`)) as { svgs: number; fxNodes: number; hpBars: string[]; classes: string[] };
  if (fight === 1) await page.screenshot({ path: "shots/fight-mid.png" });

  // The battle runs on its own clock; wait for a result card or a hard stop.
  const settled = await page
    .waitForFunction(
      `(() => {
        const t = document.body.textContent || "";
        return /THẮNG|HÒA|THUA/.test(t) ? true : false;
      })()`,
      { timeout: 45000 },
    )
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/fight-${fight}.png` });

  const read = (await page.evaluate(`(() => {
    const screen = document.querySelector(".screen");
    const txt = (screen ? screen.textContent : "") || "";
    // Anything laid out at zero size or fully transparent is present but not readable.
    const ghost = [...document.querySelectorAll(".screen *")].filter((n) => {
      const cs = getComputedStyle(n);
      if (parseFloat(cs.opacity) < 0.05) return (n.textContent || "").trim().length > 0;
      return false;
    }).map((n) => (n.className || n.tagName) + ": " + (n.textContent || "").trim().slice(0, 40));
    return {
      headline: (txt.match(/THẮNG|HÒA|THUA/) || [""])[0],
      coins: (txt.match(/\\+\\d+🪙/) || [""])[0],
      note: [...document.querySelectorAll(".streak-note")].map((n) => n.textContent.trim()),
      ghost,
    };
  })()`)) as { headline: string; coins: string; note: string[]; ghost: string[] };

  // The ledger is the ground truth: it records what was paid, after the multiplier.
  // Read the streak across the whole garden rather than off one plant - the fight used
  // whichever card was first in the sheet, which is not the strongest one, so reading a
  // single plant here reported zero and looked like the streak had not been kept.
  const ledger = (await page.evaluate(`(() => {
    const g = (window).__game;
    const last = g.store.state.ledger[g.store.state.ledger.length - 1];
    const streaks = g.store.state.plants.map((p) => p.battleRecord.streak);
    const bests = g.store.state.plants.map((p) => p.battleRecord.bestStreak);
    const wins = g.store.state.plants.reduce((n, p) => n + p.battleRecord.wins, 0);
    return {
      last: last ? last.reason + " = " + last.delta : null,
      maxStreak: Math.max(0, ...streaks),
      maxBest: Math.max(0, ...bests),
      wins,
    };
  })()`)) as { last: string | null; maxStreak: number; maxBest: number; wins: number };

  log.push(
    `fight ${fight}: offered ${sheet} fighters  promise="${promise.kvs[0]}"  badges=[${promise.streakBadges.join(",")}]\n` +
      `         preview="${(preview || []).join(" | ")}"\n` +
      `         mid-fight: ${mid.svgs} svg, ${mid.fxNodes} fx nodes, classes=${JSON.stringify(mid.classes)}\n` +
      `         result "${read.headline}" ${read.coins} note=${JSON.stringify(read.note)}\n` +
      `         ledger "${ledger.last}" maxStreak=${ledger.maxStreak} best=${ledger.maxBest} wins=${ledger.wins}` +
      (read.ghost.length ? `\n         INVISIBLE TEXT: ${JSON.stringify(read.ghost)}` : "") +
      (settled ? "" : "\n         did not settle"),
  );

  await page.evaluate(`(() => (window).__game.navigate("arena"))()`);
  await page.waitForTimeout(500);
}

console.log(log.join("\n"));
console.log(errs.length ? "\nPAGE ERRORS:\n  " + errs.join("\n  ") : "\nno page errors");
await b.close();
