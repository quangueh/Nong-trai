/**
 * Hostile-input probe: the player who double-taps everything, opens two sheets
 * at once, and hammers Escape. Store invariants must hold and the UI must not
 * stack ghosts.
 */
import { chromium } from "playwright-core";

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(`try { sessionStorage.setItem("nong-trai-account-bypass", "1"); } catch {}`);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console:" + m.text().slice(0, 160)); });

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(700);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
  ok ? pass++ : fail++;
};

const snap = () =>
  page.evaluate(`(() => { const s = (window).__game.store.state; return { coins: s.leafCoin, items: s.items, seeds: JSON.stringify(s.seeds), plants: s.plants.length, sheets: document.querySelectorAll(".sheet").length, overlays: document.querySelectorAll(".overlay").length }; })()`);

// --- 1. spam the seed-buy button ---------------------------------------------
await page.locator(".navitem", { hasText: "Cửa hàng" }).first().click().catch(() => {});
await page.waitForTimeout(600);
const before = await snap();
// Shop buy buttons are price-labelled ("30🪙"), not "Mua".
const buyBtn = page.locator("button.btn.sm.primary:not([disabled])", { hasText: "🪙" }).first();
const buyCount = await buyBtn.count();
if (buyCount) {
  const priceText = await buyBtn.textContent();
  const price = parseInt((priceText ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
  const seedsBefore = JSON.parse((await snap()).seeds) as Record<string, number>;
  const totalBefore = Object.values(seedsBefore).reduce((a, n) => a + (n || 0), 0);
  for (let i = 0; i < 8; i++) await buyBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await snap();
  const totalAfter = Object.values(JSON.parse(after.seeds) as Record<string, number>).reduce((a, n) => a + (n || 0), 0);
  const bought = totalAfter - totalBefore;
  check("spam-buy actually bought something", bought > 0, `seeds ${totalBefore} → ${totalAfter}`);
  check("coins paid equal seeds gained × price", before.coins - after.coins === bought * price,
    `paid ${before.coins - after.coins} for ${bought} × ${price}`);
  check("spam-buy never makes coins negative", after.coins >= 0, `${before.coins} → ${after.coins}`);
} else {
  check("spam-buy actually bought something", false, "no buyable seed button found");
}

// --- 2. spam care: one action, one debit, cooldown refuses the rest -----------
await page.locator(".navitem", { hasText: "Vườn" }).first().click().catch(() => {});
await page.waitForTimeout(500);
await page.locator(".plot").first().click();
await page.waitForTimeout(400);
const careBtn = page.locator(".sheet button", { hasText: "Chăm" }).first();
if (await careBtn.count()) {
  await careBtn.click();
  await page.waitForTimeout(400);
  const water = page.locator(".sheet button", { hasText: "Tưới" }).first();
  const itemsBefore = (await snap()).items;
  for (let i = 0; i < 6; i++) await water.click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  const itemsAfter = (await snap()).items;
  check("care spam debits once (cooldown)", itemsBefore - itemsAfter === 1, `items ${itemsBefore} → ${itemsAfter}`);
}
// Close whatever sheet is up.
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// --- 3. open/close storm: sheet then Escape then plot again -------------------
for (let i = 0; i < 5; i++) {
  await page.locator(".plot").first().click().catch(() => {});
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
}
const s3 = await snap();
check("no ghost sheets after open/close storm", s3.sheets === 0 && s3.overlays === 0, `sheets=${s3.sheets} overlays=${s3.overlays}`);

// --- 4. rapid nav switching ----------------------------------------------------
const tabs = ["Sưu tầm", "Lai tạo", "Đại chiến", "Vượt ải", "Vườn"];
for (const t of tabs) {
  await page.locator(".navitem", { hasText: t }).first().click().catch(() => {});
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
check("rapid nav leaves a live screen", (await page.locator(".shell").count()) === 1);

// --- 5. Escape with nothing open does not corrupt input ------------------------
for (let i = 0; i < 6; i++) await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const s5 = await snap();
check("Escape storm on bare garden is a no-op", s5.plants >= 0 && s5.sheets === 0);

// --- 6. two pickers: plant while a sheet is already open -----------------------
// Tap two different empty plots fast — two pickers may race; planting must still
// obey the seed bag.
const s6a = await snap();
await page.locator(".plot").nth(1).click().catch(() => {});
await page.waitForTimeout(150);
await page.locator(".plot").nth(2).click().catch(() => {});
await page.waitForTimeout(150);
const s6b = await snap();
check("double-picker does not stack sheets", s6b.sheets <= 1, `sheets=${s6b.sheets}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

check("no page errors through hostile input", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\nResult: ${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
