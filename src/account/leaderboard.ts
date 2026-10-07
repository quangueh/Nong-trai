/**
 * The client half of the two leaderboards.
 *
 * Thin like the rest of `src/account`: the ranking is computed on the Worker, and this
 * module only fetches it and remembers the last good answer so every screen can show a
 * board without waiting on the network each time it paints.
 *
 * A signed-out or unconfigured client still gets a usable shape — the caller renders
 * whatever `me` it can build locally and a note instead of nothing at all.
 */

import { currentToken } from "./sync";
import { accountServiceAvailable } from "./api";
import { REFUSAL_TEXT, type Outcome, type Refusal } from "./social";

export interface BoardRow {
  rank: number;
  name: string;
  power: number;
  level: number;
  me: boolean;
}

export interface Leaderboards {
  /** Sorted by strongest plant power, descending. */
  power: BoardRow[];
  /** Sorted by breeder level, descending. */
  level: BoardRow[];
  /** The caller's own placement — present even when outside either list. */
  me: { name: string; power: number; level: number; powerRank: number; levelRank: number } | null;
  /** How many players the index knows about. */
  total: number;
}

const BASE = (import.meta.env?.VITE_ACCOUNT_API as string | undefined)?.replace(/\/$/, "") ?? "";

/** The last answer that arrived, so a repaint is never blank while a fetch is out. */
let cached: Leaderboards | null = null;
let lastStatus: "ok" | "loading" | "error" | "unavailable" = "loading";
let inFlight: Promise<Outcome<Leaderboards>> | null = null;
const listeners = new Set<() => void>();

export function boardsSnapshot(): { data: Leaderboards | null; status: typeof lastStatus } {
  return { data: cached, status: lastStatus };
}

export function onBoardsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => {
  for (const fn of listeners) fn();
};

/**
 * Fetch both boards. Concurrent callers share one request — the panel repaints on
 * every screen change and a fetch per repaint would be the most expensive thing in
 * the UI for no benefit a thirty-second cache does not give.
 */
export function refreshBoards(force = false): Promise<Outcome<Leaderboards>> {
  if (inFlight) return inFlight;
  if (!BASE || !accountServiceAvailable || !currentToken()) {
    lastStatus = "unavailable";
    // Still notify — a panel that mounted during this call is showing "Đang tải"
    // and needs to know the answer is "offline" rather than nothing at all.
    notify();
    return Promise.resolve({ ok: false, why: "unauthorised" });
  }
  lastStatus = "loading";
  inFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/api/leaderboard`, {
        headers: { authorization: `Bearer ${currentToken()}` },
      });
      const json = (await res.json().catch(() => null)) as (Leaderboards & { error?: string }) | null;
      if (!res.ok || !json) {
        lastStatus = "error";
        const code = String(json?.error ?? "server");
        return { ok: false, why: (code in REFUSAL_TEXT ? code : "server") as Refusal };
      }
      cached = {
        power: Array.isArray(json.power) ? json.power : [],
        level: Array.isArray(json.level) ? json.level : [],
        me: json.me ?? null,
        total: Number(json.total) || 0,
      };
      lastStatus = "ok";
      return { ok: true, value: cached };
    } catch {
      lastStatus = "error";
      return { ok: false, why: "network" };
    } finally {
      inFlight = null;
      notify();
    }
  })();
  void force;
  return inFlight;
}
