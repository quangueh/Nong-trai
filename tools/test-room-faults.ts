/**
 * F07 — room network-fault harness (docs/34 §3, §15, §16).
 *
 * Two real `RoomClient`s talk through a fault-injecting wire whose backend is
 * the *real* `routeRoom` worker handler against a fake KV — nothing in the
 * client's own logic is mocked and no real Worker is touched. BroadcastChannel
 * is stubbed out for the remote-path sections so delivery can only happen via
 * the relay; it is restored for the section that proves the local wire is
 * unaffected by a dead relay.
 *
 * Faults injected (the shapes the spec calls a gate of its own):
 *   reconnect — guest join dropped → the reannounce loop lands it remotely
 *   duplicate — poll replays rows twice → seenKeys dispatches each once
 *   out-of-order — mailbox rows shuffled → no message lost
 *   timeout/500 — relay down → local wire works, remote heals on recovery
 *   delay — send is fire-and-forget: publish never blocks on the wire
 *   worker-side — malformed/oversize/full-room/reset-boundary contracts
 */

import { RoomClient, type RoomMessage, type RoomSnapshot } from "../src/core/room";
import { routeRoom, type RoomKvEnv } from "../worker/src/room";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (t: string) => console.log(`\n${t}`);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------- no socket, controlled wires */

const RealBC = globalThis.BroadcastChannel;
(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = undefined;
(globalThis as unknown as { WebSocket: unknown }).WebSocket = undefined;

/* ------------------------------------------------ fake KV (worker binding) */

class FakeKv {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async put(k: string, v: string) { this.store.set(k, v); }
  async delete(k: string) { this.store.delete(k); }
  async list(opts: { prefix: string }) {
    const keys = [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).sort();
    return { keys: keys.map((name) => ({ name })) };
  }
}
const kv = new FakeKv();
const env: RoomKvEnv = { DB: kv };

/* --------------------------------------------------- the fault-injecting wire */

type WireMode = "normal" | "fail500" | "slow" | "dupe" | "reorder";

const wire = {
  mode: "normal" as WireMode,
  delayMs: 600,
  calls: 0,
  /** Drop the next N requests matching this predicate — a join that never arrives. */
  dropMatching: null as null | ((body: { msg?: { kind?: string } }) => boolean),
  dropCount: 0,
};

const RELAY = "https://fake-relay.test";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (!url.startsWith(`${RELAY}/api/room`)) return realFetch(input as never, init);
  wire.calls++;
  const body = (init?.body ? JSON.parse(String(init.body)) : {}) as { action?: string; msg?: { kind?: string } };
  if (wire.dropMatching && wire.dropCount > 0 && wire.dropMatching(body)) {
    wire.dropCount--;
    await wait(20);
    throw new TypeError("network drop (injected)");
  }
  if (wire.mode === "fail500") return new Response("injected", { status: 500 });
  if (wire.mode === "slow") await wait(wire.delayMs);

  const req = new Request(url, { method: init?.method ?? "GET", body: init?.body as BodyInit, headers: init?.headers });
  const res = await routeRoom(req, env);

  if (body.action === "poll" && res.ok && (wire.mode === "dupe" || wire.mode === "reorder")) {
    const json = (await res.json()) as { msgs?: { k: string; m: RoomMessage }[] };
    let msgs = json.msgs ?? [];
    if (wire.mode === "dupe") msgs = [...msgs, ...msgs];
    else msgs = [...msgs].reverse();
    return Response.json({ msgs });
  }
  return res;
}) as typeof fetch;

/* --------------------------------------------------------------- helpers */

const client = (id: string, name: string) => new RoomClient(id, name, { relay: RELAY, pollMs: 50 });
const roomMsgs = (code: string) =>
  [...kv.store.entries()]
    .filter(([k]) => k.startsWith(`room:${code}:m:`))
    .map(([k, v]) => ({ k, m: JSON.parse(v) as RoomMessage }));

