/**
 * The ladder, played through as a player would.
 *
 * ## Why this exists
 *
 * `test-ascent.ts` fights the difficulty curve out with synthetic plants. It says nothing
 * about whether the game is *playable*: that stage 1 can be entered, that clearing it opens
 * stage 2, that a cleared stage refuses to be replayed — the ladder only goes forward, so
 * an old stage is history, not a farm — that a loss costs nothing, and — the
 * one that has bitten before — that the unlock is still there after a reload.
 *
 * That last one is not hypothetical. `AscentState` lives inside the save, the save lives in a
 * per-account slot, and a save that is not reloaded correctly loses `highest` silently: the
 * player comes back to stage 1 with a full garden and no error anywhere.
 *
 * ## The flows, in the order they happen
 *
 *   1. stage 1 is open, and stage 5 is not
 *   2. enter stage 1, see the brief, fight it
 *   3. win: the record moves, the next stage unlocks, the result screen says so
 *   4. reload: the unlock survived
 *   5. replay stage 1 and be refused
 *   6. lose stage 2: the record holds, the consolation pays, the next stage stays locked
 *
 * ## One engine, so a replay is a replay
 *
 * Checked explicitly, because the store settles a fight with `simulateBattle` and the screen
 * plays it with `BattleView`, and those were two implementations for most of this file's
 * life — identical seeds producing different winners in 15 fights out of 40. A stage result
 * that is not the fight the player watched is worse than no result screen.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";
import { simulateBattle, BattleSession } from "../src/battle/engine";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import { stageIdentity, stageName } from "../src/pve/stages";
import { STAT_LADDER_END, stageAffixes, stageIsOpen, stageReward } from "../src/pve/ascent";

mkdirSync("shots/ascent", { recursive: true });
const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* ---------------------------------------------------------------------------
   The parts that do not need a browser
   --------------------------------------------------------------------------- */

console.log("one engine, so a stage result is a record of what was watched:");
{
  let sameWinner = 0;
  let sameDamage = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    /*
   * Real plants, from the game's own generator, rather than hand-built objects.
   *
   * The point of the comparison is that two engines agree, so the inputs have to be the same
   * inputs the game builds — a synthetic object with a plausible shape would pass even if
   * the snapshot function mis-read a real plant's fields.
   */
    const a = createSeedPlant(i % 2 === 0 ? "thornroot" : "gloomcap", "probe-a", `n${i}`, 0);
    const b = createSeedPlant(i % 3 === 0 ? "thornroot" : "gloomcap", "probe-b", `n${i}`, 0);
    const cfg = { seed: `ascent-probe-${i}`, maxSeconds: 90, arena: "sunny" as const };
    const settled = simulateBattle(a, b, cfg);
    const s = new BattleSession(a, b, cfg);
    for (let k = 0; k < 1000 && !s.done; k++) s.step();
    const played = s.summary();
    if (settled.winner === played.winner) sameWinner++;
    if (Math.round(settled.a.damageDealt) === Math.round(played.a.damageDealt)) sameDamage++;
  }
  check(`the settled fight and the played fight agree (${N} seeded fights)`, sameWinner === N, `${sameWinner}/${N} same winner`);
  check("and agree on damage, not just the verdict", sameDamage === N, `${sameDamage}/${N}`);
}

