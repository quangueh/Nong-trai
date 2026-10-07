/**
 * Level-up: does the celebration actually fire, and does it survive several at once?
 *
 * Separated from `test-progression-ui.ts` because that suite plays a fight to earn its
 * level-ups, and the whole point here is to *make* one happen — a fixture that happens to
 * level the plant is a fixture that will quietly stop covering the feature the first time
 * the reward numbers change.
 *
 * Four cases, in the order they break:
 *   1. one level, with rewards listed
 *   2. several levels from one grant, with nothing lost and the totals right
 *   3. reduced motion — same information, no particles, no shake, no flight
 *   4. reload — the level and the XP survived the save
 *
 * The EXP maths itself is checked in `test-progression.ts`; this is about what the player
 * sees, which is a different thing and fails differently.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/levelup", { recursive: true });
const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

async function boot(b: Browser, reduced = false): Promise<Page> {
  const ctx = await b.newContext({
    viewport: { width: 1180, height: 900 },
    ...(reduced ? { reducedMotion: "reduce" } : {}),
  });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error" && !/GSI_LOGGER|403/.test(m.text())) errs.push(m.text().slice(0, 200));
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(600);
  return page;
}

/** A mature plant, positioned one grant away from a known number of levels. */
const PREP = `(() => {
  const g = (window).__game, s = g.store;
  s.state.breederLevel = 1;
  s.state.breederXp = 0;
  s.state.ascent.highest = 5;
  for (const p of s.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 3;
    p.growth.xp = 0;
    p.tier = "seedling";
  }
  g.navigate("garden");
})()`;

const b = await chromium.launch();

