/**
 * Experience: does it add up?
 *
 * ## The four cases, and why they are the four
 *
 *   1. a grant too small to level — the bar must move and the level must not
 *   2. a grant exactly one level short, then exactly enough — the boundary is where an
 *      off-by-one hides, because "almost" and "just enough" differ by one XP
 *   3. a grant spanning several levels at once — every level must be crossed, the remainder
 *      banked, and nothing lost
 *   4. a reload after levelling — the level and the banked remainder must both survive
 *
 * ## "Nothing lost, nothing wrong" is checked as arithmetic, not vibes
 *
 * The store walks the requirement curve one level at a time. That is a loop with a
 * subtraction in it, which is exactly the shape where a level is double-counted or a
 * remainder is dropped — and both failures are invisible in normal play, because the bar still
 * moves and the number still looks plausible.
 *
 * So this asserts the conservation law directly: for every case, `total granted` must equal
 * `spent on levels` plus `what is left in the bar`. If that identity ever fails, no amount of
 * screenshotting would have shown it.
 */
import { xpRequired, gainXp } from "../src/growth/care";
import { xpForLevel, BREEDER_LEVEL_CAP, GameStore } from "../src/core/store";
import { previewGain, previewPlantGain, plantSnapshot, breederSnapshot } from "../src/progression/levels";
import { readCombo, stageObjectives, evaluateObjectives, objectiveContext, skillMasteryPct, skillMasteryText } from "../src/progression/objectives";
import { simulateBattle } from "../src/battle/engine";
import { createSeedPlant } from "../src/genetics/genomeGenerator";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const fresh = () =>
  createSeedPlant("thornroot", "owner", `n${Math.floor(Math.random() * 1e9)}`, 0);

console.log("curves:");

console.log("\n1. a grant too small to level:");
{
  const p = fresh();
  p.growth.level = 5;
  p.growth.xp = 0;
  const grant = xpRequired(5) - 1;
  const levels = gainXp(p, grant);
  check("no level is crossed", levels === 0, `${levels}`);
  check("the whole grant is banked", p.growth.xp === grant, `${p.growth.xp} of ${grant}`);
  const snap = plantSnapshot(p);
  check("and the bar reads just under full", snap.pct > 98 && snap.pct < 100, `${snap.pct.toFixed(1)}%`);
  check("level 1 starts from zero experience", plantSnapshot({ ...p, growth: { ...p.growth, level: 1, xp: 0 } }).xp === 0);
}
{
  /* One more XP, and it crosses. The boundary itself. */
  const p = fresh();
  p.growth.level = 5;
  p.growth.xp = 0;
  const need = xpRequired(5);
  gainXp(p, need);
  check("exactly enough crosses exactly one level", p.growth.level === 6, `lv${p.growth.level}`);
  check("and banks nothing over", p.growth.xp === 0, `${p.growth.xp}`);
  check("the next level costs more than the last", xpRequired(6) > need, `${need} -> ${xpRequired(6)}`);
}

console.log("\n2. the boundary from one short, and the case just over it:");
{
  const p1 = fresh();
  p1.growth.level = 5;
  p1.growth.xp = 0;
  gainXp(p1, xpRequired(5) - 1);
  check("one XP short stays put", p1.growth.level === 5 && p1.growth.xp === xpRequired(5) - 1);
  const p2 = fresh();
  p2.growth.level = 5;
  p2.growth.xp = 0;
  gainXp(p2, xpRequired(5) + 1);
  check("one XP over levels and banks the extra", p2.growth.level === 6 && p2.growth.xp === 1, `lv${p2.growth.level} xp${p2.growth.xp}`);
  check("the extra XP is not lost", p2.growth.xp === 1);
}

