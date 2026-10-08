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
 * ## Identity, and why it is the email
 *
 * A Google display name is not unique - two people are called Minh - so a name cannot be an
 * identity. The account's email already is: it is the key for password accounts and it is
 * stored on Google accounts too. So a friend is stored by email, and the display name is
 * carried alongside purely so the list can be read without another lookup.
 *
 * Searching accepts either. An email resolves exactly; a name resolves only if it is
 * unambiguous, and an ambiguous name is refused with the candidates rather than silently
 * picking one - which would be a way to challenge a stranger by accident.
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
 * The slice of KV this module uses.
 *
 * Structural rather than `KVNamespace` on purpose. The real `Env` satisfies it, and so
 * does a hand-written fake - which is what lets the friend list and the duel be tested
 * directly, in Node, with no Cloudflare type package dragged into the browser toolchain and
 * no HTTP server standing between a test and the code it is checking.
 *
 * Two methods, because two methods is all it uses. Widening this to `KVNamespace` later
 * would be a downgrade: it would make the test file need the Workers types to compile.
 */
export interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** The environment these handlers need: a store and nothing else. */
export interface KvEnv {
  DB: Kv;
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
 * either. The outbox is the missing half of the correspondence.
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

/** The resolved fight. Small enough for KV, and read-only once written. */
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
}

// --- keys -------------------------------------------------------------------

export const friendBookKey = (accountKey: string) => `friends:${accountKey}`;
export const inboxKey = (accountKey: string) => `inbox:${accountKey}`;
export const outboxKey = (accountKey: string) => `outbox:${accountKey}`;
export const duelResultKey = (id: string) => `duel:${id}`;
/**
 * Email to account key.
 *
 * Written on every sign-in rather than at registration, so it cannot be forgotten: an
 * account that has never signed in since this feature shipped is not findable, which is
 * the correct behaviour for a friend list rather than a bug.
 */
export const handleIndexKey = (handle: string) => `handle:${handle.trim().toLowerCase()}`;
/**
 * Display name to account key.
 *
 * Holds one account, because a name can be shared. Read only together with
 * `nameCountKey`, which is what turns "somebody called Minh" into "somebody, and possibly
 * more than one somebody".
 */
export const nameIndexKey = (name: string) => "name:" + name.trim().toLowerCase();

/** How many distinct accounts have signed in under this display name. */
export const nameCountKey = (name: string) => "namecount:" + name.trim().toLowerCase();

/** What a lookup found. A shared name is its own answer, not a failure to find. */
export type Resolution = Identity | { ambiguous: true } | null;

// --- limits -----------------------------------------------------------------

/**
 * Caps, because every one of these is a KV write and the free tier allows about a
 * thousand a day. They are also just the right size: a friend list you cannot scan and
 * an inbox you cannot clear are both worse than a small one.
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

/** Drop anything older than the TTL, so a stale invite cannot be accepted tomorrow. */
function live<T extends { at: number }>(invites: T[], now: number): T[] {
  return invites.filter((i) => now - i.at < INVITE_TTL_MS).slice(-MAX_INBOX);
}

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
 */
export async function resolveTarget(env: KvEnv, query: string): Promise<Resolution> {
  const q = query.trim();
  if (!q) return null;

  const byHandle = await env.DB.get(handleIndexKey(q));
  if (byHandle) {
    const record = await readAccountSummary(env, byHandle);
    // The index can outlive the account it names, so the handle is confirmed against the
    // record rather than trusted.
    if (record && record.handle.toLowerCase() === q.toLowerCase()) return record;
  }

  // A display name, which does not identify anybody until it is shown to be unique.
  const count = Number(await env.DB.get(nameCountKey(q))) || 0;
  if (count > 1) return { ambiguous: true };
  if (count === 1) {
    const byName = await env.DB.get(nameIndexKey(q));
    if (byName) {
      const record = await readAccountSummary(env, byName);
      if (record && record.name.toLowerCase() === q.toLowerCase()) return record;
    }
  }

  return null;
}

