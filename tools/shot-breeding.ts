/**
 * The breeding screen: protocols, odds, fee and the cost of the parents.
 *
 * Three things are checked and one is photographed.
 *
 * Gating — at level 1 exactly one protocol is usable and the rest are shown locked
 * with the level that opens them. A screenshot of only the level-60 state would show a
 * row of buttons and prove nothing about whether progression is visible.
 *
 * The odds and the fee move. A picker that repaints its own chips while leaving the
 * numbers alone is decoration, not a lever. Each protocol is pulled and the quoted fee
 * and mutation ceiling are read back; all three protocols must differ.
 *
 * The parents are named. The cost notice lists the two plants that will be lost, and
 * this reads them out of the DOM rather than trusting that it does.
 *
 * Slots are filled by clicking them and choosing from the real picker, not by poking
 * the store. Setting the selection directly would skip the only part of this that a
 * player actually touches.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 1360 } });
await page.addInitScript(() => {
  window.__name = (f) => f;
});
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__game), { timeout: 15000 });
await page.waitForTimeout(400);

const seed = `(() => {
  const g = window.__game;
  g.store.state.leafCoin = 5_000_000;
  g.store.state.nurseryCap = 24;
  const ids = Object.keys(g.store.state.seeds).filter((id) => (g.store.state.seeds[id] || 0) > 0);
  let n = 0;
  for (const id of ids) {
    g.store.state.seeds[id] = 20;
    const r = g.store.plantSeed(id);
    if (r.ok && r.plantId) n++;
    if (n >= 3) break;
  }
  for (const p of g.store.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 25;
    p.locks.manual = false;
  }
  g.navigate("breeding");
})()`;

const read = `(() => ({
  chips: [...document.querySelectorAll(".proto-chip")].map((c) => ({
    name: (c.querySelector(".proto-name") || {}).textContent || "",
    locked: c.classList.contains("is-locked"),
    on: c.classList.contains("is-on"),
  })),
  cost: (document.querySelector(".proto-cost") || {}).textContent || "",
  costLive: Boolean(document.querySelector(".proto-cost.is-live")),
  tradeoff: (document.querySelector(".proto-box .card .tiny:last-child") || {}).textContent || "",
  meta: [...document.querySelectorAll(".card .row.between")]
    .map((r) => r.textContent.replace(/\\s+/g, " ").trim()),
}))()`;

async function fillSlots(): Promise<void> {
  for (const [slot, card] of [[0, 0], [1, 1]] as const) {
    await page.locator(".slot").nth(slot).click();
    await page.waitForTimeout(400);
    await page.locator(".sheet .pickrow").nth(card).click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(300);
}

// --- level 1: one protocol, four locked -----------------------------------
await page.evaluate(seed);
await page.evaluate(`(() => { window.__game.store.state.breederLevel = 1; window.__game.navigate("breeding"); })()`);
await page.waitForTimeout(600);
const lv1 = (await page.evaluate(read)) as {
  chips: { name: string; locked: boolean }[];
};
console.log(
  "level 1:",
  lv1.chips.map((c) => `${c.name}${c.locked ? " [khoá]" : ""}`).join("  "),
);
console.log(
  `  usable at level 1: ${lv1.chips.filter((c) => !c.locked).length}, locked: ${lv1.chips.filter((c) => c.locked).length}`,
);
await fillSlots();
await page.screenshot({ path: "shots/breed-proto-lv1.png" });

// --- level 60: all five, and the odds move --------------------------------
await page.evaluate(`(() => { window.__game.store.state.breederLevel = 60; window.__game.navigate("breeding"); })()`);
await page.waitForTimeout(600);
await fillSlots();
await page.screenshot({ path: "shots/breed-proto.png" });

const quoted = new Map<string, string>();
for (const name of ["Cộng hưởng", "Ổn định", "Bùng nổ", "Thổi luyện"]) {
  await page.locator(".proto-chip", { hasText: name }).first().click();
  await page.waitForTimeout(450);
  const r = (await page.evaluate(read)) as { meta: string[]; tradeoff: string; cost: string; costLive: boolean };
  const fee = r.meta.find((m) => m.includes("Phí lai")) ?? "(none)";
  const ceiling = r.meta.find((m) => m.includes("Đột biến")) ?? "(none)";
  quoted.set(name, fee);
  console.log(`${name.padEnd(12)} ${fee}   ${ceiling}`);
  console.log(`             ${r.tradeoff}`);
}
console.log(
  `\nfees differ across protocols: ${new Set(quoted.values()).size === quoted.size ? "yes" : "NO " + JSON.stringify([...quoted])}`,
);

// --- the parents are named, not just described -----------------------------
await page.locator(".proto-chip", { hasText: "Cộng hưởng" }).first().click();
await page.waitForTimeout(450);
const live = (await page.evaluate(read)) as { cost: string; costLive: boolean };
console.log(`\ncost notice live: ${live.costLive}`);
console.log(`  "${live.cost.replace(/\s+/g, " ").trim()}"`);

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();