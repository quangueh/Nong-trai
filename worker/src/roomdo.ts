/**
 * RoomMailbox — the room postbox as a Durable Object.
 *
 * Same contract as `routeRoom` in room.ts (send / poll / reset, same request and
 * response shapes), backed by the object's transactional storage instead of KV.
 * The reason it exists is the one thing KV cannot give a lobby: a `send` here is
 * visible to the very next `poll`. KV's edge caches made a written join invisible
 * for up to a minute — measured ~30 s — which is precisely the "guest never enters
 * the room" failure. One object per room code (`idFromName(code)`), strongly
 * consistent by construction, so ordering is just the order requests arrive.
 *
 * Storage layout: `m:{ts}:{rand}` → packed message, mirroring the KV mailbox so a
 * client cannot tell which backend answered. Expiry is lazy — each request sweeps
 * keys older than MSG_TTL_MS, which for a minutes-long match is all a mailbox needs.
 */

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const MAX_MSG_BYTES = 32 * 1024;
const MAX_ROOM_MSGS = 240;
const MSG_TTL_MS = 900_000;
const M_PREFIX = "m:";
const TS_WIDTH = 13;

const ok = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (code: string, status = 400): Response => ok({ error: code }, status);

interface RoomBody {
  action?: string;
  code?: string;
  msg?: unknown;
  afterTs?: number;
}

export class RoomMailbox {
  constructor(private readonly ctx: DurableObjectState) {}

  /** Writes a message and returns its storage key, or null when it is not one. */
  private async putMsg(msg: unknown): Promise<string | null> {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
    const packed = JSON.stringify(msg);
    if (packed.length > MAX_MSG_BYTES) return null;
    const key = `${M_PREFIX}${String(Date.now()).padStart(TS_WIDTH, "0")}:${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await this.ctx.storage.put(key, packed);
    return key;
  }

  /** Drops keys past their TTL so an abandoned room cannot fill the object. */
  private async sweep(): Promise<void> {
    const cutoff = `${M_PREFIX}${String(Date.now() - MSG_TTL_MS).padStart(TS_WIDTH, "0")}`;
    const map = await this.ctx.storage.list<string>({ prefix: M_PREFIX });
    const dead = [...map.keys()].filter((k) => k < cutoff);
    if (dead.length) await this.ctx.storage.delete(dead);
  }

  async fetch(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as RoomBody | null;
    const action = String(body?.action ?? "");
    const code = String(body?.code ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) return fail("bad_code");

    await this.sweep();

    switch (action) {
      case "send": {
        const msgVal = body?.msg;
        const packed = msgVal && typeof msgVal === "object" ? JSON.stringify(msgVal) : null;
        if (!packed) return fail("bad_msg");
        if (packed.length > MAX_MSG_BYTES) return fail("too_big", 413);
        if ((await this.ctx.storage.list({ prefix: M_PREFIX })).size >= MAX_ROOM_MSGS)
          return fail("room_full", 429);
        const key = await this.putMsg(msgVal);
        return ok({ k: key });
      }

      case "poll": {
        const afterTs = Number(body?.afterTs ?? 0);
        const cutoff = Number.isFinite(afterTs) && afterTs > 0 ? afterTs : 0;
        const map = await this.ctx.storage.list<string>({ prefix: M_PREFIX });
        const msgs = [...map.entries()]
          .filter(([k]) => {
            const ts = Number(k.slice(M_PREFIX.length, M_PREFIX.length + TS_WIDTH));
            return Number.isFinite(ts) && ts > cutoff;
          })
          .map(([k, packed]) => {
            let m: unknown = null;
            try {
              m = JSON.parse(packed);
            } catch {
              m = null;
            }
            return { k, m };
          })
          .filter((row) => row.m !== null);
        return ok({ msgs });
      }

      case "reset": {
        // Same contract as the KV version: the embedded `msg` is the room's own
        // create marker, written before anything is deleted, so its key is the
        // boundary — everything else under the prefix is from a previous match.
        // In one object, ordering is just the request order, which is stronger than
        // the KV version ever managed to be.
        let marker: string | null = null;
        if (body?.msg && typeof body.msg === "object") {
          marker = await this.putMsg(body.msg);
        }
        const map = await this.ctx.storage.list<string>({ prefix: M_PREFIX });
        const cutoff = `${M_PREFIX}${String(Date.now()).padStart(TS_WIDTH, "0")}`;
        const stale = [...map.keys()].filter((k) => (marker ? k !== marker : k < cutoff));
        if (stale.length) await this.ctx.storage.delete(stale);
        return ok({ cleared: stale.length, k: marker });
      }

      default:
        return fail("bad_action", 404);
    }
  }
}
