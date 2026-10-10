/**
 * Battle simulation matrix — docs/34 §17.3 + §11.3.
 *
 * §17.3 demands at least 100 seeded battle simulations evaluated on the FULL
 * event log, not only the winner: deterministic sequences, exactly-one
 * settlement, replay compatibility, multiple seeds and matchups.
 *
 * §11.3 demands balance telemetry beyond win rate: time-to-kill, draw rate,
 * crowd-control chains and energy starvation. Same pass, one report block.
 *
 *   120 sims — 11-archetype benchmark roster round-robin × seeds × arenas
 *   invariants per fight — seq ordered, t monotonic, hp bounds, one
 *   BATTLE_FINISHED at the tail, DEATH only for the loser(s), nothing after
 *   determinism — 20 sims re-run produce byte-identical event logs
 *   settle once — exactly one terminal event per fight, winner consistent
 *   telemetry — TTK / draw% / CC chains / energy starvation distribution
 */

import { simulateBattle, type BattleResult, type ArenaKind } from "../src/battle/engine";
import { createBenchmarkPlant } from "../src/genetics/benchmarkRoster";
import { BENCHMARK_ROSTER } from "../src/config/balance";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (t: string) => console.log(`\n${t}`);

const ARENAS: ArenaKind[] = ["sunny", "moon", "indoor"];
const N = 120;

const plants = BENCHMARK_ROSTER.map((id) => createBenchmarkPlant(id, "bloom"));

const results: BattleResult[] = [];
for (let i = 0; i < N; i++) {
  const a = plants[i % plants.length];
  const b = plants[(i + 3) % plants.length];
  results.push(simulateBattle(a, b, { seed: `sim:${i}`, maxSeconds: 90, arena: ARENAS[i % 3] }));
}

/* ================================================================ */

section("§17.3 — full-log invariants across 120 seeded fights");
{
  /* `seq` is a namespaced ordinal (cast events start at 500000, energy at
     600000…) — the honest invariant is uniqueness plus monotonic `t`. */
  let seqUnique = 0, tMono = 0, hpBounded = 0, singleFinish = 0, finishIsTail = 0;
  let winnerConsistent = 0, deathConsistent = 0, textCoverage = 0, nothingAfter = 0;

  for (const r of results) {
    const ev = r.events;
    if (new Set(ev.map((e) => e.seq)).size === ev.length) seqUnique++;
    if (ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t)) tMono++;
    if (ev.every((e) => e.hpAfter === undefined || (e.hpAfter >= 0 && e.hpAfter <= 1000000))) hpBounded++;
    const finishes = ev.filter((e) => e.type === "BATTLE_FINISHED");
    if (finishes.length === 1) singleFinish++;
    if (finishes.length === 1 && ev[ev.length - 1].type === "BATTLE_FINISHED") finishIsTail++;
    if (finishes.length === 1 && finishes[0].winner === r.winner) winnerConsistent++;
    const deaths = ev.filter((e) => e.type === "DEATH");
    const ok = r.winner === "a" ? deaths.every((d) => d.side === "b")
      : r.winner === "b" ? deaths.every((d) => d.side === "a")
      : true; // draws may have 0 or 2 deaths depending on the timeout
    if (ok) deathConsistent++;
    /* The human log lives on the events: nearly every event carries a `text`
       line — a fight whose events can't be narrated isn't reviewable. */
    if (ev.filter((e) => typeof e.text === "string" && e.text.length > 0).length >= ev.length * 0.8) textCoverage++;
    if (ev.findIndex((e) => e.type === "BATTLE_FINISHED") === ev.length - 1) nothingAfter++;
  }

  check(`event seq unique — ${seqUnique}/120`, seqUnique === N, `${seqUnique}`);
  check(`timestamps monotonic — ${tMono}/120`, tMono === N, `${tMono}`);
  check(`hpAfter inside bounds — ${hpBounded}/120`, hpBounded === N, `${hpBounded}`);
  check(`exactly one BATTLE_FINISHED — ${singleFinish}/120`, singleFinish === N, `${singleFinish}`);
  check(`and it is the last event — ${finishIsTail}/120`, finishIsTail === N, `${finishIsTail}`);
  check(`event winner === result winner — ${winnerConsistent}/120`, winnerConsistent === N, `${winnerConsistent}`);
  check(`DEATH only on the losing side — ${deathConsistent}/120`, deathConsistent === N, `${deathConsistent}`);
  check(`≥80% of events carry a narratable line — ${textCoverage}/120`, textCoverage === N, `${textCoverage}`);
}

