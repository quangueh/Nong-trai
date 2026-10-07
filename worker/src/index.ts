/**
 * Cloudflare Worker — accounts and named saves.
 *
 * Deployed separately from the game, which stays a static site. The game talks to
 * this over four endpoints and nothing else.
 *
 *   POST /api/register   { email, password }        -> { token, player }
 *   POST /api/login      { email, password }        -> { token, player }
 *   POST /api/google     { idToken }                -> { token, player, created }
 *   GET  /api/save                                  -> { savedAt, state } | 404
 *   PUT  /api/save       { savedAt, state }         -> { savedAt }
 *   POST /api/password   { token, current, next }   -> { ok }
 *
 * Two decisions worth stating up front, because both are forced by KV rather than
 * chosen:
 *
 *   KV is eventually consistent. A write in one region is not visible in another
 *   for up to 60 seconds. That is fatal if KV is the source of truth — a player who
 *   logs in in Singapore right after saving in Amsterdam would load a stale garden
 *   and lose the difference. So it is not the source of truth: the game keeps
 *   playing against localStorage and treats this as a *named backup* that syncs on
 *   login, on demand, and occasionally. Conflicts are resolved by `savedAt`, and
 *   the loser is reported rather than silently dropped.
 *
 *   KV's free tier allows about a thousand writes a day. Saving on every mutation
 *   would exhaust that in an afternoon, so the client is careful about when it
 *   pushes, and the worker counts writes per account to make the cost visible.
 *
 * Passwords are stretched with PBKDF2 rather than hashed once: a fast hash on a
 * leaked KV is a rainbow table, and KV is a key-value store, not a secret store.
 *
 * Tokens are HMAC-signed rather than looked up, so an authenticated request costs
 * no KV read. That matters because the read is the eventual-consistent one.
 */

import { googleAccountKey, googleSaveKey, verifyGoogleIdToken } from "./google";
import { routeRoom } from "./room";
import {
  handleDuelAccept,
  handleDuelDecline,
  handleDuelInbox,
  handleDuelOutbox,
  handleDuelResult,
  handleDuelSend,
  handleFriend,
  indexAccount,
  type Identity,
} from "./social";

export interface Env {
  /** KV namespace holding both accounts and saves. */
  DB: KVNamespace;
  /** HMAC key for session tokens. Must be set; the worker refuses to boot without it. */
  TOKEN_SECRET: string;
  /** PBKDF2 rounds. Higher is slower to attack and slower to log in. */
  PBKDF2_ROUNDS?: string;
  /**
   * The Google OAuth client ID the game is published under.
   *
   * Required for `/api/google` and nothing else: without it that route answers
   * `google_not_configured` and password sign-in is unaffected. The worker's own client
   * secret is deliberately not used or needed — the client ID token is verified with
   * Google's published public keys, so there is no secret on this side to leak.
   */
  GOOGLE_CLIENT_ID?: string;
}

interface Account {
  email: string;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  playerId: string;
  createdAt: number;
  /** Display name for the friend list. Absent on older records; the email prefix is used. */
  name?: string;
  /** Counted so a client that syncs too eagerly is visible rather than mysterious. */
  writes: number;
}

const ROK = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Errors carry a `code` the client switches on, so messages can be localised. */
const RKO = (code: string, status = 400, extra: Record<string, unknown> = {}): Response =>
  ROK({ error: code, ...extra }, status);

// --- password stretching ---------------------------------------------------

const enc = new TextEncoder();

/*
 * Accepts either an `ArrayBuffer` or a `Uint8Array`.
 *
 * The signature used to be `ArrayBuffer` alone while the body immediately wrapped its
 * argument in `new Uint8Array(...)`. Callers pass both kinds: `stretch` returns an
 * `ArrayBuffer` from `crypto.subtle.deriveBits`, while `TextEncoder.encode` returns a
 * `Uint8Array`. That mismatch was invisible because `@cloudflare/workers-types` had
 * never been installed under `worker/`, so `tsc` had never actually run over this file.
 * Installing the declared devDependency is what surfaced it.
 */
