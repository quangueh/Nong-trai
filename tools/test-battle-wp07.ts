/**
 * WP07 / BAT-01…05 — battle settle + replay contracts, domain level.
 *
 * The rule this suite enforces: the store settles once, returns a seed and a
 * pre-settle fighter snapshot, and the view replays *that* — two fights can
 * never disagree, and a cleared stage can never pay twice.
 */
import { GameStore } from "../src/core/store";
import { SPECIES } from "../src/config/species";
import { simulateBattle } from "../src/battle/engine";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, String(v)),
    removeItem: (k: string) => memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  },
});

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function fresh(): GameStore {
  memory.clear();
  const s = new GameStore();
  s.state.plants = [];
  return s;
}

/** One mature plant strong enough to actually pass a stage-1 power floor. */
function fighter(s: GameStore, power = 900): string {
  s.state.seeds[SPECIES[0].id] = 1;
  s.plantSeed(SPECIES[0].id);
  const p = s.state.plants[0];
  p.growth.stage = "mature";
  p.growth.stageReadyAt = Date.now();
  p.growth.level = 30;
  p.locks.manual = false;
  p.powerRating = power;
  p.stats.hp = 4000;
  p.stats.attack = 400; p.stats.defense = 300;
  p.stats.speed = 320; p.stats.skillPower = 250;
  return p.plantId;
}

console.log("\nBAT-01 — same seed + same snapshot => identical full log:");
{
  const s = fresh();
  const id = fighter(s);
  const res = s.runAscentStage(id, 1);
  check("stage 1 settles", res.ok === true, res.reason);
  /* Replay the settle's own inputs: the returned seed and the returned fighter
     snapshot — the same pair the screen's BattleView is given. */
  const replay = simulateBattle(res.replayAs!, res.monster!.plant, {
    seed: res.seed!, maxSeconds: 90, arena: "sunny",
  });
  check("replayed log matches the settled log event-for-event",
    JSON.stringify(replay.events) === JSON.stringify(res.result!.events),
    `${replay.events.length} vs ${res.result!.events.length} events`);
  check("replayed winner matches the settled winner", replay.winner === res.result!.winner);
  check("replayAs is a frozen copy, not the live plant", res.replayAs !== s.get(id));
}

console.log("\nBAT-02 — a cleared stage can never pay twice:");
{
  const s = fresh();
  const id = fighter(s);
  const r1 = s.runAscentStage(id, 1);
  check("first run wins or at least settles", r1.ok === true, r1.reason);
  const wins = r1.won === true;
  if (wins) {
    const coins = s.state.leafCoin;
    const ledgerCount = s.state.ledger.filter(l => /Vượt ải 1/.test(l.reason)).length;
    const r2 = s.runAscentStage(id, 1);
    check("re-running a cleared stage refuses", r2.ok === false && /đã vượt/.test(r2.reason ?? ""), r2.reason);
    check("no second stage reward line exists", s.state.ledger.filter(l => /Vượt ải 1/.test(l.reason)).length === ledgerCount);
    check("balance unchanged by the refused re-run", s.state.leafCoin === coins);
  } else {
    check("loss keeps the stage open (attempt counted)", s.runAscentStage(id, 1).ok === true);
  }
}

console.log("\nBAT-02 — reward lines are written exactly once per settle:");
{
  const s = fresh();
  const id = fighter(s);
  const battles = s.state.discovery.battles;
  s.runAscentStage(id, 1);
  check("battle counter moves once", s.state.discovery.battles === battles + 1, String(s.state.discovery.battles));
  check("win or loss recorded exactly once on the fighter",
    (s.get(id)!.battleRecord.wins + s.get(id)!.battleRecord.losses) === 1,
    JSON.stringify(s.get(id)!.battleRecord));
}

console.log("\nBAT-02/05 — replayAs freezes pre-settle stats; payout can't rewrite the fight:");
{
  const s = fresh();
  const id = fighter(s);
  const before = { level: s.get(id)!.growth.level, xp: s.get(id)!.growth.xp };
  const res = s.runAscentStage(id, 1);
  const live = s.get(id)!;
  check("settle moved plant XP/level on the live plant",
    live.growth.level !== before.level || live.growth.xp !== before.xp,
    `${JSON.stringify(before)}→${live.growth.level}/${live.growth.xp}`);
  check("replayAs kept the pre-settle level", res.replayAs!.growth.level === before.level && res.replayAs!.growth.xp === before.xp,
    `replayAs=${res.replayAs!.growth.level}/${res.replayAs!.growth.xp}`);
}

console.log("\nBAT-02 — a loss still settles once, then allows the next attempt:");
{
  const s = fresh();
  fighter(s, 40); // deliberately under the stage floor? floor is ~38 for stage 1 — use high stage
  const strong = fighter(s, 900);
  /* Push the ladder with the strong plant to stage 2, then fight stage 3 with
     something that cannot win — attempts must count, not clear. */
  s.runAscentStage(strong, 1);
  const weakId = fighter(s, 250);
  /* `fighter()` gives a strong body regardless of the powerRating argument —
     a weak entrant needs weak stats too, or it wins the fight it was meant to
     lose and the attempts counter never gets exercised. */
  const weak = s.get(weakId)!;
  weak.stats.hp = 60;
  weak.stats.attack = 8; weak.stats.defense = 5;
  weak.stats.speed = 8; weak.stats.skillPower = 5;
  const r = s.runAscentStage(weakId, 2);
  if (r.ok && r.won === false) {
    const attempts = s.state.ascent.attempts;
    check("loss increments attempts exactly once", attempts === 1, String(attempts));
  } else {
    check("a weak fighter either refuses cleanly or loses once", r.ok === false || r.won === false, JSON.stringify(r));
  }
}

console.log("\nBAT-05 — settle ordering: rewards land before the replay exists:");
{
  const s = fresh();
  const id = fighter(s);
  const res = s.runAscentStage(id, 1);
  check("ledger already holds the reward when the receipt returns",
    s.state.ledger.some(l => /ải 1/.test(l.reason)), JSON.stringify(s.state.ledger.map(l => l.reason)));
  check("settling flag unwound — notices may flow again", (s as unknown as { settling: number }).settling === 0);
  check("receipt carries everything the screen needs to replay",
    !!res.result && !!res.seed && !!res.replayAs && !!res.monster && !!res.reward);
}

console.log("\nBAT-05 — gate failures move nothing:");
{
  const s = fresh();
  s.state.seeds[SPECIES[0].id] = 1;
  s.plantSeed(SPECIES[0].id);
  const baby = s.state.plants[0];
  baby.growth.stage = "young";
  const c = s.state.leafCoin;
  const r1 = s.runAscentStage(baby.plantId, 1);
  check("immature fighter refuses", r1.ok === false && /trưởng thành/.test(r1.reason ?? ""), r1.reason);
  const strong = fighter(s);
  const r2 = s.runAscentStage(strong, 9);
  check("closed stage refuses", r2.ok === false && /chưa mở/.test(r2.reason ?? ""), r2.reason);
  check("nothing was charged or settled", s.state.leafCoin === c && s.state.discovery.battles === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
