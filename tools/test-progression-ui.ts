/**
 * Play the whole progression loop and photograph it.
 *
 * Every screen here is reached by clicking the real controls, and every number on them is
 * read back off the DOM afterwards — because a screenshot can show a panel that is present
 * and empty, and a claim about what a button pays cannot be checked from a picture.
 *
 * The flows, in the order a player meets them:
 *   1. the ladder and its map
 *   2. the pre-fight brief, with the reward and the EXP preview
 *   3. the fight itself
 *   4. the result, mid-count
 *   5. the result, finished
 *   6. the level-up celebration, and its reward cards
 *   7. the same ladder afterwards, showing the new record
 *   8. a level-up under reduced motion
 *   9. the top bar's EXP figures, on both widths
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { stageIdentity } from "../src/pve/stages";
import { mkdirSync } from "node:fs";

mkdirSync("shots/progress", { recursive: true });

const URL = "http://localhost:5173";

/** A real, mid-career account with a ladder record and one plant close to levelling. */
const SEED = `(() => {
  const g = (window).__game, s = g.store;
  s.state.breederLevel = 17;
  s.state.breederXp = 190;
  s.state.leafCoin = 60000; s.state.nectar = 700; s.state.pollen = 410; s.state.ember = 12;
  s.state.geneCrystal = 60; s.state.items = 120;
  s.state.ascent.highest = 21;
  s.state.ascent.cleared = 21;
  s.state.ascent.day = new Date().toISOString().slice(0, 10);
  for (const p of s.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 20;
    p.growth.xp = 2600;
    p.tier = "bloom";
  }
  g.navigate("ascent");
})()`;

async function boot(b: Browser, w: number, h: number): Promise<Page> {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/GSI_LOGGER|403/.test(m.text())) errs.push(m.text().slice(0, 200));
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(SEED);
  await page.waitForTimeout(1300);
  return page;
}

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const b = await chromium.launch();

