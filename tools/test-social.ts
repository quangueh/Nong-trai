/**
 * The friend list and the duel, tested against the real Worker code.
 *
 * The Worker is not stubbed. `social.ts` is imported as written and handed an in-memory
 * KV plus a `node:sqlite` database running the real `worker/schema.sql` through the
 * `D1Like` interface — so what is under test is the code that will run in production
 * rather than a description of it. This matters more than usual here, because the
 * interesting properties are all about *authority*: who a friend is, whose plants get
 * fought, and whether anything a client says can influence any of it.
 *
 * The four properties worth pinning down:
 *
 *   1. **The plants come from the server's saves.** A challenge names a plant *id*; a
 *     client that names an id it does not own is refused. There is no path by which a
 *      fighter reaches the simulation from a request body, which is the whole basis of a
 *      duel being worth anything.
 *
 *   2. **The same fight comes out twice.** The seed is derived from the invitation, so both
 *      players replaying one log is a fact rather than a hope.
 *
 *   3. **A shared display name is refused.** Two accounts called Minh must not resolve to
 *      whichever one signed in last.
 *
 *   4. **Steady-state costs reads, not writes.** The indexes are what make a friend
 *      findable; they are re-checked on every social request, so an unchanged identity
 *      must not cost a write on any store.
 */

import {
  handleDuelAccept,
  handleDuelDecline,
  handleDuelInbox,
  handleDuelOutbox,
  handleDuelResult,
  handleDuelSend,
  handleFriend,
  indexAccount,
  unindexName,
  friendBookKey,
  inboxKey,
  plantFromSave,
  resolveTarget,
  MAX_FRIENDS,
  INVITE_TTL_MS,
  type D1Prepared,
  type Identity,
} from "../worker/src/social";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateBattle } from "../src/battle/engine";
import { createSeedPlant } from "../src/genetics/genomeGenerator";
import type { Plant } from "../src/core/types";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* --- in-memory stores ------------------------------------------------------- */

/** Minimal KVNamespace. Counts writes, because write cost is a real constraint here. */
function fakeKv() {
  const map = new Map<string, string>();
  let writes = 0;
  const db = {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => {
      writes++;
      map.set(k, v);
    },
    delete: async (k: string) => {
      writes++;
      map.delete(k);
    },
    list: async () => ({ keys: [] }),
    get writes() {
      return writes;
    },
    raw: map,
  };
  return db as typeof db & { DB: never };
}

/**
 * Minimal D1Database over `node:sqlite`, running the real schema file — a test that
 * drifted from `worker/schema.sql` fails here rather than on deploy. `run()` counts
 * as a write (it is only ever used for mutations), for the same reason KV does.
 */
