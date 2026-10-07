/* Care-sheet preview probe: open the care sheet, read the ≈gain lines. */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/probe", { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(`try { sessionStorage.setItem("nong-trai-account-bypass", "1"); } catch {}`);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(600);

// Open the plant's care sheet via the store's garden path: click the planted card, then "Chăm".
await page.locator(".plot").first().click();
await page.waitForTimeout(500);
const sheetButtons = await page.locator(".sheet button").allTextContents();
console.log("sheet buttons:", JSON.stringify(sheetButtons));
// Find the care action: look for buttons whose text contains a care emoji/name.
const careBtn = page.locator(".sheet button", { hasText: "Chăm" }).first();
if (await careBtn.count()) {
  await careBtn.click();
  await page.waitForTimeout(500);
}
const careLines = await page.locator(".sheet").allTextContents();
console.log("care sheet text:", JSON.stringify(careLines).slice(0, 2400));
await page.screenshot({ path: "shots/probe/care-preview.png" });
console.log("pageerrors:", errors.length ? errors : "none");
await b.close();