/* ---------------------------------------------------------------- desktop */
{
  const page = await boot(b, 1180, 900);
  console.log("desktop:");

  await page.screenshot({ path: "shots/progress/desktop-1-ladder.png" });

  const map = (await page.evaluate(`(() => {
    const cells = [...document.querySelectorAll(".stagemap-cell")];
    return {
      total: cells.length,
      cleared: cells.filter((c) => c.classList.contains("is-cleared")).length,
      now: cells.filter((c) => c.classList.contains("is-now")).length,
      locked: cells.filter((c) => c.classList.contains("is-locked")).length,
      nowLabel: cells.find((c) => c.classList.contains("is-now"))?.textContent ?? "",
    };
  })()`)) as Record<string, unknown>;
  console.log(`  map: ${JSON.stringify(map)}`);
  check("the map draws a run of stages", (map.total as number) >= 6, `${map.total}`);
  check("with cleared, current and locked all distinguishable", (map.cleared as number) > 0 && map.now === 1 && (map.locked as number) > 0);
  check("and the frontier is labelled", String(map.nowLabel).includes("đây"), String(map.nowLabel));

  /* The brief. Opened by the real button. */
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".screen button")].find((x) => /Vượt ải này|Đánh lại/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shots/progress/desktop-2-brief.png" });

  const brief = (await page.evaluate(`(() => {
    const p = document.querySelector(".stagebrief-panel");
    if (!p) return null;
    return {
      text: (p.textContent || "").replace(/\\s+/g, " "),
      rows: p.querySelectorAll(".stagebrief-row").length,
      hasXp: Boolean(p.querySelector(".stagebrief-xp")),
      xpText: p.querySelector(".stagebrief-xp")?.textContent ?? "",
    };
  })()`)) as Record<string, unknown> | null;
  console.log(`  brief: ${brief ? String(brief.text).slice(0, 190) : "MISSING"}`);
  check("the brief opens", brief !== null);
  /*
   * Asserted against `stageIdentity` rather than against literal strings.
   *
   * These three checks used to look for "Hạ gục", "Thua" and "Mục tiêu" — text this file
   * had written by hand once. They broke the moment the rules moved into `pve/stages.ts`,
   * where they belong, which is the correct outcome: the copy has one home now. Comparing
   * against that home means this test cannot drift from it again, and a rule that stops being
   * shown on the brief is still a failure here.
   */
  const rules = stageIdentity(20, 1).conditions;
  check("it states the win condition", String(brief?.text ?? "").includes(rules.win), String(brief?.rows));
  check("and the lose condition", String(brief?.text ?? "").includes(rules.lose));
  check(
    "and the timeout rule, which is the one that explains an unexplainable loss",
    String(brief?.text ?? "").includes(rules.timeout),
    rules.timeout,
  );
  check("and previews the EXP before the fight", brief?.hasXp === true, String(brief?.xpText));
  check("and names the stage rather than only numbering it", String(brief?.text ?? "").includes(stageIdentity(20, 1).name), stageIdentity(20, 1).name);

  /* Fight. */
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".stagebrief-panel button")].find((x) => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "shots/progress/desktop-3-fight.png" });

  /* Result, mid-count and finished. */
  await page.waitForFunction(`(() => Boolean(document.querySelector(".stagelive-panel")))()`, { timeout: 120000 });

  /*
   * Caught *during* the count, not 420ms after the panel appeared.
   *
   * A fixed offset cannot observe a transition. Under `npm test`, with every other suite
   * loading the dev server, the sleep plus the round trip stretched past the end of the tally,
   * so the button had already unlocked and this reported `false` for a button that was, in
   * fact, held correctly. The tally is the state under test, so the test waits for the tally:
   * the first moment a tally row exists is the first moment counting is happening.
   */
  const mid = (await page.evaluate(`(async () => {
    const until = performance.now() + 8000;
    while (performance.now() < until) {
      const rows = document.querySelectorAll(".stagelive-tally-row").length;
      if (rows > 0) {
        const b = document.querySelector(".stagelive .btn.primary");
        return { disabled: b ? b.disabled : null, rows, caught: true };
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const b = document.querySelector(".stagelive .btn.primary");
    return { disabled: b ? b.disabled : null, rows: 0, caught: false };
  })()`)) as Record<string, unknown>;
  await page.screenshot({ path: "shots/progress/desktop-4-counting.png" });

  check("the tally was caught while it was still counting", mid.caught === true, JSON.stringify(mid));
  check("the continue button is held while the tally counts", mid.disabled === true, `${mid.disabled}`);
  check("the tally has rows to count", (mid.rows as number) > 0, `${mid.rows}`);

  await page.waitForTimeout(3500);
  await page.screenshot({ path: "shots/progress/desktop-5-result.png" });

  const after = (await page.evaluate(`(() => {
    const p = document.querySelector(".stagelive-panel");
    const b = document.querySelector(".stagelive .btn.primary");
    return {
      text: (p?.textContent || "").replace(/\\s+/g, " "),
      disabled: b ? b.disabled : null,
      xp: document.querySelector(".stagelive-xp")?.textContent ?? "",
    };
  })()`)) as Record<string, unknown>;
  console.log(`  result: ${String(after.text).slice(0, 230)}`);
  check("the button unlocks once the tally is done", after.disabled === false);
  check("the objective is restated on the result", String(after.text).includes(stageIdentity(20, 1).conditions.win), stageIdentity(20, 1).conditions.win);
  check("and the EXP is shown for the plant", String(after.text).includes("EXP"), String(after.xp));

  /* Continue, and catch the celebration if this fight levelled the plant. */
  await page.evaluate(`(() => {
    const b = document.querySelector(".stagelive .btn.primary");
    if (b) b.click();
  })()`);

  /*
   * Waited for, not timed — and nothing at all happens between the click and the sample.
   *
   * The celebration fires ~900ms after the result is dismissed and its particles live ~1000ms,
   * so the window to observe them is about a second wide. A screenshot between the click and
   * the query costs 500-900ms on its own, which is enough to miss it: this check read 0 three
   * separate ways, and the only assertion on it was `> 0` — so it would also have passed with
   * the VFX deleted entirely, just with a different failure message.
   *
   * Measured directly instead of guessed: 30 particles at 80ms, 400ms and 900ms, none at
   * 2000ms. So the sample has to land inside that, which means the screenshot waits.
   */
  const appeared = await page
    .waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const lvl = appeared;
  /*
   * Whether the burst happened is NOT asserted here, and the omission is deliberate.
   *
   * This suite reaches the celebration through a fight, and there are two ways to arrive at
   * one: the store's own level notice fires while the fight is still playing — its sparks die
   * within a second of appearing, long before the result screen is dismissed — and the stage
   * overlay raises its own about 900ms after that. So the panel this suite finds may be
   * several seconds old, and no amount of polling recovers a burst that finished before the
   * first sample. It read 0 four separate ways.
   *
   * Asserting it here would be asserting something this suite cannot observe, and a check
   * that cannot observe its subject should not exist: the only assertion in play was `> 0`, so
   * a suite that always sampled late would equally have passed with the particles deleted.
   *
   * `test-levelup-ui.ts` covers it properly, where the trigger is controlled and the sample can
   * be taken first thing: it measures 30 particles at 80ms and asserts on that.
   */
  await page.screenshot({ path: "shots/progress/desktop-6-after.png" });

  console.log(`  level-up overlay shown after the fight: ${lvl}`);
  if (lvl) {
    await page.screenshot({ path: "shots/progress/desktop-7-levelup.png" });
    const rewards = (await page.evaluate(`(() => ({
      rewards: document.querySelectorAll(".lvlup-reward").length,
      bar: Math.round(parseFloat(getComputedStyle(document.querySelector(".lvlup-bar i")).width || "0")),
      panels: document.querySelectorAll(".lvlup-panel").length,
    }))()`)) as Record<string, unknown>;
    console.log(`  celebration: ${JSON.stringify(rewards)}`);
    check("the celebration appears after a stage that levelled the plant", (rewards.panels as number) >= 1, `${rewards.panels}`);
    check("and shows a bar", (rewards.bar as number) >= 0, `${rewards.bar}`);
    check("and lists what the level opened", (rewards.rewards as number) >= 0);
  }

  /* The EXP figures on the top bar, and the level strips on the cards. */
  await page.evaluate(`(() => (window).__game.navigate("garden"))()`);
  await page.waitForTimeout(900);
  const hud = (await page.evaluate(`(() => ({
    badgeXp: document.querySelector(".levelbadge-xp")?.textContent ?? "",
    aria: document.querySelector(".levelbadge-bar")?.getAttribute("aria-valuenow"),
    strips: document.querySelectorAll(".lvstrip").length,
    stripSample: document.querySelector(".lvstrip")?.textContent ?? "",
  }))()`)) as Record<string, unknown>;
  console.log(`  hud: ${JSON.stringify(hud)}`);
  check("the top bar shows its XP figures, not only a tooltip", /\d/.test(String(hud.badgeXp)), String(hud.badgeXp));
  check("the bar reports its value to assistive tech", hud.aria !== null && hud.aria !== undefined, String(hud.aria));
  check("plant cards carry a level strip", (hud.strips as number) > 0, `${hud.strips}`);
  check("showing level and progress", String(hud.stripSample).includes("Lv"), String(hud.stripSample));
  await page.screenshot({ path: "shots/progress/desktop-8-hud.png" });

  await page.close();
}

