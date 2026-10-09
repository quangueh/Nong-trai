/**
 * Talking to the account Worker.
 *
 * Every function here is allowed to fail. That is the whole design: the game is a
 * static site with no server, and it has to keep working on a train with no signal.
 * A failed sync is a message in a corner, never a blocked action.
 *
 * The API base URL comes from `VITE_ACCOUNT_API`. Without it the whole module
 * resolves to "no account service configured" and every call short-circuits — so a
 * fresh clone, a preview deploy, or a build with no secrets all still run the game.
 */

import { takeToken } from "./turnstile";

const BASE = (import.meta.env?.VITE_ACCOUNT_API as string | undefined)?.replace(/\/$/, "") ?? "";

/** Whether an account service was configured at build time. */
export const accountServiceAvailable = BASE !== "";

export interface AccountSession {
  token: string;
  playerId: string;
}

export interface CloudSave {
  savedAt: number;
  state: unknown;
}

/** Error carrying the worker's code so the UI can say something specific. */
export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

const TIMEOUT_MS = 8000;

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!accountServiceAvailable) {
    throw new AccountError("not_configured", "Chưa cấu hình dịch vụ tài khoản.");
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  // Every call is bounded. A hung request on a flaky connection would otherwise
  // leave a spinner on screen with no way out, and the game must stay playable
  // while it happens.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // A non-JSON body means something in front of the Worker answered — a proxy,
      // a captive portal. Treated the same as a failure.
      body = {};
    }

    if (!res.ok) {
      throw new AccountError(String(body.error ?? "unknown"), `HTTP ${res.status}`, res.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof AccountError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new AccountError("timeout", "Yêu cầu quá thời gian.");
    }
    throw new AccountError("offline", "Không kết nối được tới máy chủ.");
  } finally {
    clearTimeout(timer);
  }
}

export async function register(email: string, password: string, name?: string): Promise<void> {
  await call("/api/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name, tsToken: takeToken() }),
  });
}

export async function login(email: string, password: string): Promise<AccountSession> {
  const res = await call<{ token: string; playerId: string }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password, tsToken: takeToken() }),
  });
  return { token: res.token, playerId: res.playerId };
}

/**
 * Sign in with a Google ID token.
 *
 * The client does not decide anything about the token — it forwards it and takes the
 * Worker's word. `created` distinguishes a first sign-in from a return visit so the UI
 * can say "welcome" rather than "welcome back", which is the only difference the player
 * can actually observe.
 */
export async function googleSignIn(idToken: string): Promise<AccountSession & {
  created: boolean;
  name?: string;
  email?: string;
  picture?: string;
}> {
  const res = await call<{
    token: string;
    playerId: string;
    created: boolean;
    name?: string;
    email?: string;
    picture?: string;
  }>("/api/google", { method: "POST", body: JSON.stringify({ idToken }) });
  return {
    token: res.token,
    playerId: res.playerId,
    created: res.created,
    name: res.name,
    email: res.email,
    picture: res.picture,
  };
}

/** Which save the server holds, or null when there is not one yet. */
export async function fetchSave(token: string): Promise<CloudSave | null> {
  try {
    return await call<CloudSave>("/api/save", { token });
  } catch (err) {
    // "No save yet" is the normal first-run case, not a failure to report.
    if (err instanceof AccountError && err.code === "no_save") return null;
    throw err;
  }
}

/**
 * Push a save. `kept` says which side won.
 *
 * `"theirs"` means the server had something newer and refused this one — which
 * happens when the player played on two devices. It is reported rather than
 * swallowed so the UI can say "the newer save is on the server" instead of
 * appearing to have saved successfully.
 */
export async function pushSave(
  token: string,
  savedAt: number,
  state: unknown,
): Promise<{ savedAt: number; kept: "yours" | "theirs"; writes: number }> {
  return call("/api/save", {
    method: "PUT",
    token,
    body: JSON.stringify({ savedAt, state }),
  });
}

export async function changePassword(token: string, current: string, next: string): Promise<void> {
  await call("/api/password", { method: "POST", token, body: JSON.stringify({ current, next }) });
}

export async function health(): Promise<boolean> {
  try {
    await call("/api/health");
    return true;
  } catch {
    return false;
  }
}