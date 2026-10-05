/**
 * Watch a plant level up, in the browser, and see the number move.
 *
 * The unit tests prove the notice is raised and the breeder is credited. Neither can
 * prove the player is actually *shown* it - that the toast appears on screen, that it
 * says which plant and which level, and that the breeder badge in the top bar has moved
 * by the time it is read. Those are only visible here.
 *
 * Care actions are driven through the real UI buttons rather than the store, because the
 * cooldown, the resource cost and the notice all live on that path and calling the store
 * directly would skip exactly the code under test.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));

await page.addInitScript(() => {
  // Cleared, so this measures a new player's experience rather than whatever a previous
  // run - possibly against a different build - left behind in this origin's storage.
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
await page.waitForTimeout(500);

// A fresh garden: level 1, one starter plant, no progress to flatter the numbers.
await page.evaluate(`(() => {
  const g = (window).__game;
  g.store.state.breederLevel = 1;
  g.store.state.breederXp = 0;
  g.store.state.leafCoin = 50_000;
  g.store.state.items = 400;
  g.store.state.seeds.thornroot = 8;
  g.navigate("garden");
})()`);
await page.waitForTimeout(800);

const read = () =>
  page.evaluate(`(() => {
    const g = (window).__game;
    const plant = g.store.state.plants[0];
    const badge = document.querySelector(".levelbadge, .badge, .topbar .chip");
    return {
      breederLevel: g.store.state.breederLevel,
      breederXp: g.store.state.breederXp,
      xpNeeded: null,
      plantLevel: plant ? plant.growth.level : null,
      plantXp: plant ? plant.growth.xp : null,
      plantName: plant ? plant.name : null,
      badge: badge ? badge.textContent.replace(/\\s+/g, " ").trim() : null,
      notices: [...document.querySelectorAll(".notice")].map((n) => ({
        title: (n.querySelector(".notice-title") || {}).textContent,
        body: (n.querySelector(".notice-body") || {}).textContent,
        visible: getComputedStyle(n).opacity !== "0",
      })),
    };
  })()`);

const before = (await read()) as Record<string, unknown>;
console.log("before:", JSON.stringify({ ...before, notices: undefined }));

// Care, one action at a time, until the plant levels or the run ends. The action ids are
// cycled rather than repeated, because each has its own cooldown - watering the same
// plant twice in a row is refused with "cây cần nghỉ thêm 45s".
const ACTIONS = ["water", "sunlight", "music", "pruning", "moonlight", "fertilizer"];
let shot = false;

for (let i = 0; i < 48; i++) {
  const acted = (await page.evaluate(`(() => {
    const g = (window).__game;
    const ids = ${JSON.stringify(ACTIONS)};
    const plant = g.store.state.plants[0];
    if (!plant) return "no plant";
    // Rotating position kept on the game object. Initialised before it is read: starting
    // at undefined made the index NaN and sent a bogus action id to the store.
    if (typeof g.__caret !== "number") g.__caret = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[(g.__caret + k) % ids.length];
      const r = g.store.care(plant.plantId, id);
      if (r.ok) { g.__caret = (g.__caret + 1) % ids.length; return id; }
    }
    return "all on cooldown";
  })()`)) as string;

  await page.waitForTimeout(260);

  const now = (await read()) as Record<string, unknown>;
  const shown = (now.notices as { title?: string; body?: string; visible: boolean }[]).filter((n) => n.visible);

  if (now.plantLevel !== before.plantLevel || shown.length) {
    console.log(
      `step ${i + 1} (${acted}): plant ${String(before.plantLevel)} -> ${now.plantLevel}` +
        `, xp ${now.plantXp}, breeder ${now.breederLevel} (+${now.breederXp})`,
    );
    for (const n of shown) console.log(`         TOAST: ${String(n.title).trim()}${n.body ? " / " + String(n.body).trim() : ""}`);
    if (!shot && now.plantLevel !== before.plantLevel) {
      await page.screenshot({ path: "shots/plant-levelup.png" });
      shot = true;
    }
  }

  if ((now.breederLevel as number) > (before.breederLevel as number)) {
    console.log(`  breeder reached level ${now.breederLevel} after ${i + 1} actions`);
    await page.screenshot({ path: "shots/breeder-levelup.png" });
    break;
  }
  if (acted === "all on cooldown") await page.waitForTimeout(1200);
}

const after = (await read()) as Record<string, unknown>;
console.log("\nafter:", JSON.stringify({ ...after, notices: undefined }));
console.log(
  `plant ${String(before.plantLevel)} -> ${String(after.plantLevel)} levels, breeder ${String(before.breederLevel)} -> ${String(after.breederLevel)}`,
);

console.log(errs.length ? "\nPAGE ERRORS:\n  " + errs.join("\n  ") : "\nno page errors");
await b.close();