section("§17.3 — determinism: the same seed replays the same fight");
{
  let identical = 0;
  for (let i = 0; i < 20; i++) {
    const a = plants[i % plants.length];
    const b = plants[(i + 3) % plants.length];
    const cfg = { seed: `sim:${i}`, maxSeconds: 90, arena: ARENAS[i % 3] };
    const again = simulateBattle(a, b, cfg);
    if (JSON.stringify(again.events) === JSON.stringify(results[i].events)
      && again.winner === results[i].winner
      && JSON.stringify(again.log) === JSON.stringify(results[i].log)) identical++;
  }
  check(`20/20 re-runs produce byte-identical event logs`, identical === 20, `${identical}`);
}

section("§17.3 — stances still run through the one engine");
{
  const a = plants[0], b = plants[4];
  const stanced = simulateBattle(a, b, { seed: "sim:stance", maxSeconds: 90, arena: "sunny", stances: { a: "guard", b: "swift" } });
  const again = simulateBattle(a, b, { seed: "sim:stance", maxSeconds: 90, arena: "sunny", stances: { a: "guard", b: "swift" } });
  check("stanced fight is deterministic too", JSON.stringify(stanced.events) === JSON.stringify(again.events));
  check("and settles once", stanced.events.filter((e) => e.type === "BATTLE_FINISHED").length === 1);

  /* Regression: a stance coming off the wire used to reach STANCE_EFFECTS
     unchecked — "defensive" is a personality, not a stance, and crashed the
     engine mid-fight. Forged values now degrade to "aggressive". */
  const forged = simulateBattle(a, b, { seed: "sim:forged", maxSeconds: 90, arena: "sunny", stances: { a: "garbage" as never, b: "focus" } });
  check("a forged stance degrades instead of crashing", forged.events.some((e) => e.type === "BATTLE_FINISHED"),
    `finished=${forged.events.filter((e) => e.type === "BATTLE_FINISHED").length}`);
}

/* ================================================================ */

section("§11.3 — balance telemetry: TTK, draws, CC chains, energy starvation");
{
  const ttk = results.map((r) => r.durationSeconds).sort((x, y) => x - y);
  const draws = results.filter((r) => r.winner === "draw").length;
  const timeouts = results.filter((r) => r.timeouts).length;

  /* A CC chain: stretches where one side controls the other back-to-back
     (STATUS_APPLIED for a control kind while a previous control still had
     time left). Count chains ≥2 applications long. */
  let ccChains = 0;
  for (const r of results) {
    let streak = 0, inChain = false;
    for (const e of r.events) {
      if (e.type === "STATUS_APPLIED" && (e.status === "stun" || e.status === "root" || e.status === "slow")) {
        streak++;
        if (streak >= 2) inChain = true;
      } else if (e.type === "DEATH" || e.type === "BATTLE_FINISHED") {
        if (inChain) ccChains++;
        streak = 0; inChain = false;
      }
    }
    if (inChain) ccChains++;
  }

  /* Energy starvation: fights where the loser's peak energy never reached a
     single cast's worth — they died without ever answering a skill. */
  let starved = 0;
  for (const r of results) {
    const loser = r.winner === "a" ? r.b : r.winner === "b" ? r.a : null;
    if (loser && loser.skillUses === 0 && loser.energyPeak < 25) starved++;
  }

  const p50 = ttk[Math.floor(ttk.length * 0.5)];
  const p90 = ttk[Math.floor(ttk.length * 0.9)];
  const wins = results.filter((r) => r.winner !== "draw").length;
  console.log(`  TTK p50=${p50}s  p90=${p90}s  min=${ttk[0]}s  max=${ttk[ttk.length - 1]}s`);
  console.log(`  draws=${draws} (${(draws / N * 100).toFixed(0)}%)  timeouts=${timeouts}  decisive=${wins}`);
  console.log(`  CC chains (≥2 controls back-to-back): ${ccChains}/120 fights`);
  console.log(`  energy-starved losses (0 skills, peak<25): ${starved}/120`);

  /* Sanity assertions — these are telemetry floors, not tuning verdicts. A
     healthy matrix has decisive fights, bounded TTK, and few starved losses. */
  check("at least half the matrix is decisive", wins >= N * 0.5, `decisive=${wins}`);
  check("draws stay rare (≤30%)", draws <= N * 0.3, `draws=${draws}`);
  check("median TTK inside the 90s cap", p50 < 90, `p50=${p50}s`);
  check("no fight exceeds the cap in the log", ttk[ttk.length - 1] <= 91, `max=${ttk[ttk.length - 1]}s`);
  check("starved losses stay rare (≤20%)", starved <= N * 0.2, `starved=${starved}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
