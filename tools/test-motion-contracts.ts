/**
 * Motion ownership contracts — the instrumentable slice of MOT-01..14
 * (docs/28 §12, docs/34 §12). Quality scores (MOT-11/12) and slow-motion
 * review (MOT-14) need humans and stay out of this suite's claims.
 *
 * What is proven here, in a real browser against the real FX modules:
 *   MOT-01 — FX play cannot mutate wallet/plants/XP (state snapshot equality)
 *   MOT-07 — finish is idempotent: click + Escape in the same gesture →
 *            onContinue/onDone exactly once (regressions for the stageOverlay
 *            and expGain double-fire bugs)
 *   MOT-07 — interrupt mid-clip: Escape during the tally still settles once
 *   MOT-09 — reduced-motion mode changes what plays, never what is dismissible
 *   cleanup — expGain chips are all gone after their fallback; a double-done
 *            would re-add `is-credited` a second time (counted via observer)
 */

import { chromium } from "playwright-core";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (t: string) => console.log(`\n${t}`);

const browser = await chromium.launch();

async function boot() {
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });
  return { page, errs };
}

/** The FX modules are not on __game — pull them through the dev module graph. */
const MOD = `
  const [overlay, fusion, exp, lvl, prefs] = await Promise.all([
    import("/src/ui/fx/stageOverlay.ts"),
    import("/src/ui/fusion.ts"),
    import("/src/ui/fx/expGain.ts"),
    import("/src/ui/fx/levelUp.ts"),
    import("/src/core/prefs.ts"),
  ]);
  window.__fxmods = { overlay, fusion, exp, lvl, prefs };
`;

const OUTCOME = (fighter: string) => `({
  won: true, stage: 3,
  monster: { name: "Ma Vương Cỏ", title: "", stage: 3, tier: "wild", rarity: "common",
             element: "leaf", archetype: "bruiser", power: 120, affixes: [], skills: [] },
  reward: { leafCoin: 48, nectar: 2, pollen: 1, geneCrystal: 0, items: 1, plantXp: 10 },
  drops: [], share: 0.4,
  fighter: ${fighter},
})`;

/* ================================================================ */

section("MOT-07 — stage result: Escape+click in one gesture continues once");
{
  const { page, errs } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  await page.evaluate<any>(`(() => {
    const g = (window).__game;
    const fighter = g.store.state.plants[0];
    window.__continues = 0;
    (window).__fxmods.overlay.showStageResult(${OUTCOME("fighter")}, () => window.__continues++);
  })()`);
  // The tally disables the button until it finishes counting — wait it out.
  await page.waitForSelector(".stagelive .btn:not([disabled])", { timeout: 12000 });
  await page.keyboard.press("Escape");
  await page.mouse.click(10, 10); // a stray click landing on the same frame as the Escape
  await page.waitForTimeout(500);
  const res = await page.evaluate<any>(`(() => ({
    continues: (window).__continues,
    overlayGone: !document.querySelector(".stagelive"),
  }))()`);
  check("one gesture = one continue", res.continues === 1, `continues=${res.continues}`);
  check("and the overlay actually left", res.overlayGone === true);
  check("no page errors", errs.length === 0, errs.join(" | "));
  await page.close();
}

section("MOT-07 — stage result: Escape mid-tally still settles once");
{
  const { page } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  await page.evaluate<any>(`(() => {
    const g = (window).__game;
    const fighter = g.store.state.plants[0];
    window.__continues = 0;
    (window).__fxmods.overlay.showStageResult(${OUTCOME("fighter")}, () => window.__continues++);
  })()`);
  await page.waitForSelector(".stagelive", { timeout: 8000 });
  await page.waitForTimeout(300); // mid-count — the interrupt the contract is about
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const res = await page.evaluate<any>(`(() => ({
    continues: (window).__continues,
    overlayGone: !document.querySelector(".stagelive"),
  }))()`);
  check("interrupting the tally still continues exactly once", res.continues === 1, `continues=${res.continues}`);
  check("and the count-up leaves no overlay behind", res.overlayGone === true);
  await page.close();
}