const snap = (players: RoomSnapshot["players"] = []): RoomSnapshot => ({
  code: "XXXXXX", state: "in_battle", hostId: "host-1",
  players, battleSeed: null, battleNo: 1, countdownAt: null, plants: {},
});

async function until(fn: () => boolean, ms = 5000, step = 40): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(step);
  }
  return fn();
}

const post = (code: string, action: string, extra: object = {}) =>
  routeRoom(new Request(`${RELAY}/api/room`, { method: "POST", body: JSON.stringify({ action, code, ...extra }) }), env);

/* ===================================================================== */

section("worker contracts — malformed inputs fail, never crash");
{
  const unp = await routeRoom(new Request(`${RELAY}/api/room`, { method: "POST", body: "not json" }), env);
  check("unparseable body fails clean", unp.status === 400 && (await unp.json() as { error?: string }).error === "bad_code");
  const bc = await post("A!", "send", { msg: {} });
  check("bad code refused", (await bc.json() as { error?: string }).error === "bad_code");
  const ua = await post("ABCDEF", "hack");
  check("unknown action refused", (await ua.json() as { error?: string }).error === "unknown_action");
  const noMsg = await post("ABCDEF", "send");
  check("send without msg refused", (await noMsg.json() as { error?: string }).error === "bad_msg");
}

section("worker contracts — oversize and full-room limits");
{
  const big = await post("BVGMES", "send", { msg: { pad: "x".repeat(40_000) } });
  const bigJ = await big.json() as { error?: string };
  check("oversize message refused 413", big.status === 413 && bigJ.error === "too_big", `status=${big.status}`);

  for (let i = 0; i < 240; i++) await post("FUMMRM", "send", { msg: { i } });
  const full = await post("FUMMRM", "send", { msg: { over: true } });
  const fullJ = await full.json() as { error?: string };
  check("241st message refused room_full/429", full.status === 429 && fullJ.error === "room_full", `status=${full.status}`);
}

section("worker contracts — poll cursor and atomic reset boundary");
{
  await post("CURSER", "send", { msg: { kind: "create" } });
  const first = await (await post("CURSER", "poll", { afterTs: 0 })).json() as { msgs: { k: string }[] };
  const second = await (await post("CURSER", "poll", { afterTs: Date.now() + 60_000 })).json() as { msgs: unknown[] };
  check("poll returns rows after the cursor", first.msgs.length >= 1);
  check("and none before it", second.msgs.length === 0);

  /* The ordering fix: a join written before a create-marker reset is stale by
     definition; a join after survives — only someone holding the code could
     have sent it. */
  await post("RESET2", "send", { msg: { kind: "join", playerId: "stale-joiner" } });
  await post("RESET2", "reset", { msg: { kind: "create", hostId: "h" } });
  const afterReset = await (await post("RESET2", "poll", { afterTs: 0 })).json() as { msgs: { m: { kind: string } }[] };
  check("reset wipes the stale join, keeps the marker",
    afterReset.msgs.length === 1 && afterReset.msgs[0].m.kind === "create",
    `msgs=${afterReset.msgs.map((m) => m.m.kind).join(",")}`);
  await post("RESET2", "send", { msg: { kind: "join", playerId: "fresh-joiner" } });
  const afterJoin = await (await post("RESET2", "poll", { afterTs: 0 })).json() as { msgs: { m: { kind: string } }[] };
  check("a join sent after the reset boundary survives", afterJoin.msgs.some((m) => m.m.kind === "join"),
    `msgs=${afterJoin.msgs.map((m) => m.m.kind).join(",")}`);
}

/* --------------------------------------------------------- client+wire faults */

section("F07 — dropped first join: the reannounce loop lands it remotely");
{
  wire.dropMatching = (b) => b.msg?.kind === "join";
  wire.dropCount = 1;
  const h = client("host-1", "Chủ");
  const g = client("guest-1", "Khách");
  const code = h.create();
  g.join(code);
  /* BroadcastChannel is stubbed: the join can only land in KV via a retried
     relay send — the reannounce loop republishes every 4th poll (~200ms). */
  const landed = await until(() => roomMsgs(code).some((r) => r.m.kind === "join"), 4000);
  check("join reached the remote mailbox despite the dropped announce", landed === true,
    `kv joins=${roomMsgs(code).filter((r) => r.m.kind === "join").length}`);
  h.leave(); g.leave();
}

