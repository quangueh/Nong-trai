/**
 * Modal dismissal end-to-end: a sheet opens, focus lands inside it, Escape
 * closes it — and the key must not leak to the game beneath.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5173";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

// Stand the sign-in gate down: it is a modal that must NOT dismiss on Escape,
// so it is the wrong subject for this probe.
await page.addInitScript(`try { sessionStorage.setItem("nong-trai-account-bypass", "1"); } catch {}`);

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.evaluate(`(() => {
  const g = (window).__game, s = g.store;
  s.state.breederLevel = 24;
  s.state.leafCoin = 48000; s.state.nectar = 620; s.state.pollen = 340;
  for (const p of s.state.plants) { p.growth.stage = "mature"; p.growth.level = 20; }
})()`);
await page.waitForTimeout(500);

await page.evaluate(`(() => {
  (window).__escSeen = 0;
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") (window).__escSeen++; });
})()`);

let ok = true;
function check(name: string, cond: boolean, detail = ""): void {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) ok = false;
}

const gateUp = await page.evaluate(`document.querySelectorAll(".gate-card").length`);
check("sign-in gate bypassed", gateUp === 0, `${gateUp} gate`);

// 1. Detail sheet: tap a plant card, focus must move inside, Escape closes.
await page.evaluate(`(() => { document.querySelector(".plot")?.click(); })()`);
await page.waitForTimeout(500);
const sheetOpen = await page.evaluate(`document.querySelectorAll(".sheet:not(.gate-card)").length`);
check("sheet opens from a plot tap", sheetOpen > 0, `${sheetOpen} sheets`);
const focusInside = await page.evaluate(`(() => {
  const s = document.querySelector(".sheet:not(.gate-card)");
  return s ? s.contains(document.activeElement) : false;
})()`);
check("focus lands inside the sheet", focusInside === true);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const sheetAfter = await page.evaluate(`document.querySelectorAll(".sheet:not(.gate-card)").length`);
check("Escape closes the sheet", sheetAfter === 0, `${sheetAfter} left`);

// 2. Settings sheet (app.ts path).
await page.evaluate(`(() => { document.querySelector("button[title='Cài đặt']")?.click(); })()`);
await page.waitForTimeout(400);
const settingsOpen = await page.evaluate(`document.querySelectorAll(".sheet:not(.gate-card)").length`);
check("settings sheet opens", settingsOpen > 0, `${settingsOpen} sheets`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const settingsAfter = await page.evaluate(`document.querySelectorAll(".sheet:not(.gate-card)").length`);
check("Escape closes settings", settingsAfter === 0, `${settingsAfter} left`);

// 3. The leak check: every Escape while a modal owned the page stayed inside it.
const leaked = await page.evaluate(`(window).__escSeen`);
check("Escape never reached window-level handlers under a modal", leaked === 0, `${leaked} leaked`);

check("no page errors", errors.length === 0, errors[0] ?? "");
await b.close();
console.log(ok ? "\nOK" : "\nFAILURES");
process.exit(ok ? 0 : 1);