const b64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

/**
 * A short random identifier, for a `playerId` minted on the server.
 *
 * Not a UUID: the id is stored inside every save blob and compared on every sync, so
 * it is kept short. 12 bytes of `crypto.getRandomValues` is far more than enough to
 * make guessing one pointless, and it is not derived from anything guessable about the
 * account — the point of minting it here rather than accepting it from the client is
 * that a caller cannot attach a Google identity to a garden that is not its own.
 */
const randomHex = (bytes: number): string => {
  const b = randomBytes(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
};

/**
 * PBKDF2 rounds, clamped to what Cloudflare Workers will actually run.
 *
 * Workers reject a `deriveBits` call asking for more than 100,000 PBKDF2 iterations —
 * the whole call throws, not just the tail of it. The endpoint then answered a generic
 * `server` and registration was simply broken, which is how this was found: it passed
 * every local test, because Node's crypto has no such limit and `test-*.ts` never
 * touches the Worker.
 *
 * So the value is clamped rather than trusted. A var that asks for 150,000 - which is
 * what this file shipped with, and what `PBKDF2_ROUNDS` still says - now silently
 * becomes 100,000 instead of killing the endpoint. Clamping is the right response to a
 * platform ceiling: the ceiling is not negotiable, so the only choice is between
 * honouring it and refusing to start.
 *
 * 100,000 rounds of PBKDF2-SHA256 is below what OWASP currently recommends (600,000),
 * and that gap is the platform's, not this file's. It is stated here rather than left
 * for someone to assume it was a deliberate choice.
 */
const PBKDF2_CEILING = 100_000;

function pbkdf2Rounds(env: Env): number {
  const asked = Number(env.PBKDF2_ROUNDS ?? PBKDF2_CEILING);
  if (!Number.isFinite(asked) || asked <= 0) return PBKDF2_CEILING;
  return Math.min(Math.floor(asked), PBKDF2_CEILING);
}

async function stretch(password: string, salt: Uint8Array, rounds: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: rounds, hash: "SHA-256" },
    key,
    256,
  );
}

// --- tokens ---------------------------------------------------------------

/**
 * `base64url(payload).base64url(hmac)`.
 *
 * Stateless on purpose: verifying must not read KV, because a KV read is
 * eventually consistent and a token that sometimes fails to verify is a support
 * ticket rather than a bug report. The payload carries an expiry.
 */
