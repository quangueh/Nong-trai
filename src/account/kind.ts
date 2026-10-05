/**
 * Track which kind of session is live.
 *
 * The client cannot inspect the Worker's session token to see whether it carries a `sub`
 * or an `email` — it is HMAC-signed, so decoding it would only prove it was
 * well-formed, never which kind of account it names. So the answer is recorded at
 * sign-in time, which is the only moment the client actually knows.
 *
 * Storage failures are swallowed deliberately. A browser with storage disabled still
 * plays the game perfectly well, and the only thing lost is which row the account sheet
 * shows — cosmetic. A save that threw would make the game unplayable instead, which is
 * a bad trade for a label.
 */
const KEY = "nong-trai-account-kind";

export type SessionKind = "password" | "google";

export function rememberSessionKind(kind: SessionKind): void {
  try {
    localStorage.setItem(KEY, kind);
  } catch {
    /* storage disabled */
  }
}

export function sessionKind(): SessionKind {
  try {
    return localStorage.getItem(KEY) === "google" ? "google" : "password";
  } catch {
    return "password";
  }
}

export function forgetSessionKind(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage disabled */
  }
}