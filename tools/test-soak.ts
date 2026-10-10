/*
 * test-soak.ts — bounded real-time soak (docs/34 §17.1).
 *
 * The spec's 15-minute garden is the minimum meaningful session and it runs
 * for real here — no fake clock. Counters are sampled at 0/5/10/15 min:
 * heap (performance.memory), DOM nodes, live audio sources, request count.
 * Then: 5 min hidden, 20 route transitions, 10 consecutive quick fights.
 * Verdicts catch the failure shapes a soak exists for: heap runaway, DOM
 * growth, unbounded audio sources, network storms, listener pile-up across
 * routes, and data loss across a reload.
 *
 * Runs against the production-transformed test build (npm run preview:test).
 * TEST_BASE_URL overrides the default dev-server URL.
 */

import { chromium, type Browser, type Page } from "playwright-core";
import { applyFixture } from "./fixtures";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
const GARDEN_MS = Number(process.env.SOAK_GARDEN_MS ?? 15 * 60 * 1000);
const HIDDEN_MS = Number(process.env.SOAK_HIDDEN_MS ?? 5 * 60 * 1000);
const SAMPLES = Math.max(2, Number(process.env.SOAK_SAMPLES ?? 4)); // 0/5/10/15

let pass = 0, fail = 0;
const check = (ok: boolean, name: string, detail = "") => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

type Counters = { heapMB: number; dom: number; sources: number; reqs: number };

async function counters(page: Page, reqs: number): Promise<Counters> {
  const c = await page.evaluate<any>(`(() => {
    const g = (window).__game;
    return {
      heap: performance.memory ? performance.memory.usedJSHeapSize : -1,
      dom: document.getElementsByTagName("*").length,
      sources: g?.music ? g.music.stats?.().liveSources ?? -1 : -1,
    };
  })()`);
  return { heapMB: c.heap / 1048576, dom: c.dom, sources: c.sources, reqs };
}

const routeCycle = async (page: Page) => {
  for (const nav of ["lab", "collection", "breeding", "garden"]) {
    await page.click(`[data-nav="${nav}"]`).catch(async () => {
      await page.evaluate<any>(`(window).__game.navigate("${nav}")`);
    });
    await page.waitForTimeout(300);
  }
};

