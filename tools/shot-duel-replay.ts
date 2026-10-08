import { chromium } from "playwright-core";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1180, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERR", String(e)));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean((window as any).__game), { timeout: 15000 });
// Determinism probe: simulate with a fixed seed, then replay via a fresh session
// with the same seed — winner + event count must be identical.
const verdict = await page.evaluate(`(async () => {
  const { SPECIES } = await import("/src/config/species.ts");
  const { createSeedPlant } = await import("/src/genetics/genomeGenerator.ts");
  const { Rng, seedToken } = await import("/src/core/rng.ts");
  const { simulateBattle, BattleSession } = await import("/src/battle/engine.ts");
  const rng = new Rng("probe:duel");
  const mk = (id) => { const p = createSeedPlant(id, "x", seedToken(rng.next()), 0); p.growth.stage = "mature"; p.growth.level = 25; return p; };
  const A = mk(SPECIES[10].id), B = mk(SPECIES[200].id);
  const cfg = { seed: "duel:test:1", maxSeconds: 90, arena: "sunny", stances: { a: "aggressive", b: "aggressive" } };
  const r1 = simulateBattle(A, B, cfg);
  const s2 = new BattleSession(A, B, cfg);
  while (!s2.done) s2.step();
  const r2 = s2.summary();
  return { w1: r1.winner, w2: r2.winner, e1: r1.events.length, e2: r2.events.length };
})()`);
console.log("determinism:", JSON.stringify(verdict));
await b.close();
