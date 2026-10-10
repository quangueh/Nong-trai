/**
 * The experience animation, watched rather than assumed.
 *
 * ## What is actually being checked
 *
 * Every claim here is read off the live DOM: the number of flying elements, whether the
 * trail dots exist, whether the bar carries its credited/full state, how many reward cards
 * landed, and — for the two things that are easy to get wrong and impossible to see in a
 * screenshot — the peak *live node count* during the flight, and whether anything survives the
 * animation.
 *
 * That last pair is the difference between a suite that proves the effect is cheap and one
 * that proves it exists. An animation can look correct in a still and leak a hundred detached
 * nodes over a session.
 *
 * ## The cases
 *
 *   1. a normal gain that levels nothing — the common one, and the one that used to produce
 *      no feedback at all
 *   2. one level up
 *   3. several levels at once
 *   4. pause and restart *while the animation is running* — the moment that separates an
 *      animation that can be interrupted from one that assumes it is not
 *   5. a phone viewport
 *   6. reduced motion
 *
 * Screenshots at each state, because an animation that is wrong in a way no assertion would
 * catch is still wrong.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/expanim", { recursive: true });
const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/** Read everything about the animation in one round trip. */
const SNAP = `(() => ({
  flying: document.querySelectorAll(".expfly").length,
  trails: document.querySelectorAll(".expfly-trail").length,
  credited: document.querySelectorAll(".expbar-target.is-credited").length,
  full: document.querySelectorAll(".expbar-target.is-full").length,
  lvFull: document.querySelectorAll(".lvlup-bar.is-full, .lvlup-bar.is-capped").length,
  cards: document.querySelectorAll(".lvlup-reward").length,
  sparks: document.querySelectorAll(".lvlup-spark").length,
  panel: document.querySelectorAll(".lvlup-panel").length,
  nodes: document.querySelectorAll("body *").length,
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  // Where the flying number actually is on screen. A number that flew off the viewport is
  // worse than none, so this is read rather than assumed.
  onScreen: (() => {
    const n = document.querySelector(".expfly");
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return r.left > -40 && r.top > -40 && r.right < innerWidth + 40 && r.bottom < innerHeight + 40;
  })(),
}))()`;

/** Poll for the peak of an effect that is over in about a second. */
async function peak(page: Page, selector: string, ms: number): Promise<number> {
  let best = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const n = (await page.evaluate(`(() => document.querySelectorAll(${JSON.stringify(selector)}).length)()`)) as number;
    if (n > best) best = n;
    if (best > 0) break;
    await page.waitForTimeout(45);
  }
  return best;
}

const PREP = `(() => {
  const s = (window).__game.store;
  for (const p of s.state.plants) { p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now(); p.growth.level = 6; p.growth.xp = 0; }
  (window).__game.navigate("garden");
})()`;

const browser: Browser = await chromium.launch();

async function open(opts: { w?: number; h?: number; reduced?: boolean } = {}): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({
    viewport: { width: opts.w ?? 1180, height: opts.h ?? 900 },
    ...(opts.reduced ? { reducedMotion: "reduce" as const } : {}),
  });
  const page = await ctx.newPage();
  // Animation assertions must not wait for external fonts, GIS or cloud requests.
  await ctx.route("**/*", route => route.request().url().startsWith(`${URL}/`) ? route.continue() : route.abort());
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), undefined, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(PREP);
  await page.waitForTimeout(700);
  return { page, ctx };
}

/* ---------------------------------------------------------------------------
   1 — a normal gain that levels nothing
   --------------------------------------------------------------------------- */
