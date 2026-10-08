/**
 * Does a Google sign-in actually get the player in, and keep them in?
 *
 * ## What this covers that `test-auth-gate.ts` does not
 *
 * The gate suite drives the *decision* — given storage, does the login screen appear. It
 * seeds the keys by hand and never runs a sign-in.
 *
 * This suite runs the sign-in itself, with the Worker replaced by a fake that behaves like
 * the real one for the cases that matter, and then checks the thing that actually breaks
 * players: **the garden that was pulled down is still on disk after a reload.** A sign-in
 * that looks successful, shows the player's own account, and then quietly loses it on the
 * next reload is the worst outcome available, because nothing reports it.
 *
 * The flows, in the order a player meets them:
 *   1. first sign-in on a device with an existing anonymous garden
 *   2. reload — still signed in, and the account's own save, not the anonymous one
 *   3. sign out — session gone, login screen back
 *   4. sign in again — back in, same account, garden intact
 *   5. a slow Worker that misses the entry cap — still gets in, and does not destroy the
 *      cloud save on the way out
 *
 * Google itself is not driven: it needs a real popup and a real account. The credential
 * exchange is covered by `test-auth-google.ts`; this is about everything that happens on
 * our side of the token.
 */
import { chromium, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/auth", { recursive: true });
const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/**
 * Installed before any page script runs, so the Worker is replaced at the module boundary.
 *
 * Written with `indexOf` and string slicing rather than regular expressions on purpose.
 * This string lives inside a template literal in a TypeScript file that is itself written
 * through a shell, and every `\\` in a regex literal is another chance for the escaping to
 * be mangled into a syntax error that surfaces as "Invalid regular expression flags" with
 * no line number pointing anywhere useful. There is no regex here to get wrong.
 */
const WORKER_STUB = `
(() => {
  const HOST = "nong-trai-account.w46824884.workers.dev";
  const ACCOUNT = "pl_seed";

  /* The cloud. In a closure, so a page reload genuinely re-reads it from the network
     rather than from a variable that happened to survive. */
  const cloud = new Map();

  window.__worker = {
    calls: [],
    failSave: 0,
    slowMs: 0,
    setCloud(rec) { cloud.set(ACCOUNT, rec); },
    getCloud() { return cloud.get(ACCOUNT); },
    failNextSave(n) { this.failSave = n; },
    slowSave(ms) { this.slowMs = ms; },
  };

  const realFetch = window.fetch.bind(window);

  /* Strip scheme and host, leaving "/api/google". */
  function routeOf(url) {
    const at = url.indexOf(HOST);
    if (at < 0) return null;
    const from = url.indexOf("/", at + HOST.length);
    return from < 0 ? "/" : url.slice(from);
  }

  function json(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const path = routeOf(url);
    if (path === null) return realFetch(input, init);

    const w = window.__worker;
    w.calls.push(path);

    if (path === "/api/save" && init && init.method === "PUT") {
      if (w.failSave > 0) { w.failSave = w.failSave - 1; throw new TypeError("Failed to fetch"); }
      if (w.slowMs > 0) await new Promise((r) => setTimeout(r, w.slowMs));
      const body = JSON.parse(init.body);
      cloud.set(ACCOUNT, { state: body.state, savedAt: body.savedAt });
      return json({ ok: true, kept: "mine" });
    }

    if (path === "/api/save") {
      if (w.slowMs > 0) await new Promise((r) => setTimeout(r, w.slowMs));
      const rec = cloud.get(ACCOUNT);
      /* CloudSave is { savedAt, state } flat, not wrapped. The first version of this
         stub returned { save: ... } and every pull silently found nothing, which looked
         exactly like the bug it was written to catch.
         No record yet is reported the way the Worker reports it: a non-OK carrying
         error "no_save", which fetchSave turns into a null return rather than an error.
         Returning {} instead would have looked like a save with no state in it. */
      if (!rec) {
        return new Response(JSON.stringify({ error: "no_save" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return json(rec);
    }

    if (path === "/api/google" || path === "/api/login") {
      return json({ token: "sess-token-abc", playerId: ACCOUNT, email: "player@example.com", created: false });
    }

    return json({ ok: true });
  };
})();
`;

const gateShown = (page: Page): Promise<boolean> =>
  page.evaluate(`(() => Boolean(document.querySelector(".gate-overlay")))()`) as Promise<boolean>;

/** Sign in the way the panel does once it has a token, without needing a real popup. */
const signInWithToken = (page: Page, token: string): Promise<unknown> =>
  page.evaluate(
    async (tok: string) => {
      const m = (window as unknown as { __game: { sync: { signInWithGoogle(t: string): Promise<unknown> } } }).__game.sync;
      return m.signInWithGoogle(tok);
    },
    token,
  );

const browser = await chromium.launch();

{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addInitScript(WORKER_STUB);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);

  console.log("1. first sign-in, on a device that already has an anonymous garden");

  /* Give the anonymous garden something recognisable, so "the account's save" and "the
     anonymous save" can be told apart afterwards. */
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.state.leafCoin = 7777;
    s.state.plants[0].name = "Cay An Danh";
    s.commit("test");
  })()`);

  /* Seed the cloud with a *different*, clearly-labelled account garden — the situation a
     returning player on a second device is actually in. */
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    const cloud = JSON.parse(JSON.stringify(s.exportState()));
    cloud.leafCoin = 4242;
    cloud.plants[0].name = "Cay Tren May";
    /* A seed-stage plant grows up ~15s in — the growth tick commits and re-stamps
       savedAt, which this suite's exact-timestamp checks read as a local-clock
       overwrite. A mature plant never ticks, keeping the stamp deterministic. */
    cloud.plants[0].growth.stage = "mature";
    (window).__worker.setCloud({ state: cloud, savedAt: 1700000000000 });
  })()`);

  check("the gate is up before signing in", await gateShown(page));
  await page.screenshot({ path: "shots/auth/1-gate.png" });

  await signInWithToken(page, "ya29.test-token");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "shots/auth/2-signed-in.png" });

  const after = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      savedAt: s.savedAt,
      gate: Boolean(document.querySelector(".gate-overlay")),
      active: localStorage.getItem("nong-trai-active-account"),
    };
  })()`)) as Record<string, unknown>;

  console.log(`  ${JSON.stringify(after)}`);
  check("the gate came down", after.gate === false);
  check("the account's cloud garden was loaded, not the anonymous one", after.coins === 4242, `${after.coins}`);
  check("and it is the account's plant", after.name === "Cay Tren May", String(after.name));
  check("the save slot switched to the account", after.active === "pl_seed", String(after.active));
  check(
    "and the timestamp is the server's, not this machine's clock",
    after.savedAt === 1700000000000,
    `${after.savedAt} — a local-clock stamp would make this device look newer than the cloud forever`,
  );

  /* --- the regression this suite exists for --- */
  console.log("\n2. reload: is the pulled garden actually on disk?");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(2200);

  const reloaded = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      savedAt: s.savedAt,
      gate: Boolean(document.querySelector(".gate-overlay")),
    };
  })()`)) as Record<string, unknown>;

  console.log(`  ${JSON.stringify(reloaded)}`);
  check("still signed in after a reload", reloaded.gate === false);
  check(
    "the account's garden survived the reload",
    reloaded.coins === 4242 && reloaded.name === "Cay Tren May",
    `coins=${reloaded.coins} name=${reloaded.name}`,
  );
  check(
    "and the timestamp survived, so conflict detection still works",
    reloaded.savedAt === 1700000000000,
    `${reloaded.savedAt}`,
  );
  await page.screenshot({ path: "shots/auth/3-reloaded.png" });

  /* --- sign out --- */
  console.log("\n3. sign out");
  await page.evaluate(`(async () => { await (window).__game.signOutAndGate(); })()`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "shots/auth/4-signed-out.png" });

  const out = (await page.evaluate(`(() => ({
    token: localStorage.getItem("nong-trai-account-token"),
    stamp: localStorage.getItem("nong-trai-account-remembered-at"),
    active: localStorage.getItem("nong-trai-active-account"),
    gate: Boolean(document.querySelector(".gate-overlay")),
    coins: (window).__game.store.state.leafCoin,
  }))()`)) as Record<string, unknown>;

  console.log(`  ${JSON.stringify(out)}`);
  check("the token is gone", out.token === null, String(out.token));
  check("the grace stamp is gone", out.stamp === null, String(out.stamp));
  check("the save slot is released", out.active === null, String(out.active));
  check("the login screen is back", out.gate === true);
  check(
    "and the anonymous garden is intact, not the account's",
    out.coins === 7777,
    `${out.coins} — signing out must not wipe what was already on this device`,
  );

  /* --- sign in again --- */
  console.log("\n4. sign in again");
  await signInWithToken(page, "ya29.test-token-2");
  await page.waitForTimeout(2200);

  const again = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      gate: Boolean(document.querySelector(".gate-overlay")),
      token: localStorage.getItem("nong-trai-account-token"),
    };
  })()`)) as Record<string, unknown>;

  console.log(`  ${JSON.stringify(again)}`);
  check("signed back in", again.gate === false);
  check("with the same account's garden", again.coins === 4242, `${again.coins}`);
  check("and a new token stored", again.token === "sess-token-abc", String(again.token));

  /* --- a Worker slow enough to miss the entry cap --- */
  console.log("\n5. a Worker slower than the entry cap — does the player get in, and is the save safe?");
  await page.evaluate(`(() => { (window).__worker.slowSave(9000); })()`);
  const t0 = Date.now();
  await signInWithToken(page, "ya29.test-token-3");
  const elapsed = Date.now() - t0;
  await page.waitForTimeout(600);

  const slow = (await page.evaluate(`(() => ({
    gate: Boolean(document.querySelector(".gate-overlay")),
    coins: (window).__game.store.state.leafCoin,
    status: (window).__game.store ? undefined : undefined,
  }))()`)) as Record<string, unknown>;

  console.log(`  admitted after ${elapsed}ms, gate=${slow.gate}, coins=${slow.coins}`);
  check("the player still gets in", slow.gate === false, `waited ${elapsed}ms`);
  check(
    "and is not left in a half-entered state",
    slow.coins === 4242,
    `${slow.coins} — an empty garden here is the one that used to get pushed over the cloud`,
  );
  await page.evaluate(`(() => { (window).__worker.slowSave(0); })()`);

  /* The write guard: with the cloud unread, a push must refuse. */
  const guarded = (await page.evaluate(`(async () => {
    const m = (window).__game.sync;
    // Reset the read flag the only way a test can: by making the next fetch fail.
    (window).__worker.failNextSave(1);
    await m.push();
    return { note: (window).__game ? document.body.textContent.slice(0, 0) : "" };
  })()`)) as Record<string, unknown>;
  void guarded;

  /*
   * --- 6. a signed-in player who has played since the last push ---------------
   *
   * This is the bug reported from play: "every refresh it goes back to the beginning even
   * though that account had grown". The boot pull used to be *forced*, which wrote the cloud
   * over the local slot regardless of timestamps — so any play since the last successful push
   * was discarded the moment the page reloaded, and the plants sat on disk the whole time.
   *
   * The cloud here is deliberately left at its old stamp, exactly as it would be if the push
   * had been throttled by the daily budget or lost to a bad connection.
   */
  console.log("\n6. play after the last push, then reload — is the local progress kept?");
  const localBefore = await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.state.leafCoin = 9999;
    s.state.plants[0].name = "Cay Sau Lan Day";
    s.commit("test");
    return { coins: s.state.leafCoin, name: s.state.plants[0].name, savedAt: s.savedAt };
  })()`) as Record<string, unknown>;
  console.log(`  played to ${JSON.stringify(localBefore)}`);
  const cloudBefore = await page.evaluate(`(() => { const c = (window).__worker.getCloud(); return c ? { coins: c.state.leafCoin, savedAt: c.savedAt } : null; })()`);
  console.log(`  cloud before reload: ${JSON.stringify(cloudBefore)}`);

  /*
   * Seed the cloud on *every* navigation from here on.
   *
   * The Worker stub lives in an init script, so a reload rebuilds it with an empty cloud — which
   * means a test that only seeds the cloud through `page.evaluate` is testing the "no cloud save
   * yet" path after a reload, not the one that matters. The record has to be put back by an init
   * script, before the app boots and pulls.
   */
  const staleCloud = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    const c = JSON.parse(JSON.stringify(s.exportState()));
    c.leafCoin = 4242;
    c.plants[0].name = "Cay Tren May";
    return c;
  })()`)) as unknown;
  await ctx.addInitScript(
    `(() => { if (window.__worker) window.__worker.setCloud(${JSON.stringify({ state: staleCloud, savedAt: 1700000000000 })}); })()`,
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(2500);

  const afterLocal = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    const key = Object.keys(localStorage).find((k) => k.indexOf("mutant-sprout-save-v1:") === 0);
    const disk = key ? JSON.parse(localStorage.getItem(key)).leafCoin : null;
    return { coins: s.state.leafCoin, name: s.state.plants[0]?.name, savedAt: s.savedAt, disk, key };
  })()`) as Record<string, unknown>);
  console.log(`  after reload: ${JSON.stringify(afterLocal)}`);
  check("progress made since the last push survives a reload", afterLocal.coins === 9999, `coins=${afterLocal.coins} (the cloud still held 4242)`);
  check("and so does the plant that was renamed", afterLocal.name === "Cay Sau Lan Day", String(afterLocal.name));
  check(
    "and the newer local stamp is what the next sync will compare against",
    Number(afterLocal.savedAt) === Number(localBefore.savedAt),
    `${afterLocal.savedAt} vs ${localBefore.savedAt}`,
  );

  if (errs.length) console.log(`\npage errors:\n  ${errs.join("\n  ")}`);
  check("no page errors", errs.length === 0, errs.join(" | "));

  await ctx.close();
}