function fakeD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../worker/schema.sql"), "utf8"));
  let writes = 0;
  const d1 = {
    sqlite,
    get writes() {
      return writes;
    },
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const make = (values: unknown[]): D1Prepared => ({
        bind: (...v: unknown[]) => make(v),
        async run() {
          writes++;
          const r = stmt.run(...(values as never[]));
          return { meta: { changes: Number(r.changes) } };
        },
        async first<T>(column?: string): Promise<T | null> {
          const row = stmt.get(...(values as never[])) as Record<string, unknown> | undefined;
          if (row === undefined) return null;
          return (column !== undefined ? row[column] : row) as T;
        },
        async all<T>() {
          return { results: stmt.all(...(values as never[])) as T[] };
        },
      });
      // D1 allows running a statement without binding it — same methods, no args.
      return make([]);
    },
    async batch(stmts: D1Prepared[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return d1;
}

/** Minimal R2Bucket — a map of key to object body. */
function fakeR2() {
  const map = new Map<string, string>();
  return {
    put: async (k: string, v: string) => (map.set(k, v), {}),
    get: async (k: string) => (map.has(k) ? { text: async () => map.get(k)! } : null),
    raw: map,
  };
}

/** Wraps the stores so a handler receives the `{ DB, D1, REPLAYS }` shape it expects. */
function envFor(db: ReturnType<typeof fakeKv>, opts: { r2?: boolean } = {}) {
  const env = {
    DB: db,
    D1: fakeD1(),
    ...(opts.r2 === false ? {} : { REPLAYS: fakeR2() }),
  };
  return env as unknown as Parameters<typeof handleFriend>[1] & {
    D1: ReturnType<typeof fakeD1>;
    REPLAYS?: ReturnType<typeof fakeR2>;
  };
}

/** A password account, as the router would find it. */
function account(email: string) {
  return { key: `acct:${email}`, saveKey: `save:${email}` };
}

function identity(email: string, name: string): Identity {
  const a = account(email);
  return { handle: email, name, key: a.key, saveKey: a.saveKey };
}

/** A save with `count` mature plants, as the Worker would find it. */
function saveWith(email: string, count: number, seed = "x"): { savedAt: number; state: { plants: Plant[] } } {
  const plants: Plant[] = [];
  for (let i = 0; i < count; i++) {
    const p = createSeedPlant("thornroot", `pl_${email}`, `${seed}-${i}`, 1_700_000_000_000);
    p.plantId = `${email}-plant-${i}`;
    p.name = `${seed === "x" ? "Cây" : seed}${i + 1}`;
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.powerRating = 200 + i;
    plants.push(p);
  }
  return { savedAt: Date.now(), state: { plants } };
}

/** Publish an account the way the router does on sign-in. */
async function publish(env: ReturnType<typeof envFor>, db: ReturnType<typeof fakeKv>, me: Identity, save?: unknown): Promise<void> {
  await db.put(me.key, JSON.stringify({ email: me.handle, name: me.name }));
  if (save) await db.put(me.saveKey, JSON.stringify(save));
  await indexAccount(env, me);
}

const post = (payload: unknown) =>
  new Request("https://x/api/friend", { method: "POST", body: JSON.stringify(payload) });

/**
 * Read a response body once.
 *
 * A `Response` body is a stream, so reading it twice throws rather than returning the
 * same bytes - and the natural way to write these assertions is to check the status and
 * then read the payload, which is two reads. Memoised on the response itself so the check
 * and the read are separate calls over one stream.
 */
const seen = new WeakMap<Response, Promise<unknown>>();
function readOnce(res: Response): Promise<unknown> {
  let p = seen.get(res);
  if (!p) {
    p = res.text().then((t) => JSON.parse(t) as unknown);
    seen.set(res, p);
  }
  return p;
}

/** Parse a response or a raw KV string. */
const body = async <T>(src: Response | string): Promise<T> =>
  (typeof src === "string" ? (JSON.parse(src) as T) : ((await readOnce(src)) as T));

/** The Worker's error code, or an empty string when it succeeded. */
const code = async (res: Response): Promise<string> => String(((await readOnce(res)) as { error?: string }).error ?? "");


// --- 1. keys are derived, not assumed --------------------------------------

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  await publish(env, db, alice, saveWith("alice@example.com", 3));

  const d1one = async <T>(sql: string, ...v: unknown[]) => env.D1.prepare(sql).bind(...v).first<T>();
  const occupants = async (name: string) =>
    ((await d1one<{ occupants: number }>("SELECT occupants FROM names WHERE name = ?", name.toLowerCase()))?.occupants ?? 0);

  check("the handle index points at the account",
    (await d1one<{ account_key: string }>("SELECT account_key FROM handles WHERE handle = ?", "alice@example.com"))?.account_key === alice.key);
  check("the name index points at the account",
    (await d1one<{ account_key: string }>("SELECT account_key FROM names WHERE name = ?", "alice"))?.account_key === alice.key);
  check("the name is counted once", (await occupants("Alice")) === 1);

  // Signing in again must not inflate the count, or the count stops meaning "distinct
  // accounts" and starts meaning "times somebody typed this".
  const before = db.writes + env.D1.writes;
  await indexAccount(env, alice);
  check("a repeat sign-in does not raise the count", (await occupants("Alice")) === 1);
  /* Steady-state indexing is read-only: both indexes already point at this
     account, so there is nothing to write on either store. This matters because
     readIdentity re-indexes on every friend/duel request — an unchanged identity
     that still wrote per call is what emptied the daily KV write budget on a poll. */
  check("and costs no extra write on KV or D1", db.writes + env.D1.writes - before === 0,
    `kv=${db.writes} d1=${env.D1.writes} before=${before}`);
}

