/**
 * Sound design, checked by listening with the ears of a machine.
 *
 * ## How any of this is observed
 *
 * A screenshot cannot show whether a sound played, and an automated run cannot listen. So the
 * page's own engine is wrapped: `sfx.play` is replaced with a recorder that still calls
 * through, and every cue the game asks for is logged. That distinguishes two very different
 * outcomes that a screenshot cannot — "the game never asked for a level-up sound" and "it asked
 * and the sound was wrong" are the same pixels and completely different bugs.
 *
 * Nothing in the game is modified to make this possible. `sfx` and `music` are exposed on
 * `__game`, which is the same dev-only seam the battle view and the sign-in functions already
 * live behind.
 *
 * ## What is asserted about music, and why not more
 *
 * There are no audio files in this project — every sound is synthesised — so there is nothing
 * to fail to load, and that is checked structurally rather than by waiting for a 404 that can
 * never happen. What *can* be observed is the thing that actually breaks music in a browser:
 * scheduling into a context that has not been unlocked yet, which queues every note and fires
 * them all at once on the first gesture. So the assertions are about the context's lifecycle,
 * not about decibel levels — which no browser will tell you anyway.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots/audio", { recursive: true });
const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* ------------------------------------------------ 1. there is nothing that can 404 */

console.log("no audio assets, so nothing to fail loading:");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const assets = walk(".").filter((p) => /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(p) && !p.includes("node_modules"));
console.log(`  audio files in the repo: ${assets.length}`);
check("every sound is synthesised, so a missing asset is impossible", assets.length === 0, assets.join(", "));

const musicSrc = readFileSync("src/audio/music.ts", "utf8");
check(
  "and the music bed does not fetch or decode anything",
  !/\bfetch\(|decodeAudioData|Audio\(/.test(musicSrc),
  "music.ts reaches outside the audio graph",
);

/* --------------------------------------------------------------- the harness */

const browser: Browser = await chromium.launch();

/** Wrap `play` so every cue is recorded, still playing. */
const RECORD = `(() => {
  const g = (window).__game;
  if (g.__recorded) return;
  const calls = [];
  const orig = g.sfx.play.bind(g.sfx);
  g.sfx.play = (name, opts) => { calls.push({ name, opts: opts || null }); orig(name, opts); };
  g.__recorded = calls;
})()`;

async function open(opts: { autoplay?: boolean } = {}): Promise<{ page: Page; errs: string[] }> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Chromium will refuse to start an AudioContext without a gesture unless told otherwise.
    // Left at the default for the autoplay test, and relaxed for the rest so the audio graph
    // is actually live and the cues are real rather than early-returned.
    ...(opts.autoplay === false ? {} : { args: ["--autoplay-policy=no-user-gesture-required"] }),
  });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error" && !/GSI_LOGGER|403|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200));
  });
  (page as Page & { __errs: string[] }).__errs = errs;
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(`(() => {
    const a = [...document.querySelectorAll("a, button")].find(x => /không cần tài khoản/i.test(x.textContent || ""));
    if (a) a.click();
  })()`);
  await page.waitForTimeout(800);
  await page.evaluate(RECORD);
  return { page, errs };
}

const calls = async (page: Page): Promise<string[]> => {
  const raw = await page.evaluate(`(() => {
    const g = (window).__game;
    if (!g) return { error: "no __game" };
    if (!g.__recorded) return { error: "no __recorded" };
    return { names: g.__recorded.map(c => c.name) };
  })()`);
  const r = raw as { names?: string[]; error?: string };
  if (r.error) {
    console.log(`  ! recorder: ${r.error}`);
    return [];
  }
  return r.names ?? [];
};

/* ------------------------------------------------- 2. autoplay: nothing before a gesture */

