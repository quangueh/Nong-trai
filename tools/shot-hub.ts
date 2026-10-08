/** Verify shot for the combat hub + floating dock. */
import { chromium } from "playwright-core";
const b = await chromium.launch();
for (const vp of [
  { name: "lg-desktop", width: 1366, height: 768 },
  { name: "lg-mobile", width: 390, height: 844 },
]) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game: unknown }).__game), { timeout: 15000 });
  for (const route of ["arena", "ascent", "garden"]) {
    await page.evaluate(`window.__game.navigate("${route}")`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `.shots-tmp/base/${vp.name}-${route}.png` });
  }
  // Solid mode
  await page.evaluate(`(async()=>{ const m = await import("/src/core/prefs.ts"); m.setGlassPref("solid"); })()`);
  await page.evaluate(`window.__game.navigate("garden")`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.shots-tmp/base/${vp.name}-solid.png` });
  await page.close();
}
await b.close(); console.log("hub shots done");
