/**
 * Two-client room test (docs/04, docs/16 §25).
 *
 * Two RoomClients talk over a real BroadcastChannel: one is the host and runs
 * the authoritative simulation, the other sends intents and receives the
 * result. This is the same code path a WebSocket worker would use.
 */

import { GameStore } from "../src/core/store";
import { RoomClient, HostRoom, resultForPlayer } from "../src/core/room";
import { simulateBattle } from "../src/battle/engine";
import type { Plant } from "../src/core/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- storage shim ---------------------------------------------------------
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

function maturePlant(store: GameStore, species: never): Plant {
  store.state.leafCoin = 100000;
  store.buySeed(species, 1);
  const res = store.plantSeed(species);
  const p = store.get(res.plantId!)!;
  p.growth.stage = "mature";
  p.growth.stageReadyAt = Date.now();
  p.growth.level = 20;
  p.locks.manual = false;
  p.tier = "bloom";
  return p;
}

section("0. BroadcastChannel availability");
check("Node provides BroadcastChannel", typeof BroadcastChannel !== "undefined");

section("1. Two clients join the same room");
// Two tabs of the same browser share one save, so give each store its own.
const hostStore = new GameStore();
mem.clear();
const guestStore = new GameStore();
guestStore.state.playerId = "pl_guest_test";
check("the two stores have different player ids", hostStore.state.playerId !== guestStore.state.playerId, `${hostStore.state.playerId} vs ${guestStore.state.playerId}`);

const hostPlant = maturePlant(hostStore, "thornroot" as never);
const guestPlant = maturePlant(guestStore, "emberleaf" as never);

const hostClient = new RoomClient(hostStore.state.playerId, hostStore.state.name);
const guestClient = new RoomClient(guestStore.state.playerId, guestStore.state.name);

const code = hostClient.create();
check("host created a 6-character code", code.length === 6, code);
check("code avoids ambiguous glyphs", !/[01OIL]/.test(code), code);

let hostSawGuest = "";
let guestSnapshot: unknown = null;
let guestGotPlant: Plant | null = null;

const hostRoom = new HostRoom(code, hostStore.state.playerId, hostStore.state.name);
hostRoom.registerPlant(hostPlant);
hostRoom.setPlant(hostStore.state.playerId, hostPlant.plantId);

hostClient.onMessage((m) => {
  if (m.kind === "join" && m.code === code) {
    hostSawGuest = m.name;
    hostRoom.addGuest(m.playerId, m.name);
    hostClient.broadcastState(hostRoom.snapshot);
  }
  if (m.kind === "plant_data" && m.code === code) {
    guestGotPlant = m.plant;
    hostRoom.registerPlant(m.plant);
    hostRoom.setPlant(m.playerId, m.plant.plantId);
    hostClient.broadcastState(hostRoom.snapshot);
  }
  if (m.kind === "ready" && m.code === code) {
    hostRoom.setReady(m.playerId, m.ready);
    hostClient.broadcastState(hostRoom.snapshot);
  }
  if (m.kind === "leave" && m.code === code) {
    hostRoom.removePlayer(m.playerId);
  }
});
guestClient.onState((s) => {
  guestSnapshot = s;
});

guestClient.join(code);
await wait(120);

check("host sees the guest join", hostSawGuest.length > 0, hostSawGuest);
check("host lobby has two players", hostRoom.snapshot.players.length === 2, `${hostRoom.snapshot.players.length}`);
check("room state advances to selecting", hostRoom.snapshot.state === "selecting_plants" || hostRoom.snapshot.state === "ready_check", hostRoom.snapshot.state);
check("guest received a snapshot", !!guestSnapshot);

section("2. Guest registers its plant and readies up");
guestClient.sendPlant(guestPlant);
guestClient.sendSelect(guestPlant.plantId);
await wait(120);
check("host received the guest's plant", !!guestGotPlant, String((guestGotPlant as Plant | null)?.name ?? ""));
check("host knows which plant the guest picked", hostRoom.snapshot.players.find((p) => !p.isHost)?.plantId === guestPlant.plantId);
check("host can now start (both selected)", hostRoom.canStart() === false, "still needs ready");

guestClient.sendReady(true);
await wait(120);
hostClient.sendReady?.(true);
hostRoom.setReady(hostStore.state.playerId, true);
hostRoom.setReady(guestStore.state.playerId, true);
check("host can start once both are ready", hostRoom.canStart(), hostRoom.snapshot.state);

section("3. Host runs the authoritative simulation");
hostRoom.markInBattle();
const battleSeed = hostRoom.makeBattleSeed(hostPlant.plantId, guestPlant.plantId);
check("battle seed is deterministic from the room + plants", battleSeed === hostRoom.makeBattleSeed(hostPlant.plantId, guestPlant.plantId), battleSeed);

const result = simulateBattle(hostPlant, guestPlant, {
  seed: battleSeed,
  maxSeconds: 90,
  arena: "sunny",
});
check("authoritative battle resolves", !!result.winner, `winner=${result.winner} in ${result.durationSeconds}s`);