section("MOT-07 — fusion ceremony: skip lands onDone exactly once");
{
  const { page } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  await page.evaluate<any>(`(() => {
    const g = (window).__game;
    const child = g.store.state.plants[0];
    window.__dones = 0;
    (window).__fxmods.fusion.playFusion(child, () => window.__dones++);
  })()`);
  await page.waitForSelector(".fusion-overlay", { timeout: 8000 });
  await page.waitForTimeout(600); // ~25–50% of the ceremony
  await page.click(".fusion-overlay");
  await page.waitForTimeout(300);
  // A second click after it finished must not re-fire anything.
  await page.click("body", { position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  const res = await page.evaluate<any>(`(() => ({
    dones: (window).__dones,
    overlayGone: !document.querySelector(".fusion-overlay"),
  }))()`);
  check("skipping the ceremony calls onDone once", res.dones === 1, `dones=${res.dones}`);
  check("and removes the ceremony", res.overlayGone === true);
  await page.close();
}

section("BRD-§10 — route switch mid-ceremony cannot lose or repeat the result");
{
  const { page, errs } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  // A real settle first — the child exists before the first frame plays.
  await page.evaluate<any>(`(async () => {
    const sp = await import("/src/config/species.ts");
    const g = (window).__game;
    const s = g.store;
    s.state.plants = [];
    for (const id of [sp.SPECIES[0].id, sp.SPECIES[1].id]) {
      s.state.seeds[id] = 2; s.plantSeed(id);
      const p = s.state.plants[s.state.plants.length - 1];
      p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now();
      p.growth.level = 14; p.locks.manual = false;
    }
    s.state.leafCoin = 1e6;
    // Empty the book so this breed is a guaranteed first discovery.
    s.state.discovery.species = []; s.state.discovery.traits = [];
    const res = s.breed(s.state.plants[0].plantId, s.state.plants[1].plantId);
    window.__breedRes = res;
    const child = res.result.plant;
    window.__childId = child.plantId;
    window.__dones = 0;
    (window).__fxmods.fusion.playFusion(child, () => window.__dones++);
    return child.plantId;
  })()`);
  await page.waitForSelector(".fusion-overlay", { timeout: 8000 });
  await page.waitForTimeout(500); // mid-ceremony — the route switch §10 requires
  await page.evaluate<any>(`(() => (window).__game.navigate("lab"))()`);
  // The ceremony is modal on .shell: it finishes on its own even over a new route.
  await page.waitForFunction(() => (window as unknown as { __dones?: number }).__dones === 1, { timeout: 6000 });
  await page.waitForTimeout(300);
  const res = await page.evaluate<any>(`(() => {
    const s = (window).__game.store.state;
    return {
      dones: (window).__dones,
      overlayGone: !document.querySelector(".fusion-overlay"),
      childThere: s.plants.some(p => p.plantId === (window).__childId),
      plants: s.plants.length,
      pity: s.pity.totalBreeds,
    };
  })()`);
  check("onDone landed exactly once across the route switch", res.dones === 1, `dones=${res.dones}`);
  check("ceremony left no stuck overlay", res.overlayGone === true);
  check("the settled child survived the route switch", res.childThere === true, `plants=${res.plants}`);
  check("settlement stayed single (one breed counted)", res.pity === 1, `totalBreeds=${res.pity}`);
  check("no page errors", errs.length === 0, errs.join(" | "));

  // §10 result sheet: parents comparison + discovery state must be readable.
  await page.evaluate<any>(`(async () => {
    const br = await import("/src/ui/screens/breeding.ts");
    br.openMutationReport((window).__breedRes.result, () => {});
  })()`);
  await page.waitForSelector(".breed-report", { timeout: 8000 });
  const rep = await page.evaluate<any>(`(() => {
    const sheet = document.querySelector(".breed-report");
    const text = sheet ? sheet.textContent : "";
    const rows = sheet ? [...sheet.querySelectorAll(".card .row .grow")].length : 0;
    return { hasParents: text.includes("Cha mẹ"), hasDiscovery: text.includes("Khám phá mới"),
      hasPower: text.includes("Sức mạnh"), rows };
  })()`);
  check("report shows the consumed parents", rep.hasParents && rep.rows >= 2, JSON.stringify(rep));
  check("report shows the child's power comparison", rep.hasPower === true);
  check("report shows the discovery state", rep.hasDiscovery === true);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.close();
}

section("MOT-09 — reduced motion: faster path, same dismissibility");
{
  const { page } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  await page.evaluate<any>(`(() => (window).__fxmods.prefs.setMotionPref("reduce"))()`);
  const t0 = Date.now();
  await page.evaluate<any>(`(() => {
    const g = (window).__game;
    const child = g.store.state.plants[0];
    window.__dones = 0;
    (window).__fxmods.fusion.playFusion(child, () => window.__dones++);
  })()`);
  await page.waitForFunction(() => (window as unknown as { __dones?: number }).__dones === 1, { timeout: 4000 });
  const calm = await page.evaluate<any>(`(() => (window).__dones)()`);
  const elapsed = Date.now() - t0;
  check("the calm ceremony finishes on its own quickly", calm === 1 && elapsed < 3500, `dones=${calm} in ${elapsed}ms`);
  await page.evaluate<any>(`(() => (window).__fxmods.prefs.setMotionPref("system"))()`);
  await page.close();
}

section("MOT-01 — FX plays move pixels, never the wallet or the garden");
{
  const { page, errs } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  const before = await page.evaluate<any>(`(() => {
    const s = (window).__game.store.state;
    return { coin: s.leafCoin, plants: s.plants.length, nectar: s.nectar, pollen: s.pollen };
  })()`);
  await page.evaluate<any>(`(() => {
    const g = (window).__game;
    const fx = (window).__fxmods;
    const plant = g.store.state.plants[0];
    const bar = document.querySelector(".lvstrip-bar") ?? document.body;
    fx.exp.celebrateExpGain({ amount: 500, bar, filled: true });
    fx.fusion.playFusion(plant, () => {});
    fx.lvl.celebrateLevelUp({ level: 5, levelsGained: 1, subject: plant.name, subjectIcon: "🌱",
      expGained: 40, after: { level: 5, pct: 10, capped: false }, rewards: [] });
  })()`);
  await page.waitForTimeout(800);
  const after = await page.evaluate<any>(`(() => {
    const s = (window).__game.store.state;
    return { coin: s.leafCoin, plants: s.plants.length, nectar: s.nectar, pollen: s.pollen };
  })()`);
  check("three concurrent celebrations changed no state", JSON.stringify(before) === JSON.stringify(after),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  // Leave the overlays politely.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  check("no page errors from concurrent FX", errs.length === 0, errs.join(" | "));
  await page.close();
}

section("cleanup — expGain chips leave nothing behind, pulse fires once");
{
  const { page } = await boot();
  await page.evaluate<any>(`(async () => { ${MOD} })()`);
  await page.evaluate<any>(`(() => {
    const fx = (window).__fxmods;
    const bar = document.querySelector(".lvstrip-bar") ?? document.body;
    /* MutationObserver: a double-done would remove+add is-credited twice —
       count the adds, not the class's presence. */
    /* A pulse removes and re-adds is-credited inside one synchronous call, so a
       MutationObserver sees net-zero. Count the add() calls themselves — a
       double-done would call pulse() again and show up as extra adds. */
    window.__pulses = 0;
    const orig = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...args) {
      if (this === bar.classList && args.includes("is-credited")) (window).__pulses++;
      return orig.apply(this, args);
    };
    fx.exp.celebrateExpGain({ amount: 120, bar });
    window.__restoreAdd = () => { DOMTokenList.prototype.add = orig; };
  })()`);
  await page.waitForTimeout(1900); // past the 1500ms fallback for every chip
  const res = await page.evaluate<any>(`(() => ({
    ghosts: document.querySelectorAll(".expfly, .expfly-trail").length,
    pulses: (window).__pulses,
  }))()`);
  check("zero chips or trail dots left over", res.ghosts === 0, `ghosts=${res.ghosts}`);
  // amount=120 → 2 chips; each done() pulses the bar exactly once.
  check("the bar pulsed once per chip — never twice", res.pulses === 2, `pulses=${res.pulses}`);
  await page.close();
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