console.log("\nthe replay fights the plant that was settled, not the rewarded one:");
{
  /* Same seed is not enough: the settle pays out before the screen replays,
     and the payout mutates the live plant — `addSkillXp` raises power and
     shortens cooldowns, `gainXp` lifts the level. A replay snapshotting the
     post-settle plant runs a different fight, so the store returns
     `replayAs`: the fighter frozen at the bell. Checked end to end here
     because the drift only exists inside `runAscentStage`. */
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
  const { GameStore } = await import("../src/core/store");
  const store = new GameStore();
  const p = store.state.plants[0];
  p.growth.stage = "mature";
  /* Park every skill just under its first level boundary so the settle's own
     XP grant (+12 win / +4 loss) crosses it whichever way the fight goes —
     the live plant provably diverges from the fighter the bell saw. */
  for (const s of p.skills) s.masteryXp = 28;
  const out = store.runAscentStage(p.plantId, 1);
  check("the stage settles", out.ok === true, String(out.reason));
  const replayed =
    out.replayAs && out.seed && out.monster
      ? simulateBattle(out.replayAs, out.monster.plant, { seed: out.seed, maxSeconds: 90, arena: "sunny" })
      : null;
  check(
    "the frozen fighter replays to the settled verdict",
    replayed !== null && replayed.winner === out.result!.winner,
    `settle ${out.result?.winner} vs replay ${replayed?.winner}`,
  );
  check(
    "and reproduces the same event log, not just the verdict",
    replayed !== null && replayed.events.length === out.result!.events.length,
    `${out.result?.events.length} vs ${replayed?.events.length}`,
  );
  const drifted = p.skills.some(
    (s, i) =>
      s.power !== out.replayAs!.skills[i].power ||
      s.cooldown !== out.replayAs!.skills[i].cooldown,
  );
  check(
    "the live plant provably drifted, which is why the frozen copy exists",
    drifted,
    `skill power ${out.replayAs?.skills[0]?.power} -> ${p.skills[0]?.power}`,
  );
}

console.log("\nstage identity:");
{
  check("a stage has a name", stageName(1).length > 2, stageName(1));
  check("and it is stable", stageName(34) === stageName(34));
  check("which is not the same as its neighbour's", stageName(34) !== stageName(35), `${stageName(34)} vs ${stageName(35)}`);
  const bands = [1, 20, 40, 70, 100].map((s) => stageIdentity(s, 1).band);
  check("a deep ladder passes through several bands", new Set(bands).size >= 4, bands.join(","));
  const scores = [1, 10, 30, 60, 200].map((s) => stageIdentity(s, 1).difficulty.score);
  const rising = scores.every((v, i) => i === 0 || v >= scores[i - 1]);
  check("difficulty never goes down the ladder", rising, scores.join(" -> "));
  check("and actually spans the range", Math.max(...scores) - Math.min(...scores) >= 3, scores.join(" -> "));
  const id = stageIdentity(40, 1);
  check("conditions name a win, a loss and a timeout", Boolean(id.conditions.win && id.conditions.lose && id.conditions.timeout));
  check("and a band with a hazard has one to announce", stageIdentity(40, 1).conditions.hazard !== undefined);
  check("the opening band has no hazard to announce", stageIdentity(2, 1).conditions.hazard === undefined);
}

console.log("\nprogression gates and rewards:");
{
  check("stage 1 is open to a new account", stageIsOpen(1, 0));
  check("stage 5 is not", !stageIsOpen(5, 0));
  check("and stage 2 opens once 1 is cleared", stageIsOpen(2, 1));
  check("a cleared stage is closed for good", !stageIsOpen(1, 12));
  check("but the next four are open", stageIsOpen(13, 12) && stageIsOpen(16, 12) && !stageIsOpen(17, 12));
  const win = stageReward(10, true, 0);
  const loss = stageReward(10, false, 0);
  check("a loss still pays something", loss.leafCoin > 0 && loss.plantXp > 0, JSON.stringify(loss));
  check("and pays less than a win", win.leafCoin > loss.leafCoin && win.plantXp > loss.plantXp, `${win.leafCoin}/${win.plantXp} vs ${loss.leafCoin}/${loss.plantXp}`);
  check("rewards grow with the stage number", stageReward(30, true, 0).leafCoin > stageReward(5, true, 0).leafCoin);
  const a0 = stageAffixes("p", STAT_LADDER_END, 0).length;
  const a1 = stageAffixes("p", STAT_LADDER_END + 10, 0).length;
  const a2 = stageAffixes("p", 200, 0).length;
  check("affixes appear past the stat ladder and grow", a0 === 0 && a1 >= 1 && a2 > a1, `${a0}, ${a1}, ${a2}`);
  const setOf = (s: number) => stageAffixes("p", s, 0).map((x) => x.id).sort().join(",");
  let dupes = 0;
  for (let s = 300; s < 500; s++) if (setOf(s) === setOf(s + 1)) dupes++;
  check("the endless tail is not one fight repeated", dupes === 0, `${dupes} identical adjacent pairs in 300..500`);
}

