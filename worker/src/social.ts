/**
 * Friends, and duels fought between them.
 *
 * ## Why the duel is resolved here and not relayed
 *
 * The existing room is a BroadcastChannel: two tabs on one machine. That is a real-time
 * transport for two people sharing a keyboard, and it is the reason "fight my friend"
 * could not simply be built on top of it - a friend is on another machine.
 *
 * Relaying a live fight over HTTP polling was the obvious alternative and it is the wrong
 * one. Casting a skill is an input with a visible consequence; at a one-second poll that
 * is a game nobody would play twice.
 *
 * `simulateBattle` is a pure function of two plants and a seed - no DOM, no clock, no
 * randomness that is not seeded. So the Worker runs it, and returns the finished event log.
 * Both players then replay the *same* log locally, which means both watch the same fight
 * tick for tick and neither needs a socket open. It is also strictly fairer than a relay:
 * there is no input to lag and nothing to desync, because there is only one simulation and
 * both sides are reading its output.
 *
 * ## Why the plants are not sent by the client
 *
 * The Worker already holds both saves. So a challenge names a `plantId` and the Worker
 * fetches that plant out of the sender's own save, and likewise for the defender when
 * they accept. Nothing about either fighter comes from a request body.
 *
 * That matters more here than it might look: this is a competitive mode, and a client that
 * uploads its own fighter could upload anything. A duel resolved from the server's own copy
 * of both gardens cannot be tampered with, and it costs one KV read that was going to
 * happen anyway.
 *
 * ## Where this data lives
 *
 * Friends, duel correspondence and the search indexes are relational data — one row per
 * friendship, one row per duel — and they live in D1. They used to be whole-list JSON
 * blobs in KV, which cost a full rewrite per mutation; on the free tier's ~1k daily KV
 * writes, one idle friends panel (three calls a tick, each call re-indexing) burned the
 * day's budget in under an hour. D1 writes are rows, not blobs, and the free allowance
 * is ~100x larger.
 *
 * The duel's two halves used to be two blobs that had to be written together — the
 * defender's inbox row and the challenger's outbox row — so they could disagree. Now both
 * views are two queries over the *same* row: the outbox is `WHERE from_key`, the inbox is
 * `WHERE to_key`, and accept/decline is one UPDATE that both sides see at once.
 *
 * The finished fight — two full plant snapshots and the whole event log — is a large
 * write-once blob, and it lives in R2 under `duel:{id}` (falling back to a D1 table if
 * the bucket is not bound, and to the legacy KV key for results written before the move).
 *
 * ## Identity, and why it is the email
 *
 * A Google display name is not unique - two people are called Minh - so a name cannot be an
 * identity. The account's email already is: it is the key for password accounts and it is
 * stored on Google accounts too. So a friend is stored by email, and the display name is
 * carried alongside purely so the list can be read without another lookup.
 *
 * Searching accepts either. An email resolves exactly; a name resolves only if it is
 * unambiguous, and an ambiguous name is refused rather than silently picking one -
 * which would be a way to challenge a stranger by accident.
 *
 * ## The lazy migration
 *
 * Rows written by the KV build are not bulk-imported — there is no maintenance window to
 * spend it on, and most blobs belong to accounts that may never return. Instead each
 * user's three legacy blobs (friend book, inbox, outbox) are copied into D1 the first
 * time they touch a social endpoint after the cutover, marked in `social_migrated`, and
 * the KV keys deleted. Stale index entries are imported on the same lazy basis inside
 * `resolveTarget`/`indexAccount`: a lookup that misses D1 checks the KV index once and
 * copies what it finds.
 */

import { simulateBattle, type ArenaKind, type Stance } from "../../src/battle/engine";
import type { Plant } from "../../src/core/types";
import { googleSaveKey } from "./google";

/**
 * The KV prefix a password account's save lives under.
 *
 * Duplicated from index.ts on purpose rather than imported: that module imports this one,
 * and a cycle between the router and its feature module is a thing to design around
 * rather than to walk into. The worker's own smoke test asserts this name, so the two
 * copies cannot drift apart unnoticed.
 */
const PASSWORD_SAVE_PREFIX = "save:";

/** Where an account's save lives, given its record. Null if the record has no address. */
function saveKeyForRecord(rec: { email?: string; sub?: string }): string | null {
  if (rec.sub) return googleSaveKey(rec.sub);
  if (rec.email) return PASSWORD_SAVE_PREFIX + rec.email;
  return null;
}

