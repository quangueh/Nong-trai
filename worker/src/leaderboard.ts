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
  return {
    name,
    power: Math.round(power),
    level: Number.isFinite(level) && level > 0 ? Math.floor(level) : 1,
    at,
  };
}

/** Store the ranked summary for one account. Called from the save handler. */
export async function writeEntry(env: LbEnv, accountKey: string, entry: LbEntry): Promise<void> {
  await env.DB.put(lbKey(accountKey), JSON.stringify(entry));
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
  email: row.email,
  power: row.power,
  level: row.level,
  me: row.key === myKey,
});

/**
 * `GET /api/leaderboard` — both boards plus the caller's own placement.
 *
 * `myKey` is the caller's account key, resolved by the router from the session — the
 * request body is never trusted to say who is asking. Rank is `1 + count(strictly
 * better)`, so being absent from the index reads as unranked rather than as last.
 */
export async function handleLeaderboard(env: LbEnv, myKey: string): Promise<Response> {
  const rows = await readAll(env);
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