section("F07 — duplicated poll rows dispatch each message once");
{
  const h = client("host-1", "Chủ");
  const g = client("guest-1", "Khách");
  const states: RoomSnapshot[] = [];
  g.onState((s) => states.push(s));
  const code = h.create();
  g.join(code);
  await until(() => roomMsgs(code).some((r) => r.m.kind === "join"), 3000);
  wire.mode = "dupe";
  h.broadcastState(snap());
  await until(() => states.length >= 1, 4000);
  /* Let several more polls replay the same row inside the skew window — the
     key-set dedupe must still hold the count at exactly one. */
  await wait(400);
  check("one state broadcast dispatches exactly once under duped rows", states.length === 1, `states=${states.length}`);
  h.leave(); g.leave();
  wire.mode = "normal";
}

section("F07 — out-of-order rows: the cursor is a key-set, not a sequence");
{
  const h = client("host-1", "Chủ");
  const g = client("guest-1", "Khách");
  const states: RoomSnapshot[] = [];
  g.onState((s) => states.push(s));
  const code = h.create();
  g.join(code);
  await until(() => roomMsgs(code).length >= 1, 3000);
  wire.mode = "reorder";
  for (let i = 0; i < 3; i++) h.broadcastState(snap());
  const got = await until(() => states.length >= 3, 4000);
  check("every shuffled mailbox row still arrived", got === true, `states=${states.length}`);
  h.leave(); g.leave();
  wire.mode = "normal";
}

section("F07 — relay 500s: local wire unaffected, remote heals itself");
{
  (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = RealBC;
  const h = client("host-1", "Chủ");
  const g = client("guest-1", "Khách");
  const hostJoins: RoomMessage[] = [];
  h.onMessage((m) => { if (m.kind === "join") hostJoins.push(m); });
  const code = h.create();
  wire.mode = "fail500";
  const callsBefore = wire.calls;
  g.join(code);
  /* BroadcastChannel is real here: the same-browser join lands instantly even
     while every relay request 500s. */
  const localOk = await until(() => hostJoins.length >= 1, 2000);
  check("local wire delivers while the relay is dead", localOk === true);
  await wait(300);
  check("client keeps retrying the dead relay without crashing", wire.calls > callsBefore, `calls=${wire.calls - callsBefore}`);

  /* Heal the relay — a state broadcast must now reach the guest remotely too:
     the guest also sees it via BroadcastChannel, so assert on the KV row. */
  const guestStates: RoomSnapshot[] = [];
  g.onState((s) => guestStates.push(s));
  wire.mode = "normal";
  h.broadcastState(snap());
  const healed = await until(() => guestStates.length >= 1, 4000);
  const inKv = await until(() => roomMsgs(code).some((r) => r.m.kind === "state"), 2000);
  check("remote delivery resumes after the relay recovers", healed === true && inKv === true);
  h.leave(); g.leave();
  (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = undefined;
}

section("F07 — slow wire: publish never blocks on the network");
{
  wire.mode = "slow";
  const h = client("host-1", "Chủ");
  h.create();
  const t0 = Date.now();
  h.broadcastState(snap());
  const elapsed = Date.now() - t0;
  check("send returns immediately on a 600ms wire (fire-and-forget)", elapsed < 400, `elapsed=${elapsed}ms`);
  h.leave();
  wire.mode = "normal";
}

section("F07 — leave stops the poller (no timer leak)");
{
  const h = client("host-1", "Chủ");
  h.create();
  await wait(150);
  const inner = h as unknown as { relayTimer: unknown };
  check("poller armed while in room", inner.relayTimer !== null);
  h.leave();
  await wait(60);
  check("poller cleared after leave", inner.relayTimer === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
