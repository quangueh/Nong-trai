/**
 * Leaderboards — who has the strongest plant, and who is the highest level.
 *
 * ## Where the numbers come from
 *
 * The saves are already in KV: every `PUT /api/save` writes one garden blob. Rather
 * than scanning all of those on every read — saves are tens of KB each and the list
 * would only grow — the save handler extracts the two ranked numbers at write time
 * and stores them under `lb:{accountKey}`: a few dozen bytes per player. Reading a
 * board is then a `list` of small records, which a worker can afford every poll.
 *
 * It does mean a player only appears once they have pushed a save. That is the honest
 * answer: an account that registered and never played has no strongest plant to rank.
 *
 * ## Two boards, one source
 *
 * The same entry feeds both rankings — strongest plant power, then breeder level —
 * because both are facts about the same garden. Ties break on the other stat, then on
 * who got there first, so a rank never reshuffles under two equal players.
 *
 * The caller's own rank is returned even when they are outside the visible list:
 * "you are #47 of 132" is the piece of information a top-15 board cannot show.
 */

/** The slice of KV this module uses — structural, like `Kv` in social.ts. */
export interface LbKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete?: boolean;
    cursor?: string;
  }>;
}

export interface LbEnv {
  DB: LbKv;
}

export const lbKey = (accountKey: string): string => `lb:${accountKey}`;

/** One ranked player. `power` is the best plant's power rating, `level` the breeder's. */
export interface LbEntry {
  name: string;
  /**
   * The account email — the identity players actually recognise ("gmail của mình").
   * Names collide and are editable; the email is neither. Optional because entries
   * written before this field existed have only a name, and a board must still show them.
   */
  email?: string;
  power: number;
  level: number;
  /** When the save that produced this entry was written — the tie-breaker. */
  at: number;
}

interface LbRow extends LbEntry {
  key: string;
}

/** How many names a board publishes. The caller's own row is always added on top. */
export const BOARD_SIZE = 15;

/** Pages of `list` to walk before giving up — a bound, not an expectation. */
const MAX_PAGES = 10;

/**
 * Snapshot of every row, served to board reads.
 *
 * A `list` call costs 100× a `get` on the free tier (1k vs 100k ops a day),
 * and the board used to list + re-get every entry on every fetch — a client
 * polling each 45s spent a List per poll forever. The snapshot turns a board
 * read into one `get`; a rebuild only happens once per TTL across *all*
 * players, and `writeEntry` folds each save's row in so a fresh cache is also
 * accurate.
 */
const CACHE_KEY = "lb:__cache__";
const CACHE_TTL_MS = 45_000;

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Pull the two ranked numbers out of a saved game state.
 *
 * `state` is `unknown` because it came out of a request body — partial saves and saves
 * from older builds are ordinary input here. A state with no plants still ranks: a
 * zero-power, level-1 row is the truth of that garden, and leaving it out would make
 * "no one" indistinguishable from "no one who has played".
 */
export function entryFromState(state: unknown, name: string, at = Date.now()): LbEntry {
  const plants = (state as { plants?: unknown })?.plants;
  let power = 0;
  if (Array.isArray(plants)) {
    for (const p of plants) {
      const rating = Number((p as { powerRating?: number })?.powerRating);
      if (Number.isFinite(rating) && rating > power) power = rating;
    }
  }
  const level = Number((state as { breederLevel?: number })?.breederLevel);
  /* Both numbers are client-claimed — the save IS the client's garden blob, so
     this board is a shared diary, not ranked truth (docs/20 gates real ranked
     on server-verified progression). Bounding them to plausible ceilings keeps
     a doctored save from printing "Lv 9999999" on a public list. */
  return {
    name,
    power: Math.round(Math.min(Math.max(0, power), 100_000)),
    level: Number.isFinite(level) && level > 0 ? Math.floor(Math.min(level, 10_000)) : 1,
    at,
  };
}

/** Store the ranked summary for one account. Called from the save handler. */
export async function writeEntry(env: LbEnv, accountKey: string, entry: LbEntry): Promise<void> {
  const key = lbKey(accountKey);
  await env.DB.put(key, JSON.stringify(entry));
  /* Fold the row into the snapshot when one exists — +1 get +1 put on a save,
     but the board keeps answering from the cache instead of re-listing, and
     the saver's own row is right on their very next poll. */
  const cachedRaw = await env.DB.get(CACHE_KEY);
  if (!cachedRaw) return;
  const cached = safeParse<{ at?: number; rows?: LbRow[] }>(cachedRaw, {});
  if (!Array.isArray(cached.rows) || typeof cached.at !== "number") return;
  const rows = cached.rows.filter((r) => r.key !== key);
  rows.push({ key, name: entry.name, email: entry.email, power: entry.power, level: entry.level, at: entry.at });
  await env.DB.put(CACHE_KEY, JSON.stringify({ at: cached.at, rows }));
}

