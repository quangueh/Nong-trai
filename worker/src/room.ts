/**
 * Room relay — a KV mailbox that lets two browsers trade room messages.
 *
 * The room protocol itself lives in the game (src/core/room.ts) and was built for
 * BroadcastChannel, which only reaches tabs of one browser on one machine. Playing a
 * friend on another device needs a wire, and this is it: the sender POSTs a message,
 * the other side polls for keys it has not seen yet. Nothing here understands the
 * messages — the Worker is a postbox, not a referee. The host client still runs the
 * authoritative simulation exactly as it does over BroadcastChannel.
 *
 * Three KV facts shaped the design:
 *
 *   `list()` is not edge-cached, so a poll sees a message within a second or so of the
 *   write rather than up to a minute later. Reads (`get`) can be cached at the edge,
 *   which does not matter here because every message key is brand new — a cached miss
 *   is impossible for a key that has never been asked for.
 *
 *   One write per second per key. So messages are appended as individual keys under a
 *   room prefix rather than accumulated into one list key, which would throttle on the
 *   very traffic it exists for.
 *
 *   Ordering across clocks is approximate. Keys sort by the writer's timestamp, and a
 *   guest's clock can run ahead of the host's, so a strict "newer than the last key I
 *   saw" cursor can skip messages forever. The poll therefore takes a timestamp with a
 *   skew window and the client dedupes by key name — a repeated message is harmless and
 *   a missed one is not.
 *
 * There is deliberately no auth: the six-character code is the capability, the same
 * contract the BroadcastChannel version already had. What is bound instead is size —
 * a message cannot exceed 32 KB and a room cannot hold more than 240 of them — and
 * lifetime, because everything under a room key expires on its own.
 */

/**
 * The slice of KV this module uses.
 *
 * Structural rather than `KVNamespace`, for the same reason `KvEnv` in social.ts is:
 * the real binding satisfies it, a hand-written test fake satisfies it, and the tools
 * tsconfig never needs the Cloudflare type package to typecheck a file that tests
 * import directly.
 */
export interface RoomKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: { name: string }[] }>;
}

/** The environment these handlers need: a store and nothing else. */
export interface RoomKvEnv {
  DB: RoomKv;
}

/** Same alphabet the client mints codes from: no 0, O, 1, I or L. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** A plant blob is a few KB; nothing in the protocol is bigger. */
const MAX_MSG_BYTES = 32 * 1024;

/** Matches are minutes long; hundreds of messages would mean something is wrong. */
const MAX_ROOM_MSGS = 240;

/** Fifteen minutes — long enough for a match, short enough that codes can be reused. */
const MSG_TTL_S = 900;

const prefix = (code: string): string => `room:${code}:m:`;

/** Message keys sort by write time because the timestamp is fixed-width. */
const TS_WIDTH = 13;

const ok = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (code: string, status = 400): Response => ok({ error: code }, status);

/** Timestamp encoded in a message key, or 0 when the name is not one of ours. */
function keyTs(prefixLen: number, name: string): number {
  const ts = Number(name.slice(prefixLen, prefixLen + TS_WIDTH));
  return Number.isFinite(ts) ? ts : 0;
}

/** Where one message lands in KV, stamped with the worker's own clock. */
async function putMsg(env: RoomKvEnv, code: string, msg: unknown): Promise<string | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const packed = JSON.stringify(msg);
  if (packed.length > MAX_MSG_BYTES) return null;
  const key = `${prefix(code)}${String(Date.now()).padStart(TS_WIDTH, "0")}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  await env.DB.put(key, packed, { expirationTtl: MSG_TTL_S });
  return key;
}

export async function routeRoom(req: Request, env: RoomKvEnv): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { action?: string; code?: string; msg?: unknown; afterTs?: number }
    | null;
  const action = String(body?.action ?? "");
  const code = String(body?.code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return fail("bad_code");

  switch (action) {
    case "send": {
      const msg = body?.msg;
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail("bad_msg");
      const packed = JSON.stringify(msg);
      if (packed.length > MAX_MSG_BYTES) return fail("too_big", 413);

      const existing = await env.DB.list({ prefix: prefix(code) });
      if (existing.keys.length >= MAX_ROOM_MSGS) return fail("room_full", 429);

      const key = await putMsg(env, code, msg);
      return ok({ k: key });
    }

    case "poll": {
      const afterTs = Number(body?.afterTs ?? 0);
      const cutoff = Number.isFinite(afterTs) && afterTs > 0 ? afterTs : 0;
      const p = prefix(code);
      const list = await env.DB.list({ prefix: p });
      const fresh = list.keys.map((k) => k.name).filter((k) => keyTs(p.length, k) > cutoff);
      const msgs = (
        await Promise.all(
          fresh.map(async (k) => {
            const raw = await env.DB.get(k);
            let m: unknown = null;
            try {
              m = raw ? JSON.parse(raw) : null;
            } catch {
              m = null;
            }
            return { k, m };
          }),
        )
      ).filter((row) => row.m !== null);
      return ok({ msgs });
    }

    case "reset": {
      // The host calls this before sharing a freshly minted code, so a message left
      // over from a previous match cannot leak into the new lobby.
      //
      // The cutoff used to be `Date.now()` at the moment this request arrived, which
      // was wrong in a way only two devices could ever produce: the reset and the
      // guest's join travel on different connections, and nothing orders them. A
      // reset that arrived *after* a join deleted it — the host never saw the
      // second player and the room stayed a one-person lobby forever.
      //
      // The fix is to make the reset carry the room's own `create` message. It is
      // written first, in this same request, so its key is the boundary: everything
      // before it is from a previous match, everything after it — any join that
      // could only have been sent by someone holding the code — survives. Ordering
      // inside one request is the only ordering two devices can be given.
      //
      // The deletion compares whole key names, not timestamps: two writes in the same
      // millisecond sort by their random suffix, and a stale message that happened to
      // sort after the marker would survive it. Anything that is not the marker is
      // older than the room by definition — a join written "between" the marker and
      // this list would have had to arrive inside a single request's microseconds.
      const p = prefix(code);
      let cutoff = `${p}${String(Date.now()).padStart(TS_WIDTH, "0")}:`;
      let marker: string | null = null;
      if (body?.msg && typeof body.msg === "object") {
        marker = await putMsg(env, code, body.msg);
      }
      const list = await env.DB.list({ prefix: p });
      const stale = list.keys
        .map((k) => k.name)
        .filter((k) => (marker ? k !== marker : k < cutoff));
      await Promise.all(stale.map((k) => env.DB.delete(k)));
      return ok({ cleared: stale.length, k: marker });
    }

    default:
      return fail("unknown_action");
  }
}