/* ---------------------------------------------------------------------------
   The parts that need a browser
   --------------------------------------------------------------------------- */

const browser: Browser = await chromium.launch();

/** A plant strong enough to clear stage 1, and the account around it. */
const SEED = `(() => {
  const g = (window).__game, s = g.store;
  s.state.breederLevel = 6;
  s.state.ascent.highest = 0;
  s.state.ascent.cleared = 0;
  s.state.ascent.day = new Date().toISOString().slice(0, 10);
  s.state.leafCoin = 90000;
  for (const p of s.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 12;
    p.growth.xp = 0;
    p.tier = "sprout";
    p.powerRating = 620;
  }
  g.navigate("ascent");
})()`;

async function open(w = 1180, h = 900): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);
  return page;
}

/** Read the ladder state straight off the store. */
const readAscent = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(`(() => {
    const s = (window).__game.store;
    return { highest: s.state.ascent.highest, attempts: s.state.ascent.attempts, day: s.state.ascent.day };
  })()`) as Promise<Record<string, unknown>>;

/** The player-visible frontier: which stage the map is offering next. */
const frontierOf = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(`(() => {
    const cap = document.querySelector(".stagemap-caption-next");
    const now = [...document.querySelectorAll(".stagemap-cell.is-now")].map((n) => n.textContent);
    return {
      caption: cap ? cap.textContent : "",
      nowCells: now,
      cleared: document.querySelectorAll(".stagemap-cell.is-cleared").length,
      locked: document.querySelectorAll(".stagemap-cell.is-locked").length,
      rows: document.querySelectorAll(".ascent-row, .stagerow").length,
    };
  })()`) as Promise<Record<string, unknown>>;