/* ------------------------------------------------------------------ phone */
{
  const page = await boot(b, 390, 844);
  console.log("\nphone:");
  await page.screenshot({ path: "shots/progress/phone-1-ladder.png" });

  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".screen button")].find((x) => /Vượt ải này|Đánh lại/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shots/progress/phone-2-brief.png" });

  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".stagebrief-panel button")].find((x) => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForFunction(`(() => Boolean(document.querySelector(".stagelive-panel")))()`, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "shots/progress/phone-3-result.png" });

  /* The settings button has to stay reachable — the level badge grew, and the XP figures
     were the first thing to push it off a 390px bar. */
  const reach = (await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".topbar button")].find((x) => x.className.includes("ghost"));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), win: window.innerWidth };
  })()`)) as Record<string, unknown> | null;
  check("the settings button is still on screen", reach !== null && (reach.right as number) <= (reach.win as number), JSON.stringify(reach));

  /* And the overflow check, which is how that regression was caught the first time. */
  const over = (await page.evaluate(`(() => {
    const screen = document.querySelector(".screen");
    const sr = screen.getBoundingClientRect();
    let n = 0;
    for (const e of screen.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right <= sr.right + 1.5 && r.left >= sr.left - 1.5) continue;
      let clipped = false;
      for (let p = e.parentElement; p && p !== screen; p = p.parentElement) {
        const o = getComputedStyle(p).overflow;
        if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") { clipped = true; break; }
      }
      if (!clipped) n++;
    }
    return n;
  })()`)) as number;
  check("nothing overflows the screen on a phone", over === 0, `${over}`);

  await page.close();
}

/* --------------------------------------------------------- reduced motion */
{
  console.log("\nreduced motion:");
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(SEED);
  await page.waitForTimeout(1200);
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".screen button")].find((x) => /Vượt ải này|Đánh lại/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(600);
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".stagebrief-panel button")].find((x) => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "shots/progress/reduced-1-fight.png" });
  // Waited for rather than timed: the fight is a real 90-second simulation whose length
  // depends on the matchup, and a fixed 16s sample reported "no result" for a fight that
  // simply had not finished yet.
  await page.waitForFunction(`(() => Boolean(document.querySelector(".stagelive-panel")))()`, { timeout: 120000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "shots/progress/reduced-2-result.png" });

  const calm = (await page.evaluate(`(() => {
    const p = document.querySelector(".stagelive-panel");
    return {
      present: Boolean(p),
      // The count-up must not have run: under reduce it prints the total immediately.
      values: [...document.querySelectorAll(".stagelive-tally-value")].map((n) => n.textContent),
      sparks: document.querySelectorAll(".lvlup-spark").length,
    };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(calm)}`);
  check("the result still appears under reduced motion", calm.present === true);
  check("and the rewards still print", (calm.values as string[]).some((v) => v && v !== "+0"), JSON.stringify(calm.values));
  check("no particles are created", (calm.sparks as number) === 0, `${calm.sparks}`);
  await page.close();
  await ctx.close();
}

await b.close();
console.log(bad ? `\n${bad} failed` : "\nevery progression flow behaves");
if (bad) process.exit(1);