async function sign(payload: object, secret: string): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(payload)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let s = "";
  for (const b of mac) s += String.fromCharCode(b);
  const sig = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${body}.${sig}`;
}

interface Session {
  /** Present for password accounts. */
  email?: string;
  /** Present for Google accounts. Google's stable account id. */
  sub?: string;
  exp: number;
}

/**
 * Verify one of our own HMAC session tokens.
 *
 * Returns the subject without touching KV, which is the whole point of signing rather
 * than looking the account up: KV is eventually consistent, so a read after a write can
 * miss, and a login that appeared to fail because of it would be maddening.
 *
 * Either `email` or `sub` is set, never both — see the note on `googleAccountKey` for why
 * the two namespaces are kept apart rather than merged on address.
 */
async function verify(token: string, secret: string): Promise<Session | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let macBytes: Uint8Array;
  try {
    const raw = atob(sig.replace(/-/g, "+").replace(/_/g, "/"));
    macBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) macBytes[i] = raw.charCodeAt(i);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", key, macBytes as unknown as BufferSource, enc.encode(body));
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as Session;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    // Exactly one subject, or the token names an account that cannot be looked up.
    const hasEmail = typeof payload.email === "string" && payload.email.length > 0;
    const hasSub = typeof payload.sub === "string" && payload.sub.length > 0;
    if (hasEmail === hasSub) return null;
    return payload;
  } catch {
    return null;
  }
}

const accountKey = (email: string): string => `acct:${email}`;
const saveKey = (email: string): string => `save:${email}`;

/**
 * Publish an account to the friend-search indexes.
 *
 * This used to happen only inside `readIdentity` — which runs for `/api/friend` and
 * `/api/duel` and nothing else. An account that had signed in but never opened the
 * friends panel was absent from both indexes, so adding anyone by name or email
 * answered `no_such_player` until the *target* happened to use the feature first.
 * Indexing here, at the moment an identity is established, is what the design doc
 * for the index already describes.
 */
function identityFor(key: string, save: string, email: string, name?: string): Identity {
  return { handle: email, name: name?.trim() || email.split("@")[0] || email, key, saveKey: save };
}

/** Ninety days, matching the password session. */
const SESSION_MS = 1000 * 60 * 60 * 24 * 90;

/**
 * A Google-backed account.
 *
 * A separate shape from `Account` rather than a variant of it, because the two have
 * nothing in common but a `playerId`: there is no salt and no hash here, and pretending
 * otherwise would invite code that reads `account.hash` on a record that has none.
 */
interface GoogleAccount {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  playerId: string;
  createdAt: number;
  writes: number;
}

// --- a small fixed-window limiter ------------------------------------------

/**
 * Crude by design: five attempts per email per minute.
 *
 * KV cannot do this atomically, so a determined attacker can beat it by racing.
 * It is here to stop someone grinding passwords against a leaked namespace, not to
 * be a security boundary — the real boundary is the PBKDF2 cost per attempt.
 */
async function throttled(env: Env, email: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 60000);
  const key = `rl:${email}:${bucket}`;
  const n = Number((await env.DB.get(key)) ?? "0") + 1;
  await env.DB.put(key, String(n), { expirationTtl: 120 });
  return n > 5;
}

async function handleRegister(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  // Deliberately loose. The address is only a login handle; being fussy about
  // the domain rejects real players over a typo and teaches nothing.
  if (!email.includes("@") || email.length > 200) return RKO("bad_email");
  if (password.length < 8) return RKO("weak_password", 400, { min: 8 });
  if (password.length > 200) return RKO("weak_password", 400, { max: 200 });
  if (await throttled(env, email)) return RKO("too_many", 429);

  if (await env.DB.get(accountKey(email))) return RKO("taken", 409);

  const salt = randomBytes(16);
  const rounds = pbkdf2Rounds(env);
  const hash = await stretch(password, salt, rounds);

  const account: Account = {
    email,
    salt: b64(salt.buffer as ArrayBuffer),
    hash: b64(hash),
    playerId: `pl_${b64(randomBytes(9).buffer as ArrayBuffer).replace(/[^a-zA-Z0-9]/g, "").slice(0, 14)}`,
    createdAt: Date.now(),
    writes: 0,
  };
  await env.DB.put(accountKey(email), JSON.stringify(account));
  await indexAccount(env, identityFor(accountKey(email), saveKey(email), email));
  return ROK({ playerId: account.playerId }, 201);
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password) return RKO("missing");

  const raw = await env.DB.get(accountKey(email));
  // Run the stretch even when there is no account.
  //
  // Returning early on a miss would make "no such user" measurably faster than
  // "wrong password", which is a free account-enumeration oracle. The constant-time
  // shape here costs one hash on a miss and buys not answering the question.
  const salt = raw ? unb64((JSON.parse(raw) as Account).salt) : new Uint8Array(16);
  const rounds = pbkdf2Rounds(env);
  const hash = await stretch(password, salt, rounds);

  if (!raw) {
    await stretch(password, salt, rounds);
    return RKO("bad_credentials", 401);
  }
  const account = JSON.parse(raw) as Account;
  if (b64(hash) !== account.hash) return RKO("bad_credentials", 401);

  await indexAccount(env, identityFor(accountKey(email), saveKey(email), email, account.name));
  const token = await sign({ email, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 }, env.TOKEN_SECRET);
  return ROK({ token, playerId: account.playerId });
}

/**
 * Sign in with a Google ID token.
 *
 * Verifies the token, then issues one of our own session tokens. The account is created
 * on first sight — there is no separate "link your Google" step, because a player
 * pressing "sign in with Google" expects to be in, not to be asked to prove they are
 * also a password user.
 *
 * No password is stored and none can be set on this path. `handleChangePassword` reads
 * `account.hash`, which is absent here, so it refuses; the client hides the row. That is
 * a real limitation rather than an oversight and the account sheet says so, because
 * "my password does not work" is a much worse experience than "this account has no
 * password".
 */
async function handleGoogleSignIn(req: Request, env: Env): Promise<Response> {
  const clientId = String(env.GOOGLE_CLIENT_ID ?? "").trim();
  if (!clientId) return RKO("google_not_configured", 503);

  const body = (await req.json().catch(() => null)) as { idToken?: string } | null;
  const idToken = String(body?.idToken ?? "").trim();
  if (!idToken) return RKO("missing");

  const verdict = await verifyGoogleIdToken(idToken, clientId);
  // The reason goes to the server log, not to the client: it names which check failed,
  // which is useful for whoever is deploying this and is free reconnaissance for anyone
  // probing the endpoint.
  if (!verdict.ok) {
    console.warn("google sign-in refused:", verdict.reason);
    return RKO("google_rejected", 401);
  }

  const claims = verdict.claims;
  const key = googleAccountKey(claims.sub);
  const existing = await env.DB.get(key);

  if (existing) {
    const account = JSON.parse(existing) as GoogleAccount;
    await indexAccount(env, identityFor(key, googleSaveKey(account.sub), account.email, account.name));
    const token = await sign({ sub: account.sub, exp: Date.now() + SESSION_MS }, env.TOKEN_SECRET);
    return ROK({
      token,
      playerId: account.playerId,
      name: account.name,
      email: account.email,
      picture: account.picture,
      created: false,
    });
  }

  // A first sign-in. `playerId` is minted here rather than accepted from the client,
  // so a caller cannot attach a Google account to a save that is not its own.
  const playerId = `g_${randomHex(12)}`;
  const account: GoogleAccount = {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? claims.email,
    picture: claims.picture,
    playerId,
    createdAt: Date.now(),
    writes: 0,
  };
  await env.DB.put(key, JSON.stringify(account));
  await indexAccount(env, identityFor(key, googleSaveKey(account.sub), account.email, account.name));

  const token = await sign({ sub: claims.sub, exp: Date.now() + SESSION_MS }, env.TOKEN_SECRET);
  return ROK({
    token,
    playerId,
    name: account.name,
    email: account.email,
    picture: account.picture,
    created: true,
  });
}

/** The save key for whichever kind of session this is. */
const keyFor = (auth: Session, env: Env): string =>
  auth.sub ? googleSaveKey(auth.sub) : saveKey(auth.email!);

async function handleGetSave(auth: Session, env: Env): Promise<Response> {
  const raw = await env.DB.get(keyFor(auth, env));
  if (!raw) return RKO("no_save", 404);
  const rec = JSON.parse(raw) as { savedAt: number; state: unknown };
  return ROK(rec);
}

/**
 * Last write wins, decided by `savedAt` and never by arrival order.
 *
 * Arrival order would be wrong on its face: two devices offline for a week come
 * back, and whichever request happened to reach the edge first would win regardless
 * of which save was actually newer. Comparing the timestamps makes the newer game
 * the survivor, and the response says so either way so the client can warn.
 */
async function handlePutSave(req: Request, auth: Session, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { savedAt?: number; state?: unknown } | null;
  if (typeof body?.savedAt !== "number" || body.state === undefined) return RKO("bad_body");

  const key = keyFor(auth, env);
  const existing = await env.DB.get(key);
  if (existing) {
    const prev = JSON.parse(existing) as { savedAt: number };
    if (body.savedAt < prev.savedAt) {
      return ROK({ savedAt: prev.savedAt, kept: "theirs" }, 200);
    }
  }

  // The write counter is a nicety for password accounts and has no meaning for Google
  // ones — there is exactly one client per Google account and no password to protect.
  // It is not tracked rather than tracked as zero, so a future dashboard reading it
  // cannot mistake "not counted" for "never written".
  const accountKeyFor = auth.sub ? googleAccountKey(auth.sub) : accountKey(auth.email!);
  const accountRaw = await env.DB.get(accountKeyFor);
  const writes = accountRaw ? (JSON.parse(accountRaw) as { writes?: number }).writes! + 1 : 1;

  const puts: Promise<unknown>[] = [env.DB.put(key, JSON.stringify({ savedAt: body.savedAt, state: body.state }))];
  if (accountRaw) {
    puts.push(env.DB.put(accountKeyFor, JSON.stringify({ ...(JSON.parse(accountRaw) as object), writes })));
  }
  await Promise.all(puts);
  return ROK({ savedAt: body.savedAt, kept: "yours", writes });
}

async function handleChangePassword(req: Request, auth: Session, env: Env): Promise<Response> {
  // A Google session has no password to change, and its account record has no `hash`.
  // Refused here with its own code rather than failing later on a missing field, so the
  // client can hide the row instead of showing an error the player can do nothing about.
  if (auth.sub) return RKO("no_password", 400);

  const body = (await req.json().catch(() => null)) as { current?: string; next?: string } | null;
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");
  if (next.length < 8) return RKO("weak_password", 400, { min: 8 });

  const raw = await env.DB.get(accountKey(auth.email!));
  if (!raw) return RKO("no_account", 404);
  const account = JSON.parse(raw) as Account;

  const check = await stretch(current, unb64(account.salt), pbkdf2Rounds(env));
  if (b64(check) !== account.hash) return RKO("bad_credentials", 401);

  const salt = randomBytes(16);
  const hash = await stretch(next, salt, pbkdf2Rounds(env));
  await env.DB.put(accountKey(auth.email!), JSON.stringify({ ...account, salt: b64(salt.buffer as ArrayBuffer), hash: b64(hash) }));
  return ROK({ ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.TOKEN_SECRET) return RKO("misconfigured", 500);

    const url = new URL(req.url);
    // Permissive CORS: the game may be served from a different host than the
    // Worker, and the token is the only thing at stake — it is bearer-only and
    // short of being a password. Locking the origin down is a one-line change once
    // the production host is known.
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-max-age": "86400",
    };

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const path = url.pathname.replace(/\/$/, "");
      let res: Response;

      if (path === "/api/register" && req.method === "POST") {
        res = await handleRegister(req, env);
      } else if (path === "/api/login" && req.method === "POST") {
        res = await handleLogin(req, env);
      } else if (path === "/api/google" && req.method === "POST") {
        res = await handleGoogleSignIn(req, env);
      } else if (path === "/api/save" && req.method === "GET") {
        const auth = await readAuth(req, env);
        if (!auth) res = RKO("unauthorised", 401);
        else res = await handleGetSave(auth, env);
      } else if (path === "/api/save" && req.method === "PUT") {
        const auth = await readAuth(req, env);
        if (!auth) res = RKO("unauthorised", 401);
        else res = await handlePutSave(req, auth, env);
      } else if (path === "/api/password" && req.method === "POST") {
        const auth = await readAuth(req, env);
        if (!auth) res = RKO("unauthorised", 401);
        else res = await handleChangePassword(req, auth, env);
      } else if (path === "/api/friend" && req.method === "POST") {
        const me = await readIdentity(req, env);
        if (!me) res = RKO("unauthorised", 401);
        else res = await handleFriend(req, env, me);
      } else if (path === "/api/duel" && req.method === "POST") {
        res = await routeDuel(req, env);
      } else if (path === "/api/room" && req.method === "POST") {
        // Unauthenticated by design: the room code is the capability, matching the
        // BroadcastChannel transport it replaces for players on different machines.
        res = await routeRoom(req, env);
      } else if (path === "/api/health") {
        res = ROK({ ok: true, at: Date.now() });
      } else {
        res = RKO("not_found", 404);
      }

      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      // The message is logged but not returned: an exception here can include a
      // binding name and a slice of a save, and none of that belongs in a response.
      console.error("worker error", err);
      return RKO("server", 500);
    }
  },
};

/**
 * Who the session belongs to, as a friend-list identity.
 *
 * Reads the account record rather than trusting the token's claims, for two reasons: the
 * display name lives there and nowhere else, and a token minted before a rename would
 * otherwise carry the old name for ever.
 *
 * Returns null both when the session does not verify and when the account behind it has
 * gone. Those are different failures and the client is told which, because "your session
 * expired" sends you to the sign-in screen and "your account is gone" does not.
 */
async function readIdentity(req: Request, env: Env): Promise<Identity | null> {
  const auth = await readAuth(req, env);
  if (!auth) return null;
  const key = auth.sub ? googleAccountKey(auth.sub) : accountKey(auth.email!);
  const recordRaw = await env.DB.get(key);
  if (!recordRaw) return null;
  const rec = JSON.parse(recordRaw) as { email?: string; name?: string };
  const handle = rec.email ?? "";
  if (!handle) return null;
  const identity: Identity = {
    handle,
    name: rec.name?.trim() || handle.split("@")[0] || handle,
    key,
    saveKey: auth.sub ? googleSaveKey(auth.sub) : saveKey(auth.email!),
  };
  // Keeps the search indexes current, so an account can be found by name and by address
  // without publishing itself anywhere.
  await indexAccount(env, identity);
  return identity;
}

/**
 * The duel endpoint's actions.
 *
 * Split out rather than inlined so the "who is this" question is answered in one place for
 * every action. Reading a finished fight is the exception and is deliberately
 * unauthenticated: it is keyed by an unguessable id, both participants need it, and a fight
 * result is not private information.
 */
async function routeDuel(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { action?: string; to?: string; id?: string; plantId?: string }
    | null;
  const action = String(body?.action ?? "");

  if (action === "result") return handleDuelResult(env, String(body?.id ?? ""));

  const me = await readIdentity(req, env);
  if (!me) return RKO("unauthorised", 401);

  switch (action) {
    case "send":
      return handleDuelSend(env, me, String(body?.to ?? ""), String(body?.plantId ?? ""), await loadSave(env, me.saveKey));
    case "inbox":
      return handleDuelInbox(env, me);
    case "sent":
      return handleDuelOutbox(env, me);
    case "accept":
      return handleDuelAccept(env, me, String(body?.id ?? ""), String(body?.plantId ?? ""), await loadSave(env, me.saveKey));
    case "decline":
      return handleDuelDecline(env, me, String(body?.id ?? ""));
    default:
      return RKO("unknown_action", 400);
  }
}

/**
 * A save out of KV, unwrapped from its `{ savedAt, state }` envelope.
 *
 * The fighter is taken from *this* and never from the request, which is the whole basis of
 * the duel being unfakeable: a client nominates a plant id and the server checks it against
 * the garden it already holds.
 */
async function loadSave(env: Env, saveKey: string): Promise<unknown> {
  const raw = await env.DB.get(saveKey);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { state: unknown }).state;
  } catch {
    return null;
  }
}

async function readAuth(req: Request, env: Env): Promise<Session | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return verify(token, env.TOKEN_SECRET);
}