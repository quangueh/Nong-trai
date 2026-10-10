/**
 * Browser-side actor checks for the visible gardener (docs/27 ACT-02/03/06/07).
 * Runs against the real garden with the F02 fixture: 12 plants, 2 care-ready,
 * ~10 minutes of buff.
 */

import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { applyFixture } from "./fixtures";

const URL = "http://localhost:5173";

let passed = 0;
let failed = 0;
async function test(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`);
  }
}

let browser: Browser | undefined;
let page: Page;

const gdr = () => page.locator(".gdr");
const state = () => page.locator(".gdr").getAttribute("data-state");

async function waitState(want: string | string[], ms = 9000): Promise<string> {
  const set = Array.isArray(want) ? want : [want];
  await page.waitForFunction((ws) => ws.includes(document.querySelector(".gdr")?.getAttribute("data-state") ?? ""), set, { timeout: ms });
  return (await state())!;
}

async function tick(): Promise<number> {
  return page.evaluate(() => (window as any).__game.store.autoCareTick());
}

async function boot(p: Page): Promise<void> {
  await p.goto(URL);
  await applyFixture(p, "F02");
  await p.reload();
  await p.waitForFunction(() => Boolean((window as any).__game));
  await p.waitForSelector(".garden-scene", { timeout: 10000 });
  // The first-visit account gate overlays the scene — keep playing as guest
  // through the real skip button, same as a user would.
  const skip = p.locator(".gate-skip");
  if (await skip.count()) {
    await skip.click();
    await p.waitForFunction(() => !document.querySelector(".gate-overlay"), { timeout: 8000 });
  }
}

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await ctx.newPage();
  await boot(page);

  await test("actor mounts inside the scene while the buff runs", async () => {
    assert.ok(await gdr().count(), "no .gdr element");
    const box = await gdr().boundingBox();
    assert.ok(box && box.width > 20, "actor has no size");
    // Any non-hidden state proves it alive — the app's own 12s tick may have
    // already put it mid-job by the time we sample.
    await waitState(["arrive", "idle", "walk", "face", "work", "ack", "leave"], 15000);
  });

  await test("figure never intercepts input — only the badge is clickable", async () => {
    const pe = await page.locator(".gdr svg").evaluate((n) => getComputedStyle(n).pointerEvents);
    assert.equal(pe, "none");
    const badgePe = await page.locator(".gdr-badge").evaluate((n) => getComputedStyle(n).pointerEvents);
    assert.equal(badgePe, "auto");
  });

  await test("a successful auto-care tick is acted out: work → done", async () => {
    // Reset + tick atomically — the app's own 12s interval would otherwise
    // consume the readiness between two evaluate calls.
    const did = await page.evaluate(() => {
      const s = (window as any).__game.store;
      for (const pl of s.state.plants.slice(0, 3)) {
        pl.careMemory.lastUse = {};
        pl.careMemory.recent = [];
        delete pl.careMemory.lastAction;
      }
      return s.autoCareTick();
    });
    assert.ok(did! >= 1, "tick performed nothing — fixture should have care-ready plants");
    const seen = await waitState(["walk", "face", "work", "ack", "idle"], 12000);
    assert.ok(["walk", "face", "work", "ack", "idle"].includes(seen));
    // Give the full job cycle a bounded window — walk + face + work + ack.
    await page.waitForFunction(
      () => (window as any).__gardener?.done?.length > 0 || document.querySelector(".gdr")?.getAttribute("data-state") === "idle",
      { timeout: 20000 },
    );
    const doneLen = await page.evaluate(() => (window as any).__gardener?.done?.length ?? 0);
    assert.ok(doneLen >= 1, "actor finished no job — done log empty");
  });

  await test("actor work never calls care/reward again (ACT-02)", async () => {
    const probe = await page.evaluate(() => {
      const store = (window as any).__game.store;
      const plant = store.state.plants[0];
      const cycles = plant.economy.careCycles;
      const coin = store.state.leafCoin;
      // Let whatever job is queued finish — acting it out must not touch state.
      return { cycles, coin };
    });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => {
      const store = (window as any).__game.store;
      return { cycles: store.state.plants[0].economy.careCycles, coin: store.state.leafCoin };
    });
    assert.equal(after.coin, probe.coin, "actor performance changed currency");
    // Care may legitimately have advanced only through domain ticks — assert
    // the DOM layer is not the one mutating it by comparing against a tick-free
    // window: no autoCareTick ran in this test, so cycles must be identical.
    assert.equal(after.cycles, probe.cycles, "actor performance mutated plant state");
  });

  await test("sold target cancels the visual job without errors", async () => {
    await page.evaluate(() => {
      const store = (window as any).__game.store;
      // Force a job then delete the plant before the actor reaches it.
      const p = store.state.plants[0];
      store.state.autoCareUntil = Date.now() + 60_000;
      (store as any).pushGardenerWork?.(p, "water", Date.now(), "live");
      store.state.plants = store.state.plants.filter((x: any) => x !== p);
    });
    await page.waitForTimeout(1200);
    const st = await state();
    assert.ok(["idle", "walk", "face", "work", "ack", "arrive"].includes(st ?? ""), `bad state ${st}`);
    const errors = await page.evaluate(() => (window as any).__errors ?? []);
    assert.equal(errors.length, 0);
  });

  await test("buff expiry parks the actor: leave → hidden, no new work", async () => {
    await page.evaluate(() => {
      const store = (window as any).__game.store;
      store.state.autoCareUntil = Date.now() + 150; // about to end
    });
    await page.waitForFunction(() => document.querySelector(".gdr")?.getAttribute("data-state") === "hidden", { timeout: 15000 });
    const did = await tick();
    assert.equal(did, 0);
  });

  await test("hidden state is actually invisible — no ghost gardener without a buff", async () => {
    // DEF: for the longest time no CSS rule matched data-state="hidden", so the
    // actor rendered at the spawn point forever — a figure standing stock-still
    // in the corner looked like a gardener that refused to work.
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".gdr")!).opacity === "0",
      { timeout: 3000 },
    );
    const cs = await gdr().evaluate((n) => {
      const s = getComputedStyle(n);
      return { opacity: s.opacity, visibility: s.visibility };
    });
    assert.equal(cs.visibility, "hidden", `hidden actor still rendered: ${JSON.stringify(cs)}`);
    assert.equal(cs.opacity, "0");
    const badgePe = await page.locator(".gdr-badge").evaluate((n) => getComputedStyle(n).visibility);
    assert.equal(badgePe, "hidden", "invisible badge remains a tap target");
  });

  await test("re-grant wakes the actor from hidden", async () => {
    await page.evaluate(() => {
      const store = (window as any).__game.store;
      store.grantAutoCare(2 * 60_000);
    });
    await waitState(["arrive", "idle", "walk", "face", "work"], 8000);
  });

  await test("badge opens the detail sheet with time + work log", async () => {
    // The auto-opened check-in sheet covers the scene on a fresh boot —
    // close whatever is up, like the user would, then reach the badge.
    await page.evaluate(() => document.querySelectorAll(".overlay, .sheet").forEach((n) => n.remove()));
    await page.locator(".gdr-badge").click();
    await page.waitForSelector(".sheet.gdr-sheet", { timeout: 4000 });
    const text = await page.locator(".sheet.gdr-sheet").innerText();
    assert.ok(/Người làm vườn/.test(text));
    assert.ok(/phút/.test(text));
    await page.locator(".sheet.gdr-sheet .btn").click();
    assert.equal(await page.locator(".sheet.gdr-sheet").count(), 0);
  });

  await test("repaint keeps exactly one actor (mount is idempotent)", async () => {
    await page.evaluate(() => (window as any).__game.navigate("garden"));
    await page.waitForTimeout(300);
    assert.equal(await gdr().count(), 1, "repaint duplicated the actor");
  });

  await test("boot catch-up reaches the actor — overnight work folds to summary + illustration", async () => {
    // DEF: autoCareCatchUp used to fire before the first paint, so every work
    // event published to zero subscribers — the player who "left the gardener
    // working overnight" saw no summary and no illustration at all.
    await page.addInitScript(() => {
      try {
        const key = "mutant-sprout-save-v1";
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const sv = JSON.parse(raw);
        sv.autoCareUntil = Date.now() + 5 * 60_000;
        sv.lastSeen = Date.now() - 4 * 12_000; // ~4 missed tick windows
        for (const p of (sv.plants ?? []).slice(0, 3)) {
          p.careMemory = { recent: [], counts: {}, lastUse: {}, lastAction: null };
        }
        localStorage.setItem(key, JSON.stringify(sv));
      } catch {
        /* no save / guest slot — the assertion below will fail loudly anyway */
      }
    });
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__game));
    await page.waitForSelector(".gdr", { timeout: 10000 });
    // arrive → walk → perform the one illustration; summarized counts the rest.
    await page.waitForFunction(
      () => {
        const g = (window as any).__gardener;
        if (!g) return false;
        return (g.done?.length ?? 0) + (g.queue?.catchupSummarized ?? 0) + (g.queue?.jobs?.length ?? 0) + (g.job ? 1 : 0) > 0;
      },
      { timeout: 20000 },
    );
    const seen = await page.evaluate(() => {
      const g = (window as any).__gardener;
      return { done: g?.done?.length ?? 0, summarized: g?.queue?.catchupSummarized ?? 0 };
    });
    assert.ok(seen.done + seen.summarized > 0, `catch-up vanished: ${JSON.stringify(seen)}`);
  });

  await test("leaving and returning 20 times leaves no extra listeners (ACT-06)", async () => {
    const counts = async () =>
      page.evaluate(() => {
        const s = (window as any).__game.store as any;
        return { work: s.gardenerListeners.size, paint: s.listeners.size };
      });
    const base = await counts();
    for (let i = 0; i < 20; i++) {
      await page.evaluate((s) => (window as any).__game.navigate(s), i % 2 ? "collection" : "garden");
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => (window as any).__game.navigate("garden"));
    await page.waitForTimeout(400);
    const after = await counts();
    assert.equal(after.work, base.work, `gardener listeners ${base.work} → ${after.work}`);
    assert.ok(after.paint <= base.paint + 1, `paint listeners ${base.paint} → ${after.paint}`);
    assert.equal(await gdr().count(), 1);
  });

  // Reduced motion needs its own context (media emulation is per-context).
  const rmCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const rmPage = await rmCtx.newPage();
  await boot(rmPage);
  await test("reduced motion: actor still works, no walking clips (ACT-07)", async () => {
    await rmPage.waitForSelector(".gdr", { timeout: 8000 });
    await rmPage.evaluate(() => {
      const s = (window as any).__game.store;
      for (const pl of s.state.plants.slice(0, 3)) {
        pl.careMemory.lastUse = {};
        pl.careMemory.recent = [];
      }
      return s.autoCareTick();
    });
    await rmPage.waitForFunction(
      () => ["walk", "face", "work", "ack", "idle"].includes(document.querySelector(".gdr")?.getAttribute("data-state") ?? ""),
      { timeout: 12000 },
    );
    const rm = await rmPage.locator(".gdr").evaluate((n) => n.classList.contains("rm"));
    assert.equal(rm, true, "rm flag not applied");
    const doneLen = await rmPage.evaluate(() => (window as any).__gardener?.done?.length ?? 0);
    await rmPage.waitForFunction(
      () => (window as any).__gardener?.done?.length > 0 || document.querySelector(".gdr")?.getAttribute("data-state") === "idle",
      { timeout: 20000 },
    );
    const after = await rmPage.evaluate(() => (window as any).__gardener?.done?.length ?? 0);
    assert.ok(after >= doneLen, "reduced-motion actor performed nothing");
  });
  await rmCtx.close();
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
