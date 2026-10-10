/**
 * WP09 / REL-04 — solid mode, reduced motion, keyboard, and zoom through the
 * core journeys (docs/27 §12): garden → shop → collection → arena fight.
 *
 * Each axis is checked where it actually bites: `data-solid` renders a real
 * garden, `data-motion="reduce"` still shows complete state, Space pauses a
 * live fight through the same keydown the player has, and the viewport meta
 * no longer forbids pinch zoom.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { applyFixture } from "./fixtures";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function boot(browser: Browser, opts: { reducedMotion?: "reduce" | "no-preference" } = {}): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: opts.reducedMotion })).newPage();
  await page.goto("http://localhost:5173");
  await applyFixture(page, "F03");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__game));
  const skip = page.locator(".gate-skip");
  if (await skip.count()) await skip.click();
  await page.waitForSelector(".gate-overlay", { state: "detached", timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    sessionStorage.setItem(`ci-shown:${key}`, "1");
  });
  return page;
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch();

  console.log("\nREL-04 — solid, motion, keyboard, zoom through core journeys:");

  // Zoom must be possible — `user-scalable=no` was an accessibility tax.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto("http://localhost:5173");
    const html = (await res?.text().catch(() => "")) ?? (await page.content());
    const meta = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\d|\.)/.test(html);
    check("viewport meta does not forbid pinch zoom", meta === false, meta ? "user-scalable=no present" : "zoom allowed");
    await ctx.close();
  }

  // Solid mode journey: every core screen still renders its content.
  {
    const page = await boot(browser);
    await page.evaluate<any>(`(() => {
      const s = (window).__game.store;
      const btn = [...document.querySelectorAll("button")].find(b => /Cài đặt/.test(b.getAttribute("aria-label") || b.title || ""));
      localStorage.setItem("nongtrai.glass", "solid");
      document.documentElement.dataset.solid = "1";
    })()`);
    const screens = ["garden", "lab", "collection", "arena"];
    let allOk = true;
    const seen: string[] = [];
    for (const sc of screens) {
      await page.evaluate<any>(`(() => (window).__game.navigate(${JSON.stringify("X")} ))()`.replace("X", sc));
      await page.waitForTimeout(700);
      const n = await page.evaluate<any>(`(() => document.querySelectorAll(".card, .plot, .seed-grid > *, .plantcard").length)()`);
      seen.push(`${sc}:${n}`);
      if (!(n > 0)) allOk = false;
    }
    check("solid mode renders content on garden/shop/collection/arena", allOk, seen.join(" "));
    const solid = await page.evaluate<any>(`(() => document.documentElement.dataset.solid)()`);
    check("data-solid stayed applied through the journey", solid === "1", String(solid));
    await page.close();
  }

  // Reduced motion journey: garden paints, plots hold real state, no crash.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("http://localhost:5173");
    await applyFixture(page, "F03");
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__game));
    const skip = page.locator(".gate-skip");
    if (await skip.count()) await skip.click();
    const rm = await page.evaluate<any>(`(() => ({
      attr: document.documentElement.dataset.motion,
      plots: document.querySelectorAll(".plot").length,
      names: document.querySelectorAll(".pname").length,
    }))()`);
    check("reduced motion publishes data-motion=reduce", rm.attr === "reduce", String(rm.attr));
    check("and the garden still shows every plot and name", rm.plots >= 20 && rm.names >= 20, JSON.stringify(rm));
    await ctx.close();
  }

  // Keyboard: Space pauses a live fight — the same keydown a player uses.
  {
    const page = await boot(browser);
    await page.evaluate<any>(`(() => {
      for (const p of (window).__game.store.state.plants) {
        p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now();
        p.stats.attack = 30; p.stats.defense = 8000; p.stats.hp = 8000; p.stats.maxHp = 8000;
        p.stats.speed = 60; p.powerRating = 400;
      }
    })()`);
    await page.evaluate<any>(`(() => (window).__game.navigate("arena"))()`);
    await page.waitForTimeout(900);
    await page.evaluate<any>(`(() => { const b=[...document.querySelectorAll("button")].find(x=>/Đấu với AI/.test(x.textContent||"")); if(b)b.click(); })()`);
    await page.waitForTimeout(900);
    await page.evaluate<any>(`(() => { const c=document.querySelector(".sheet .pickrow"); if(c)c.click(); })()`);
    await page.waitForTimeout(900);
    await page.evaluate<any>(`(() => { const b=[...document.querySelectorAll("button")].find(x=>/Bắt đầu/.test(x.textContent||"")); if(b)b.click(); })()`);
    await page.waitForSelector(".battlefield", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // Space → paused veil; Space again → resume.
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    const paused = await page.evaluate<any>(`(() => ({
      veil: !!document.querySelector(".pauseveil, [class*=pause]"),
      log: document.querySelector(".battlelog")?.textContent ?? "",
    }))()`);
    check("Space pauses a live fight", paused.veil === true || /tạm dừng|dừng/i.test(paused.log), JSON.stringify(paused));
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    const resumed = await page.evaluate<any>(`(() => !document.querySelector(".pauseveil"))()`);
    check("and Space again resumes it", resumed === true);
    await page.close();
  }
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