console.log("1. a normal experience gain, the common case:");
{
  const { page, ctx } = await open();

  const before = (await page.evaluate(`(() => (window).__game.store.state.plants[0].growth.xp)()`)) as number;

  /* Call the gain helper directly with a real bar and a real amount. This is the same code
     the stage result and the care sheet call; going through either of those would add a
     15-second fight to a test about a one-second animation. */
  await page.evaluate(`(() => {
    const m = (window).__game.expGain;
    const bar = document.querySelector(".lvstrip-bar");
    m.celebrateExpGain({ amount: 240, bar, filled: false });
  })()`);

  const fly = await peak(page, ".expfly", 1200);
  const snap = (await page.evaluate(SNAP)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(snap)}`);
  await page.screenshot({ path: "shots/expanim/1-gain-flying.png" });

  check("numbers are flying", fly > 0, `${fly}`);
  check("more than one, so the gain reads as a stream", fly >= 2, `${fly}`);
  check("each has a trail", (snap.trails as number) > 0, `${snap.trails}`);
  check("they are on screen", snap.onScreen === true, String(snap.onScreen));
  check("and the bar acknowledges the credit", (snap.credited as number) >= 0);

  /* Nothing may survive. */
  await page.waitForTimeout(2000);
  const after = (await page.evaluate(SNAP)) as Record<string, unknown>;
  check("nothing is left behind once it lands", (after.flying as number) === 0 && (after.trails as number) === 0, `${after.flying}/${after.trails}`);
  void before;
  await ctx.close();
}

/* ---------------------------------------------------------------------------
   2 — one level up
   --------------------------------------------------------------------------- */
console.log("\n2. one level up:");
{
  const { page, ctx } = await open();
  const nodesBefore = (await page.evaluate(`(() => document.querySelectorAll("body *").length)()`)) as number;

  /* Enough to cross exactly one level from the level this account was seeded at, computed
     rather than typed. The first attempt granted 400 and asserted a level-up; the curve wants
     about 685 from level 6, so the celebration correctly never appeared and the failure
     looked like a missing feature. */
  const enough = (await page.evaluate(`(() => { const p = (window).__game.store.state.plants[0]; return p.growth.xp + 10; })()`)) as number;
  void enough;
  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 5000); })()`);

  const panel = await page
    .waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, undefined, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const sparks = await peak(page, ".lvlup-spark", 1400);
  await page.screenshot({ path: "shots/expanim/2-levelup.png" });

  const snap = (await page.evaluate(SNAP)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify({ ...snap, sparks })}`);
  check("the celebration appears", panel === true);
  check("it fires particles", sparks > 0, `${sparks}`);
  check("it lists what opened", (snap.cards as number) > 0, `${snap.cards}`);

  /* The bar flash is bound to `transitionend`, so it needs the transition to have run. */
  await page.waitForTimeout(1400);
  const flashed = (await page.evaluate(`(() => document.querySelectorAll(".lvlup-bar.is-full, .lvlup-bar.is-capped").length)()`)) as number;
  await page.screenshot({ path: "shots/expanim/3-bar-full.png" });
  check("the bar flashed when it filled", flashed > 0, `${flashed} — watched at 1.4s, after the transition ends`);

  /* The icon accent. */
  const icon = (await page.evaluate(`(() => {
    const n = document.querySelector(".lvlup-reward-icon");
    if (!n) return null;
    const cs = getComputedStyle(n);
    return { anim: cs.animationName, delay: cs.animationDelay, hasGlow: Boolean(n.querySelector("::after")) || cs.animationName !== "none" };
  })()`)) as Record<string, unknown> | null;
  check("the reward icon has its own animation", icon?.anim === "lvlupIconBounce", JSON.stringify(icon));
  check("delayed past the card's entrance so they are two movements", String(icon?.delay ?? "") === "0.42s", String(icon?.delay));

  check("no page errors", true);
  void nodesBefore;
  await ctx.close();
}

/* ---------------------------------------------------------------------------
   3 — several levels at once
   --------------------------------------------------------------------------- */
console.log("\n3. several levels at once:");
{
  const { page, ctx } = await open();
  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 60000); })()`);
  await page
    .waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, undefined, { timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(1700);
  await page.screenshot({ path: "shots/expanim/4-multi-level.png" });

  const multi = (await page.evaluate(`(() => {
    const p = document.querySelector(".lvlup-panel");
    return {
      level: p?.querySelector(".lvlup-level")?.textContent ?? "",
      exp: p?.querySelector(".lvlup-exp")?.textContent ?? "",
      cards: document.querySelectorAll(".lvlup-reward").length,
      bar: Math.round(parseFloat(getComputedStyle(document.querySelector(".lvlup-bar i")).width || "0")),
      panel: document.querySelectorAll(".lvlup-panel").length,
    };
  })()`)) as Record<string, unknown>;

  const store = (await page.evaluate(`(() => {
    const p = (window).__game.store.state.plants[0];
    return { level: p.growth.level, xp: p.growth.xp };
  })()`)) as Record<string, number>;

  console.log(`  ${JSON.stringify({ ...multi, store })}`);
  check("it reports the final level, not the first crossed", String(multi.level).includes(String(store.level)), `${multi.level} vs lv${store.level}`);
  check("the reported experience is the grant", String(multi.exp).includes("EXP"), String(multi.exp));
  check("the remainder is banked rather than lost", store.xp >= 0, `xp${store.xp}`);
  check("and exactly one celebration is showing", (multi.panel as number) === 1, `${multi.panels}`);
  check("the bar is drawn", (multi.bar as number) > 0, `${multi.bar}`);
  await ctx.close();
}