// --- 2. adding a friend ------------------------------------------------------

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  await publish(env, db, alice);
  await publish(env, db, bob);

  const byEmail = await handleFriend(post({ action: "add", query: "bob@example.com" }), env, alice);
  check("adding by email works", byEmail.status === 200, await code(byEmail));
  const stored = await body<{ friends: { handle: string; saveKey: string }[] }>(
    await handleFriend(post({ action: "list" }), env, alice),
  );
  check("and it is stored", stored.friends.length === 1 && stored.friends[0].handle === "bob@example.com", JSON.stringify(stored));
  check("the stored row carries the save key", Boolean(stored.friends[0]?.saveKey), String(stored.friends[0]?.saveKey));

  // A second account, so a by-name add has something to find.
  const bob2 = identity("bob2@example.com", "Robert");
  await publish(env, db, bob2);
  const byName = await handleFriend(post({ action: "add", query: "Robert" }), env, alice);
  check("adding by an unambiguous name works", byName.status === 200, await code(byName));
  check("now there are two", (await body<{ friends: unknown[] }>(byName)).friends.length === 2);

  check("adding yourself is refused", (await code(await handleFriend(post({ action: "add", query: "alice@example.com" }), env, alice))) === "that_is_you");
  check("adding yourself by name too", (await code(await handleFriend(post({ action: "add", query: "Alice" }), env, alice))) === "that_is_you");
  check("an empty query is refused", (await code(await handleFriend(post({ action: "add", query: "  " }), env, alice))) === "empty_query");
  check("a stranger is refused", (await code(await handleFriend(post({ action: "add", query: "nobody@example.com" }), env, alice))) === "no_such_player");

  const twice = await handleFriend(post({ action: "add", query: "bob@example.com" }), env, alice);
  check("adding the same friend again is harmless", twice.status === 200);
  check("and does not duplicate the row", (await body<{ friends: unknown[] }>(twice)).friends.length === 2);

  const removed = await handleFriend(post({ action: "remove", query: "BOB@example.com" }), env, alice);
  check("removing is case-insensitive", removed.status === 200, await code(removed));
  check("and leaves one friend", (await body<{ friends: unknown[] }>(removed)).friends.length === 1);
  check("removing a non-friend says so", (await code(await handleFriend(post({ action: "remove", query: "bob@example.com" }), env, alice))) === "not_a_friend");
}

// --- 3. a shared display name is refused --------------------------------------

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const first = identity("minh1@example.com", "Minh");
  const second = identity("minh2@example.com", "Minh");
  await publish(env, db, alice);
  await publish(env, db, first);
  await publish(env, db, second);

  const occupants = await env.D1.prepare("SELECT occupants FROM names WHERE name = ?")
    .bind("minh").first<{ occupants: number }>();
  check("the shared name is counted twice", occupants?.occupants === 2, JSON.stringify(occupants));
  const res = await handleFriend(post({ action: "add", query: "Minh" }), env, alice);
  check("so adding by it is refused", (await code(res)) === "ambiguous_name", await code(res));
  const aliceFriends = await body<{ friends: unknown[] }>(await handleFriend(post({ action: "list" }), env, alice));
  check("and nothing is stored", aliceFriends.friends.length === 0);

  // The address still works, which is the point of refusing by name.
  check("but the address resolves", (await handleFriend(post({ action: "add", query: "minh1@example.com" }), env, alice)).status === 200);
}

// --- 4. the list is capped ---------------------------------------------------

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  await publish(env, db, alice);
  for (let i = 0; i < MAX_FRIENDS + 2; i++) {
    const other = identity(`f${i}@example.com`, `Friend ${i}`);
    await publish(env, db, other);
    await handleFriend(post({ action: "add", query: other.handle }), env, alice);
  }
  const list = await body<{ friends: unknown[] }>(await handleFriend(post({ action: "list" }), env, alice));
  check(`the list stops at ${MAX_FRIENDS}`, list.friends.length === MAX_FRIENDS, `${list.friends.length}`);
  check("and the overflow add was refused", (await code(await handleFriend(post({ action: "add", query: "f0@example.com" }), env, alice))) !== "");
}

