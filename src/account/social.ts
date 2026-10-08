/**
 * The client half of the friend list and the duel inbox.
 *
 * Thin on purpose. Every decision that matters - who a friend is, which plant a duel is
 * fought with, who won - is made on the Worker, and this module only moves bytes. The one
 * thing worth being careful about is that a signed-out player gets a clear answer rather
 * than an exception: the whole social feature is invisible without an account, and a
 * console full of failed fetches is not a way to say so.
 *
 * Refusals are returned as `{ ok: false, why }` rather than thrown. "That display name is
 * shared by more than one player" is a normal answer to a normal action, and the UI has to
 * be able to print it.
 */

import { currentToken } from "./sync";
import { accountServiceAvailable } from "./api";
import type { Plant } from "../core/types";

export interface Friend {
  handle: string;
  name: string;
  since: number;
}

export interface DuelInvite {
  id: string;
  from: string;
  fromName: string;
  plantName: string;
  plantPower: number;
  at: number;
  state: "pending" | "declined" | "done";
  toPlantName?: string;
  toPlantPower?: number;
  /** Set once the fight exists, so a finished invite can be re-watched. */
  resultKey?: string;
}

/** A challenge I sent, from the sender's side — the outbox counterpart of DuelInvite. */
export interface SentDuel {
  id: string;
  to: string;
  toName: string;
  plantName: string;
  plantPower: number;
  at: number;
  state: "pending" | "declined" | "done";
  resultKey?: string;
}

/** The resolved fight. The event log is the fight: both sides replay this one list. */
export interface DuelResult {
  id: string;
  winner: "a" | "b" | "draw";
  events: unknown[];
  a: { hpPct: number; damageDealt: number; damageTaken: number; skillUses: number };
  b: { hpPct: number; damageDealt: number; damageTaken: number; skillUses: number };
  durationSeconds: number;
  log: string[];
  seed: string;
  aName: string;
  bName: string;
  aPower: number;
  bPower: number;
  /** Fighter snapshots, written since the replay landed; old duels lack them. */
  aPlant?: Plant;
  bPlant?: Plant;
}

export type Refusal =
  | "unauthorised"
  | "no_such_player"
  | "ambiguous_name"
  | "that_is_you"
  | "friend_list_full"
  | "already_challenged"
  | "plant_not_in_your_garden"
  | "challenger_gone"
  | "challenger_plant_gone"
  | "no_such_invite"
  | "not_a_friend"
  | "empty_query"
  | "not_found"
  | "server"
  | "network";

export type Outcome<T> = { ok: true; value: T } | { ok: false; why: Refusal };

/**
 * What each refusal says to the player.
 *
 * Written here rather than in the screens so the same refusal reads the same wherever it
 * comes up, and so adding a Worker error code forces a sentence rather than leaving a
 * blank toast.
 */
export const REFUSAL_TEXT: Record<Refusal, string> = {
  unauthorised: "Cần đăng nhập để dùng bạn bè.",
  no_such_player: "Không tìm thấy người chơi đó. Kiểm tra lại tên hoặc email.",
  ambiguous_name: "Có nhiều người cùng tên này. Hãy nhập email để kết bạn chính xác.",
  that_is_you: "Đó là bạn. Kết bạn với chính mình thì hơi kỳ.",
  friend_list_full: "Danh sách bạn đã đầy.",
  already_challenged: "Bạn đang chờ họ phản hồi. Đừng spam quá.",
  plant_not_in_your_garden: "Chọn một cây đang có trong vườn của bạn.",
  challenger_gone: "Người gọi không còn tồn tại.",
  challenger_plant_gone: "Cây của họ đã không còn trong vườn nữa.",
  no_such_invite: "Lời mời không còn hiệu lực.",
  not_a_friend: "Họ không có trong danh sách bạn của bạn.",
  empty_query: "Nhập tên hoặc email trước đã.",
  not_found: "Máy chủ chưa có tính năng này — Worker đang chạy bản cũ, cần deploy lại (worker/README.md).",
  server: "Máy chủ đang lỗi. Thử lại sau ít phút.",
  network: "Không kết nối được. Kiểm tra mạng rồi thử lại.",
};

