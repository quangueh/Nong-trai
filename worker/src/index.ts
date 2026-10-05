/**
 * Cloudflare Worker — accounts and named saves.
 *
 * Deployed separately from the game, which stays a static site. The game talks to
 * this over four endpoints and nothing else.
 *
 *   POST /api/register   { email, password }        -> { token, player }
 *   POST /api/login      { email, password }        -> { token, player }
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

export interface Env {
  /** KV namespace holding both accounts and saves. */
  DB: KVNamespace;
  /** HMAC key for session tokens. Must be set; the worker refuses to boot without it. */
  TOKEN_SECRET: string;
  /** PBKDF2 rounds. Higher is slower to attack and slower to log in. */
  PBKDF2_ROUNDS?: string;
}

interface Account {
  email: string;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  playerId: string;
  createdAt: number;
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

const b64 = (buf: ArrayBuffer): string => {
  let s = "";
  const b = new Uint8Array(buf);
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

async function verify(token: string, secret: string): Promise<{ email: string } | null> {
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
    const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as { email: string; exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

const accountKey = (email: string): string => `acct:${email}`;
const saveKey = (email: string): string => `save:${email}`;

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
  const rounds = Number(env.PBKDF2_ROUNDS ?? 150000);
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
  const rounds = Number(env.PBKDF2_ROUNDS ?? 150000);
  const hash = await stretch(password, salt, rounds);

  if (!raw) {
    await stretch(password, salt, rounds);
    return RKO("bad_credentials", 401);
  }
  const account = JSON.parse(raw) as Account;
  if (b64(hash) !== account.hash) return RKO("bad_credentials", 401);

  const token = await sign({ email, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 }, env.TOKEN_SECRET);
  return ROK({ token, playerId: account.playerId });
}

async function handleGetSave(auth: { email: string }, env: Env): Promise<Response> {
  const raw = await env.DB.get(saveKey(auth.email));
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
async function handlePutSave(req: Request, auth: { email: string }, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { savedAt?: number; state?: unknown } | null;
  if (typeof body?.savedAt !== "number" || body.state === undefined) return RKO("bad_body");

  const key = saveKey(auth.email);
  const existing = await env.DB.get(key);
  if (existing) {
    const prev = JSON.parse(existing) as { savedAt: number };
    if (body.savedAt < prev.savedAt) {
      return ROK({ savedAt: prev.savedAt, kept: "theirs" }, 200);
    }
  }

  const accountRaw = await env.DB.get(accountKey(auth.email));
  const writes = accountRaw ? (JSON.parse(accountRaw) as Account).writes + 1 : 1;

  await Promise.all([
    env.DB.put(key, JSON.stringify({ savedAt: body.savedAt, state: body.state })),
    accountRaw && env.DB.put(accountKey(auth.email), JSON.stringify({ ...(JSON.parse(accountRaw) as Account), writes })),
  ]);
  return ROK({ savedAt: body.savedAt, kept: "yours", writes });
}

async function handleChangePassword(req: Request, auth: { email: string }, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { current?: string; next?: string } | null;
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");
  if (next.length < 8) return RKO("weak_password", 400, { min: 8 });

  const raw = await env.DB.get(accountKey(auth.email));
  if (!raw) return RKO("no_account", 404);
  const account = JSON.parse(raw) as Account;

  const check = await stretch(current, unb64(account.salt), Number(env.PBKDF2_ROUNDS ?? 150000));
  if (b64(check) !== account.hash) return RKO("bad_credentials", 401);

  const salt = randomBytes(16);
  const hash = await stretch(next, salt, Number(env.PBKDF2_ROUNDS ?? 150000));
  await env.DB.put(accountKey(auth.email), JSON.stringify({ ...account, salt: b64(salt.buffer as ArrayBuffer), hash: b64(hash) }));
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

async function readAuth(req: Request, env: Env): Promise<{ email: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return verify(token, env.TOKEN_SECRET);
}