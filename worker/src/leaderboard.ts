/**
 * Leaderboards — who has the strongest plant, and who is the highest level.
 *
 * ## Where the numbers come from
 *
 * The saves are already in KV: every `PUT /api/save` writes one garden blob. Rather
 * than scanning all of those on every read — saves are tens of KB each and the list
 * would only grow — the save handler extracts the two ranked numbers at write time
 * and stores one row in the D1 `lb` table: a few dozen bytes per player. Reading a
 * board is then `SELECT` + an in-memory sort, which costs one query a poll.
 *
 * It does mean a player only appears once they have pushed a save. That is the honest
 * answer: an account that registered and never played has no strongest plant to rank.
 *
 * ## Why D1 and not the KV snapshot this replaced
 *
 * The KV version kept a `lb:` key per player *plus* a cached snapshot blob, so every
 * save wrote two keys and every board read either hit the cache or paid a list +
 * per-entry gets — and a `list` costs 100x a `get` on the free tier. A table of one
 * row per player is the same index without the cache to keep warm or the blob to
 * rewrite: `writeEntry` is one upsert, `handleLeaderboard` is one SELECT.
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

import type { D1Like } from "./social";

/** The slice of KV still needed — only for the one-time import of `lb:*` rows. */
export interface LbKv {
  get(key: string): Promise<string | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete?: boolean;
    cursor?: string;
  }>;
}

export interface LbEnv {
  DB: LbKv;
  D1: D1Like;
}

/** The legacy KV key an account's ranked entry lived under — import-time only now. */
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
  await env.D1.prepare(
    `INSERT INTO lb (account_key, name, email, power, level, at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_key) DO UPDATE SET
       name = excluded.name, email = excluded.email,
       power = excluded.power, level = excluded.level, at = excluded.at`,
  ).bind(accountKey, entry.name, entry.email ?? null, entry.power, entry.level, entry.at).run();
}

/**
 * One-time import of the KV `lb:*` index into the table.
 *
 * Gated on the `lb_backfilled` flag alone — never on the table being empty.
 * The earlier version also required `lb` to be empty, which broke the moment a
 * save landed before the first board read: every later read saw a non-empty
 * table and the legacy players stayed invisible in KV forever. Returns the
 * imported rows so the caller can merge them (D1 wins any key conflict — it is
 * the live store). INSERT OR IGNORE means re-runs and overlapping saves are
 * both harmless.
 */
async function backfillOnce(env: LbEnv): Promise<LbRow[]> {
  const flag = await env.D1.prepare("SELECT v FROM meta WHERE k = 'lb_backfilled'").first<string>("v");
  if (flag) return [];

  const legacy = await readAll(env);
  for (const r of legacy) {
    await env.D1.prepare(
      "INSERT OR IGNORE INTO lb (account_key, name, email, power, level, at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(r.key.replace(/^lb:/, ""), r.name, r.email ?? null, r.power, r.level, r.at).run();
  }
  await env.D1.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('lb_backfilled', ?)")
    .bind(String(Date.now())).run();
  return legacy;
}

/** Every row of the legacy KV index, newest write winning per key by construction. */
async function readAll(env: LbEnv): Promise<LbRow[]> {
  const rows: LbRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const list = await env.DB.list({ prefix: "lb:", cursor });
    const got = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await env.DB.get(k.name);
        const e = raw ? safeParse<Partial<LbEntry>>(raw, {}) : {};
        // `lb:__cache__` is the old snapshot blob, not a player — importing it
        // would put a row named "__cache__" on the board.
        if (k.name === "lb:__cache__" || typeof e.name !== "string" || !e.name) return null;
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
  const { results } = await env.D1.prepare(
    "SELECT account_key, name, email, power, level, at FROM lb",
  ).all<{ account_key: string; name: string; email: string | null; power: number; level: number; at: number }>();

  let rows: LbRow[] = results.map((r) => ({
    key: r.account_key,
    name: r.name,
    email: r.email ?? undefined,
    power: r.power,
    level: r.level,
    at: r.at,
  }));
  const legacy = await backfillOnce(env);
  if (legacy.length) {
    // KV rows that lost the INSERT race to a fresher D1 entry keep the D1 row —
    // it was written by a live save, the KV copy is by definition staler. Keys
    // are un-prefixed here so `me` matches the caller's account key.
    const seen = new Set(rows.map((r) => r.key));
    for (const r of legacy) {
      const key = r.key.replace(/^lb:/, "");
      if (!seen.has(key)) rows.push({ ...r, key });
    }
  }
  /*
   * `me` is resolved before the probe filter: the public boards hide smoke and
   * example.com accounts, but the caller still exists — pretending otherwise
   * read as "my save never reached the board" to every health check that logs
   * in with a probe address.
   */
  const all = rows;
  const mine = all.find((r) => r.key === myKey) ?? null;
  rows = all.filter((r) => !isTestEntry(r));

  const power = [...rows].sort(byPower);
  const level = [...rows].sort(byLevel);
  // A probe's rank is computed against the unfiltered pool — "0" would read as
  // broken to the caller even though the public board rightly hides it.
  const allPower = [...all].sort(byPower);
  const allLevel = [...all].sort(byLevel);

  return Response.json({
    power: power.slice(0, BOARD_SIZE).map((r, i) => rowFor(r, i + 1, myKey)),
    level: level.slice(0, BOARD_SIZE).map((r, i) => rowFor(r, i + 1, myKey)),
    me: mine
      ? {
          name: mine.name,
          email: mine.email,
          power: mine.power,
          level: mine.level,
          powerRank: allPower.indexOf(mine) + 1,
          levelRank: allLevel.indexOf(mine) + 1,
        }
      : null,
    total: rows.length,
  });
}