{
  const page = await open();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));

  console.log("\n1. a new account sees stage 1 and nothing past it:");
  await page.evaluate(SEED);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: "shots/ascent/1-new-account.png" });

  const fresh = await frontierOf(page);
  const freshState = await readAscent(page);
  console.log(`  ${JSON.stringify(fresh)}`);
  check("the map names the stage it is offering", String(fresh.caption).includes("Ải 1"), String(fresh.caption));
  check("and the name is the stage's real name, not just an index", String(fresh.caption).includes(stageName(1)), `${fresh.caption} / ${stageName(1)}`);
  check("exactly one stage is marked as current", (fresh.nowCells as string[]).length === 1, JSON.stringify(fresh.nowCells));
  check("nothing is marked cleared yet", (fresh.cleared as number) === 0, String(fresh.cleared));
  check("distant stages are visibly locked", (fresh.locked as number) > 0, String(fresh.locked));
  check("the record starts at zero", freshState.highest === 0);

  /* --- the brief --- */
  console.log("\n2. stage 1 can be entered, and says what it wants:");
  /*
   * Selected on `data-stage-fight`, not on the label.
   *
   * This matched `/Vượt ải này|Đánh lại/` — Vietnamese prose in a regex, coupled to wording that
   * existed only by accident. It broke the moment the button was relabelled to name its stage,
   * which was an improvement, and a test that fails when the copy improves is reading the wrong
   * thing. The hook says *which stage's action this is*; the label says what a player should
   * call it, and those are allowed to change independently.
   */
  await page.evaluate(`(() => {
    const b = document.querySelector('[data-stage-fight="1"]');
    if (b) b.click();
  })()`);
  await page.waitForSelector(".stagebrief-panel", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/ascent/2-brief.png" });

  const brief = (await page.evaluate(`(() => {
    const p = document.querySelector(".stagebrief-panel");
    if (!p) return null;
    return {
      text: (p.textContent || "").replace(/\\s+/g, " "),
      name: p.querySelector(".stagebrief-name")?.textContent ?? "",
      diff: p.querySelector(".stagebrief-diff")?.textContent ?? "",
      rows: p.querySelectorAll(".stagebrief-row").length,
    };
  })()`)) as Record<string, unknown> | null;

  console.log(`  ${JSON.stringify(brief)}`);
  check("the brief opens", brief !== null);
  check("it carries the stage name", String(brief?.name) === stageName(1), `${brief?.name} vs ${stageName(1)}`);
  check("and a difficulty rating", String(brief?.diff).length > 4, String(brief?.diff));
  check("whose two halves do not repeat the same word", /(.)\\s*\\1/.test(String(brief?.diff)) === false, String(brief?.diff));
  check("and three rules — win, lose, timeout", (brief?.rows as number) === 3, String(brief?.rows));
  check("the timeout rule is stated, not implied", String(brief?.text).includes("90 giây"));

  /* --- the fight and the result --- */
  console.log("\n3. fight it, and see a result:");
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll(".stagebrief-panel button")].find((x) => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  /*
   * The replay is real-time — a grind can run a minute and a half — so the wait has to
   * outlast the longest fight. `waitForFunction` takes its options as the third argument;
   * passing `{ timeout }` as the second fed it to the page function and left the default
   * 30s in force, which is why this used to time out mid-fight.
   */
  await page.waitForFunction(`(() => Boolean(document.querySelector(".stagelive-panel")))()`, undefined, { timeout: 150000 });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: "shots/ascent/3-result.png" });

  const result = (await page.evaluate(`(() => {
    const p = document.querySelector(".stagelive-panel");
    return {
      text: (p?.textContent || "").replace(/\\s+/g, " "),
      title: p?.querySelector(".stagelive-title")?.textContent ?? "",
      won: document.querySelector(".stagelive")?.classList.contains("is-win") ?? false,
      button: document.querySelector(".stagelive .btn.primary")?.textContent ?? "",
      unlock: document.querySelector(".stagelive-unlock")?.textContent ?? "",
    };
  })()`)) as Record<string, unknown>;

  console.log(`  ${String(result.text).slice(0, 200)}`);
  check("a result screen appears", Boolean(result.text));
  check("it is either a win or a loss, clearly", typeof result.won === "boolean");
  check("the title names the stage, not just its number", String(result.title).includes(stageName(1)), `${result.title}`);
  check("the rules are restated", String(result.text).includes("90 giây"));
  check("and the rewards are tallied", /\+\d/.test(String(result.text)));

  const won = result.won === true;
  console.log(`  outcome: ${won ? "win" : "loss"}`);

  if (won) {
    check("the result announces the unlock", String(result.unlock).includes("2"), String(result.unlock));
    check("and the continue button points at it", String(result.button).includes("2"), String(result.button));
  }

  await page.evaluate(`(() => { const b = document.querySelector(".stagelive .btn.primary"); if (b) b.click(); })()`);
  await page.waitForTimeout(1400);

  /* --- record + reload --- */
  console.log("\n4. the record moved, and survives a reload:");
  const afterWin = await readAscent(page);
  const mapAfter = await frontierOf(page);
  console.log(`  ${JSON.stringify(afterWin)}`);
  check("the record advanced past 0", (afterWin.highest as number) >= 1, String(afterWin.highest));
  check("and the map now marks a cleared stage", (mapAfter.cleared as number) >= 1, String(mapAfter.cleared));
  check("and offers the one after it", String(mapAfter.caption).includes(`Ải ${(afterWin.highest as number) + 1}`), String(mapAfter.caption));
  await page.screenshot({ path: "shots/ascent/4-unlocked.png" });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(1400);
  /*
   * Back to the ladder.
   *
   * The reload lands on the garden, because that is where a reload lands — the screen is not
   * part of the save. So the map has to be reopened before it can be inspected, and the
   * first version of this read an empty document and reported the unlock as lost when it was
   * sitting in the store the whole time.
   */
  await page.evaluate(`(() => (window).__game.navigate("ascent"))()`);
  await page.waitForTimeout(1600);

  const afterReload = await readAscent(page);
  const mapReloaded = await frontierOf(page);
  console.log(`  after reload: ${JSON.stringify(afterReload)}`);
  check("the stage unlock survived the reload", afterReload.highest === afterWin.highest, `${afterWin.highest} -> ${afterReload.highest}`);
  check("and the map still marks it cleared", (mapReloaded.cleared as number) >= 1, String(mapReloaded.cleared));
  check("and still points at the next stage", String(mapReloaded.caption).includes(`Ải ${(afterReload.highest as number) + 1}`), String(mapReloaded.caption));
  await page.screenshot({ path: "shots/ascent/5-after-reload.png" });

  /* --- replay an old stage: refused ---
   *
   * Cleared stages never reopen. The store refuses, the button is not rendered,
   * and nothing is paid — replaying for EXP was the one way to grow without
   * planting or breeding. */
  console.log("\n5. replay the stage already cleared — refused:");
  const clearedStage = afterReload.highest as number;
  const xpBefore = (await page.evaluate(`(() => (window).__game.store.state.plants[0].growth.xp)()`)) as number;
  const coinsBefore = (await page.evaluate(`(() => (window).__game.store.state.leafCoin)()`)) as number;

  const replayed = (await page.evaluate(`(async (n) => {
    const s = (window).__game.store;
    const out = s.runAscentStage(s.state.plants[0].plantId, n);
    return { ok: out.ok, won: out.won === true, reason: out.reason ?? null, plantXp: out.reward ? out.reward.plantXp : 0 };
  })(${clearedStage > 1 ? clearedStage - 1 : 1})`)) as Record<string, unknown>;

  await page.waitForTimeout(1200);
  const xpAfter = (await page.evaluate(`(() => (window).__game.store.state.plants[0].growth.xp)()`)) as number;
  const coinsAfter = (await page.evaluate(`(() => (window).__game.store.state.leafCoin)()`)) as number;
  const replayBtn = await page.evaluate(`(() => [...document.querySelectorAll("[data-stage-fight]")].some(b => (b.textContent ?? "").includes("lại")))()`);

  console.log(`  ${JSON.stringify(replayed)}`);
  check("a cleared stage refuses to re-enter", replayed.ok === false, String(replayed.reason));
  check("the refusal names the reason", String(replayed.reason).includes("đã vượt"), String(replayed.reason));
  check("replaying pays nothing", xpAfter === xpBefore && coinsAfter === coinsBefore, `${xpBefore}->${xpAfter} / ${coinsBefore}->${coinsAfter}`);
  check("and no replay button is rendered", replayBtn === false);

  /* --- a loss --- */
  console.log("\n6. a stage that is too hard:");
  /*
   * Depth plus an under-levelled plant, which is the only honest way to lose here.
   *
   * See the note at the top of this file's loss section: weakening the plant alone shrinks
   * the monster with it, because the ladder's difficulty is a share of the player's own
   * power. The monster has to be deep into the ladder *and* the plant has to be small.
   */
  const loss = (await page.evaluate(`(async () => {
    const s = (window).__game.store;
    const p = s.state.plants[0];
    // Record progress so a deep stage is legitimately open, then under-level the plant so
    // the stage that opened is genuinely out of reach — but still above the admission
    // floor, which now refuses outright fights the plant cannot possibly win.
    s.state.ascent.highest = 40;
    p.powerRating = 380;
    const stage = 44;
    const out = s.runAscentStage(p.plantId, stage);
    return {
      ok: out.ok,
      won: out.won === true,
      stage,
      consolation: out.reward ? { coin: out.reward.leafCoin, xp: out.reward.plantXp } : null,
      highest: s.state.ascent.highest,
    };
  })()`)) as Record<string, unknown>;

  await page.waitForTimeout(1000);
  const lossAfter = await readAscent(page);
  console.log(`  ${JSON.stringify(loss)}`);
  check("fighting a hard stage is allowed", loss.ok === true, String(loss.reason));
  check("an outmatched plant actually loses", loss.won === false, `stage ${loss.stage} reported a win`);
  check("a loss leaves the record alone", lossAfter.highest === 40, `40 -> ${lossAfter.highest}`);
  check("and still pays a consolation", (loss.consolation as Record<string, number>).coin > 0, JSON.stringify(loss.consolation));

  check("no page errors throughout", errs.length === 0, errs.join(" | "));
  await page.close();
}

await browser.close();
console.log(bad ? `\n${bad} failed` : "\nthe ladder is playable end to end");
if (bad) process.exit(1);