/** Every entry in the index, newest write winning per key by construction. */
async function readAll(env: LbEnv): Promise<LbRow[]> {
  const rows: LbRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await env.DB.list({ prefix: "lb:", cursor });
    const got = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await env.DB.get(k.name);
        const e = raw ? safeParse<Partial<LbEntry>>(raw, {}) : {};
        if (typeof e.name !== "string" || !e.name) return null;
        return {
          key: k.name,
          name: e.name,
          email: typeof e.email === "string" && e.email ? e.email : undefined,
          power: Number(e.power) || 0,
          level: Number(e.level) || 1,
          at: Number(e.at) || 0,
        };
      }),
    );
    for (const row of got) if (row) rows.push(row);
    if (list.list_complete === false && list.cursor) {
      cursor = list.cursor;
    } else {
      break;
    }
  }
  return rows;
}

/** Strongest plant first; a tie breaks on level, then on who reached it first. */
const byPower = (a: LbRow, b: LbRow): number => b.power - a.power || b.level - a.level || a.at - b.at || a.name.localeCompare(b.name);

/** Highest breeder level first; a tie breaks on power, then on who reached it first. */
const byLevel = (a: LbRow, b: LbRow): number => b.level - a.level || b.power - a.power || a.at - b.at || a.name.localeCompare(b.name);

const rowFor = (row: LbRow, rank: number, myKey: string) => ({
  rank,
  name: row.name,
  /* Emails stay in the index (the account identity), but only the caller's own
     row is told it — a public board carrying 15 strangers' email addresses is
     a leak, not a label. */
  email: row.key === myKey ? row.email : undefined,
  power: row.power,
  level: row.level,
  me: row.key === myKey,
});

/**
 * Throwaway accounts left behind by the project's own test runs.
 *
 * `tools/smoke-worker.ts` registers a `smoke-*@example.com` account and pushes a
 * save on every run — by design, since only a real request exercises the deployed
 * Worker — and leaderboard probes did the same under `lb-probe-*`. Each one earns
 * an `lb:` entry that then sits on the public board. `example.com` is the
 * reserved documentation domain, so a real mailbox can never end in it; the name
 * prefixes carry the probe's timestamp (`smoke-1791395758872`), which a real
 * display name would not.
 */
function isTestEntry(row: LbRow): boolean {
  if (/@example\.com$/i.test(row.email ?? "")) return true;
  const probeName = /^(smoke|probe|lb-probe|test)-\d/i;
  return probeName.test(row.name) || probeName.test(row.email ?? "");
}

/**
 * `GET /api/leaderboard` — both boards plus the caller's own placement.
 *
 * `myKey` is the caller's account key, resolved by the router from the session — the
 * request body is never trusted to say who is asking. Rank is `1 + count(strictly
 * better)`, so being absent from the index reads as unranked rather than as last.
 */
export async function handleLeaderboard(env: LbEnv, myKey: string): Promise<Response> {
  /* Snapshot first: a fresh cache serves the whole board for the price of one
     `get`. Only a missing or stale snapshot pays the list + per-entry gets. */
  const cachedRaw = await env.DB.get(CACHE_KEY);
  let rows: LbRow[];
  const cached = cachedRaw ? safeParse<{ at?: number; rows?: LbRow[] }>(cachedRaw, {}) : null;
  if (cached && typeof cached.at === "number" && Array.isArray(cached.rows) && Date.now() - cached.at < CACHE_TTL_MS) {
    rows = cached.rows;
  } else {
    rows = await readAll(env);
    await env.DB.put(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  }
  rows = rows.filter((r) => !isTestEntry(r));
  const power = [...rows].sort(byPower);
  const level = [...rows].sort(byLevel);
  // Rows carry their full KV name (`lb:acct:…`); the caller arrives as a bare key.
  const mine = rows.find((r) => r.key === lbKey(myKey)) ?? null;
  const mineKey = lbKey(myKey);

  return Response.json({
    power: power.slice(0, BOARD_SIZE).map((r, i) => rowFor(r, i + 1, mineKey)),
    level: level.slice(0, BOARD_SIZE).map((r, i) => rowFor(r, i + 1, mineKey)),
    me: mine
      ? {
          name: mine.name,
          email: mine.email,
          power: mine.power,
          level: mine.level,
          powerRank: power.indexOf(mine) + 1,
          levelRank: level.indexOf(mine) + 1,
        }
      : null,
    total: rows.length,
  });
}