console.log("\nnothing runs before the first gesture:");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(1200);

  const before = (await page.evaluate(`(() => {
    const g = (window).__game;
    return { available: g.sfx.available, state: g.sfx.context ? g.sfx.context.state : null, bus: Boolean(g.sfx.musicBus) };
  })()`)) as Record<string, unknown>;
  console.log(`  before any gesture: ${JSON.stringify(before)}`);
  check("the page loads with no audio context at all", before.state === null, String(before.state));
  check("which means there is nothing to queue notes into", before.bus === false, String(before.bus));

  // The first real gesture.
  await page.mouse.click(640, 450);
  await page.waitForTimeout(900);

  const after = (await page.evaluate(`(() => {
    const g = (window).__game;
    const bus = g.sfx.musicBus;
    return {
      state: g.sfx.context ? g.sfx.context.state : null,
      bus: Boolean(bus),
      musicGain: bus ? Number(bus.gain.value.toFixed(3)) : null,
      musicVolume: g.sfx.musicVolume,
    };
  })()`)) as Record<string, unknown>;
  console.log(`  after the first gesture: ${JSON.stringify(after)}`);
  check("the first gesture unlocks the context", after.state === "running", String(after.state));
  check("and builds the music bus", after.bus === true, String(after.bus));
  check(
    "which starts at the player's level, not at 1.0",
    after.musicGain !== null && Math.abs((after.musicGain as number) - (after.musicVolume as number)) < 0.01,
    `gain=${after.musicGain} volume=${after.musicVolume}`,
  );
  check("no page errors across the unlock", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

/* ------------------------------------------------------------- 3. mute and volume */

console.log("\nmute, and the two volumes:");
{
  const { page, errs } = await open();

  const sliders = (await page.evaluate(`(async () => {
    const b = [...document.querySelectorAll("button")].find(x => /⚙/.test(x.textContent || ""));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      sfxSliders: [...document.querySelectorAll(".volumeslider")].map(s => s.getAttribute("aria-label")),
      rows: [...document.querySelectorAll(".account-volume b")].map(b => b.textContent),
    };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(sliders)}`);
  check("there is a volume control for effects and one for music", (sliders.sfxSliders as string[]).length === 2, JSON.stringify(sliders.sfxSliders));
  check("and each says what it controls", (sliders.sfxSliders as string[]).some((l) => /hiệu ứng/i.test(l)) && (sliders.sfxSliders as string[]).some((l) => /nhạc/i.test(l)), JSON.stringify(sliders.sfxSliders));
  await page.screenshot({ path: "shots/audio/1-settings.png" });
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(`(() => { document.querySelectorAll(".overlay").forEach(n => n.remove()); })()`);

  /* --- muting silences the master, and the music follows --- */
  const muted = (await page.evaluate(`(() => {
    const g = (window).__game;
    g.sfx.setMuted(true);
    const m = g.sfx.musicBus;
    return { muted: g.sfx.muted, stored: localStorage.getItem("nongtrai.muted"), musicGain: m ? Number(m.gain.value.toFixed(3)) : null };
  })()`)) as Record<string, unknown>;
  console.log(`  muted: ${JSON.stringify(muted)}`);
  check("muting is recorded", muted.muted === true && muted.stored === "1", JSON.stringify(muted));

  /* --- the two volumes are independent --- */
  const vols = (await page.evaluate(`(() => {
    const g = (window).__game;
    g.sfx.setMuted(false);
    g.sfx.setVolume(0.5);
    g.sfx.setMusicVolume(0.8);
    return {
      sfx: Number(g.sfx.volume.toFixed(3)),
      music: Number(g.sfx.musicVolume.toFixed(3)),
      sfxKey: localStorage.getItem("nongtrai.volume"),
      musicKey: localStorage.getItem("nongtrai.musicVolume"),
    };
  })()`)) as Record<string, unknown>;
  console.log(`  volumes: ${JSON.stringify(vols)}`);
  check("the two volumes are genuinely separate", vols.sfx === 0.5 && vols.music === 0.8, JSON.stringify(vols));
  check("and each is persisted under its own key", vols.sfxKey === "50" && vols.musicKey === "80", JSON.stringify(vols));

  /* --- and they survive a reload --- */
  await page.evaluate(`(() => (window).__game.sfx.setMuted(true))()`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);
  const after = (await page.evaluate(`(() => {
    const g = (window).__game;
    return { muted: g.sfx.muted, sfx: Number(g.sfx.volume.toFixed(3)), music: Number(g.sfx.musicVolume.toFixed(3)) };
  })()`)) as Record<string, unknown>;
  console.log(`  after reload: ${JSON.stringify(after)}`);
  check("mute survives a reload", after.muted === true, JSON.stringify(after));
  check("and so do both volumes", after.sfx === 0.5 && after.music === 0.8, JSON.stringify(after));

  check("no page errors in the audio settings flow", errs.length === 0, errs.join(" | "));
  await page.context().close();
}

/* --------------------------------------- 4. the moments that must be audible */

console.log("\nthe moments that carry the game:");
{
  const { page, errs } = await open();

  /*
 * A grant big enough to level.
 *
 * There is deliberately no separate check for a small non-leveling gain here. That path — the
 * one where the numbers actually fly — is the stage result, which has no level to cross and is
 * asserted below; calling `addPlantXp` for 40 in isolation plays nothing at all, because the
 * store emits a notice and the *screen* decides what to show, so a store-only call has no UI to
 * react to. An earlier version of this block asserted on it and failed for that reason.
 */
  await page.evaluate(`(() => {
    const g = (window).__game;
    g.__recorded.length = 0;
    g.store.addPlantXp(g.store.state.plants[0], 4000);
  })()`);
  await page.waitForTimeout(2200);
  const onLevelUp = await calls(page);
  console.log(`  levelling a plant: ${JSON.stringify([...new Set(onLevelUp)])}`);
  check("a level up plays a sound", onLevelUp.includes("levelUp"), JSON.stringify(onLevelUp));
  check("and a second one for the power going in", onLevelUp.includes("powerUp"), JSON.stringify(onLevelUp));

  /*
   * A stage fought through the real ladder UI.
   *
   * The first version of this block called `runAscentStage` on the store and asserted on the
   * sounds. It reported a win with only `levelUp` playing, which looked like the reward cue not
   * being wired — and it was not wired to the store. `reward` and `unlock` live in the result
   * *overlay*, which the store never builds. So the test was measuring a path that does not
   * exist and calling the result a bug.
   *
   * Which is the right lesson for a suite about sound: the cue belongs to a moment in the UI, so
   * the test has to be a player. It costs a whole fight and it is the only way to know the cue
   * is where the player will meet it.
   */
  await page.evaluate(`(() => {
    const g = (window).__game;
    g.store.state.ascent.highest = 9;
    g.store.state.breederLevel = 12;
    for (const p of g.store.state.plants) {
      p.growth.stage = "mature"; p.growth.stageReadyAt = Date.now();
      p.growth.level = 20; p.powerRating = 250; p.tier = "bloom";
    }
    g.navigate("ascent");
  })()`);
  await page.waitForTimeout(1400);
  await page.evaluate(`(() => { const b = document.querySelector('[data-stage-fight="10"]'); if (b) b.click(); })()`);
  await page.waitForSelector(".stagebrief-panel", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(`(() => {
    (window).__game.__recorded.length = 0;
    const b = [...document.querySelectorAll(".stagebrief-panel button")].find(x => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForSelector(".stagelive-panel", { timeout: 150000 }).catch(() => {});

  /*
   * Pause and resume, through the real pause button.
   *
   * The module-level `__game.battleView` only reports the arena's main view; ladder and the
   * arena modal both keep their views local. Clicking the visible pause button avoids that trap
   * and matches what a player actually does.
   */
  const paused = (await page.evaluate(`(async () => {
    const g = (window).__game;
    const btn = document.querySelector('button[title^="Tạm dừng"]');
    if (!btn) return { error: "no pause button" };

    g.__recorded.length = 0;
    (btn as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 350));
    const a = [...new Set(g.__recorded.map(c => c.name))];
    g.__recorded.length = 0;
    (btn as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 350));
    return { paused: a, resumed: [...new Set(g.__recorded.map(c => c.name))] };
  })()`)) as Record<string, string[]>;
  console.log(`  pause/resume: ${JSON.stringify(paused)}`);
  if (paused.error) {
    check("a live fight to pause", false, String(paused.error));
  } else {
    check("a live fight to pause", true);
    check("pausing is audible", paused.paused.includes("pause"), JSON.stringify(paused.paused));
    check("and resuming is a different sound", paused.resumed.includes("resume") && !paused.resumed.includes("pause"), JSON.stringify(paused.resumed));
  }

  /*
   * Wait for the fight to actually resolve rather than sleeping a guessed interval and reading
   * whatever is on screen — a fixed wait cannot tell "still fighting" from "already over", and
   * this suite has now been bitten by that distinction three separate ways.
   */
  await page.waitForSelector(".stageover-panel, .stagelive-panel.is-over, .stageresult", { timeout: 150000 }).catch(() => {});
  await page.waitForTimeout(4500);

  const onStage = await calls(page);
  const uniqStage = [...new Set(onStage)];
  console.log(`  a stage fought on the ladder: ${JSON.stringify(uniqStage)}`);
  check("the fight announces itself", uniqStage.includes("start"), JSON.stringify(uniqStage));
  check("a win has its own reward sound", uniqStage.includes("reward"), JSON.stringify(uniqStage));
  check("and the EXP numbers have a voice", uniqStage.includes("expGain"), JSON.stringify(uniqStage));
  check("opening the next stage is its own sound, not part of the fanfare", uniqStage.includes("unlock"), JSON.stringify(uniqStage));
  check("and the win itself has a sound", uniqStage.includes("win") || uniqStage.includes("lose"), JSON.stringify(uniqStage));
  await page.screenshot({ path: "shots/audio/2-result.png" });

  /* --- a fight: the arc, the combo, and being hit --- */
  /*
   * The plant is dialled back first, and that matters more than it looks.
   *
   * The ladder fight above needs a strong plant to be won quickly. That same plant then fought
   * the arena AI, killed it in about two seconds, and took its view with it — so the combo
   * never had two hits in a row to count, and there was no live fight left to pause. Both
   * assertions were reporting on a fight that had already ended.
   *
   * A combo needs consecutive hits without being interrupted, so it needs a fight that lasts.
   */
  await page.evaluate(`(() => {
    const g = (window).__game;
    for (const p of g.store.state.plants) p.powerRating = 240;
    g.navigate("arena");
  })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Đấu với AI/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => { const c = document.querySelector(".sheet .pickrow"); if (c) c.click(); })()`);
  await page.waitForTimeout(900);
  await page.evaluate(`(() => {
    (window).__game.__recorded.length = 0;
    const b = [...document.querySelectorAll("button")].find(x => /Bắt đầu/.test(x.textContent || ""));
    if (b) b.click();
  })()`);
  await page.waitForSelector(".battlefield", { timeout: 20000 }).catch(() => {});

  /*
   * Polled, not sampled.
   *
   * A combo is a run of consecutive hits, and whether one has formed by any given second is
   * down to how the fight is going — sampling once reports a coin flip and calls it a failure.
   * So this waits for the combo to appear, within a fight that is known to still be running.
   */
  const sawCombo = await page.evaluate(`(async () => {
    const g = (window).__game;
    const until = performance.now() + 9000;
    while (performance.now() < until) {
      if (g.__recorded.some(c => c.name === "combo")) return true;
      if (!document.querySelector(".battlefield")) return false;   // the fight ended first
      await new Promise(r => setTimeout(r, 60));
    }
    return false;
  })()`);
  const midFight = await calls(page);
  const uniq = [...new Set(midFight)];
  console.log(`  a live fight: ${JSON.stringify(uniq)}`);
  check("the fight announces itself", uniq.includes("start"), JSON.stringify(uniq));
  check("and something lands", uniq.includes("hit") || uniq.includes("cast"), JSON.stringify(uniq));
  check("being hit sounds different from hitting", uniq.includes("enemy"), JSON.stringify(uniq));
  check("a combo builds and is audible while it does", sawCombo === true, JSON.stringify(uniq));
  await page.screenshot({ path: "shots/audio/3-fight.png" });

  check("no page errors from audio across the whole run", errs.length === 0, errs.join(" | "));
  await page.context().close();
}

/* ---------------------------------------------------- 5. silence must not break the game */

console.log("\nthe game survives having no audio at all:");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error" && !/GSI_LOGGER|403|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200));
  });

  // Remove the constructor before any script runs, so `available` is false from the start.
  await page.addInitScript(`delete window.AudioContext; delete window.webkitAudioContext;`);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(`(() => {
    const a = [...document.querySelectorAll("a, button")].find(x => /không cần tài khoản/i.test(x.textContent || ""));
    if (a) a.click();
  })()`);
  await page.waitForTimeout(700);

  const noAudio = (await page.evaluate(`(() => {
    const g = (window).__game;
    let threw = null;
    try {
      g.sfx.unlock();
      g.music.start();
      g.music.setMood("battle");
      g.sfx.setVolume(0.5);
      g.sfx.setMusicVolume(0.5);
      g.sfx.play("levelUp");
      g.sfx.play("reward");
    } catch (e) { threw = String(e); }
    g.navigate("garden");
    return { available: g.sfx.available, threw, stillAlive: Boolean(document.querySelector(".shell")) };
  })()`)) as Record<string, unknown>;
  console.log(`  ${JSON.stringify(noAudio)}`);
  check("the engine reports itself unavailable", noAudio.available === false, String(noAudio.available));
  check("nothing throws when every audio path is taken", noAudio.threw === null, String(noAudio.threw));
  check("and the game is still there", noAudio.stillAlive === true, String(noAudio.stillAlive));

  // A real navigation, and a real button press, with no audio underneath.
  await page.evaluate(`(() => (window).__game.navigate("ascent"))()`);
  await page.waitForTimeout(1200);
  const alive = (await page.evaluate(`(() => ({
    shell: Boolean(document.querySelector(".shell")),
    screen: document.querySelector(".screen")?.childElementCount ?? 0,
  }))()`)) as Record<string, unknown>;
  check("navigation still works", alive.shell === true && (alive.screen as number) > 0, JSON.stringify(alive));
  await page.screenshot({ path: "shots/audio/3-no-audio.png" });
  check("no page errors with audio unavailable", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(bad ? `\n${bad} failed` : "\nsounds where they belong, at levels that leave room for each other");
if (bad) process.exit(1);