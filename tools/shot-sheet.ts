/**
 * A contact sheet of plants.
 *
 * "The plant art is ugly" is not an actionable complaint until you can see twenty
 * of them at once. Rendered as a grid at the size the player actually meets them —
 * a garden tile is about 150px, a shop chip 52px, a picker 40px — because art that
 * holds up at 500px in isolation routinely turns to mush at 52.
 *
 * Two sheets: the same twelve species at garden size and at picker size, so the
 * question "does the silhouette survive small" gets answered rather than assumed.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
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

const built = await page.evaluate(`(async () => {
  const g = window.__game;
  const store = g.store;
  store.state.breederLevel = 60;
  store.state.leafCoin = 90000000;
  store.state.nurseryCap = 24;

  const { createSeedPlant } = await import("/src/genetics/genomeGenerator.ts");
  const { SPECIES } = await import("/src/config/species.ts");
  const { renderPlantSvg } = await import("/src/render/plantRenderer.ts");

  // A spread rather than the first N: the registry cycles elements and archetypes,
  // so a contiguous slice would be eight of the same thing.
  const ids = [];
  const step = Math.floor(SPECIES.length / 18);
  for (let i = 0; i < 18; i++) ids.push(SPECIES[i * step].id);

  const size = Number(window.__size || 150);
  const cards = ids.map((id, i) => {
    const p = createSeedPlant(id, "sheet", "s" + i, 0);
    // Halfway grown: a seedling is mostly a stick and would flatter the art.
    p.growth.stage = "mature";
    p.growth.level = 20;
    return { id, name: SPECIES[i * step].name, svg: renderPlantSvg(p, size) };
  });
  window.__cards = cards;

  const host = document.createElement("div");
  host.id = "sheet";
  host.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:#dcefc8;padding:14px;overflow:auto;" +
    "display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-content:start;";
  document.body.appendChild(host);
  for (const c of cards) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "background:#e0cb9e;border-radius:8px;padding:6px;display:grid;justify-items:center;gap:4px;" +
      "box-shadow:inset 0 4px 10px rgba(74,48,22,.24);";
    cell.innerHTML = c.svg;
    const lab = document.createElement("div");
    lab.style.cssText = "font:700 9px system-ui;color:#3a2a18;";
    lab.textContent = c.name;
    cell.appendChild(lab);
    host.appendChild(cell);
  }
  return cards.length;
})()`);
console.log("plants rendered:", built);

await page.screenshot({ path: "shots/sheet-garden.png", fullPage: true });

// Same plants at the size the picker shows them.
await page.setViewportSize({ width: 1180, height: 620 });
await page.evaluate(`(() => {
  document.querySelector("#sheet").style.gridTemplateColumns = "repeat(9,1fr)";
  [...document.querySelectorAll("#sheet svg")].forEach((s) => {
    s.setAttribute("width", "52");
    s.setAttribute("height", "52");
  });
})()`);
await page.waitForTimeout(250);
await page.screenshot({ path: "shots/sheet-picker.png", fullPage: true });

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();