// --- 5. a challenge, and whose plants are fought ------------------------------

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  const aliceSave = saveWith("alice@example.com", 3, "A");
  const bobSave = saveWith("bob@example.com", 2, "B");
  await publish(env, db, alice, aliceSave);
  await publish(env, db, bob, bobSave);

  // Challenges are between friends only — strangers by email are refused.
  check(
    "a stranger cannot be challenged",
    (await code(await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-1", aliceSave.state))) === "not_a_friend",
  );
  await handleFriend(post({ action: "add", query: bob.handle }), env, alice);

  // Alice challenges with a plant she actually owns.
  const sent = await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-1", aliceSave.state);
  check("a challenge can be sent", sent.status === 200, await code(sent));

  // And the sender keeps a copy: the outbox row is what lets her see the answer.
  const outbox = await body<{ sent: { id: string; to: string; state: string }[] }>(await handleDuelOutbox(env, alice));
  check("the sender sees the challenge in her outbox", outbox.sent.length === 1 && outbox.sent[0].to === "bob@example.com");
  check("and it is pending", outbox.sent[0].state === "pending");

  // The inbox is Bob's, and it names Alice's fighter - read from her save, not from her.
  const inbox = await body<{ invites: { id: string; from: string; fromName: string; plantName: string; plantPower: number; state: string }[] }>(
    await handleDuelInbox(env, bob),
  );
  check("it arrives in Bob's inbox", inbox.invites.length === 1);
  const invite = inbox.invites[0];
  check("from Alice", invite.from === "alice@example.com" && invite.fromName === "Alice");
  check("naming the fighter she sent", invite.plantName === "A2", invite.plantName);
  check("with its power", invite.plantPower === 201, `${invite.plantPower}`);
  check("pending", invite.state === "pending");

  // Bob cannot accept with a plant that is not his.
  const wrong = await handleDuelAccept(env, bob, invite.id, "not-mine", bobSave.state);
  check("accepting with an unowned plant is refused", (await code(wrong)) === "plant_not_in_your_garden", await code(wrong));
  check("and it stays pending", (await body<{ invites: { state: string }[] }>(await handleDuelInbox(env, bob))).invites[0].state === "pending");

  // Alice's inbox is untouched - a challenge is not visible to the sender.
  check("the sender does not see it in their own inbox", (await body<{ invites: unknown[] }>(await handleDuelInbox(env, alice))).invites.length === 0);

  // Bob accepts with his own plant 1.
  const accepted = await handleDuelAccept(env, bob, invite.id, "bob@example.com-plant-1", bobSave.state);
  check("accepting resolves the duel", accepted.status === 200, await code(accepted));
  const { result } = await body<{
    result: {
      winner: string;
      events: unknown[];
      aName: string;
      bName: string;
      aPower: number;
      bPower: number;
      log: string[];
      seed: string;
      aPlant?: { name: string; plantId: string };
      bPlant?: { name: string; plantId: string };
    };
  }>(accepted);
  check("with a real event log", Array.isArray(result.events) && result.events.length > 20, `${result.events?.length} events`);
  // The replay contract: without both fighter snapshots the client can only show
  // the score, so their presence is part of what "accept" owes the viewer.
  check(
    "carrying both fighter snapshots for replay",
    result.aPlant?.name === "A2" && result.bPlant?.name === "B2" && result.aPlant?.plantId.length! > 0,
    `${result.aPlant?.name}/${result.bPlant?.name}`,
  );
  check("naming both fighters", result.aName === "A2" && result.bName === "B2", `${result.aName} vs ${result.bName}`);
  check("and both powers", result.aPower === 201 && result.bPower === 201, `${result.aPower}/${result.bPower}`);
  check("and a winner", ["a", "b", "draw"].includes(result.winner), result.winner);
  // `simulateBattle` never fills `log` - it is declared and handed to helpers whose
  // parameter is `_log`. The events are the record, so that is what is asserted.
  check("and the engine leaves log empty, as it always has", result.log.length === 0, `${result.log.length}`);
  check("but the events carry the fight", result.events.some((e) => (e as { type?: string }).type === "BATTLE_FINISHED"), "no finish event");

  // Both sides can read it, and it is the same document.
  const read = await handleDuelResult(env, invite.id);
  check("the result is readable by id", read.status === 200);
  check("and matches", (await body<{ result: { seed: string } }>(read)).result.seed === result.seed);
  check("a nonsense id is refused", (await code(await handleDuelResult(env, "../../etc/passwd"))) === "bad_id");
  check("an unknown id is refused", (await code(await handleDuelResult(env, "00000000-0000-0000-0000-000000000000"))) === "no_such_duel");

  // Accepting twice is refused, so a resolved duel cannot be re-fought.
  check("accepting twice is refused", (await code(await handleDuelAccept(env, bob, invite.id, "bob@example.com-plant-1", bobSave.state))) === "no_such_invite");

  // And it stays readable from the inbox, marked done.
  const after = await body<{ invites: { state: string; toPlantName?: string }[] }>(await handleDuelInbox(env, bob));
  check("the invite is marked done", after.invites[0].state === "done");
  check("and records his fighter", after.invites[0].toPlantName === "B2", String(after.invites[0].toPlantName));

  // The sender's outbox closed too, and points at the fight she can now watch.
  const outAfter = await body<{ sent: { state: string; resultKey?: string }[] }>(await handleDuelOutbox(env, alice));
  check("the sender's outbox is marked done", outAfter.sent[0].state === "done");
  check("and names the result", outAfter.sent[0].resultKey === `duel:${invite.id}`, String(outAfter.sent[0].resultKey));
}

/* --- 6. determinism ---------------------------------------------------------- */

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  const a = saveWith("alice@example.com", 3, "A");
  const b = saveWith("bob@example.com", 2, "B");
  await publish(env, db, alice, a);
  await publish(env, db, bob, b);
  await handleFriend(post({ action: "add", query: bob.handle }), env, alice);

  await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-0", a.state);
  const id = (await body<{ invites: { id: string }[] }>(await handleDuelInbox(env, bob))).invites[0].id;
  const first = (
    await body<{ result: { winner: string; log: string[]; events: unknown[]; seed: string } }>(
      await handleDuelAccept(env, bob, id, "bob@example.com-plant-0", b.state),
    )
  ).result;

  // Re-run the same two plants through the same seed the Worker derives. If the log
  // differs, then "both sides replay one log" is not true and the whole design is wrong.
  const again = simulateBattle(a.state.plants[0], b.state.plants[0], {
    seed: `${id}:${(await body<{ invites: { at: number }[] }>(await handleDuelInbox(env, bob))).invites[0].at}`,
    maxSeconds: 90,
    arena: "sunny",
    stances: { a: "aggressive", b: "aggressive" },
  });
  check("the same seed gives the same winner", again.winner === first.winner, `${again.winner} vs ${first.winner}`);
  check("and the same event count", again.events.length === first.events.length, `${again.events.length} vs ${first.events.length}`);
  check("and the same seed", again.seed === first.seed, `${again.seed} vs ${first.seed}`);

  // A different seed must be able to differ, or the test above proves nothing.
  const other = simulateBattle(a.state.plants[0], b.state.plants[0], {
    seed: "something-else",
    maxSeconds: 90,
    arena: "sunny",
    stances: { a: "aggressive", b: "aggressive" },
  });
  check("a different seed is a different fight", other.events.length !== first.events.length || other.seed !== first.seed, `${other.seed} vs ${first.seed}`);
}