/** The public facts about an account: enough to render a friend row. */
export async function readAccountSummary(env: KvEnv, accountKey: string): Promise<Identity | null> {
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
export async function unindexName(env: KvEnv, accountKey: string, name: string): Promise<void> {
  if (!name.trim()) return;
  const ni = nameIndexKey(name);
  const previous = await env.DB.get(ni);
  if (previous !== accountKey) return;
  const seen = Number(await env.DB.get(nameCountKey(name))) || 0;
  if (seen > 0) await env.DB.put(nameCountKey(name), String(seen - 1));
}

/** Keep the two indexes current. Called on every sign-in. */
export async function indexAccount(env: KvEnv, summary: Identity): Promise<void> {
  // Read the name's current occupant *before* overwriting it. The comparison has to be
  // against what was there a moment ago, and doing it after the write compares the key
  // against itself - so the count never moves and the ambiguity check never fires.
  const ni = nameIndexKey(summary.name);
  const previous = await env.DB.get(ni);
  const isNewOccupant = previous !== summary.key;

  await env.DB.put(handleIndexKey(summary.handle), summary.key);
  await env.DB.put(ni, summary.key);

  // Counted only when this account is not already the name's occupant, so the counter
  // tracks distinct accounts rather than sign-ins, and an ordinary return visit costs one
  // write instead of three.
  if (isNewOccupant) {
    const seen = Number(await env.DB.get(nameCountKey(summary.name))) || 0;
    await env.DB.put(nameCountKey(summary.name), String(seen + 1));
  }
}

// --- friends ----------------------------------------------------------------

/**
 * One endpoint for the whole friend list, because three endpoints for add, remove and
 * list means three places to get the authorisation and the caps wrong.
 */
export async function handleFriend(
  req: Request,
  env: KvEnv,
  me: Identity,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { action?: string; query?: string } | null;
  const action = String(body?.action ?? "list");

  const raw = await env.DB.get(friendBookKey(me.key));
  const book: FriendBook = raw
    ? safeParse<FriendBook>(raw, { list: [] })
    : { list: [] };
  book.list = Array.isArray(book.list) ? book.list.filter((f) => f && typeof f.handle === "string") : [];

  if (action === "list") {
    return ok({ friends: book.list });
  }

  const query = String(body?.query ?? "").trim();
  if (!query) return fail("empty_query");

  if (action === "remove") {
    const before = book.list.length;
    // Matched case-insensitively on the handle, so removing does not depend on how the
    // address was typed when it was added.
    book.list = book.list.filter((f) => f.handle.toLowerCase() !== query.toLowerCase());
    if (book.list.length === before) return fail("not_a_friend", 404);
    await env.DB.put(friendBookKey(me.key), JSON.stringify(book));
    return ok({ removed: query, friends: book.list });
  }

  if (action === "add") {
    if (book.list.length >= MAX_FRIENDS) return fail("friend_list_full", 409);

    // Adding yourself is the mistake everybody makes once, and the error is worth naming.
    if (query.toLowerCase() === me.handle.toLowerCase()) return fail("that_is_you");

    const target = await resolveTarget(env, query);
    if (!target) return fail("no_such_player", 404);
    if ("ambiguous" in target) return fail("ambiguous_name", 409);
    if (target.key === me.key) return fail("that_is_you");

    if (book.list.some((f) => f.key === target.key)) return ok({ friends: book.list, already: true });

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
    book.list.push(friend);
    await env.DB.put(friendBookKey(me.key), JSON.stringify(book));
    return ok({ friends: book.list, added: friend });
  }

  return fail("unknown_action");
}

// --- duels ------------------------------------------------------------------

/**
 * Send a challenge.
 *
 * The challenger names one of their own plants by id; the Worker fetches it from their save.
 */
export async function handleDuelSend(
  env: KvEnv,
  me: Identity,
  toHandle: string,
  plantId: string,
  mySave: unknown,
): Promise<Response> {
  const target = await resolveTarget(env, toHandle);
  if (!target) return fail("no_such_player", 404);
  if ("ambiguous" in target) return fail("ambiguous_name", 409);
  if (target.key === me.key) return fail("that_is_you");

  // Challenges are between friends, which the client enforces by only offering the
  // button on friend rows — but the endpoint is public, and `not_a_friend` was already
  // a named refusal that nothing could ever return. Enforcing it here is what makes
  // "đấu với bạn" mean that rather than "đấu với bất kỳ ai biết email".
  const bookRaw = await env.DB.get(friendBookKey(me.key));
  const book: FriendBook = bookRaw ? safeParse<FriendBook>(bookRaw, { list: [] }) : { list: [] };
  const isFriend = Array.isArray(book.list) && book.list.some(
    (f) => f && (f.key === target.key || f.handle.toLowerCase() === target.handle.toLowerCase()),
  );
  if (!isFriend) return fail("not_a_friend", 403);

  const plant = plantFromSave(mySave, plantId);
  if (!plant) return fail("plant_not_in_your_garden", 404);

  const raw = await env.DB.get(inboxKey(target.key));
  const inbox: Inbox = raw ? safeParse<Inbox>(raw, { list: [] }) : { list: [] };
  inbox.list = live(Array.isArray(inbox.list) ? inbox.list : [], Date.now());

  // Two live challenges from the same person is a queue; five is a loophole for filling
  // somebody else's inbox so their real challenges cannot be seen.
  const already = inbox.list.filter((i) => i.from === me.handle && i.state === "pending").length;
  if (already >= 2) return fail("already_challenged", 429);

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
  inbox.list.push(invite);

  // The challenger's own record of the letter, so accepting it later can tell the sender
  // what happened instead of the challenge vanishing into somebody else's inbox.
  const outRaw = await env.DB.get(outboxKey(me.key));
  const outbox: Outbox = outRaw ? safeParse<Outbox>(outRaw, { list: [] }) : { list: [] };
  outbox.list = live(Array.isArray(outbox.list) ? outbox.list : [], Date.now());
  const sentRow: SentDuel = {
    id: invite.id,
    to: target.handle,
    toName: target.name,
    plantName: plant.name,
    plantPower: Math.round(plant.powerRating ?? 0),
    at: invite.at,
    state: "pending",
  };
  outbox.list.push(sentRow);

  await Promise.all([
    env.DB.put(inboxKey(target.key), JSON.stringify(inbox)),
    env.DB.put(outboxKey(me.key), JSON.stringify(outbox)),
  ]);
  return ok({ sent: invite.id, to: target.handle });
}

/** Everything I have sent, oldest first — the challenger's half of the duel flow. */
export async function handleDuelOutbox(env: KvEnv, me: Identity): Promise<Response> {
  const raw = await env.DB.get(outboxKey(me.key));
  const box: Outbox = raw ? safeParse<Outbox>(raw, { list: [] }) : { list: [] };
  const kept = live(Array.isArray(box.list) ? box.list : [], Date.now());
  if (kept.length !== (box.list?.length ?? 0)) {
    await env.DB.put(outboxKey(me.key), JSON.stringify({ list: kept }));
  }
  return ok({ sent: kept });
}

/** Everything waiting for me, oldest first so the order a player sees is stable. */
export async function handleDuelInbox(
  env: KvEnv,
  me: Identity,
): Promise<Response> {
  const raw = await env.DB.get(inboxKey(me.key));
  const inbox: Inbox = raw ? safeParse<Inbox>(raw, { list: [] }) : { list: [] };
  const kept = live(Array.isArray(inbox.list) ? inbox.list : [], Date.now());
  // Only written back when something actually expired, so a poll does not spend a write
  // on an unchanged inbox.
  if (kept.length !== (inbox.list?.length ?? 0)) {
    await env.DB.put(inboxKey(me.key), JSON.stringify({ list: kept }));
  }
  return ok({ invites: kept });
}

/**
 * Accept, and fight.
 *
 * Both fighters come out of the two saves, the fight is simulated here, and only the event
 * log is stored. The defender is the host of the result: they are the one who answered, so
 * the challenger polling for it can be told plainly that nothing has happened yet.
 */
export async function handleDuelAccept(
  env: KvEnv,
  me: Identity,
  id: string,
  plantId: string,
  mySave: unknown,
): Promise<Response> {
  const raw = await env.DB.get(inboxKey(me.key));
  const inbox: Inbox = raw ? safeParse<Inbox>(raw, { list: [] }) : { list: [] };
  const invites = live(Array.isArray(inbox.list) ? inbox.list : [], Date.now());
  const at = invites.findIndex((i) => i.id === id && i.state === "pending");
  if (at < 0) return fail("no_such_invite", 404);

  const invite = invites[at];
  const mine = plantFromSave(mySave, plantId);
  if (!mine) return fail("plant_not_in_your_garden", 404);

  // New invites carry the challenger's account and save keys, so accepting is one read
  // and no lookup. Old ones fall back to resolving the handle, which is also how a
  // challenger whose account vanished is still caught.
  let challengerKey = invite.fromKey ?? "";
  let challengerSaveKey = invite.fromSaveKey ?? "";
  if (!challengerKey || !challengerSaveKey) {
    const resolved = await resolveTarget(env, invite.from);
    if (!resolved || "ambiguous" in resolved) return fail("challenger_gone", 404);
    challengerKey = resolved.key;
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
  };
  await env.DB.put(duelResultKey(invite.id), JSON.stringify(payload));

  invite.state = "done";
  invite.toPlantName = mine.name;
  invite.toPlantPower = Math.round(mine.powerRating ?? 0);
  invite.resultKey = duelResultKey(invite.id);
  invites[at] = invite;

  const writes: Promise<unknown>[] = [env.DB.put(inboxKey(me.key), JSON.stringify({ list: invites }))];

  // Close the loop for the sender: their outbox row flips to done and points at the
  // result, so a challenge they sent can be watched rather than wondered about.
  writes.push(markSentDuel(env, challengerKey, invite.id, "done", duelResultKey(invite.id)));

  await Promise.all(writes);
  return ok({ result: payload });
}

/** Turn down a challenge. The row stays, marked, rather than vanishing. */
export async function handleDuelDecline(
  env: KvEnv,
  me: Identity,
  id: string,
): Promise<Response> {
  const raw = await env.DB.get(inboxKey(me.key));
  const inbox: Inbox = raw ? safeParse<Inbox>(raw, { list: [] }) : { list: [] };
  const invites = live(Array.isArray(inbox.list) ? inbox.list : [], Date.now());
  const at = invites.findIndex((i) => i.id === id && i.state === "pending");
  if (at < 0) return fail("no_such_invite", 404);
  const invite = invites[at];
  invites[at] = { ...invite, state: "declined" };

  const writes: Promise<unknown>[] = [env.DB.put(inboxKey(me.key), JSON.stringify({ list: invites }))];

  // The sender's outbox needs a key rather than a handle, which old invites do not
  // carry — resolve it in that case, and skip quietly if the account is gone.
  let challengerKey = invite.fromKey ?? "";
  if (!challengerKey) {
    const resolved = await resolveTarget(env, invite.from);
    if (resolved && !("ambiguous" in resolved)) challengerKey = resolved.key;
  }
  if (challengerKey) writes.push(markSentDuel(env, challengerKey, invite.id, "declined"));

  await Promise.all(writes);
  return ok({ invites });
}

/**
 * Update the challenger's own record of a sent invite. A missing outbox — the invite
 * predates it — is skipped rather than created, because a declined or finished duel
 * nobody can match to a sent row is not worth a write.
 */
async function markSentDuel(env: KvEnv, accountKey: string, id: string, state: "done" | "declined", resultKey?: string): Promise<void> {
  const raw = await env.DB.get(outboxKey(accountKey));
  if (!raw) return;
  const box = safeParse<Outbox>(raw, { list: [] });
  const row = Array.isArray(box.list) ? box.list.find((s) => s.id === id) : undefined;
  if (!row || row.state !== "pending") return;
  row.state = state;
  if (resultKey) row.resultKey = resultKey;
  await env.DB.put(outboxKey(accountKey), JSON.stringify(box));
}

/** Read a finished fight. Open to both participants; the id is the capability. */
export async function handleDuelResult(env: KvEnv, id: string): Promise<Response> {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) return fail("bad_id");
  const raw = await env.DB.get(duelResultKey(id));
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

/** Parse without throwing. KV holds bytes a previous build wrote. */
function safeParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