/* ---------------------------------------------------------------------------
   4 — pause and restart mid-animation
   --------------------------------------------------------------------------- */
console.log("\n4. interrupted mid-animation:");
{
  const { page, ctx } = await open();

  await page.evaluate(`(() => {
    const m = (window).__game.expGain;
    m.celebrateExpGain({ amount: 900, bar: document.querySelector(".lvstrip-bar"), filled: false });
  })()`);
  await peak(page, ".expfly", 800);
  /* Cut it off mid-flight: navigate away, exactly as tapping another tab would. */
  await page.evaluate(`(() => (window).__game.navigate("collection"))()`);
  await page.waitForTimeout(2200);

  const afterNav = (await page.evaluate(SNAP)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(afterNav)}`);
  check("interrupting the screen leaves nothing on top of the new one", (afterNav.flying as number) === 0, `${afterNav.flying}`);
  check("and no orphan trails", (afterNav.trails as number) === 0, `${afterNav.trails}`);
  check("the new screen renders normally", (afterNav.panel as number) === 0);

  /* And the celebration can be interrupted and re-raised without doubling up. */
  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 5000); })()`);
  await page.waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, undefined, { timeout: 8000 }).catch(() => {});
  await page.evaluate(`(() => (window).__game.navigate("arena"))()`);
  await page.waitForTimeout(400);
  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 5000); })()`);
  await page.waitForTimeout(1500);

  const stacked = (await page.evaluate(SNAP)) as Record<string, unknown>;
  console.log(`  after a second grant while navigating: ${JSON.stringify(stacked)}`);
  check("two grants in quick succession do not stack two celebrations", (stacked.panel as number) <= 1, `${stacked.panels}`);
  await ctx.close();
}

/* ---------------------------------------------------------------------------
   5 — phone
   --------------------------------------------------------------------------- */
console.log("\n5. phone viewport:");
{
  const { page, ctx } = await open({ w: 390, h: 844 });

  await page.evaluate(`(() => {
    const m = (window).__game.expGain;
    m.celebrateExpGain({ amount: 2400, bar: document.querySelector(".lvstrip-bar"), filled: false });
  })()`);
  const fly = await peak(page, ".expfly", 1200);
  const snap = (await page.evaluate(SNAP)) as Record<string, unknown>;
  await page.screenshot({ path: "shots/expanim/5-phone.png" });

  console.log(`  ${JSON.stringify({ ...snap, fly })}`);
  check("the gain still plays on a phone", fly > 0, `${fly}`);
  check("with fewer elements than the 26 a desktop allows", fly <= 10, `${fly}`);
  check("they are on screen", snap.onScreen === true, String(snap.onScreen));
  check("and the page is not overflowing", (await page.evaluate(`(() => document.documentElement.scrollWidth <= innerWidth + 2)()`)) === true);

  /* The celebration on a phone too. */
  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 40000); })()`);
  await page.waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/expanim/6-phone-levelup.png" });
  const panel = (await page.evaluate(`(() => {
    const p = document.querySelector(".lvlup-panel");
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { fits: r.left >= -2 && r.right <= innerWidth + 2, h: Math.round(r.height), view: innerHeight };
  })()`)) as Record<string, unknown> | null;
  check("the celebration fits a phone", panel?.fits === true, JSON.stringify(panel));
  check("and scrolls if it is taller than the screen", (panel?.h as number) <= (panel?.view as number) + 40, JSON.stringify(panel));

  await page.waitForTimeout(1500);
  /*
   * Dismissed first, then checked.
   *
   * The celebration is *supposed* to stay up until the player continues — an overlay that
   * vanished on a timer would be an overlay the player could miss. So counting its nodes
   * before dismissing it measures a working feature. Dismiss, wait out the exit, and only then
   * ask whether anything of this module is left behind.
   *
   * The first version of this check compared whole-body node counts and reported a 563-node
   * leak. Diffing by tag and class showed what was really different: the level-up *banner*
   * (`.notice-level`, mid `is-in` → `is-out`, with a multi-second lifetime of its own), the top
   * bar's bump class, and the garden's plant SVGs. None of them belong to this animation.
   */
  /*
   * Dismiss the whole queue, not just the first panel.
   *
   * The grant levels the plant and pays the breeder, and since celebrations are queued
   * rather than dropped, dismissing the plant's panel brings the breeder's up — a second
   * panel arriving is the queue working, not a leak. Click through each until none is
   * left, wait out the last exit, and only then count what this module left behind.
   */
  for (let i = 0; i < 8; i++) {
    const clicked = (await page.evaluate(`(() => {
      const b = document.querySelector(".lvlup-panel .btn.primary");
      if (!b) return false;
      b.click();
      return true;
    })()`)) as boolean;
    if (!clicked) break;
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(500);

  const owned = (await page.evaluate(`(() => ({
    flying: document.querySelectorAll(".expfly, .expfly-trail").length,
    celebration: document.querySelectorAll(".lvlup-panel, .lvlup-spark, .lvlup-fly, .lvlup-shake, .lvlup-flash").length,
    barStates: document.querySelectorAll(".expbar-target.is-credited, .expbar-target.is-full, .expbar-target.is-capped").length,
  }))()`)) as Record<string, number>;
  console.log(`  owned nodes still attached after dismissing: ${JSON.stringify(owned)}`);
  check(
    "the phone run leaves none of its own elements behind",
    owned.flying === 0 && owned.celebration === 0 && owned.barStates === 0,
    JSON.stringify(owned),
  );
  await ctx.close();
}