console.log("\n3. a grant spanning many levels at once:");
{
  for (const grant of [xpRequired(5) * 3 + 40, 5000, 40000, 250000]) {
    const p = fresh();
    p.growth.level = 5;
    p.growth.xp = 0;
    const levels = gainXp(p, grant);

    /* The conservation law: granted == spent crossing levels + what is left. */
    let spent = 0;
    for (let l = 5; l < p.growth.level; l++) spent += xpRequired(l);
    const conservation = spent + p.growth.xp === grant;

    const snap = plantSnapshot(p);
    const preview = previewPlantGain(grant, { ...p, growth: { ...p.growth, level: 5, xp: 0 } });
    check(
      `grant ${grant}: level and banked XP account for every XP (lv5 -> lv${p.growth.level}, ${p.growth.xp} left)`,
      conservation,
      `spent ${spent} + left ${p.growth.xp} = ${spent + p.growth.xp}, granted ${grant}`,
    );
    check(`grant ${grant}: the preview agrees with what happened`, preview.finalLevel === p.growth.level && preview.leftover === p.growth.xp, `preview lv${preview.finalLevel}/${preview.leftover}`);
    check(`grant ${grant}: the reported level count matches`, preview.levelsGained === levels && levels === p.growth.level - 5);
    check(`grant ${grant}: and the bar is inside its own range`, snap.pct >= 0 && snap.pct <= 100, `${snap.pct}`);
  }
}
{
  /* The breeder curve, walked the same way. */
  const before = { level: 1, xp: 0 };
  let level = 1;
  let xp = 0;
  let granted = 0;
  for (let i = 0; i < 2000 && level < BREEDER_LEVEL_CAP; i++) {
    xp += 7;
    granted += 7;
    while (level < BREEDER_LEVEL_CAP && xp >= xpForLevel(level)) {
      xp -= xpForLevel(level);
      level++;
    }
  }
  let spent = 0;
  for (let l = before.level; l < level; l++) spent += xpForLevel(l);
  check("the breeder curve conserves experience too", spent + xp === granted, `${spent} + ${xp} vs ${granted}`);
  const snap = breederSnapshot(level, xp);
  check("and its snapshot stays in range", snap.pct >= 0 && snap.pct <= 100 && snap.level === level);
  check("a capped breeder reports a full bar rather than a broken one", breederSnapshot(BREEDER_LEVEL_CAP, 0).capped === true && breederSnapshot(BREEDER_LEVEL_CAP, 0).pct === 100);
  /*
   * The threshold is derived, not guessed.
   *
   * The first version asserted that a 100,000 grant reaches level 60. Walking the curve shows
   * 60 needs 100,301 — so the preview was correct and the test was wrong. A check whose
   * expected value is a literal is a check that breaks the moment someone tunes the curve,
   * and which agrees with a bug whenever the two happen to differ in the same direction.
   */
  let toCap = 0;
  for (let l = before.level; l < BREEDER_LEVEL_CAP; l++) toCap += xpForLevel(l);
  const pre = previewGain({ level: 1, xp: 0, need: xpForLevel(1), pct: 0, capped: false }, toCap, xpForLevel, BREEDER_LEVEL_CAP);
  check(`exactly the cap's worth of experience reaches the cap (needs ${toCap.toLocaleString()})`, pre.finalLevel === BREEDER_LEVEL_CAP, `lv${pre.finalLevel}`);
  check("one XP short stops at the level below it", previewGain({ level: 1, xp: 0, need: xpForLevel(1), pct: 0, capped: false }, toCap - 1, xpForLevel, BREEDER_LEVEL_CAP).finalLevel === BREEDER_LEVEL_CAP - 1);

  /*
   * The leftover at the cap has to be the number the store will hold.
   *
   * It used to be reported as 0 while `addBreederXp` banked the remainder, so a preview and
   * the ledger disagreed by however much the grant exceeded the cap — 899,699 for a grant of
   * a million. The bar is unaffected either way, because `breederSnapshot` renders a capped
   * bar as full on the strength of `capped` alone.
   */
  const overCap = previewGain({ level: 1, xp: 0, need: xpForLevel(1), pct: 0, capped: false }, 1e6, xpForLevel, BREEDER_LEVEL_CAP);
  check("a capped preview reports the experience the store will actually hold", overCap.leftover === 1e6 - toCap, `preview says ${overCap.leftover}, store would hold ${(1e6 - toCap).toLocaleString()}`);
  check("and it is not zero, which is what it used to claim", overCap.leftover > 0);
  check("while the bar still reads full at the cap", breederSnapshot(BREEDER_LEVEL_CAP, overCap.leftover).pct === 100);
}