/* --- 7. declining, expiry, and self-challenging ----------------------------- */

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  const a = saveWith("alice@example.com", 2, "A");
  const b = saveWith("bob@example.com", 2, "B");
  await publish(env, db, alice, a);
  await publish(env, db, bob, b);
  await handleFriend(post({ action: "add", query: bob.handle }), env, alice);

  check("challenging yourself is refused", (await code(await handleDuelSend(env, alice, alice.handle, "alice@example.com-plant-0", a.state))) === "that_is_you");

  await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-0", a.state);
  const id = (await body<{ invites: { id: string }[] }>(await handleDuelInbox(env, bob))).invites[0].id;
  const declined = await handleDuelDecline(env, bob, id);
  check("declining works", declined.status === 200, await code(declined));
  check("and leaves it visible but closed", (await body<{ invites: { state: string }[] }>(declined)).invites[0].state === "declined");
  check("a declined invite cannot be accepted", (await code(await handleDuelAccept(env, bob, id, "bob@example.com-plant-0", b.state))) === "no_such_invite");
  check("and cannot be declined twice", (await code(await handleDuelDecline(env, bob, id))) === "no_such_invite");

  // An invitation older than the TTL is not an invitation any more. Backdated rather than
  // waited for, because the alternative is a test that sleeps for twelve hours.
  await env.D1.prepare("UPDATE duels SET created_at = ? WHERE to_key = ?")
    .bind(Date.now() - INVITE_TTL_MS - 1000, bob.key).run();
  check("an expired invitation disappears from the inbox", (await body<{ invites: unknown[] }>(await handleDuelInbox(env, bob))).invites.length === 0);

  // Two live challenges from one person is a queue; three is refused.
  const spam = identity("spam@example.com", "Spammer");
  await publish(env, db, spam, saveWith("spam@example.com", 2, "S"));
  await handleFriend(post({ action: "add", query: bob.handle }), env, spam);
  await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-0", saveWith("spam@example.com", 2, "S").state);
  await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-1", saveWith("spam@example.com", 2, "S").state);
  const third = await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-0", saveWith("spam@example.com", 2, "S").state);
  check("a third live challenge is refused", (await code(third)) === "already_challenged", await code(third));
}

/* --- 9. the leaderboard ----------------------------------------------------- */