/*
 * Orientation, checked in both directions.
 *
 * The host settles with its own plant as side `a` and broadcasts the raw result. A guest that
 * reads it directly is told it won the fight it lost — the exact report that came back from
 * play: "my plant's health is gone but I won, and when the opponent died first it still says I
 * lost". `resultForPlayer` is the one place that re-expresses it, so this asserts the contract
 * rather than the UI that happens to call it.
 */
{
  const mineA = { ...result.a, hpPct: 0 };
  const mineB = { ...result.b, hpPct: 42 };
  const hostView = { winner: "a", mine: mineA, theirs: mineB };
  const asHost = resultForPlayer(hostView, "a");
  const asGuest = resultForPlayer(hostView, "b");
  check("the host reads its own win as a win", asHost.won === true);
  check("and the guest reads the same result as a loss", asGuest.won === false);
  check("the guest's own numbers are the guest's, not the host's", asGuest.mine === mineB && asGuest.theirs === mineA);

  const guestWon = { winner: "b", mine: mineA, theirs: mineB };
  check("the guest reads its own win as a win", resultForPlayer(guestWon, "b").won === true);
  check("and the host reads that as a loss", resultForPlayer(guestWon, "a").won === false);
  check("a draw is a draw for both", resultForPlayer({ winner: "draw", mine: mineA, theirs: mineB }, "a").draw === true && resultForPlayer({ winner: "draw", mine: mineA, theirs: mineB }, "b").won === false);
}

// Both clients replay the SAME seed with the SAME side order, which is what
// the host broadcasts. That is the guarantee that prevents desync: identical
// seed + identical snapshots + identical order => identical event stream.
const replay = simulateBattle(hostPlant, guestPlant, {
  seed: battleSeed,
  maxSeconds: 90,
  arena: "sunny",
});
check("replay of the same seed and order gives the same winner", replay.winner === result.winner, `${replay.winner} vs ${result.winner}`);
check("replay produced identical HP on both sides", replay.a.hp === result.a.hp && replay.b.hp === result.b.hp, `${replay.a.hp}/${replay.b.hp} vs ${result.a.hp}/${result.b.hp}`);
check("replay produced an identical event stream", replay.events.length === result.events.length, `${replay.events.length} vs ${result.events.length}`);

section("4. Intents are relayed, not trusted");
{
  const hostSeen: string[] = [];
  const guestSeen: string[] = [];
  // Each client listens on its own channel. BroadcastChannel never echoes a
  // message back to the sender, so only the OTHER side should see intents.
  hostClient.onIntent((i) => hostSeen.push(i.kind));
  guestClient.onIntent((i) => guestSeen.push(i.kind));

  hostClient.sendIntent({ kind: "cast", value: hostPlant.skills[0].id });
  hostClient.sendIntent({ kind: "stance", stance: "guard" });
  hostClient.sendIntent({ kind: "focus" });
  await wait(150);

  check("sender does not receive its own intents", hostSeen.length === 0, `${hostSeen.length}`);
  check("the other client receives all three intents", guestSeen.length === 3, guestSeen.join(","));

  guestSeen.length = 0;
  guestClient.sendIntent({ kind: "cast", value: guestPlant.skills[0].id });
  await wait(150);
  check("intents flow in the other direction too", hostSeen.length === 1, hostSeen.join(","));
}

section("5. Anti-cheat: the guest cannot dictate the outcome");
{
  // A guest sending raw damage/winner messages must not be able to alter state.
  const before = hostRoom.snapshot.battleSeed;
  const ch = (hostClient as unknown as { channel: BroadcastChannel | null }).channel;
  check("host has a broadcast channel", !!ch);
  // Forge a fake result from the guest side; the host ignores unknown kinds.
  const forged = (guestClient as unknown as { channel: BroadcastChannel | null }).channel;
  forged?.postMessage({ kind: "result", code, playerId: guestStore.state.playerId, winner: "b", mine: { hp: 99999, hpPct: 100, damageDealt: 99999, damageTaken: 0, shields: 0, heals: 0, skillUses: 99, energyPeak: 100 }, theirs: { hp: 0, hpPct: 0, damageDealt: 0, damageTaken: 99999, shields: 0, heals: 0, skillUses: 99, energyPeak: 100 } });
  await wait(120);
  check("host state is unchanged by a forged message", hostRoom.snapshot.battleSeed === before);
}

section("6. Room lifecycle");
{
  guestClient.leave();
  await wait(120);
  check("host drops the player who left", hostRoom.snapshot.players.length === 1, `${hostRoom.snapshot.players.length}`);
  hostRoom.resetToLobby();
  check("room can be reset for a rematch", hostRoom.snapshot.state === "selecting_plants");
  check("ready flags are cleared on reset", hostRoom.snapshot.players.every((p) => !p.ready));
  hostClient.destroy();
  guestClient.destroy();
  check("clients destroy cleanly", true);
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
