/**
 * Photograph a morph mid-fight.
 *
 * The fight is built directly from the module rather than driven through the
 * arena's "start match" button: two earlier attempts tried that and could not
 * reach the view at all, so the script photographed an arena with no morph in it
 * — which is exactly the failure this harness exists to prevent. Only the
 * matchmaking is skipped; the skill, the event, the view's reaction, the juice,
 * the ring and the label are all the real code path.
 *
 * The cast goes through the skill button rather than a method, because
 * `BattleView` has no `castSkill` — and because going through the button also
 * proves the skill is castable in the UI at all.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
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
  store.state.leafCoin = 50_000_000;
  store.state.nurseryCap = 24;

  const mature = (p) => {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 30;
    p.locks.manual = false;
  };
  for (const p of store.state.plants) mature(p);

  if (store.state.plants.length < 2) {
    for (const id of Object.keys(store.state.seeds)) {
      if ((store.state.seeds[id] || 0) <= 0) continue;
      const r = store.plantSeed(id);
      if (r.ok && r.plantId) {
        const p = store.get(r.plantId);
        if (p) mature(p);
      }
      if (store.state.plants.length >= 2) break;
    }
  }
  const plants = store.state.plants;
  if (plants.length < 2) return "not enough plants";

  const { BattleView } = await import("/src/battle/battleView.ts");

  const container = document.createElement("div");
  // The battle markup is positioned by its own stylesheet, so it needs the shell
  // to itself. The garden was drawn straight through it in an earlier run — the
  // harness reported a morph and produced a photograph of a vegetable patch.
  document.querySelector(".screen").style.display = "none";
  document.querySelector(".bottomnav").style.display = "none";
  document.querySelector(".shell").appendChild(container);

  window.__view = new BattleView({
    container,
    plantA: plants[0],
    plantB: plants[1],
    maxSeconds: 90,
    mySide: "a",
    interactive: true,
    onIntent: function () {},
    onFinish: function () {},
  });

  // Only the delivery is rewritten. Power, windup, effect and cooldown stay the
  // engine's own, so what is animated is a real skill and not a special case.
  const skills = window.__view.session.a.snap.skills;
  if (!skills || !skills.length) return "no skills";
  skills[0] = Object.assign({}, skills[0], {
    core: Object.assign({}, skills[0].core, { delivery: "morph", elements: ["fire"] }),
  });
  window.__morphId = skills[0].id;
  window.__view.start();
  return "ok: " + skills[0].id;
})()`);
console.log("built:", built);

if (String(built).startsWith("ok")) {
  // The view runs its own clock, and at full speed six seconds of morph passes in
// about one of real time — long before a screenshot lands. Dropped to its slowest
// setting so the ring and the label are actually on screen when the shutter fires.
await page.evaluate(`(() => { window.__view.speed = 0.34; })()`);

const pressed = await page.evaluate(`(() => {
    const v = window.__view;
    v.session.a.energy = 100;
    v.session.a.casting = null;
    v.session.a.cooldown[window.__morphId] = 0;
    // By label, not by position. \`:not([disabled])\` picked whichever skill
    // happened to be enabled, which on this run was a melee — and the harness
    // then reported a fight with no morph in it.
    const all = [...document.querySelectorAll(".skillbtn")];
    const btn = all.find((b) => /Biến hình/.test(b.textContent || "")) || all[0];
    if (!btn) return "no skill button";
    btn.click();
    return "clicked: " + (btn.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 44);
  })()`);
  console.log("cast:", pressed);

  // Poll for the frame where the ring is still mid-expansion, which is the only
  // moment the transformation reads as a transformation rather than as a glow.
  let caught = false;
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(`(() => Boolean(document.querySelector(".fx-morph-ring")))`)) {
      caught = true;
      break;
    }
    await page.waitForTimeout(25);
  }

  await page.screenshot({ path: "shots/morph-cast.png" });

  const state = await page.evaluate(`(() => ({
    morphed: document.querySelectorAll(".battler.is-morphed").length,
    label: document.querySelector(".fx-morph-label")?.textContent ?? null,
    rings: document.querySelectorAll(".fx-morph-ring").length,
    avatarTransform: (() => {
      const el = document.querySelector(".battler.is-morphed .avatar");
      return el ? el.style.transform || "(no inline transform)" : null;
    })(),
    morphEvents: (window.__view.session.events || [])
      .filter((e) => String(e.type).indexOf("MORPH") === 0)
      .map((e) => e.type + (e.text ? ": " + e.text : "")),
    logTail: (document.querySelector(".blog, .blogline, .blogbox") || {}).textContent
      ? (document.querySelector(".blog, .blogline, .blogbox").textContent || "").replace(/\\s+/g, " ").slice(-200)
      : null,
  }))()`);
  console.log(JSON.stringify(state, null, 2));
  console.log("caught the transformed frame:", caught);
}

console.log(errs.length ? "ERRORS " + errs.join(" | ") : "no console errors");
await b.close();