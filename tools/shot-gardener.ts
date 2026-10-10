/** WP04 evidence: real screenshots of the gardener actor's states.
    Each capture pairs a full view with a clip centred on the actor. */
import { chromium, type Page } from "playwright-core";
import { applyFixture } from "./fixtures";
import { mkdirSync } from "node:fs";

mkdirSync("shots/gardener", { recursive: true });
const browser = await chromium.launch();

async function boot(width = 390, height = 844): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await page.goto("http://localhost:5173");
  await applyFixture(page, "F02");
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__game));
  await page.waitForSelector(".garden-scene");
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

const clearSheets = (page: Page) =>
  page.locator(".sheet-overlay, .gdr-sheet").evaluateAll(els => els.forEach(e => e.remove())).catch(() => {});

async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(() =>
    (document.querySelector(".gdr") as HTMLElement)?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(120);
  await page.screenshot({ path: `shots/gardener/${name}.png` });
  const clip = await page.evaluate(() => {
    const r = (document.querySelector(".gdr") as HTMLElement)?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.max(0, r.x - 80), y: Math.max(0, r.y - 60),
      width: 240, height: 190,
    };
  });
  if (clip) await page.screenshot({ path: `shots/gardener/${name}-zoom.png`, clip }).catch(() => {});
}

const page = await boot();
await page.waitForSelector(".gdr", { timeout: 8000 });
await page.waitForTimeout(900);
await clearSheets(page);
await snap(page, "1-parked");

await page.evaluate(() => {
  const s = (window as any).__game.store;
  for (const pl of s.state.plants.slice(5, 8)) {
    pl.careMemory.lastUse = {}; pl.careMemory.recent = []; delete pl.careMemory.lastAction;
  }
  s.autoCareTick();
});
await page.waitForSelector('.gdr[data-state="walk"]', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(250);
await snap(page, "2-walking");

await page.waitForSelector('.gdr[data-state="work"]', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(350);
await snap(page, "3-working");

await page.waitForSelector('.gdr[data-state="done"]', { timeout: 10000 }).catch(() => {});
await snap(page, "4-done");

await page.waitForSelector('.gdr[data-state="idle"], .gdr[data-state="park"], .gdr[data-state="hidden"]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
await clearSheets(page);
await page.locator(".gdr-badge").click({ timeout: 8000 }).catch(() => {});
await page.waitForSelector(".gdr-sheet", { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(400);
await snap(page, "5-detail-sheet");
await clearSheets(page);

await page.evaluate(() => { (window as any).__game.store.state.autoCareUntil = Date.now() + 400; });
await page.waitForSelector('.gdr[data-state="leave"], .gdr[data-state="hidden"]', { timeout: 15000 }).catch(() => {});
await snap(page, "6-expired");
await page.close();

const dpage = await boot(1366, 768);
await dpage.waitForSelector(".gdr", { timeout: 8000 });
await clearSheets(dpage);
await dpage.evaluate(() => {
  const s = (window as any).__game.store;
  for (const pl of s.state.plants.slice(5, 8)) {
    pl.careMemory.lastUse = {}; pl.careMemory.recent = []; delete pl.careMemory.lastAction;
  }
  s.autoCareTick();
});
await dpage.waitForSelector('.gdr[data-state="work"], .gdr[data-state="done"]', { timeout: 15000 }).catch(() => {});
await dpage.screenshot({ path: "shots/gardener/7-desktop-working.png" });
const dclip = await dpage.evaluate(() => {
  const r = (document.querySelector(".gdr") as HTMLElement)?.getBoundingClientRect();
  return r ? { x: Math.max(0, r.x - 90), y: Math.max(0, r.y - 70), width: 260, height: 210 } : null;
});
if (dclip) await dpage.screenshot({ path: "shots/gardener/7-desktop-zoom.png", clip: dclip });

console.log("shots written to shots/gardener/");
await browser.close();