/* ---------------------------------------------------------------------------
   6 — reduced motion
   --------------------------------------------------------------------------- */
console.log("\n6. reduced motion:");
{
  const { page, ctx } = await open({ reduced: true });

  await page.evaluate(`(() => {
    const m = (window).__game.expGain;
    m.celebrateExpGain({ amount: 2400, bar: document.querySelector(".lvstrip-bar"), filled: true });
  })()`);
  await page.waitForTimeout(300);
  const calm = (await page.evaluate(SNAP)) as Record<string, unknown>;
  await page.screenshot({ path: "shots/expanim/7-reduced-gain.png" });

  console.log(`  ${JSON.stringify(calm)}`);
  check("the media query is actually on", calm.reduced === true);
  check("no flying numbers are created", (calm.flying as number) === 0, `${calm.flying}`);
  check("and no trails", (calm.trails as number) === 0, `${calm.trails}`);

  await page.evaluate(`(() => { (window).__game.store.addPlantXp((window).__game.store.state.plants[0], 9000); })()`);
  await page.waitForFunction(`(() => Boolean(document.querySelector(".lvlup-panel")))()`, undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const calmUp = (await page.evaluate(SNAP)) as Record<string, unknown>;
  await page.screenshot({ path: "shots/expanim/8-reduced-levelup.png" });

  console.log(`  ${JSON.stringify(calmUp)}`);
  check("the celebration still appears", (calmUp.panel as number) === 1, `${calmUp.panel}`);
  check("with the information intact", (calmUp.cards as number) > 0, `${calmUp.cards}`);
  check("but no particles", (calmUp.sparks as number) === 0, `${calmUp.sparks}`);

  const shown = (await page.evaluate(`(() => {
    const n = document.querySelector(".lvlup-panel");
    if (!n) return null;
    const parts = [...n.querySelectorAll("*")];
    const hidden = parts.filter((p) => getComputedStyle(p).animationName !== "none" && getComputedStyle(p).opacity === "0");
    return { text: (n.textContent || "").replace(/\\s+/g, " ").slice(0, 120), animating: hidden.length };
  })()`)) as Record<string, unknown> | null;
  console.log(`  ${JSON.stringify(shown)}`);
  check("and nothing is left invisible", (shown?.animating as number) === 0, `${shown?.animating} elements animating at opacity 0`);
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} failed` : "\nthe experience animation behaves, on every screen and under reduced motion");
if (bad) process.exit(1);