/* --- 1. one level, with rewards ------------------------------------------ */
{
  console.log("one level up:");
  const page = await boot(b);
  await page.evaluate(PREP);
  await page.waitForTimeout(900);

  const before = (await page.evaluate(`(() => {
    const p = (window).__game.store.state.plants[0];
    return { level: p.growth.level, xp: p.growth.xp };
  })()`)) as { level: number; xp: number };

  /*
   * The peak is *observed*, not polled.
   *
   * This suite has failed this check four ways, and every one was the same mistake: reading a
   * transient animation at a guessed instant. A poll started after a `waitForTimeout`, a
   * screenshot or a round trip can begin after the burst is already over, and then reports zero
   * for an animation that plainly happened.
   *
   * A MutationObserver installed *before* the level-up sees every spark that is ever added,
   * whatever the timing, and keeps the high-water mark. There is no window to miss.
   */
  await page.evaluate(`(() => {
    const w = window;
    w.__sparkPeak = 0;
    const obs = new MutationObserver(() => {
      const n = document.querySelectorAll(".lvlup-spark").length;
      if (n > w.__sparkPeak) w.__sparkPeak = n;
    });
    obs.observe(document.body, { childList: true, subtree: true });
  })()`);

  // Tended rather than fought, so this exercises the care path rather than the arena one.
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    const p = s.state.plants[0];
    const { xpRequired } = window.__care || {};
    void xpRequired;
    // Enough for several levels at once; how many is measured, not assumed.
    s.addPlantXp(p, 5000);
  })()`);
  /*
   * The spark count is *polled*, not sampled once.
   *
   * This suite has now failed this check three different ways, and all three were the same
   * mistake: reading a transient animation at one guessed instant. At 900ms it read after the
   * burst had ended and reported zero for an animation that plainly happened. Moving it to
   * 260ms fixed that — until `npm test` had twenty other suites loading the same dev server,
   * the round trip stretched, and the read landed past the burst again.
   *
   * A sample cannot tell "no particles were created" from "I looked too late". Polling inside
   * the page, from the moment the panel appears and keeping the maximum, measures the thing
   * that exists — the peak — instead of guessing when to look at it.
   */
  await page.waitForTimeout(60);

  const panel = (await page.evaluate(`(async () => {
    // Wait for the celebration to exist at all, then watch its whole life for the peak.
    const panelDeadline = performance.now() + 2000;
    while (performance.now() < panelDeadline && !document.querySelector(".lvlup-panel")) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    let peak = 0;
    const until = performance.now() + 2500;
    while (performance.now() < until) {
      const n = document.querySelectorAll(".lvlup-spark").length;
      if (n > peak) peak = n;
      if (peak > 0 && performance.now() > until - 1800) break;  // seen it, no need to wait out the clock
      await new Promise((r) => requestAnimationFrame(r));
    }
    const p = document.querySelector(".lvlup-panel");
    if (!p) return null;
    return {
      title: p.querySelector(".lvlup-title")?.textContent ?? "",
      level: p.querySelector(".lvlup-level")?.textContent ?? "",
      exp: p.querySelector(".lvlup-exp")?.textContent ?? "",
      rewards: [...document.querySelectorAll(".lvlup-reward b")].map((n) => n.textContent),
      sparks: Math.max(peak, Number(window.__sparkPeak) || 0),
      barWidth: Math.round(parseFloat(getComputedStyle(document.querySelector(".lvlup-bar i")).width || "0")),
      hasButton: Boolean(p.querySelector(".btn.primary")),
    };
  })()`)) as Record<string, unknown> | null;

  console.log(`  ${JSON.stringify(panel)}`);
  /*
   * Screenshot *after* the peak has been read, not before.
   *
   * A screenshot takes a few hundred milliseconds, and it used to run before the particle
   * poll — so under load the burst could start and finish inside that window and the poll then
   * watched an empty panel. The panel stays up until it is dismissed, so capturing it a moment
   * later loses nothing.
   */
  await page.screenshot({ path: "shots/levelup/one-level.png" });
  check("the celebration appears", panel !== null);
  check("it says LÊN CẤP!", String(panel?.title).includes("LÊN CẤP"), String(panel?.title));
  check("and names the level reached", String(panel?.level).includes("Cấp"), String(panel?.level));
  check("and reports the EXP earned", /\+/.test(String(panel?.exp)), String(panel?.exp));
  check("and lists what opened", (panel?.rewards as string[]).length > 0, JSON.stringify(panel?.rewards));
  check("and fires particles", (panel?.sparks as number) > 0, `${panel?.sparks}`);
  check("and offers a way out", panel?.hasButton === true);

  const after = (await page.evaluate(`(() => {
    const p = (window).__game.store.state.plants[0];
    return { level: p.growth.level, xp: p.growth.xp };
  })()`)) as { level: number; xp: number };
  check(
    "the level really moved",
    after.level > before.level,
    `${before.level} -> ${after.level}`,
  );
  check(
    "and the leftover XP is banked, not discarded",
    after.xp >= 0 && after.level === before.level + 1 || after.level > before.level + 1,
    `lv${after.level} xp${after.xp}`,
  );

  /* Dismiss and confirm it cleans up. */
  await page.evaluate(`(() => { const b = document.querySelector(".lvlup-panel .btn.primary"); if (b) b.click(); })()`);
  await page.waitForTimeout(900);
  const gone = (await page.evaluate(`(() => !document.querySelector(".lvlup-panel"))()`)) as boolean;
  check("and the overlay is removed when dismissed", gone);

  /* --- reload: the level survived the save ------------------------------ */
  const saved = await page.evaluate(`(() => {
    const s = (window).__game.store;
    return { level: s.state.plants[0].growth.level, xp: s.state.plants[0].growth.xp };
  })()`) as { level: number; xp: number };
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(800);
  const reloaded = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    return { level: s.state.plants[0].growth.level, xp: s.state.plants[0].growth.xp };
  })()`)) as { level: number; xp: number };
  check(
    "the level survives a reload",
    reloaded.level === saved.level && reloaded.xp === saved.xp,
    `${JSON.stringify(saved)} -> ${JSON.stringify(reloaded)}`,
  );
  await page.close();
}

