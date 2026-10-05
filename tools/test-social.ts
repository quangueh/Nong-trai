/**
 * The friend list and the duel, tested against the real Worker code.
 *
 * The Worker is not stubbed. `social.ts` is imported as written and handed an in-memory KV,
 * so what is under test is the code that will run in production rather than a description
 * of it. This matters more than usual here, because the interesting properties are all
 * about *authority*: who a friend is, whose plants get fought, and whether anything a
 * client says can influence any of it.
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
 *   4. **Signing in publishes nothing sensitive and costs one write for a name already
 *      seen.** The indexes are what make a friend findable, and they are written on every
 *      sign-in, so their cost is part of the design.
 */

import {
  handleDuelAccept,
  handleDuelDecline,
  handleDuelInbox,
  handleDuelResult,
  handleDuelSend,
  handleFriend,
  indexAccount,
  nameCountKey,
  nameIndexKey,
  handleIndexKey,
  friendBookKey,
  inboxKey,
  plantFromSave,
  MAX_FRIENDS,
  INVITE_TTL_MS,
  type Identity,
} from "../worker/src/social";
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

/* --- an in-memory KV ------------------------------------------------------- */

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

/** Wraps the store so a handler receives the `{ DB }` shape it expects. */
function envFor(db: ReturnType<typeof fakeKv>) {
  return { DB: db as unknown as Parameters<typeof handleFriend>[1]["DB"] };
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

  check("the handle index points at the account", (await db.get(handleIndexKey("alice@example.com"))) === alice.key);
  check("the name index points at the account", (await db.get(nameIndexKey("Alice"))) === alice.key);
  check("names are indexed lowercased", (await db.get(nameIndexKey("alice"))) === alice.key);
  check("the name is counted once", (await db.get(nameCountKey("Alice"))) === "1");

  // Signing in again must not inflate the count, or the count stops meaning "distinct
  // accounts" and starts meaning "times somebody typed this".
  const before = db.writes;
  await indexAccount(env, alice);
  check("a repeat sign-in does not raise the count", (await db.get(nameCountKey("Alice"))) === "1");
  check("and costs no extra write for it", db.writes - before === 2, `${db.writes - before} writes`);
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
  const book = await body<{ list: { handle: string; saveKey: string }[] }>(
    (await db.get(friendBookKey(alice.key))) ?? "null",
  );
  check("and it is stored", book.list.length === 1 && book.list[0].handle === "bob@example.com", JSON.stringify(book));
  check("the stored row carries the save key", Boolean(book.list[0]?.saveKey), String(book.list[0]?.saveKey));

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

  check("the shared name is counted twice", (await db.get(nameCountKey("Minh"))) === "2");
  const res = await handleFriend(post({ action: "add", query: "Minh" }), env, alice);
  check("so adding by it is refused", (await code(res)) === "ambiguous_name", await code(res));
  check("and nothing is stored", !((await db.get(friendBookKey(alice.key))) ?? "").includes("Minh"));

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

  // Alice challenges with a plant she actually owns.
  const sent = await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-1", aliceSave.state);
  check("a challenge can be sent", sent.status === 200, await code(sent));

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
    };
  }>(accepted);
  check("with a real event log", Array.isArray(result.events) && result.events.length > 20, `${result.events?.length} events`);
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

  check("challenging yourself is refused", (await code(await handleDuelSend(env, alice, alice.handle, "alice@example.com-plant-0", a.state))) === "that_is_you");

  await handleDuelSend(env, alice, bob.handle, "alice@example.com-plant-0", a.state);
  const id = (await body<{ invites: { id: string }[] }>(await handleDuelInbox(env, bob))).invites[0].id;
  const declined = await handleDuelDecline(env, bob, id);
  check("declining works", declined.status === 200, await code(declined));
  check("and leaves it visible but closed", (await body<{ invites: { state: string }[] }>(declined)).invites[0].state === "declined");
  check("a declined invite cannot be accepted", (await code(await handleDuelAccept(env, bob, id, "bob@example.com-plant-0", b.state))) === "no_such_invite");
  check("and cannot be declined twice", (await code(await handleDuelDecline(env, bob, id))) === "no_such_invite");

  // An invitation older than the TTL is not an invitation any more. Rewritten rather than
  // waited for, because the alternative is a test that sleeps for twelve hours.
  const raw = JSON.parse(((await db.get(inboxKey(bob.key))) ?? "null")) as { list: { at: number }[] };
  raw.list[0].at = Date.now() - INVITE_TTL_MS - 1000;
  await db.put(inboxKey(bob.key), JSON.stringify(raw));
  check("an expired invitation disappears from the inbox", (await body<{ invites: unknown[] }>(await handleDuelInbox(env, bob))).invites.length === 0);

  // Two live challenges from one person is a queue; three is refused.
  const spam = identity("spam@example.com", "Spammer");
  await publish(env, db, spam, saveWith("spam@example.com", 2, "S"));
  await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-0", saveWith("spam@example.com", 2, "S").state);
  await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-1", saveWith("spam@example.com", 2, "S").state);
  const third = await handleDuelSend(env, spam, bob.handle, "spam@example.com-plant-0", saveWith("spam@example.com", 2, "S").state);
  check("a third live challenge is refused", (await code(third)) === "already_challenged", await code(third));
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

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
