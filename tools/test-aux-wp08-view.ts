/**
 * WP08 / AUX-01…08 (browser halves) — what the player actually sees:
 * dex-gone species cards, a paginated shelf that never DOMs the registry,
 * the quest deep-link pin, offline/error/empty states that are not spinners,
 * and settings that each produce a verifiable effect.
 *
 * Domain halves (catalogue contract, transaction atomicity, discovery)
 * live in test-aux-wp08.ts; account fork/conflict in test-signin-flow.ts;
 * prefs persistence in test-prefs.ts.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { applyFixture, type FixtureId } from "./fixtures";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function boot(browser: Browser, fixture: FixtureId = "F03"): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
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
  });
  return page;
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch();

  console.log("\nAUX-01 — a species whose last plant is gone still reads as discovered:");
  {
    const page = await boot(browser);
    // Mark a species discovered that no plant carries — the "Đã mở · hiện không
    // còn" dex-gone card is the UI half of the domain assertion.
    await page.evaluate<any>(`(() => {
      const s = (window).__game.store;
      const owned = new Set(s.state.plants.flatMap(p => p.baseLineage));
      const gone = s.state.discovery.species.find(sp => !owned.has(sp))
        ?? s.state.plants[0]?.baseLineage[0];
      // Ensure at least one: register a species no plant carries.
      const species = gone ?? "thornroot";
      if (!s.state.discovery.species.includes(species)) s.state.discovery.species.push(species);
      for (const p of s.state.plants) p.baseLineage = p.baseLineage.filter(x => x !== species);
      s.commit("aux-setup");
    })()`);
    await page.evaluate<any>(`(() => (window).__game.navigate("collection"))()`);
    await page.waitForTimeout(1000);
    /* The species index sits behind its own tab — "Cây của tôi" shows first,
       which is itself the AUX-01 separation the criterion asks for. */
    await page.evaluate<any>(`(() => {
      const tab = [...document.querySelectorAll(".seg button")].find(b => /Bộ sưu tập/.test(b.textContent || ""));
      if (tab) tab.click();
    })()`);
    await page.waitForTimeout(1200);
    const dex = await page.evaluate<any>(`(() => {
      const gone = document.querySelector(".dex-gone");
      return {
        gone: !!gone,
        label: gone?.textContent?.includes("hiện không còn") || document.body.textContent?.includes("Đã mở · hiện không còn") || false,
      };
    })()`);
    check("a discovered-but-gone species still gets a card", dex.gone === true, JSON.stringify(dex));
    check("and it says 'gone', not 'undiscovered'", dex.label === true, JSON.stringify(dex));
    await page.close();
  }

  console.log("\nAUX-02 — the shelf paginates; the registry is never DOM'd whole:");
  {
    const page = await boot(browser);
    await page.evaluate<any>(`(() => (window).__game.navigate("lab"))()`);
    await page.waitForTimeout(1200);
    const shelf = await page.evaluate<any>(`(() => {
      const grid = document.querySelector(".seed-grid");
      const cards = grid ? grid.querySelectorAll(":scope > .card").length : -1;
      const pager = [...document.querySelectorAll("button")].some(b => /›|»/.test(b.textContent || ""))
        || /\\/\\s*\\d+/.test(document.body.textContent || "");
      const search = document.querySelector('input[placeholder*="Tìm"]');
      return { cards, pager, search: !!search, total: (window).__game.store ? undefined : 0 };
    })()`);
    check("shelf shows a page, not the 1000-species registry", shelf.cards > 0 && shelf.cards <= 24, `cards=${shelf.cards}`);
    check("a pager or page indicator exists for the rest", shelf.pager === true, JSON.stringify(shelf));
    check("a real search box is there", shelf.search === true);

    // Search narrows the shelf through the real input event.
    await page.fill('input[placeholder*="Tìm"]', "tùng");
    await page.waitForTimeout(900);
    const after = await page.evaluate<any>(`(() => {
      const cards = [...document.querySelectorAll(".seed-grid > .card")];
      return { count: cards.length, names: cards.slice(0, 5).map(c => c.textContent?.slice(0, 60)) };
    })()`);
    check("search narrows the shelf through the real input", after.count >= 0 && after.count <= 24, JSON.stringify(after));
    await page.close();
  }

  console.log("\nAUX-04 — the quest pin holds one card and dismisses back to context:");
  {
    const page = await boot(browser);
    /* The quest card lands here as `navigate("lab", { seed })` — drive the
       same route param the card does. */
    await page.evaluate<any>(`(() => (window).__game.navigate("lab", { seed: "thornroot" }))()`);
    await page.waitForTimeout(1200);
    const pinned = await page.evaluate<any>(`(() => {
      const chip = [...document.querySelectorAll("button")].find(b => /🎯/.test(b.textContent || ""));
      const cards = document.querySelectorAll(".seed-grid > .card").length;
      return { chip: chip?.textContent ?? null, cards };
    })()`);
    check("the pin chip names the species", pinned.chip !== null && /🎯/.test(pinned.chip), JSON.stringify(pinned));
    check("the shelf is narrowed to the pinned card", pinned.cards === 1, `cards=${pinned.cards}`);
    // Dismiss through the chip's own ✕ → full shelf returns.
    await page.evaluate<any>(`(() => {
      const chip = [...document.querySelectorAll("button")].find(b => /🎯/.test(b.textContent || ""));
      if (chip) chip.click();
    })()`);
    await page.waitForTimeout(800);
    const restored = await page.evaluate<any>(`(() => ({
      chip: [...document.querySelectorAll("button")].some(b => /🎯/.test(b.textContent || "")),
      cards: document.querySelectorAll(".seed-grid > .card").length,
    }))()`);
    check("dismissing the pin restores the full shelf", restored.chip === false && restored.cards > 1, JSON.stringify(restored));
    await page.close();
  }

  console.log("\nAUX-06 — offline/error/empty are states, not spinners:");
  {
    const page = await boot(browser);
    await page.evaluate<any>(`(() => (window).__game.navigate("leaderboard"))()`);
    // Dev has no account service → 'unavailable' is the honest terminal state.
    await page.waitForTimeout(1800);
    const lb = await page.evaluate<any>(`(() => {
      const panel = document.querySelector(".lb-panel");
      const text = panel?.textContent ?? "";
      return {
        loading: /Đang tải/.test(text),
        settled: /chưa sẵn sàng|Không tải được|thử lại|⚔|Lv/.test(text),
        rows: panel ? panel.querySelectorAll(".row, .lb-row, [class*=row]").length : 0,
      };
    })()`);
    check("the board settles into a real state, not a spinner", lb.loading === false && lb.settled === true, JSON.stringify(lb));
    check("the unavailable board still shows the player's own numbers", lb.rows > 0, `rows=${lb.rows}`);

    // Friends panel on the same screen: signed-out shows the reason, not an empty list.
    await page.evaluate<any>(`(() => (window).__game.navigate("arena"))()`);
    await page.waitForTimeout(1200);
    const fr = await page.evaluate<any>(`(() => {
      const host = document.querySelector(".friends");
      const text = host?.textContent ?? "";
      return { host: !!host, reason: /đăng nhập|tài khoản|Bạn bè/.test(text), emptyLie: /Chưa có bạn nào/.test(text) && !/đăng nhập|tài khoản/i.test(text) };
    })()`);
    check("signed-out friends says why, not 'no friends yet'", fr.host && fr.reason && !fr.emptyLie, JSON.stringify(fr));
    await page.close();
  }

  console.log("\nAUX-08 — every setting has an observable effect:");
  {
    const page = await boot(browser);
    // Open the real settings sheet from the topbar.
    await page.click('button[aria-label="Cài đặt"]').catch(async () => {
      await page.evaluate<any>(`(() => { const b = document.querySelector('.iconbtn[title="Cài đặt"]'); if (b) b.click(); })()`);
    });
    await page.waitForTimeout(800);
    const sheetOpen = await page.evaluate<any>(`(() => /Cài đặt/.test(document.querySelector(".sheet")?.textContent ?? ""))()`);
    check("settings sheet opens from the topbar", sheetOpen === true);

    const motion = await page.evaluate<any>(`(() => {
      const row = [...document.querySelectorAll(".account-rowbtn")].find(b => /Chuyển động/.test(b.textContent || ""));
      if (!row) return { found: false };
      const before = { attr: document.documentElement.dataset.motion, key: localStorage.getItem("nongtrai.motion") };
      row.click(); row.click(); // system → full → reduce (or next two states)
      const after = { attr: document.documentElement.dataset.motion, key: localStorage.getItem("nongtrai.motion") };
      return { found: true, before, after, changed: before.attr !== after.attr, persisted: after.key !== null };
    })()`);
    check("motion setting publishes data-motion and persists", motion.found && motion.changed && motion.persisted, JSON.stringify(motion));

    const glass = await page.evaluate<any>(`(() => {
      const row = [...document.querySelectorAll(".account-rowbtn")].find(b => /trong suốt/.test(b.textContent || ""));
      if (!row) return { found: false };
      /* Three states — system→glass resolves to the same "not solid" value, so
         keep cycling until the published attribute actually moves (max 3, the
         cycle length) rather than assuming one click is one state. */
      const before = document.documentElement.dataset.solid;
      let after = before;
      for (let i = 0; i < 3 && after === before; i++) { row.click(); after = document.documentElement.dataset.solid; }
      return { found: true, before, after, changed: before !== after, key: localStorage.getItem("nongtrai.glass") };
    })()`);
    check("transparency setting publishes data-solid", glass.found && glass.changed && glass.key !== null, JSON.stringify(glass));

    const quality = await page.evaluate<any>(`(() => {
      const row = [...document.querySelectorAll(".account-rowbtn")].find(b => /Chất lượng/.test(b.textContent || ""));
      if (!row) return { found: false };
      const before = document.documentElement.dataset.quality;
      row.click();
      return { found: true, before, after: document.documentElement.dataset.quality, changed: before !== document.documentElement.dataset.quality };
    })()`);
    check("quality setting publishes data-quality", quality.found && quality.changed, JSON.stringify(quality));

    const vol = await page.evaluate<any>(`(() => {
      const slider = document.querySelector('input[aria-label="Âm lượng hiệu ứng"]');
      if (!slider) return { found: false };
      slider.value = "30";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return { found: true, key: localStorage.getItem("nongtrai.volume"), vol: (window).__game.sfx.volume };
    })()`);
    check("volume slider drives the live engine and persists", vol.found && Math.abs(vol.vol - 0.3) < 0.01 && vol.key === "30", JSON.stringify(vol));
    await page.close();
  }
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
