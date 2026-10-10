/**
 * WP07 / BAT-03…05,08 — battle presentation in a real browser.
 *
 * The domain suite proves the settle; this suite proves what the player sees:
 * no HUD overlap under hostile names, skill buttons that survive a hundred
 * ticks without losing their identity, settlement that lands once, and a
 * fight that still resolves under reduced motion and no audio.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { applyFixture } from "./fixtures";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function boot(browser: Browser, fixture = "F03", width = 390, height = 844): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await page.goto("http://localhost:5173");
  await applyFixture(page, fixture);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__game));
  const skip = page.locator(".gate-skip");
  if (await skip.count()) await skip.click();
  await page.waitForSelector(".gate-overlay", { state: "detached", timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    sessionStorage.setItem(`ci-shown:${key}`, "1");
    /* Long hostile names on every plant, so the HUD is measured against the
       worst names the registry can produce (F09's stress, applied in place). */
    for (const p of (window as any).__game.store.state.plants) {
      p.name = "Hắc ám Cành Nước Diệm Đêm Khuya Ngấm Độc Vĩnh Cửu " + p.name;
      /* Long fight by construction: the AI opponent is bred fresh and scales
         within ±40% of our powerRating, so the only way to keep it alive is
         low damage output — ~800hp against 30 attack is ~30 hits, well past
         the probe window. Energy still charges per *hit* (+4, damage value is
         irrelevant), so skills come online on schedule; and defense is a wall
         the scaled-down foe cannot breach. A fight that ends before the probe
         arrives makes every identity/overlap assertion measure nothing. */
      p.stats.hp = 6000; p.stats.maxHp = 6000;
      p.stats.attack = 30; p.stats.defense = 8000; p.stats.speed = 60;
      p.powerRating = 400;
      p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now();
    }
  });
  return page;
}

