/** ACT-03 video evidence: the hired gardener working a full 24-plot garden.
    recordVideo on the context, a real walk→work→done cycle on a dense F03
    garden, both mobile and desktop framings. Videos land in shots/gardener-video/. */
import { chromium } from "playwright-core";
import { applyFixture } from "./fixtures";
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";

const DIR = "shots/gardener-video";
mkdirSync(DIR, { recursive: true });
const browser = await chromium.launch();

async function take(name: string, width: number, height: number): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: DIR, size: { width, height } },
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5173");
  await applyFixture(page, "F03");
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
  await page.waitForSelector(".gdr", { timeout: 10000 });
  await page.waitForTimeout(800);

  // Hire the gardener and queue real work across the bed.
  await page.evaluate(() => {
    const s = (window as any).__game.store;
    s.state.autoCareUntil = Date.now() + 10 * 60 * 1000;
    for (const pl of s.state.plants.slice(3, 10)) {
      pl.careMemory.lastUse = {}; pl.careMemory.recent = []; delete pl.careMemory.lastAction;
    }
    s.autoCareTick();
  });

  // Walk + first job.
  await page.waitForSelector('.gdr[data-state="walk"], .gdr[data-state="work"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Scroll so the video shows the plot rows the gardener is crossing.
  await page.evaluate(() => document.querySelector(".plot-grid")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  await page.waitForTimeout(2500);
  await page.waitForSelector('.gdr[data-state="done"], .gdr[data-state="work"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // A second cycle proves the queue keeps working, not just one job.
  await page.waitForSelector('.gdr[data-state="walk"], .gdr[data-state="work"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Pan across the dense bed for the "24 plots" evidence itself.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await page.waitForTimeout(2000);

  const video = page.video();
  await ctx.close(); // video is only finalised when the context closes
  if (video) {
    const src = await video.path();
    copyFileSync(src, `${DIR}/${name}.webm`);
  }
  console.log(`recorded ${name}.webm`);
}

await take("mobile-24plot", 390, 844);
await take("desktop-24plot", 1366, 768);
await browser.close();
console.log("files:", readdirSync(DIR).filter((f) => f.endsWith(".webm")).join(", "));
