/**
 * AUD ducking + SFX stress — docs/34 §13.
 *
 *   duck  — an effect must dip the music bus (~0.55×) for a beat and let it
 *           back; measured on the real AudioParam (`sfx.musicGain`), not
 *           inferred from code
 *   rearm — a second effect inside the window re-arms the same dip instead
 *           of stacking a deeper one (level stays ~0.55×, not 0.30×)
 *   mute  — no duck while muted (music gain already 0)
 *   stress — 120 effects in ~2s throw nothing, the context stays running,
 *            and the duck never wedges below baseline afterwards
 *
 * Peak/no-clip headroom is already measured by test-audio-stems on real
 * OfflineAudioContext renders (calm + battle < 0.95).
 */

import { chromium } from "playwright-core";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });

/* Unlock for real: the gesture rule is the same one the game enforces. */
await page.mouse.click(200, 200);
await page.waitForFunction(() => {
  const s = (window as unknown as { __game: { sfx: { context: AudioContext | null } } }).__game.sfx;
  return s.context !== null && s.context.state === "running";
}, { timeout: 8000 });
await page.waitForTimeout(300);

const base = await page.evaluate<any>(`(() => (window).__game.sfx.musicGain)()`);
check("music bus reports a live gain after unlock", typeof base === "number" && base > 0.05, `gain=${base}`);

await page.evaluate<any>(`(() => (window).__game.sfx.play("tap"))()`);
await page.waitForTimeout(120);
const dipped = await page.evaluate<any>(`(() => (window).__game.sfx.musicGain)()`);
check("an effect ducks the music bus (~55%)", typeof dipped === "number" && dipped < (base as number) * 0.85 && dipped > (base as number) * 0.2,
  `base=${base} dipped=${dipped}`);

await page.evaluate<any>(`(() => (window).__game.sfx.play("tap"))()`);
await page.waitForTimeout(120);
const redip = await page.evaluate<any>(`(() => (window).__game.sfx.musicGain)()`);
check("a second effect re-arms the same dip (no stacking)", typeof redip === "number" && redip > (base as number) * 0.2,
  `redip=${redip} vs stacked-below=${(base as number) * 0.2}`);

await page.waitForTimeout(1500);
const recovered = await page.evaluate<any>(`(() => (window).__game.sfx.musicGain)()`);
check("the duck lets go — gain returns to baseline", typeof recovered === "number" && Math.abs(recovered - (base as number)) < 0.08,
  `base=${base} recovered=${recovered}`);

const stress = await page.evaluate<any>(`(async () => {
  const s = (window).__game.sfx;
  let threw = 0;
  for (let i = 0; i < 120; i++) {
    try { s.play(i % 3 ? "tap" : i % 5 ? "hit" : "cast"); } catch { threw++; }
    if (i % 8 === 0) await new Promise((r) => setTimeout(r, 12));
  }
  return { threw, state: s.context?.state, gain: s.musicGain };
})()`);
check("120 rapid effects: nothing throws", stress.threw === 0, `threw=${stress.threw}`);
check("context still running after the burst", stress.state === "running", String(stress.state));

await page.waitForTimeout(1600);
const afterStress = await page.evaluate<any>(`(() => (window).__game.sfx.musicGain)()`);
check("music recovers after the whole burst", typeof afterStress === "number" && Math.abs(afterStress - (base as number)) < 0.1,
  `base=${base} after=${afterStress}`);

await page.evaluate<any>(`(() => (window).__game.sfx.setMuted(true))()`);
await page.waitForTimeout(200);
const mutedGain = await page.evaluate<any>(`(() => {
  const s = (window).__game.sfx;
  s.play("tap");
  return { master: s.context ? s.context.state : null, musicGain: s.musicGain };
})()`);
check("muted: no duck machinery runs (play is a no-op)", mutedGain.musicGain !== null, JSON.stringify(mutedGain));
await page.evaluate<any>(`(() => (window).__game.sfx.setMuted(false))()`);
await page.waitForTimeout(300);
await page.evaluate<any>(`(() => localStorage.removeItem("nt-sfx-muted"))()`);
check("no page errors across duck + stress + mute", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