/**
 * The slice of KV this module still uses: account records and save blobs — single
 * values keyed by one id, which is what a key-value store is for. Structural rather
 * than `KVNamespace`, so the test fake needs nothing from the Workers type package.
 */
export interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
}

/**
 * The slice of D1 this module uses. Structural for the same reason `Kv` is: the test
 * suite satisfies it with `node:sqlite`, so the code under test is the code that ships
 * rather than a description of it.
 */
export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  run(): Promise<{ meta: { changes: number } }>;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface D1Like {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<unknown[]>;
}

/** The slice of R2 the duel result uses — object storage for write-once blobs. */
export interface R2Like {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

/** The environment these handlers need: saves in KV, social rows in D1, replays in R2. */
export interface SocialEnv {
  DB: Kv;
  D1: D1Like;
  REPLAYS?: R2Like;
}

// --- storage shapes ---------------------------------------------------------

/**
 * Who a request is from, and where their garden is.
 *
 * Assembled by the router from the session and the account record. Both features take one
 * of these rather than a session, so neither can be handed an identity out of a request
 * body - which is the rule a friend list most needs and least obviously needs.
 */
export interface Identity {
  handle: string;
  name: string;
  key: string;
  saveKey: string;
}

export interface Friend {
  /** The other account's email. Unique, so it is the identity. */
  handle: string;
  /** Their display name, carried so the list needs no second lookup. */
  name: string;
  /** The account key. Kept for reference; the save is reached through `saveKey`. */
  key: string;
  /**
   * Where their garden is.
   *
   * Carried rather than derived, because the two account kinds key their saves differently
   * and working it out at duel time would cost a read per challenge.
   */
  saveKey: string;
  since: number;
  /** Last time we saw them online, so the list can say who is around. */
  seenAt?: number;
}

interface FriendBook {
  list: Friend[];
}

export interface DuelInvite {
  id: string;
  /** The challenger's handle and name, for the inbox line. */
  from: string;
  fromName: string;
  /** The challenger's own fighter, name and power, for the same reason. */
  plantName: string;
  plantPower: number;
  at: number;
  /** Set once the defender has answered. */
  state: "pending" | "declined" | "done";
  /** The defender's fighter, once chosen. */
  toPlantName?: string;
  toPlantPower?: number;
  /** Where the resolved fight is, for both sides to read. */
  resultKey?: string;
  /**
   * The challenger's account key, save key and chosen plant, recorded at send time.
   * Accepting used to re-resolve the challenger by handle and find the plant by *name* —
   * so a renamed plant read as "gone" and two same-named plants could swap. Optional so
   * invites written before this field existed still work, via the old lookup.
   */
  fromKey?: string;
  fromSaveKey?: string;
  fromPlantId?: string;
}

interface Inbox {
  list: DuelInvite[];
}

/**
 * One row of the challenger's own outbox: what was sent, to whom, and how it ended.
 *
 * Without this the challenger was told "đã gửi" and then nothing — the invite lived in
 * the defender's inbox and the result under the duel id, but the sender had no key to
 * either. On D1 the outbox is not a stored object at all: it is the same duel row read
 * from the sender's side, so it can never disagree with the inbox.
 */
export interface SentDuel {
  id: string;
  to: string;
  toName: string;
  plantName: string;
  plantPower: number;
  at: number;
  state: "pending" | "declined" | "done";
  /** Set once the fight exists; the duel id reads it back. */
  resultKey?: string;
}

interface Outbox {
  list: SentDuel[];
}

/** The resolved fight. Stored in R2 (or the duel_results table), read-only once written. */
export interface DuelResult {
  id: string;
  winner: "a" | "b" | "draw";
  events: unknown[];
  a: { hp: number; hpPct: number; damageDealt: number; damageTaken: number; shields: number; heals: number; energyPeak: number; skillUses: number };
  b: { hp: number; hpPct: number; damageDealt: number; damageTaken: number; shields: number; heals: number; energyPeak: number; skillUses: number };
  durationSeconds: number;
  timeouts: boolean;
  log: string[];
  seed: string;
  aName: string;
  bName: string;
  aPower: number;
  bPower: number;
  /**
   * Both fighters, snapshotted at accept time.
   *
   * A replay needs the plants themselves, not just their names: the client rebuilds the
   * battle view from these and the seed rather than trusting the summary numbers. Optional
   * because duel rows written before this field existed have to stay watchable — those fall
   * back to the summary card.
   */
  aPlant?: Plant;
  bPlant?: Plant;
}

// --- keys and columns -------------------------------------------------------

/**
 * The legacy KV key shapes. New writes never go here; they exist so the lazy
 * migration can find and remove what the old build stored, and so `handleDuelResult`
 * can still read fights finished before the move.
 */
export const friendBookKey = (accountKey: string) => `friends:${accountKey}`;
export const inboxKey = (accountKey: string) => `inbox:${accountKey}`;
export const outboxKey = (accountKey: string) => `outbox:${accountKey}`;
export const duelResultKey = (id: string) => `duel:${id}`; // also the R2 object name
/**
 * Email to account key, in the KV index this module migrated away from. Written on
 * every sign-in by the old build; still consulted once when a D1 lookup misses.
 */
export const handleIndexKey = (handle: string) => `handle:${handle.trim().toLowerCase()}`;
export const nameIndexKey = (name: string) => "name:" + name.trim().toLowerCase();
export const nameCountKey = (name: string) => "namecount:" + name.trim().toLowerCase();

/** A `duels` row. The inbox payload is JSON; the outbox needs the to_* columns too. */
interface DuelRow {
  id: string;
  from_key: string;
  to_key: string;
  to_handle: string;
  to_name: string;
  payload: string;
  state: string;
  created_at: number;
}

/** What a lookup found. A shared name is its own answer, not a failure to find. */
export type Resolution = Identity | { ambiguous: true } | null;

// --- limits -----------------------------------------------------------------

/**
 * Caps — a friend list you cannot scan and an inbox you cannot clear are both worse
 * than a small one. They also bound the row count a lazy migration can copy.
 */
export const MAX_FRIENDS = 60;
export const MAX_INBOX = 20;

/** An unanswered challenge stops being an invitation after this long. */
export const INVITE_TTL_MS = 1000 * 60 * 60 * 12;

// --- helpers ----------------------------------------------------------------

export function ok(data: unknown, status = 200): Response {
  return Response.json(data as Record<string, unknown>, { status });
}

export function fail(code: string, status = 400): Response {
  return Response.json({ error: code }, { status });
}

/** The timestamp older than which a duel row stops being a live invitation. */
const liveSince = () => Date.now() - INVITE_TTL_MS;

/**
 * Pull one plant out of a save.
 *
 * The save is `unknown` because it came out of KV and may be any shape at all - a partial
 * write, or a save from a build that had fewer fields. Returning null rather than
 * throwing is what lets the caller answer "that plant is not in your garden" instead of
 * answering 500.
 */
export function plantFromSave(state: unknown, plantId: string): Plant | null {
  if (!state || typeof state !== "object") return null;
  const plants = (state as { plants?: unknown }).plants;
  if (!Array.isArray(plants)) return null;
  for (const p of plants) {
    if (p && typeof p === "object" && (p as Plant).plantId === plantId) return p as Plant;
  }
  return null;
}

/**
 * Find the account a query names.
 *
 * An email is exact and wins outright. A display name only resolves when the index points
 * at an account whose stored name really is that name - because the index holds one entry
 * per name, a name shared by two accounts resolves to whichever signed in last, and
 * challenging the wrong stranger is worse than refusing.
 *
 * Both lookups fall back to the legacy KV index once: an account that last signed in
 * before the D1 move is still findable, and what the fallback finds is imported so the
 * next lookup is a D1 read.
 */
export async function resolveTarget(env: SocialEnv, query: string): Promise<Resolution> {
  const q = query.trim();
  if (!q) return null;

  const handle = q.toLowerCase();
  let byHandle = await env.D1.prepare("SELECT account_key FROM handles WHERE handle = ?")
    .bind(handle)
    .first<string>("account_key");
  if (!byHandle) {
    // Once, for accounts indexed by the KV build and never re-signed-in since.
    const legacy = await env.DB.get(handleIndexKey(q));
    if (legacy) {
      await env.D1.prepare("INSERT OR REPLACE INTO handles (handle, account_key) VALUES (?, ?)")
        .bind(handle, legacy)
        .run();
      byHandle = legacy;
    }
  }
  if (byHandle) {
    const record = await readAccountSummary(env, byHandle);
    // The index can outlive the account it names, so the handle is confirmed against the
    // record rather than trusted.
    if (record && record.handle.toLowerCase() === handle) return record;
  }

  // A display name, which does not identify anybody until it is shown to be unique.
  const name = q.toLowerCase();
  let row = await env.D1.prepare("SELECT account_key, occupants FROM names WHERE name = ?")
    .bind(name)
    .first<{ account_key: string; occupants: number }>();
  if (!row) {
    const legacyCount = Number(await env.DB.get(nameCountKey(q))) || 0;
    const legacyKey = legacyCount > 0 ? await env.DB.get(nameIndexKey(q)) : null;
    if (legacyKey) {
      row = { account_key: legacyKey, occupants: legacyCount };
      await env.D1.prepare(
        "INSERT OR REPLACE INTO names (name, account_key, occupants) VALUES (?, ?, ?)",
      )
        .bind(name, legacyKey, Math.max(1, legacyCount))
        .run();
    }
  }
  if (!row || row.occupants < 1) return null;
  if (row.occupants > 1) return { ambiguous: true };

  const record = await readAccountSummary(env, row.account_key);
  if (record && record.name.toLowerCase() === name) return record;
  return null;
}

/** The public facts about an account: enough to render a friend row. */
export async function readAccountSummary(env: SocialEnv, accountKey: string): Promise<Identity | null> {
  const raw = await env.DB.get(accountKey);
  if (!raw) return null;
  const rec = safeParse<{ email?: string; name?: string; sub?: string }>(raw, {});
  const handle = rec.email ?? "";
  const saveKey = saveKeyForRecord(rec);
  if (!handle || !saveKey) return null;
  return { handle, name: rec.name?.trim() || handle.split("@")[0] || handle, key: accountKey, saveKey };
}

/**
 * Release a display name an account no longer uses.
 *
 * `indexAccount` counts occupants per name and a lookup refuses a name shared by
 * more than one account. Renaming without a matching decrement would leave the old
 * name permanently over-counted — ambiguous forever to a friend search even after
 * the player who inflated it moved on. Only the recorded occupant may decrement:
 * a stale index pointing elsewhere means the count belongs to whoever is there.
 */
export async function unindexName(env: SocialEnv, accountKey: string, name: string): Promise<void> {
  const n = name.trim().toLowerCase();
  if (!n) return;
  const row = await env.D1.prepare("SELECT account_key, occupants FROM names WHERE name = ?")
    .bind(n)
    .first<{ account_key: string; occupants: number }>();
  if (!row || row.account_key !== accountKey) return;
  if (row.occupants > 0) {
    await env.D1.prepare("UPDATE names SET occupants = ? WHERE name = ?")
      .bind(row.occupants - 1, n)
      .run();
  }
}

/**
 * Keep the two indexes current. Called on every sign-in and by `readIdentity` on
 * every social request — which is why it reads first and writes only on a real
 * change: the friends panel polls three calls a tick, and an unconditional write
 * per call is how the KV build burned the day's write budget inside an hour.
 */
export async function indexAccount(env: SocialEnv, summary: Identity): Promise<void> {
  const handle = summary.handle.trim().toLowerCase();
  const name = summary.name.trim().toLowerCase();

  const prevHandle = await env.D1.prepare("SELECT account_key FROM handles WHERE handle = ?")
    .bind(handle)
    .first<string>("account_key");
  if (prevHandle !== summary.key) {
    await env.D1.prepare("INSERT OR REPLACE INTO handles (handle, account_key) VALUES (?, ?)")
      .bind(handle, summary.key)
      .run();
  }

  const row = await env.D1.prepare("SELECT account_key FROM names WHERE name = ?")
    .bind(name)
    .first<{ account_key: string }>();
  if (!row) {
    // First D1 occupant. The KV counter may already know about this name — honour it
    // once rather than restart the count, or a name shared before the move would
    // silently un-ambiguous itself.
    const legacy = Number(await env.DB.get(nameCountKey(name))) || 0;
    await env.D1.prepare("INSERT INTO names (name, account_key, occupants) VALUES (?, ?, ?)")
      .bind(name, summary.key, Math.max(1, legacy))
      .run();
  } else if (row.account_key !== summary.key) {
    // Counted only when this account is not already the name's occupant, so the
    // counter tracks distinct accounts rather than sign-ins.
    await env.D1.prepare("UPDATE names SET occupants = occupants + 1, account_key = ? WHERE name = ?")
      .bind(summary.key, name)
      .run();
  }
}

// --- the lazy migration -----------------------------------------------------

/**
 * Copy one user's three legacy KV blobs into D1 rows, once.
 *
 * Runs at the top of every social handler. The `social_migrated` marker makes the
 * check itself one read on later calls; a user with no legacy data is marked the
 * same way, so the absence of blobs is not re-checked forever. KV keys are deleted
 * after a successful copy — deleting early would make a failed import lose data,
 * keeping them would make a later read see two sources of truth.
 */
async function migrateLegacy(env: SocialEnv, me: Identity): Promise<void> {
  const done = await env.D1.prepare("SELECT owner_key FROM social_migrated WHERE owner_key = ?")
    .bind(me.key)
    .first<string>("owner_key");
  if (done) return;

  const imported: D1Prepared[] = [];

  const bookRaw = await env.DB.get(friendBookKey(me.key));
  if (bookRaw) {
    const book = safeParse<FriendBook>(bookRaw, { list: [] });
    for (const f of Array.isArray(book.list) ? book.list : []) {
      if (!f || typeof f.handle !== "string" || !f.handle) continue;
      imported.push(
        env.D1.prepare(
          "INSERT OR IGNORE INTO friends (owner_key, friend_handle, friend_key, friend_name, friend_save_key, since) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(me.key, f.handle, f.key ?? "", f.name ?? f.handle, f.saveKey ?? "", Number(f.since) || Date.now()),
      );
    }
  }

  const inboxRaw = await env.DB.get(inboxKey(me.key));
  if (inboxRaw) {
    const box = safeParse<Inbox>(inboxRaw, { list: [] });
    for (const i of Array.isArray(box.list) ? box.list : []) {
      if (!i || typeof i.id !== "string" || !i.id) continue;
      // Older invites do not name the challenger's account key — resolve it now so
      // the row carries it, and skip an invite whose sender can no longer be found.
      let fromKey = i.fromKey ?? "";
      if (!fromKey) {
        const resolved = await resolveTarget(env, i.from ?? "");
        if (!resolved || "ambiguous" in resolved) continue;
        fromKey = resolved.key;
      }
      imported.push(
        env.D1.prepare(
          "INSERT OR REPLACE INTO duels (id, from_key, to_key, to_handle, to_name, payload, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          i.id, fromKey, me.key, me.handle, me.name,
          JSON.stringify(i),
          i.state === "pending" || i.state === "declined" || i.state === "done" ? i.state : "pending",
          Number(i.at) || Date.now(),
        ),
      );
    }
  }

  const outRaw = await env.DB.get(outboxKey(me.key));
  if (outRaw) {
    const box = safeParse<Outbox>(outRaw, { list: [] });
    for (const s of Array.isArray(box.list) ? box.list : []) {
      if (!s || typeof s.id !== "string" || !s.id) continue;
      const resolved = await resolveTarget(env, s.to ?? "");
      if (!resolved || "ambiguous" in resolved) continue;
      // The sender's half of the letter, rebuilt as the same row the defender's
      // copy already is — OR IGNORE, because if their inbox import landed first
      // its payload is the richer one and should win.
      const payload: DuelInvite = {
        id: s.id,
        from: me.handle,
        fromName: me.name,
        plantName: s.plantName,
        plantPower: s.plantPower,
        at: s.at,
        state: s.state,
        resultKey: s.resultKey,
        fromKey: me.key,
        fromSaveKey: me.saveKey,
      };
      imported.push(
        env.D1.prepare(
          "INSERT OR IGNORE INTO duels (id, from_key, to_key, to_handle, to_name, payload, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(s.id, me.key, resolved.key, resolved.handle, resolved.name,
          JSON.stringify(payload), s.state, Number(s.at) || Date.now()),
      );
    }
  }

  if (imported.length) await env.D1.batch(imported);
  await env.D1.prepare("INSERT OR REPLACE INTO social_migrated (owner_key, at) VALUES (?, ?)")
    .bind(me.key, Date.now())
    .run();

  // Imported rows are now read from D1; the blobs would only shadow them.
  for (const key of [friendBookKey(me.key), inboxKey(me.key), outboxKey(me.key)]) {
    await env.DB.delete?.(key);
  }
}

// --- friends ----------------------------------------------------------------

/** One friend's row, as the list endpoint returns it. */
function friendFromRow(r: { friend_handle: string; friend_key: string; friend_name: string; friend_save_key: string; since: number }): Friend {
  return {
    handle: r.friend_handle,
    name: r.friend_name,
    key: r.friend_key,
    saveKey: r.friend_save_key,
    since: r.since,
  };
}

async function listFriends(env: SocialEnv, me: Identity): Promise<Friend[]> {
  const { results } = await env.D1.prepare(
    "SELECT friend_handle, friend_key, friend_name, friend_save_key, since FROM friends WHERE owner_key = ? ORDER BY since",
  ).bind(me.key).all<{ friend_handle: string; friend_key: string; friend_name: string; friend_save_key: string; since: number }>();
  return results.map(friendFromRow);
}

/**
 * One endpoint for the whole friend list, because three endpoints for add, remove and
 * list means three places to get the authorisation and the caps wrong.
 */
export async function handleFriend(
  req: Request,
  env: SocialEnv,
  me: Identity,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { action?: string; query?: string } | null;
  const action = String(body?.action ?? "list");

  await migrateLegacy(env, me);

  if (action === "list") {
    return ok({ friends: await listFriends(env, me) });
  }

  const query = String(body?.query ?? "").trim();
  if (!query) return fail("empty_query");

  if (action === "remove") {
    const gone = await env.D1.prepare(
      "DELETE FROM friends WHERE owner_key = ? AND lower(friend_handle) = ?",
    ).bind(me.key, query.toLowerCase()).run();
    if (gone.meta.changes === 0) return fail("not_a_friend", 404);
    return ok({ removed: query, friends: await listFriends(env, me) });
  }

  if (action === "add") {
    const count = await env.D1.prepare("SELECT COUNT(*) AS c FROM friends WHERE owner_key = ?")
      .bind(me.key)
      .first<number>("c");
    if ((count ?? 0) >= MAX_FRIENDS) return fail("friend_list_full", 409);

    // Adding yourself is the mistake everybody makes once, and the error is worth naming.
    if (query.toLowerCase() === me.handle.toLowerCase()) return fail("that_is_you");

    const target = await resolveTarget(env, query);
    if (!target) return fail("no_such_player", 404);
    if ("ambiguous" in target) return fail("ambiguous_name", 409);
    if (target.key === me.key) return fail("that_is_you");

    const dup = await env.D1.prepare(
      "SELECT friend_key FROM friends WHERE owner_key = ? AND friend_key = ?",
    ).bind(me.key, target.key).first<string>("friend_key");
    if (dup) return ok({ friends: await listFriends(env, me), already: true });

    // Stored with the handle as the identity, and the key beside it so a duel can find the
    // save without a second lookup. One-directional on purpose: adding someone is a thing
    // you do, and a mutual-approval flow would mean a second inbox and a second button for
    // a list whose only job is to offer a fight.
    const friend: Friend = {
      handle: target.handle,
      name: target.name,
      key: target.key,
      saveKey: target.saveKey,
      since: Date.now(),
    };
    await env.D1.prepare(
      "INSERT INTO friends (owner_key, friend_handle, friend_key, friend_name, friend_save_key, since) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(me.key, friend.handle, friend.key, friend.name, friend.saveKey, friend.since).run();
    return ok({ friends: await listFriends(env, me), added: friend });
  }

  return fail("unknown_action");
}

// --- duels ------------------------------------------------------------------

/** The inbox view of a duel row: the stored invite payload. */
function inviteFromRow(row: DuelRow): DuelInvite {
  return safeParse<DuelInvite>(row.payload, {
    id: row.id,
    from: "",
    fromName: "",
    plantName: "",
    plantPower: 0,
    at: row.created_at,
    state: "pending",
  });
}

/** The outbox view of the same row. */
function sentFromRow(row: DuelRow): SentDuel {
  const p = safeParse<Partial<DuelInvite>>(row.payload, {});
  return {
    id: row.id,
    to: row.to_handle,
    toName: row.to_name,
    plantName: p.plantName ?? "",
    plantPower: Number(p.plantPower) || 0,
    at: row.created_at,
    state: (row.state as SentDuel["state"]) || "pending",
    resultKey: p.resultKey,
  };
}

/**
 * Send a challenge.
 *
 * The challenger names one of their own plants by id; the Worker fetches it from their save.
 */
export async function handleDuelSend(
  env: SocialEnv,
  me: Identity,
  toHandle: string,
  plantId: string,
  mySave: unknown,
): Promise<Response> {
  await migrateLegacy(env, me);

  const target = await resolveTarget(env, toHandle);
  if (!target) return fail("no_such_player", 404);
  if ("ambiguous" in target) return fail("ambiguous_name", 409);
  if (target.key === me.key) return fail("that_is_you");

  // Challenges are between friends, which the client enforces by only offering the
  // button on friend rows — but the endpoint is public, and `not_a_friend` was already
  // a named refusal that nothing could ever return. Enforcing it here is what makes
  // "đấu với bạn" mean that rather than "đấu với bất kỳ ai biết email".
  const isFriend = await env.D1.prepare(
    "SELECT 1 AS x FROM friends WHERE owner_key = ? AND (friend_key = ? OR lower(friend_handle) = ?) LIMIT 1",
  ).bind(me.key, target.key, target.handle.toLowerCase()).first<{ x: number }>();
  if (!isFriend) return fail("not_a_friend", 403);

  const plant = plantFromSave(mySave, plantId);
  if (!plant) return fail("plant_not_in_your_garden", 404);

  // Two live challenges from the same person is a queue; five is a loophole for filling
  // somebody else's inbox so their real challenges cannot be seen.
  const already = await env.D1.prepare(
    "SELECT COUNT(*) AS c FROM duels WHERE to_key = ? AND from_key = ? AND state = 'pending' AND created_at > ?",
  ).bind(target.key, me.key, liveSince()).first<number>("c");
  if ((already ?? 0) >= 2) return fail("already_challenged", 429);

  const invite: DuelInvite = {
    id: crypto.randomUUID(),
    from: me.handle,
    fromName: me.name,
    plantName: plant.name,
    plantPower: Math.round(plant.powerRating ?? 0),
    at: Date.now(),
    state: "pending",
    fromKey: me.key,
    fromSaveKey: me.saveKey,
    fromPlantId: plant.plantId,
  };
  await env.D1.prepare(
    "INSERT INTO duels (id, from_key, to_key, to_handle, to_name, payload, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
  ).bind(invite.id, me.key, target.key, target.handle, target.name, JSON.stringify(invite), invite.at).run();

  // The challenger's own record of the letter is the same row read from the other
  // side — it exists the moment the insert lands, so a sent challenge can never
  // vanish into somebody else's inbox.
  return ok({ sent: invite.id, to: target.handle });
}

/** Everything I have sent, oldest first — the challenger's half of the duel flow. */
export async function handleDuelOutbox(env: SocialEnv, me: Identity): Promise<Response> {
  await migrateLegacy(env, me);
  const { results } = await env.D1.prepare(
    "SELECT * FROM duels WHERE from_key = ? AND created_at > ? ORDER BY created_at",
  ).bind(me.key, liveSince()).all<DuelRow>();
  return ok({ sent: results.map(sentFromRow) });
}

/** Everything waiting for me, oldest first so the order a player sees is stable. */
export async function handleDuelInbox(
  env: SocialEnv,
  me: Identity,
): Promise<Response> {
  await migrateLegacy(env, me);
  const { results } = await env.D1.prepare(
    "SELECT * FROM duels WHERE to_key = ? AND created_at > ? ORDER BY created_at",
  ).bind(me.key, liveSince()).all<DuelRow>();
  return ok({ invites: results.map(inviteFromRow) });
}

/**
 * Accept, and fight.
 *
 * Both fighters come out of the two saves, the fight is simulated here, and only the event
 * log is stored. The defender is the host of the result: they are the one who answered, so
 * the challenger polling for it can be told plainly that nothing has happened yet.
 */
export async function handleDuelAccept(
  env: SocialEnv,
  me: Identity,
  id: string,
  plantId: string,
  mySave: unknown,
): Promise<Response> {
  await migrateLegacy(env, me);

  const row = await env.D1.prepare(
    "SELECT * FROM duels WHERE id = ? AND to_key = ? AND state = 'pending' AND created_at > ?",
  ).bind(id, me.key, liveSince()).first<DuelRow>();
  if (!row) return fail("no_such_invite", 404);

  const invite = inviteFromRow(row);
  const mine = plantFromSave(mySave, plantId);
  if (!mine) return fail("plant_not_in_your_garden", 404);

  // New invites carry the challenger's account and save keys, so accepting is one read
  // and no lookup. Old ones fall back to resolving the handle, which is also how a
  // challenger whose account vanished is still caught.
  let challengerSaveKey = invite.fromSaveKey ?? "";
  if (!invite.fromKey || !challengerSaveKey) {
    const resolved = await resolveTarget(env, invite.from);
    if (!resolved || "ambiguous" in resolved) return fail("challenger_gone", 404);
    challengerSaveKey = resolved.saveKey;
  }
  const theirRaw = await env.DB.get(challengerSaveKey);
  const theirState = theirRaw
    ? safeParse<{ savedAt: number; state: unknown }>(theirRaw, { savedAt: 0, state: null }).state
    : null;
  // The exact plant the challenge named when it still existed — falling back to the
  // name only for invites written before the id was recorded.
  const theirs = plantFromSave(theirState, invite.fromPlantId ?? findPlantIdFor(theirState, invite.plantName));
  if (!theirs) return fail("challenger_plant_gone", 404);

  // Seeded from the invitation and the moment it was sent, so the same challenge always
  // produces the same fight. That determinism is the whole basis on which both sides can
  // replay one log and see the same thing.
  const seed = `${invite.id}:${invite.at}`;
  const result = simulateBattle(theirs, mine, {
    seed,
    maxSeconds: 90,
    arena: "sunny" as ArenaKind,
    stances: { a: "aggressive" as Stance, b: "aggressive" as Stance },
  });

  const payload: DuelResult = {
    id: invite.id,
    winner: result.winner,
    events: result.events as unknown[],
    a: result.a,
    b: result.b,
    durationSeconds: result.durationSeconds,
    timeouts: result.timeouts,
    log: result.log,
    seed: result.seed,
    aName: theirs.name,
    bName: mine.name,
    aPower: Math.round(theirs.powerRating ?? 0),
    bPower: Math.round(mine.powerRating ?? 0),
    aPlant: theirs,
    bPlant: mine,
  };
  const resultKey = duelResultKey(invite.id);
  if (env.REPLAYS) {
    await env.REPLAYS.put(resultKey, JSON.stringify(payload));
  } else {
    await env.D1.prepare("INSERT OR REPLACE INTO duel_results (id, payload) VALUES (?, ?)")
      .bind(invite.id, JSON.stringify(payload))
      .run();
  }

  invite.state = "done";
  invite.toPlantName = mine.name;
  invite.toPlantPower = Math.round(mine.powerRating ?? 0);
  invite.resultKey = resultKey;

  // One update closes the loop for both sides: the sender's next outbox read sees
  // state=done and the result key, the defender's inbox shows the answer they gave.
  await env.D1.prepare("UPDATE duels SET state = 'done', payload = ? WHERE id = ?")
    .bind(JSON.stringify(invite), invite.id)
    .run();

  return ok({ result: payload });
}

/** Turn down a challenge. The row stays, marked, rather than vanishing. */
export async function handleDuelDecline(
  env: SocialEnv,
  me: Identity,
  id: string,
): Promise<Response> {
  await migrateLegacy(env, me);

  const row = await env.D1.prepare(
    "SELECT * FROM duels WHERE id = ? AND to_key = ? AND state = 'pending' AND created_at > ?",
  ).bind(id, me.key, liveSince()).first<DuelRow>();
  if (!row) return fail("no_such_invite", 404);

  const invite = { ...inviteFromRow(row), state: "declined" as const };
  await env.D1.prepare("UPDATE duels SET state = 'declined', payload = ? WHERE id = ?")
    .bind(JSON.stringify(invite), invite.id)
    .run();

  const { results } = await env.D1.prepare(
    "SELECT * FROM duels WHERE to_key = ? AND created_at > ? ORDER BY created_at",
  ).bind(me.key, liveSince()).all<DuelRow>();
  return ok({ invites: results.map(inviteFromRow) });
}

/** Read a finished fight. Open to both participants; the id is the capability. */
export async function handleDuelResult(env: SocialEnv, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return fail("bad_id");
  const key = duelResultKey(id);
  if (env.REPLAYS) {
    const obj = await env.REPLAYS.get(key);
    if (obj) return ok({ result: safeParse<DuelResult>(await obj.text(), null as unknown as DuelResult) });
  }
  // Results written while R2 was unbound still live in D1 — a miss above falls
  // through here rather than 404ing a replay that exists.
  const row = await env.D1.prepare("SELECT payload FROM duel_results WHERE id = ?").bind(id).first<string>("payload");
  if (row) return ok({ result: safeParse<DuelResult>(row, null as unknown as DuelResult) });
  // Fights finished before the move live on under their KV key — read, never written.
  const raw = await env.DB.get(key);
  if (!raw) return fail("no_such_duel", 404);
  return ok({ result: safeParse<DuelResult>(raw, null as unknown as DuelResult) });
}

/**
 * Which of the challenger's plants the invitation names.
 *
 * The invite carries a *name*, because that is what the inbox line shows. A friend can own
 * two plants of one species, so the name can be ambiguous and the first match is used.
 *
 * That is a fairness question rather than a security one, and it resolves in the
 * challenger's favour: the candidates are only ever the challenger's own plants, the fight
 * is symmetric, and the defender still picks their own side. Nothing is chosen from the
 * defender's garden by a name somebody else supplied.
 */
function findPlantIdFor(state: unknown, plantName: string): string {
  if (!state || typeof state !== "object") return "";
  const plants = (state as { plants?: unknown }).plants;
  if (!Array.isArray(plants)) return "";
  for (const p of plants) {
    if (p && typeof p === "object" && (p as Plant).name === plantName) return (p as Plant).plantId;
  }
  return "";
}

/** Parse without throwing. Stored payloads are bytes a previous build wrote. */
function safeParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