async function main() {
  console.log(`SOAK — real-time bounded session on ${BASE}`);
  console.log(`  garden=${GARDEN_MS / 60000}min samples=${SAMPLES} hidden=${HIDDEN_MS / 60000}min + 20 route cycles + 10 fights`);

  const browser: Browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page: Page = await ctx.newPage();
  let reqs = 0;
  page.on("request", () => reqs++);

  await page.goto(BASE);
  await page.evaluate<any>(`localStorage.setItem("nongtrai.onboarded", "1"); localStorage.setItem("ci-shown", new Date().toDateString())`);
  await applyFixture(page, "F02");

  /* Music on for real — the whole point of the audio half of the soak. A real
     pointer event takes the same path a player's first tap does (sfx.unlock +
     music.start on the gesture), so liveSources actually means "audible". */
  await page.mouse.click(200, 120);
  await page.waitForTimeout(1500);
  const musicUp = await page.evaluate<any>(`(() => {
    const g = (window).__game;
    return { running: g.music.stats().running, ctx: g.sfx?.context?.state ?? "none" };
  })()`);
  check(musicUp.running === true && musicUp.ctx === "running", "music bed actually running after the unlock gesture", JSON.stringify(musicUp));

  const samples: Counters[] = [await counters(page, reqs)];
  const t0 = Date.now();
  for (let i = 1; i < SAMPLES; i++) {
    const wait = (GARDEN_MS / (SAMPLES - 1)) * i - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    samples.push(await counters(page, reqs));
  }

  console.log("\n  garden counters (heap MB / dom / sources / reqs):");
  for (const [i, s] of samples.entries())
    console.log(`    t=${Math.round((GARDEN_MS / 60000 / (SAMPLES - 1)) * i)}min  ${s.heapMB.toFixed(1)} / ${s.dom} / ${s.sources} / ${s.reqs}`);

  const first = samples[0], last = samples[samples.length - 1];
  check(last.heapMB < first.heapMB * 2, "heap under 2× after garden soak", `${first.heapMB.toFixed(1)}→${last.heapMB.toFixed(1)}MB`);
  check(Math.abs(last.dom - first.dom) < first.dom * 0.5, "DOM stable over soak", `${first.dom}→${last.dom}`);
  check(last.sources >= 0 && last.sources <= 64, "audio sources bounded", `sources=${last.sources}`);

  /* Hidden phase — the app reacts to document.hidden/visibilitychange. Headless
     Chromium cannot occlude a page (cover-tab does not flip hidden either), so
     the trigger is shimmed: override the same properties the browser would set
     and dispatch the same event. Every handler still runs the real path. */
  await page.evaluate<any>(`(() => {
    (window).__setHidden = (v) => {
      Object.defineProperty(document, "hidden", { get: () => v, configurable: true });
      Object.defineProperty(document, "visibilityState", { get: () => v ? "hidden" : "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
  })()`);
  await page.evaluate<any>(`(window).__setHidden(true)`);
  const hiddenReqs = reqs;
  await page.waitForTimeout(HIDDEN_MS);
  await page.evaluate<any>(`(window).__setHidden(false)`);
  await page.waitForTimeout(2000);
  const hiddenStorm = reqs - hiddenReqs;
  check(hiddenStorm < 500, "no request storm while hidden", `reqs during hidden=${hiddenStorm}`);
  const afterHidden = await counters(page, reqs);
  check(afterHidden.heapMB < first.heapMB * 2.5, "heap still bounded after hidden", `${afterHidden.heapMB.toFixed(1)}MB`);

  /* 20 route transitions — listener/RAF pile-up shows as DOM/heap drift. */
  console.log("\n  route cycles:");
  const preCycle = await counters(page, reqs);
  for (let i = 0; i < 5; i++) await routeCycle(page); // 5×4 = 20 transitions
  await page.waitForTimeout(1500);
  const postCycle = await counters(page, reqs);
  check(Math.abs(postCycle.dom - preCycle.dom) < 1500, "20 transitions leave no DOM pile-up", `${preCycle.dom}→${postCycle.dom}`);
  check(postCycle.heapMB < preCycle.heapMB * 1.8, "20 transitions leave no heap pile-up", `${preCycle.heapMB.toFixed(1)}→${postCycle.heapMB.toFixed(1)}MB`);

  /* 10 consecutive fights — settle-once under repetition, no battlefield left. */
  console.log("\n  fights:");
  for (let i = 0; i < 10; i++) {
    await page.evaluate<any>(`(() => {
      const g = (window).__game;
      const st = g.store.state;
      const p = st.plants.find((pl) => !pl.locks || !pl.locks.battle);
      if (!p) return;
      p.stats.speed = 500; p.stats.attack = 400; p.powerRating = 999;
      g.navigate("arena");
    })()`);
    await page.waitForTimeout(600);
    await page.evaluate<any>(`(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Đấu với AI/.test(x.textContent || ""));
      if (b) b.click();
    })()`);
    await page.waitForTimeout(600);
    await page.evaluate<any>(`(() => { const c = document.querySelector(".sheet .pickrow"); if (c) c.click(); })()`);
    await page.waitForTimeout(600);
    await page.evaluate<any>(`(() => {
      const b = [...document.querySelectorAll("button")].find(x => /Bắt đầu/.test(x.textContent || ""));
      if (b) b.click();
    })()`);
    await page.waitForSelector(".battlefield", { timeout: 15000 });
    await page.waitForSelector(".result-banner", { timeout: 100000 });
    await page.evaluate<any>(`(window).__game.navigate("garden")`);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2500);
  const left = await page.locator(".battlefield").count();
  check(left === 0, "no battlefield left after 10 soak fights", `left=${left}`);

  /* Data survival — a reload mid-session must keep plants and currency. */
  const before = await page.evaluate<any>(`(() => {
    const st = (window).__game.store.state;
    return { plants: st.plants.length, leaf: st.leafCoin };
  })()`);
  await page.reload();
  await page.waitForFunction(() => Boolean((window).__game?.store), { timeout: 15000 });
  await page.waitForTimeout(1000);
  const after = await page.evaluate<any>(`(() => {
    const st = (window).__game.store.state;
    return { plants: st.plants.length, leaf: st.leafCoin };
  })()`);
  check(after.plants >= before.plants, "plants survive reload mid-soak", `${before.plants}→${after.plants}`);
  check(after.leaf >= before.leaf, "wallet survives reload mid-soak", `${before.leaf}→${after.leaf}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
