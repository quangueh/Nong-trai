/** The account sheet, with no service configured. That is the default state. */
import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 460, height: 820 } });
await page.addInitScript(() => { window.__name = (f) => f; });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(600);

console.log("game booted:", await page.evaluate(`(() => Boolean(document.querySelector(".plots")))`));

await page.evaluate(`(() => { document.querySelector('.topbar .btn.ghost[title]').click(); })()`);
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/settings.png" });

const settings = await page.evaluate(`(() => ({
  rows: [...document.querySelectorAll(".account-rowbtn")].map((n) => n.textContent.replace(/\\s+/g, " ").trim().slice(0, 60)),
  hasWipe: (document.body.textContent || "").includes("Xoá vườn"),
}))()`);
console.log("settings:", JSON.stringify(settings, null, 2));

await page.locator(".account-rowbtn").first().click();
await page.waitForTimeout(450);
await page.screenshot({ path: "shots/account.png" });

const acct = await page.evaluate(`(() => ({
  open: !!document.querySelector(".account"),
  text: (document.querySelector(".account")?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
}))()`);
console.log("account sheet:", JSON.stringify(acct, null, 2));
console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();