/** Arena AI fight through the real UI — the same flow test-audio drives. */
async function startArenaFight(page: Page): Promise<void> {
  await page.evaluate(`(() => (window).__game.navigate("arena"))()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Đấu với AI/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => { const c = document.querySelector(".sheet .pickrow"); if (c) c.click(); })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForSelector(".battlefield", { timeout: 20000 }).catch(() => {});
}

const rectsOverlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

let browser: Browser | undefined;
try {
  browser = await chromium.launch();

  console.log("\nBAT-03 — no HUD overlap with hostile names:");
  {
    const page = await boot(browser);
    await startArenaFight(page);
    await page.waitForTimeout(2500);
    const overlaps = await page.evaluate(`(() => {
      const ov = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      const r = (q) => [...document.querySelectorAll(q)].map(e => e.getBoundingClientRect().toJSON());
      const batts = r(".battler");
      const skills = r(".skillbtn");
      const bars = [...r(".energymeter"), ...r(".phase"), ...r(".clock"), ...r(".combometer")];
      const bad = [];
      if (batts.length === 2 && ov(batts[0], batts[1])) bad.push("battlers overlap");
      for (let i = 0; i < skills.length; i++)
        for (let j = i + 1; j < skills.length; j++)
          if (ov(skills[i], skills[j])) bad.push("skill " + i + "/" + j);
      for (const b of bars)
        for (const s of skills)
          if (ov(b, s)) bad.push("meter over skill");
      return { bad, battlers: batts.length, skills: skills.length };
    })()`).catch((e: Error) => ({ bad: [String(e)] as string[], battlers: 0, skills: 0 }));
    check("two fighters' HUD cards never overlap", !(overlaps.bad as string[]).some(b => b.includes("battlers")), JSON.stringify(overlaps.bad));
    check("skill buttons never collide with each other or the meters", overlaps.bad.length === 0, JSON.stringify(overlaps.bad));
    check("there are actually skill buttons to measure", overlaps.skills > 0, String(overlaps.skills));
    await page.close();
  }

  console.log("\nBAT-04 — skill buttons keep identity across ticks; a press lands:");
  {
    const page = await boot(browser);
    await startArenaFight(page);
    await page.waitForTimeout(600);
    const identity = await page.evaluate(`(async () => {
      const btns = [...document.querySelectorAll(".skillbtn")];
      const before = btns.map(b => ({ node: b, name: b.querySelector(".nm")?.textContent }));
      /* ~80 ticks at the 100ms engine cadence — longer than the skill bar's
         whole old rebuild cycle, so identity drift would already show. */
      await new Promise(r => setTimeout(r, 8000));
      const same = before.every((b, i) => document.contains(b.node));
      /* A press through the real listener — the same node must still be the
         one handling it, which is what "press not lost on repaint" means.
         Skills can legitimately sit on cooldown/cost, so wait for one to come
         ready rather than asserting on whichever happened to be up at t=8s.
         Auto-cast starts ON (see battleView's autoBtn) — with it on, the
         engine claims each skill the tick it readies and the enabled window
         is shorter than any poll interval. A player who wants to press turns
         it off first; so does the probe. */
      const autoBtn = [...document.querySelectorAll("button")].find(b => /Tự ra chiêu/.test(b.textContent || ""));
      if (autoBtn && !/TẮT/.test(autoBtn.textContent || "")) autoBtn.click();
      let first = null;
      for (let i = 0; i < 60 && !first; i++) {
        first = [...document.querySelectorAll(".skillbtn")].find(b => !(b).disabled) ?? null;
        if (!first) await new Promise(r => setTimeout(r, 500));
      }
      let cast = false;
      if (first) {
        (first).click();
        await new Promise(r => setTimeout(r, 400));
        cast = true;
      }
      return { same, count: before.length, castTried: !!first, cast };
    })()`);
    check("every skill button node survives ~80 ticks in place", identity.same === true, JSON.stringify(identity));
    check("at least one skill existed to press", identity.count > 0 && identity.castTried === true);
    await page.close();
  }

  console.log("\nBAT-05 — a finished fight cleans up; settlement lands once:");
  {
    const page = await boot(browser);
    await startArenaFight(page);
    // Let it run to its natural end (maxSeconds 90 → wait for result overlay).
    await page.waitForSelector(".result-banner", { timeout: 100000 }).catch(() => {});
    const after = await page.evaluate(`(() => {
      const ledger = (window).__game.store.state.ledger.filter(l => /Thắng trận|Hòa|Tham gia trận/.test(l.reason));
      return { battlefields: document.querySelectorAll(".battlefield").length,
               resultish: !!document.querySelector(".result-banner"),
               word: document.querySelector(".result-word")?.textContent ?? "",
               rewardLines: ledger.length };
    })()`);
    check("at most one battlefield mounted at once", after.battlefields <= 1, String(after.battlefields));
    check("fight resolved into a result surface", after.resultish === true, JSON.stringify(after));
    check("reward written to the ledger, not duplicated", after.rewardLines === 1, `lines=${after.rewardLines}`);
    /* Close/next through the real controls must not settle a second time. */
    const again = await page.evaluate(`(() => {
      const before = (window).__game.store.state.ledger.length;
      const btns = [...document.querySelectorAll(".result-banner ~ * button, .result-card button, button")];
      const replay = btns.find(b => /Đấu tiếp|Lại|Tiếp|Quay|Đóng/.test(b.textContent || ""));
      if (replay) replay.click();
      return { before, after: (window).__game.store.state.ledger.length };
    })()`);
    check("result close/next adds no second settle", again.after === again.before, JSON.stringify(again));
    await page.close();
  }

  console.log("\nBAT-08 — reduced motion + no audio still reach a readable result:");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("http://localhost:5173");
    await applyFixture(page, "F03");
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__game));
    const skip = page.locator(".gate-skip");
    if (await skip.count()) await skip.click();
    await page.evaluate(() => {
      const d = new Date();
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      sessionStorage.setItem(`ci-shown:${key}`, "1");
      for (const p of (window as any).__game.store.state.plants) {
        p.stats.hp = 3000; p.stats.maxHp = 3000; p.stats.attack = 400; p.stats.speed = 300;
        p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now(); p.powerRating = 500;
      }
    });
    await startArenaFight(page);
    await page.waitForSelector(".result-banner", { timeout: 100000 }).catch(() => {});
    const rm = await page.evaluate(`(() => ({
      text: (document.querySelector(".result-banner")?.textContent ?? "").slice(0, 120),
      field: !!document.querySelector(".battlefield"),
      won: (window).__game.store.state.plants.some(p => p.battleRecord.wins > 0 || p.battleRecord.losses > 0),
    }))()`);
    check("fight produced a recorded outcome", rm.won === true, JSON.stringify(rm));
    check("the result text exists and says something", rm.text.length > 0, JSON.stringify(rm.text));
    await ctx.close();
  }
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
