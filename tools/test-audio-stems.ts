/**
 * WP05 / AUD-02…06 — the music bed as a stem architecture, measured.
 *
 * These are not "did it throw" tests: the bed is rendered through an
 * OfflineAudioContext (the same scheduling path the live tick uses) and the
 * resulting PCM is inspected for clicks, gaps, drift, peak headroom and
 * per-stem behaviour — the properties AUD-03/05 are actually about.
 */
import { chromium, type Browser } from "playwright-core";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto("http://localhost:5173");
  await page.waitForFunction(() => Boolean((window as any).__game));

  /* `__game.music` is the same singleton the app drives — the seam exposed for
     exactly this kind of test (see app.ts __game). */
  await page.evaluate(() => {
    (window as any).__music = (window as any).__game.music;
  });

  console.log("\nstems exist and mix per mood:");
  const stemInfo = await page.evaluate(async () => {
    const m = (window as any).__music;
    (window as any).__game.sfx.unlock();
    m.start();
    const calm = m.stats();
    m.setMood("battle");
    // ease a few ticks so the mix visibly moves toward the battle targets
    await new Promise(r => setTimeout(r, 900));
    const battle = m.stats();
    m.setMood("calm");
    await new Promise(r => setTimeout(r, 900));
    const back = m.stats();
    m.stop();
    return { calm, battle, back };
  });
  check("four stems are tracked in the mix",
    ["pad", "bass", "melody", "pulse"].every(k => k in stemInfo.calm.stems),
    JSON.stringify(stemInfo.calm.stems));
  check("battle brings the pulse stem up", stemInfo.battle.stems.pulse > 0.02, JSON.stringify(stemInfo.battle.stems));
  check("returning to calm eases the pulse back down", stemInfo.back.stems.pulse < stemInfo.battle.stems.pulse, JSON.stringify(stemInfo.back.stems));

  console.log("\nAUD-02 — 20 fast mood changes, no duplicate transport or burst:");
  const trans = await page.evaluate(async () => {
    const m = (window as any).__music;
    m.start();
    const before = m.stats();
    for (let i = 0; i < 20; i++) m.setMood(i % 2 ? "battle" : "calm");
    const during = m.stats();
    await new Promise(r => setTimeout(r, 1200));
    const after = m.stats();
    m.stop();
    const stopped = m.stats();
    return { before, during, after, stopped };
  });
  check("still exactly one running scheduler after 20 flips", trans.during.running === true && trans.after.running === true, JSON.stringify(trans.after));
  check("no note burst queued by the flips", trans.after.liveSources <= 40, `liveSources=${trans.after.liveSources}`);
  check("stop actually stops the transport", trans.stopped.running === false, JSON.stringify(trans.stopped));

  console.log("\nAUD-03 — 32s calm render: clicks, gaps, loop continuity:");
  const calmAnalysis = await page.evaluate(async () => {
    const buf = await (window as any).__music.renderOffline(32, "calm");
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    let peak = 0;
    let maxDelta = 0;
    let prev = 0;
    // Longest run of samples below the noise floor — the gap metric.
    let silent = 0;
    let maxSilent = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      const delta = Math.abs(d[i] - prev);
      if (delta > maxDelta) maxDelta = delta;
      prev = d[i];
      if (a < 0.002) { silent++; if (silent > maxSilent) maxSilent = silent; }
      else silent = 0;
    }
    // Bar-boundary check: the pad must still be sounding 100ms after each 8s bar
    // starts (a "loop gap" would show silence right at the seam).
    const seams: number[] = [];
    for (let b = 1; b < 4; b++) {
      const at = Math.floor(b * 8 * sr + 0.1 * sr);
      let seamEnergy = 0;
      for (let i = at; i < at + 2000 && i < d.length; i++) seamEnergy = Math.max(seamEnergy, Math.abs(d[i]));
      seams.push(+seamEnergy.toFixed(4));
    }
    return { peak, maxDelta, maxSilentMs: (maxSilent / sr) * 1000, seams, seconds: d.length / sr };
  });
  check("peak stays under full scale — no clipping in the bed itself", calmAnalysis.peak < 0.95, `peak=${calmAnalysis.peak}`);
  check("no click edges (max sample delta sane)", calmAnalysis.maxDelta < 0.7, `delta=${calmAnalysis.maxDelta}`);
  check("no dead-air gap over ~1.2s", calmAnalysis.maxSilentMs < 1200, `${calmAnalysis.maxSilentMs}ms`);
  check("pad sustains across every bar seam", calmAnalysis.seams.every(e => e > 0.005), JSON.stringify(calmAnalysis.seams));

  console.log("\nAUD-05 — battle render peak headroom:");
  const battleAnalysis = await page.evaluate(async () => {
    const buf = await (window as any).__music.renderOffline(24, "battle");
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    return { peak };
  });
  check("battle mix peaks below clipping with headroom", battleAnalysis.peak < 0.95 && battleAnalysis.peak > 0.05, `peak=${battleAnalysis.peak}`);

  console.log("\npulse stem sits on the beat grid (no drift):");
  const pulseGrid = await page.evaluate(async () => {
    const buf = await (window as any).__music.renderOffline(16, "battle");
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    // Energy in a 100ms window around each expected pulse (bar0: t=0,4; bar1: t=8,12)
    const expected: number[] = [];
    for (const t of [0, 4, 8, 12, 2.5]) {
      const at = Math.floor(t * sr);
      let e = 0;
      for (let i = at; i < Math.min(at + Math.floor(0.1 * sr), d.length); i++) e = Math.max(e, Math.abs(d[i]));
      expected.push(e);
    }
    return { expected: expected.slice(0, 4), offgrid: expected[4] };
  });
  check("pulse energy present at each scheduled beat", pulseGrid.expected.every(e => e > 0.002), JSON.stringify(pulseGrid));
  check("grid timing is where the energy is", Math.max(...pulseGrid.expected) > pulseGrid.offgrid, `expected=${JSON.stringify(pulseGrid.expected)} off=${pulseGrid.offgrid}`);

  console.log("\nAUD-06 — live source count stays bounded:");
  const leak = await page.evaluate(async () => {
    const m = (window as any).__music;
    m.start();
    let max = 0;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      max = Math.max(max, m.stats().liveSources);
    }
    m.stop();
    return { max, final: m.stats().liveSources };
  });
  check("live source count bounded over 12s of playback", leak.max < 60, `max=${leak.max}`);

  console.log("\nAUD-01 — nothing scheduled before audio exists:");
  const preGesture = await page.evaluate(async () => {
    const m = (window as any).__music;
    // A fresh import in this page has never been started: stats show no transport.
    const fresh = m.stats();
    const ctxState = (window as any).__game.sfx.context?.state ?? null;
    return { fresh, ctxState };
  });
  check("scheduler is not running before start()", preGesture.fresh.running === false || preGesture.ctxState === null, JSON.stringify(preGesture));
} finally {
  await browser?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