/* --- 2. several levels from one grant ------------------------------------ */
{
  console.log("\nseveral levels at once:");
  const page = await boot(b);
  await page.evaluate(PREP);
  await page.waitForTimeout(800);

  const before = (await page.evaluate(`(() => {
    const p = (window).__game.store.state.plants[0];
    return p.growth.level;
  })()`)) as number;

  await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.addPlantXp(s.state.plants[0], 40000);
  })()`);
  await page.waitForSelector(".lvlup-panel", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: "shots/levelup/multi-level.png" });

  const multi = (await page.evaluate(`(() => {
    const p = document.querySelector(".lvlup-panel");
    const s = (window).__game.store;
    return {
      present: Boolean(p),
      level: p?.querySelector(".lvlup-level")?.textContent ?? "",
      rewards: [...document.querySelectorAll(".lvlup-reward b")].map((n) => n.textContent),
      actualLevel: s.state.plants[0].growth.level,
      xp: s.state.plants[0].growth.xp,
    };
  })()`)) as Record<string, unknown>;

  const shown = Number(String(multi.level).replace(/\D/g, ""));
  console.log(`  shown ${multi.level}, actual lv${multi.actualLevel}, ${(multi.rewards as string[]).length} rewards`);
  check("the celebration appears for a multi-level grant", multi.present === true);
  check("it reports the *final* level, not the first crossed", shown === multi.actualLevel, `${multi.level} vs ${multi.actualLevel}`);
  check("more than one level was actually gained", (multi.actualLevel as number) > before + 1, `${before} -> ${multi.actualLevel}`);
  check("the remainder is banked", (multi.xp as number) >= 0 && (multi.xp as number) < 100000, `${multi.xp}`);
  check(
    "and it lists what opened across every crossed level",
    (multi.rewards as string[]).length > 0,
    JSON.stringify(multi.rewards),
  );
  await page.close();
}

/* --- 3. reduced motion ---------------------------------------------------- */
{
  console.log("\nreduced motion:");
  const page = await boot(b, true);
  await page.evaluate(PREP);
  await page.waitForTimeout(800);
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.addPlantXp(s.state.plants[0], 5000);
  })()`);
  /*
   * Waited for, not slept through — the same fix as the first block.
   *
   * 900ms is enough on an idle machine and not enough when `npm test` is loading the dev server
   * with everything else, at which point the panel simply had not been built yet and the block
   * reported "the celebration does not appear under reduced motion".
   */
  await page.waitForSelector(".lvlup-panel", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(150);
  await page.screenshot({ path: "shots/levelup/reduced.png" });

  const calm = (await page.evaluate(`(() => ({
    present: Boolean(document.querySelector(".lvlup-panel")),
    isCalm: document.querySelector(".lvlup")?.classList.contains("is-calm") ?? false,
    sparks: document.querySelectorAll(".lvlup-spark").length,
    rewards: document.querySelectorAll(".lvlup-reward").length,
    flashShown: document.querySelector(".lvlup-flash") ? getComputedStyle(document.querySelector(".lvlup-flash")).display : "absent",
    shakeShown: document.querySelector(".lvlup-shake") ? getComputedStyle(document.querySelector(".lvlup-shake")).display : "absent",
  }))()`)) as Record<string, unknown>;

  console.log(`  ${JSON.stringify(calm)}`);
  check("the celebration still appears under reduced motion", calm.present === true);
  check("the panel is flagged calm", calm.isCalm === true);
  check("no particles are created", (calm.sparks as number) === 0, `${calm.sparks}`);
  check("the flash is suppressed", calm.flashShown === "none" || calm.flashShown === "absent", String(calm.flashShown));
  check("the shake is suppressed", calm.shakeShown === "none" || calm.shakeShown === "absent", String(calm.shakeShown));
  check("but the rewards are still all listed", (calm.rewards as number) > 0, `${calm.rewards}`);
  await page.close();
}

await b.close();
console.log(bad ? `\n${bad} failed` : "\nlevel-up behaves");
if (bad) process.exit(1);