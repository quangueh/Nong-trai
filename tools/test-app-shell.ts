/**
 * App-shell smoke: verifies the deployed game end-to-end over real HTTPS —
 * the exact endpoint the Android WebView loads.
 *
 * The APK is a shell over this URL, so what this proves is the app-equivalent
 * of "does it boot, can I play, does my garden survive a restart": guest gate,
 * garden render, save persistence across a reload (read straight out of
 * localStorage, the same storage the WebView keeps), and service-worker
 * registration — the offline story.
 *
 * `window.__game` is deliberately stripped from production builds, so this
 * suite asserts on the DOM and localStorage only — the things a WebView
 * genuinely guarantees.
 *
 *   npx tsx tools/test-app-shell.ts            # production
 *   APP_URL=http://localhost:5173 npx tsx tools/test-app-shell.ts
 */

import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright-core";

const URL = process.env.APP_URL ?? "https://nong-trai-9u0.pages.dev";
const SAVE_KEY = "mutant-sprout-save-v1";

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
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await test("deployed page loads over HTTPS and paints a screen", async () => {
    const res = await page.goto(URL, { waitUntil: "domcontentloaded" });
    assert.ok(res?.ok(), `HTTP ${res?.status()}`);
    // Whatever lands first — the account gate or the garden itself — proves the
    // bundle parsed and the app booted.
    await page.waitForSelector(".gate-overlay, .garden-scene", { timeout: 25000 });
  });

  await test("guest path enters the garden", async () => {
    const skip = page.locator(".gate-skip");
    if (await skip.count()) {
      await skip.click();
      await page.waitForFunction(() => !document.querySelector(".gate-overlay"), { timeout: 8000 });
    }
    await page.waitForSelector(".garden-scene", { timeout: 15000 });
    const cards = await page.locator("[data-plant-id]").count();
    assert.ok(cards > 0, "no plant cards rendered");
  });

  await test("the save persists — a reload keeps the same garden", async () => {
    const saved = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw).plants?.length ?? 0 : 0;
    }, SAVE_KEY);
    assert.ok(saved > 0, "no saved garden in localStorage — WebView would lose the player");
    await page.reload({ waitUntil: "domcontentloaded" });
    const skip = page.locator(".gate-skip");
    if (await skip.count()) await skip.click();
    await page.waitForSelector(".garden-scene", { timeout: 15000 });
    const cards = await page.locator("[data-plant-id]").count();
    assert.equal(cards, saved, "plant count changed across reload — save lost");
  });

  await test("service worker registers (offline shell story intact)", async () => {
    const ok = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise((r) => setTimeout(() => r("timeout"), 5000)),
      ]);
      return reg && typeof reg === "object" ? "registered" : String(reg);
    });
    assert.equal(ok, "registered", `service worker: ${ok}`);
  });

  await test("no page errors during the whole run", async () => {
    assert.deepEqual(pageErrors, []);
  });
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