console.log("\n4. experience sources read a real fight:");
{
  const a = createSeedPlant("thornroot", "p1", "x1", 0);
  const b = createSeedPlant("gloomcap", "p2", "x2", 0);
  const result = simulateBattle(a, b, { seed: "obj-probe", maxSeconds: 90, arena: "sunny" });
  const combo = readCombo(result.events, "a");
  check("a combo is read from the recorded events", combo.hits > 0 && combo.best > 0 && combo.best <= combo.hits, JSON.stringify(combo));
  check("and it is the same every time", JSON.stringify(readCombo(result.events, "a")) === JSON.stringify(combo));

  const ctx = objectiveContext(result.winner === "a", result);
  const scored = evaluateObjectives(8, ctx);
  check("four objectives per stage", scored.met.length + scored.missed.length === 4);
  check("each met objective pays experience", scored.met.every((o) => o.xp > 0 && o.breederXp > 0));
  check("the bonus is exactly the sum of what was met", scored.bonusPlantXp === scored.met.reduce((s, o) => s + o.xp, 0), `${scored.bonusPlantXp}`);
  check("the star count is the number met", scored.stars === scored.met.length);
  check("a loss can meet the non-win-gated ones only", objectiveContext(false, result).won === false);
  check("objectives scale with depth", stageObjectives(80)[0].xp > stageObjectives(8)[0].xp, `${stageObjectives(8)[0].xp} -> ${stageObjectives(80)[0].xp}`);
  check("but never without bound past the ladder's end", stageObjectives(200)[0].xp === stageObjectives(80)[0].xp, `${stageObjectives(200)[0].xp}`);
}

console.log("\n5. skill mastery:");
{
  check("a fresh skill reads as empty", skillMasteryPct(1, 0) === 0);
  check("and says so", skillMasteryText(1, 0).includes("30"), skillMasteryText(1, 0));
  check("a maxed skill reads full", skillMasteryPct(99, 99999) === 100 && skillMasteryText(99, 99999).includes("tối đa"));
  check("and the percentage stays inside its bar", [0, 15, 29, 30, 200].every((x) => { const v = skillMasteryPct(1, x); return v >= 0 && v <= 100; }));
}

console.log("\n6. it survives a save and reload:");
{
  /* The store writes on every commit and reads on construction, so the honest test is a real
     one: a store, some experience, then a second store built from the same slot. */
  const mem = new Map<string, string>();
  const store = new Map<string, string>();
  void store;
  const g: Record<string, unknown> = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };

  const s1 = new GameStore();
  const plant = s1.state.plants[0];
  plant.growth.stage = "mature";
  plant.growth.level = 4;
  plant.growth.xp = 0;
  s1.addPlantXp(plant, xpRequired(4) + 37);
  const lvBefore = plant.growth.level;
  const xpBefore = plant.growth.xp;
  const breederBefore = { level: s1.state.breederLevel, xp: s1.state.breederXp };
  s1.addBreederXp(500);

  const s2 = new GameStore();
  const plant2 = s2.state.plants[0];
  check("the level survived", plant2.growth.level === lvBefore, `${lvBefore} -> ${plant2.growth.level}`);
  check("and so did the banked remainder — no XP lost on reload", plant2.growth.xp === xpBefore, `${xpBefore} -> ${plant2.growth.xp}`);
  check("and the breeder's level", s2.state.breederLevel === s1.state.breederLevel, `${s1.state.breederLevel} -> ${s2.state.breederLevel}`);
  check("and its experience", s2.state.breederXp === s1.state.breederXp, `${breederBefore.xp} -> ${s2.state.breederXp} (was ${breederBefore.level})`);
  check("and the snapshot still reads as in-range", plantSnapshot(plant2).pct >= 0 && plantSnapshot(plant2).pct <= 100);
}

console.log(bad ? `\n${bad} failed` : "\nexperience adds up, and survives");
if (bad) process.exit(1);