const BASE = (import.meta.env?.VITE_ACCOUNT_API as string | undefined)?.replace(/\/$/, "") ?? "";

/** Why the social features are unavailable, in one sentence. */
export function socialUnavailableBecause(): string | null {
  if (!accountServiceAvailable) return "Chưa cấu hình máy chủ tài khoản.";
  if (!currentToken()) return "Hãy đăng nhập để kết bạn và giao đấu.";
  return null;
}

async function post<T>(path: string, body: unknown): Promise<Outcome<T>> {
  if (!BASE) return { ok: false, why: "network" };
  const token = currentToken();
  if (!token) return { ok: false, why: "unauthorised" };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) {
      const code = String(json?.error ?? "");
      // An unfamiliar code is reported as a refusal rather than swallowed, so a Worker that
      // grows a new error cannot make the UI print nothing at all.
      return { ok: false, why: (code in REFUSAL_TEXT ? code : "network") as Refusal };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, why: "network" };
  }
}

// --- friends ----------------------------------------------------------------

export async function listFriends(): Promise<Outcome<Friend[]>> {
  const r = await post<{ friends: Friend[] }>("/api/friend", { action: "list" });
  return r.ok ? { ok: true, value: r.value.friends ?? [] } : r;
}

export async function addFriend(query: string): Promise<Outcome<{ friends: Friend[]; added?: Friend; already?: boolean }>> {
  return post("/api/friend", { action: "add", query });
}

export async function removeFriend(query: string): Promise<Outcome<{ friends: Friend[] }>> {
  return post("/api/friend", { action: "remove", query });
}

// --- duels ------------------------------------------------------------------

export async function duelInbox(): Promise<Outcome<DuelInvite[]>> {
  const r = await post<{ invites: DuelInvite[] }>("/api/duel", { action: "inbox" });
  return r.ok ? { ok: true, value: r.value.invites ?? [] } : r;
}

/** Challenges I have sent, so the sender can see the answer rather than nothing. */
export async function duelOutbox(): Promise<Outcome<SentDuel[]>> {
  const r = await post<{ sent: SentDuel[] }>("/api/duel", { action: "sent" });
  return r.ok ? { ok: true, value: r.value.sent ?? [] } : r;
}

export async function sendChallenge(to: string, plantId: string): Promise<Outcome<{ sent: string; to: string }>> {
  return post("/api/duel", { action: "send", to, plantId });
}

/** Accept, and get the finished fight. The simulation happens on the Worker. */
export async function acceptChallenge(id: string, plantId: string): Promise<Outcome<{ result: DuelResult }>> {
  return post("/api/duel", { action: "accept", id, plantId });
}

export async function declineChallenge(id: string): Promise<Outcome<{ invites: DuelInvite[] }>> {
  return post("/api/duel", { action: "decline", id });
}

export async function readDuel(id: string): Promise<Outcome<{ result: DuelResult }>> {
  // Unauthenticated on purpose: both sides read the same fight, and it is keyed by an
  // unguessable id.
  if (!BASE) return { ok: false, why: "network" };
  try {
    const res = await fetch(`${BASE}/api/duel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "result", id }),
    });
    const json = (await res.json().catch(() => null)) as ({ result: DuelResult } & { error?: string }) | null;
    if (!res.ok || !json?.result) return { ok: false, why: "no_such_invite" };
    return { ok: true, value: { result: json.result } };
  } catch {
    return { ok: false, why: "network" };
  }
}

/** How long ago, in words. Used on the friend rows, where precision is noise. */
export function sinceWords(at: number, now = Date.now()): string {
  const d = Math.max(0, now - at);
  const mins = Math.floor(d / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return `${Math.floor(days / 30)} tháng trước`;
}