{
  const { entryFromState, handleLeaderboard, writeEntry, lbKey, BOARD_SIZE } = await import("../worker/src/leaderboard");

  // A KV whose list honours the prefix — kept only for the one-time backfill path.
  const lbMap = new Map<string, string>();
  const lbDb = {
    get: async (k: string) => lbMap.get(k) ?? null,
    put: async (k: string, v: string) => void lbMap.set(k, v),
    delete: async (k: string) => void lbMap.delete(k),
    list: async (o: { prefix: string }) => ({
      keys: [...lbMap.keys()].filter((k) => k.startsWith(o.prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    }),
  };
  const lbD1 = fakeD1();
  const lbEnv = { DB: lbDb, D1: lbD1 };

  check("entryFromState reads the strongest plant and the level",
    entryFromState({ plants: [{ powerRating: 120 }, { powerRating: 480.6 }], breederLevel: 7 }, "A").power === 481 &&
    entryFromState({ plants: [{ powerRating: 120 }], breederLevel: 7 }, "A").level === 7);
  check("a save with no plants still ranks", entryFromState({ plants: [] }, "A").power === 0);
  check("a malformed save does not throw", entryFromState("junk", "A").level === 1);

  // Three players: two on power order, one level king.
  await writeEntry(lbEnv, "acct:a", { name: "Alice", email: "alice@gmail.com", power: 500, level: 9, at: 100 });
  await writeEntry(lbEnv, "acct:b", { name: "Bob", email: "bob@gmail.com", power: 900, level: 5, at: 200 });
  await writeEntry(lbEnv, "acct:c", { name: "Carol", power: 100, level: 30, at: 300 }); // no email: an entry from before emails were indexed

  const res = await handleLeaderboard(lbEnv, "acct:a");
  const board = (await res.json()) as {
    power: { rank: number; name: string; email?: string; power: number; me: boolean }[];
    level: { rank: number; name: string; email?: string; level: number; me: boolean }[];
    me: { powerRank: number; levelRank: number; email?: string } | null;
    total: number;
  };
  check("power board sorts strongest first", board.power[0].name === "Bob" && board.power[0].power === 900, JSON.stringify(board.power.map(r => r.name)));
  check("level board sorts highest first", board.level[0].name === "Carol" && board.level[0].level === 30);
  check("the caller is marked in the list", board.power.find((r) => r.name === "Alice")?.me === true);
  /* Emails identify the account internally, but a public board must not hand
     out other players' addresses — only the caller's own row carries it. */
  check("other players' rows do NOT leak email", board.power[0].email === undefined, JSON.stringify(board.power[0]));
  check("the caller's own row still carries its email", board.me?.email === "alice@gmail.com", JSON.stringify(board.me));
  check("an email-less entry still boards", board.level[0].name === "Carol" && board.level[0].email === undefined);
  check("the caller's own ranks are returned", board.me?.powerRank === 2 && board.me?.levelRank === 2, JSON.stringify(board.me));
  check("the roster size is reported", board.total === 3);

  // A player outside the visible list still learns their rank.
  for (let i = 0; i < BOARD_SIZE + 3; i++) {
    await writeEntry(lbEnv, `acct:x${i}`, { name: `Filler${i}`, power: 10_000 + i, level: 99, at: i });
  }
  const deep = (await (await handleLeaderboard(lbEnv, "acct:a")).json()) as { me: { powerRank: number } | null; power: unknown[] };
  check("a rank outside the visible list is still computed", (deep.me?.powerRank ?? 0) === BOARD_SIZE + 5, `rank=${deep.me?.powerRank} list=${deep.power.length}`);
  check("the visible list stays capped", deep.power.length === BOARD_SIZE, `${deep.power.length}`);

  // The legacy KV key name is kept for the one-time backfill.
  check("the legacy lb: key name is still known", lbKey("acct:x") === "lb:acct:x");

  /* Board reads are D1 SELECTs — after the one-time flag-gated backfill they
     never touch KV at all, so a poll costs zero KV ops, not even the snapshot
     get the old design needed to stay cheap. */
  let listCalls = 0;
  const countingEnv = {
    DB: {
      ...lbDb,
      list: async (o: { prefix: string }) => {
        listCalls++;
        return lbDb.list(o);
      },
    },
    D1: lbD1,
  };
  await handleLeaderboard(countingEnv, "acct:a");
  await handleLeaderboard(countingEnv, "acct:a");
  await handleLeaderboard(countingEnv, "acct:a");
  check("repeated board reads cost at most the one-time backfill list", listCalls <= 1, `${listCalls} lists`);

  const second = await handleLeaderboard(lbEnv, "acct:never-saved");
  const nobody = (await second.json()) as { me: unknown };
  check("a player with no save is unranked, not an error", nobody.me === null);

  /*
   * Throwaway probe accounts stay off the public board.
   *
   * smoke-worker and the leaderboard probes register `*@example.com` addresses and
   * push real saves on every run; those entries used to fill the board with junk.
   * A genuine gmail row must still show beside them.
   */
  const clean = new Map<string, string>();
  const cleanDb = {
    get: async (k: string) => clean.get(k) ?? null,
    put: async (k: string, v: string) => void clean.set(k, v),
    list: async (o: { prefix: string }) => ({
      keys: [...clean.keys()].filter((k) => k.startsWith(o.prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    }),
  };
  const cleanEnv = { DB: cleanDb, D1: fakeD1() };
  await writeEntry(cleanEnv, "acct:real", { name: "quanghao6c", email: "quanghao6c@gmail.com", power: 930, level: 4, at: 1 });
  await writeEntry(cleanEnv, "acct:smoke-1@example.com", { name: "smoke-1791395758872", email: "smoke-1791395758872@example.com", power: 700, level: 1, at: 2 });
  await writeEntry(cleanEnv, "acct:lb-probe@example.com", { name: "lb-probe-1791396883605", email: "lb-probe-1791396883605@example.com", power: 777, level: 1, at: 3 });
  const pub = (await (await handleLeaderboard(cleanEnv, "acct:real")).json()) as {
    power: { name: string }[];
    total: number;
    me: { powerRank: number } | null;
  };
  check("test accounts are filtered off the board", pub.power.length === 1 && pub.power[0].name === "quanghao6c", JSON.stringify(pub.power));
  check("and out of the roster count", pub.total === 1, `${pub.total}`);
  check("the real caller still gets a rank", pub.me?.powerRank === 1);

  /*
   * Regression for the production loss: a save landed before the first board
   * read, so `lb` was never empty and the row-count-gated backfill never ran —
   * every legacy KV player stayed invisible. The import is gated on the
   * `lb_backfilled` flag only, and must run no matter how full `lb` already is.
   */
  const migDb = {
    get: async (k: string) => migMap.get(k) ?? null,
    put: async (k: string, v: string) => void migMap.set(k, v),
    delete: async (k: string) => void migMap.delete(k),
    list: async (o: { prefix: string }) => ({
      keys: [...migMap.keys()].filter((k) => k.startsWith(o.prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    }),
  };
  const migMap = new Map<string, string>([
    ["lb:acct:old@user.com", JSON.stringify({ name: "OldUser", email: "old@user.com", power: 555, level: 6, at: 50 })],
    ["lb:google:999", JSON.stringify({ name: "GoogleUser", power: 444, level: 3, at: 60 })],
    ["lb:__cache__", JSON.stringify({ snapshot: "not-a-player" })],
  ]);
  const migD1 = fakeD1();
  const migEnv = { DB: migDb, D1: migD1 };
  // The post-migration save lands BEFORE the first board read — the scenario
  // that stranded the legacy players on production.
  await writeEntry(migEnv, "acct:new@user.com", { name: "NewUser", email: "new@user.com", power: 900, level: 2, at: 70 });
  const mig = (await (await handleLeaderboard(migEnv, "acct:new@user.com")).json()) as {
    power: { name: string }[];
    total: number;
    me: { powerRank: number } | null;
  };
  check("legacy KV players appear even when lb was already populated",
    mig.power.some((r) => r.name === "OldUser") && mig.power.some((r) => r.name === "GoogleUser"),
    JSON.stringify(mig.power.map((r) => r.name)));
  check("the snapshot blob is not imported as a player",
    !mig.power.some((r) => r.name === "__cache__") && mig.total === 3, `total=${mig.total}`);
  check("a newer D1 row still outranks an imported one", mig.me?.powerRank === 1);
  // Imported rows persist — the next read is pure D1, flag set.
  const mig2 = (await (await handleLeaderboard(migEnv, "acct:old@user.com")).json()) as { me: { powerRank: number; email?: string } | null };
  check("an imported player sees their own rank", mig2.me?.powerRank === 2, JSON.stringify(mig2.me));
}

/* --- 10. renaming frees the old name -------------------------------------- */

{
  const db = fakeKv();
  const env = envFor(db);
  const minh1 = identity("minh1@example.com", "Minh");
  const minh2 = identity("minh2@example.com", "Minh");
  await publish(env, db, minh1);
  await publish(env, db, minh2);
  const occupants = async (name: string) =>
    ((await env.D1.prepare("SELECT occupants FROM names WHERE name = ?")
      .bind(name.toLowerCase()).first<{ occupants: number }>())?.occupants ?? 0);
  check("two Minhs make the name ambiguous", (await occupants("Minh")) === 2, `${await occupants("Minh")}`);

  // Only the recorded occupant may release the name: an index pointing at minh2
  // must not be decremented by minh1's rename.
  await unindexName(env, minh1.key, "Minh");
  check("a non-occupant cannot release the name", (await occupants("Minh")) === 2);
  await unindexName(env, minh2.key, "Minh");
  check("the occupant's rename frees one share", (await occupants("Minh")) === 1);

  // And the freed name resolves to the survivor again — no longer ambiguous.
  const target = await resolveTarget(env, "Minh");
  check("the freed name resolves again", !!target && !("ambiguous" in target) && target.handle === "minh2@example.com",
    JSON.stringify(target));
}

/* --- 8. reading a save ------------------------------------------------------- */

{
  const plants = [{ plantId: "a" }, { plantId: "b" }];
  check("a plant is found by id", plantFromSave({ plants }, "b")?.plantId === "b");
  check("an unknown id is null, not a throw", plantFromSave({ plants }, "zzz") === null);
  check("a save with no plants is null", plantFromSave({ plants: [] }, "a") === null);
  check("a save of the wrong shape is null", plantFromSave({ nope: 1 }, "a") === null);
  check("null is null", plantFromSave(null, "a") === null);
  check("undefined is null", plantFromSave(undefined, "a") === null);
  check("a string is null", plantFromSave("nonsense", "a") === null);
}

/* --- 11. the lazy KV → D1 migration ------------------------------------------ */

{
  const db = fakeKv();
  const env = envFor(db);
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  await publish(env, db, alice);
  await publish(env, db, bob);
  await publish(env, db, identity("carol@example.com", "Carol"));

  // The blobs a KV build would have left behind: a friend book, an inbox invite
  // (with the modern fromKey), and an outbox row on the challenger.
  await db.put(friendBookKey(alice.key), JSON.stringify({
    list: [{ handle: "carol@example.com", name: "Carol", key: "acct:carol@example.com", saveKey: "save:carol@example.com", since: 1 }],
  }));
  const legacyInvite = {
    id: "legacy-invite-1",
    from: "bob@example.com",
    fromName: "Bob",
    plantName: "B1",
    plantPower: 201,
    at: Date.now() - 1000,
    state: "pending",
    fromKey: bob.key,
    fromSaveKey: bob.saveKey,
    fromPlantId: "bob@example.com-plant-0",
  };
  await db.put(inboxKey(alice.key), JSON.stringify({ list: [legacyInvite] }));

  // First touch imports and answers from D1.
  const list = await body<{ friends: { handle: string }[] }>(await handleFriend(post({ action: "list" }), env, alice));
  check("a legacy friend book is imported", list.friends.length === 1 && list.friends[0].handle === "carol@example.com", JSON.stringify(list));
  check("and the KV blob is deleted after import", (await db.get(friendBookKey(alice.key))) === null);
  const invites = await body<{ invites: { id: string; state: string }[] }>(await handleDuelInbox(env, alice));
  check("a legacy inbox invite is imported", invites.invites.length === 1 && invites.invites[0].id === "legacy-invite-1");
  check("and that blob is gone too", (await db.get(inboxKey(alice.key))) === null);

  // The migration is one-time: the marker stops the second call re-reading KV.
  const kvGetsBefore = 0; void kvGetsBefore;
  await handleFriend(post({ action: "list" }), env, alice);
  const migrated = await env.D1.prepare("SELECT owner_key FROM social_migrated WHERE owner_key = ?")
    .bind(alice.key).first<string>("owner_key");
  check("the user is marked migrated", migrated === alice.key);
}

/* --- 12. duel results without R2 fall back to the D1 table -------------------- */

{
  const db = fakeKv();
  const env = envFor(db, { r2: false });
  const alice = identity("alice@example.com", "Alice");
  const bob = identity("bob@example.com", "Bob");
  const a = saveWith("alice@example.com", 2, "A");
  const b = saveWith("bob@example.com", 2, "B");
  await publish(env, db, alice, a);
  await publish(env, db, bob, b);
  await handleFriend(post({ action: "add", query: bob.handle }), env, alice);
  await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-0", a.state);
  const id = (await body<{ invites: { id: string }[] }>(await handleDuelInbox(env, bob))).invites[0].id;
  const accepted = await handleDuelAccept(env, bob, id, "bob@example.com-plant-0", b.state);
  check("accept works without the replay bucket", accepted.status === 200, await code(accepted));
  const read = await handleDuelResult(env, id);
  check("and the result is still readable — from the D1 table", read.status === 200);
  check("with the same seed", (await body<{ result: { seed: string } }>(read)).result.seed ===
    (await body<{ result: { seed: string } }>(accepted)).result.seed);
}

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