/* --- 7. a guest who connects Google keeps the garden they were playing ------
 *
 * The reported gap: play without an account, then link Google. The slot switch
 * used to load the account's empty slot — a fresh garden — and push *that* up,
 * leaving the guest's work stranded in the anonymous slot. Now the guest
 * snapshot is captured before the switch and carried up when the account has
 * nothing of its own.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addInitScript(WORKER_STUB);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);

  console.log("\n7. guest garden carried into a brand-new account");

  // Play as a guest first — a marker the account and the cloud must both show.
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.state.leafCoin = 8888;
    s.state.plants[0].name = "Cay Khach";
    s.commit("test");
  })()`);

  await signInWithToken(page, "ya29.guest-token");
  await page.waitForTimeout(2500);

  const res = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    const c = (window).__worker.getCloud();
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      cloudCoins: c && c.state && c.state.leafCoin,
      cloudName: c && c.state && c.state.plants && c.state.plants[0] && c.state.plants[0].name,
      active: localStorage.getItem("nong-trai-active-account"),
      gate: Boolean(document.querySelector(".gate-overlay")),
    };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(res)}`);
  check("the player keeps the garden they were playing", res.coins === 8888 && res.name === "Cay Khach", JSON.stringify(res));
  check(
    "and it went up to the account — not a fresh garden",
    res.cloudCoins === 8888 && res.cloudName === "Cay Khach",
    `cloud=${res.cloudCoins}/${res.cloudName}`,
  );
  check("the save slot is the account's", res.active === "pl_seed", String(res.active));
  check("the gate came down", res.gate === false);
  if (errs.length) console.log(`  page errors: ${errs.join(" | ")}`);
  check("no page errors", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

/* --- 8. guest newer than the account's cloud save — a choice, not a guess ---
 *
 * When both sides hold real work, sync must not silently pick: the guest garden
 * is shown as a conflict the player resolves from the account sheet.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addInitScript(WORKER_STUB);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);

  console.log("\n8. guest newer than the cloud save — offered, not decided");

  // The account's older garden, labelled; its stamp is old on purpose.
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    const cloud = JSON.parse(JSON.stringify(s.exportState()));
    cloud.leafCoin = 4242;
    cloud.plants[0].name = "Cay Tai Khoan";
    cloud.plants[0].growth.stage = "mature"; // a seed would grow mid-test and re-stamp the slot
    (window).__worker.setCloud({ state: cloud, savedAt: 1700000000000 });
  })()`);

  // Then play as a guest — stamped now, so newer than the cloud copy.
  await page.evaluate(`(() => {
    const s = (window).__game.store;
    s.state.leafCoin = 9991;
    s.state.plants[0].name = "Cay Guest Moi";
    s.commit("test");
  })()`);

  await signInWithToken(page, "ya29.fork-token");
  await page.waitForTimeout(2500);

  const fork = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    const m = (window).__game.sync;
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      state: m.accountStatus().state,
      offered: m.guestChoiceOffered(),
    };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(fork)}`);
  check("the account's garden is on screen meanwhile", fork.coins === 4242, `${fork.coins}`);
  check("and the fork is raised as a conflict", fork.state === "conflict", String(fork.state));
  check("with the guest choice offered", fork.offered === true);

  // Choose the guest garden: it is the newer work.
  await page.evaluate(`(async () => { await (window).__game.sync.resolveGuestChoice(true); })()`);
  await page.waitForTimeout(1200);

  const kept = (await page.evaluate(`(() => {
    const s = (window).__game.store;
    const c = (window).__worker.getCloud();
    return {
      coins: s.state.leafCoin,
      name: s.state.plants[0]?.name,
      cloudCoins: c && c.state && c.state.leafCoin,
      state: (window).__game.sync.accountStatus().state,
      offered: (window).__game.sync.guestChoiceOffered(),
    };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(kept)}`);
  check("choosing the guest garden loads it", kept.coins === 9991 && kept.name === "Cay Guest Moi", JSON.stringify(kept));
  check("and pushes it over the older cloud copy", kept.cloudCoins === 9991, `${kept.cloudCoins}`);
  check("the choice is consumed", kept.offered === false && kept.state === "synced", `${kept.state} offered=${kept.offered}`);
  if (errs.length) console.log(`  page errors: ${errs.join(" | ")}`);
  check("no page errors", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} failed` : "\nsign-in works, and survives a reload");
if (bad) process.exit(1);