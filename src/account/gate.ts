/**
 * Whether the game may be played, and for how long a sign-in is remembered.
 *
 * The player asked for a sign-in gate: to play you must be logged in, but a login is
 * remembered for a period rather than demanded on every visit. This module decides.
 *
 * Two rules shape it, and one is not obvious.
 *
 * **A gate needs something to judge.** With no Worker configured there is no token and
 * no service to ask, so the question has no answer that is not a guess. Rather than
 * guess, the gate stands down. A login wall that appears because a third-party service
 * is unreachable is the worst possible failure: the player is locked out of their own
 * garden over something they cannot fix.
 *
 * **Remembered is not signed in.** The grace period is satisfied by a timestamp written
 * at the last successful sign-in, not by a token being present. A token that is present
 * but expired is exactly the case grace exists to cover, so reading its presence would
 * let a stale session through forever.
 *
 * The timestamp itself lives in `./stamp`, which is a leaf module. Keeping it there is
 * what stops this file and `sync.ts` importing each other.
 */

import { isSignedIn } from "./sync";
import {
  forgetSignIn,
  GRACE_DAYS,
  graceRemaining,
  rememberedAt,
  rememberSignIn,
} from "./stamp";

export { forgetSignIn, rememberSignIn, GRACE_DAYS };

const BYPASS = "nong-trai-account-bypass";

export type GateState =
  /** A live session, or one inside its grace period. Play. */
  | { open: true; remembered: boolean }
  /**
   * No usable session. `reason` says which, because they ask different things of the
   * player: a first visit needs an account created, a lapsed one needs a password they
   * already have.
   */
  | { open: false; reason: "never" | "expired"; serviceConfigured: boolean };

/**
 * Play once without an account.
 *
 * Session-scoped on purpose. Persisted, it becomes a hole in the gate that nothing ever
 * closes, which defeats the thing it was added for.
 */
export function bypassOnce(): void {
  try {
    sessionStorage.setItem(BYPASS, "1");
  } catch {
    // Storage disabled: the gate simply reappears next reload, which is the safe
    // direction to fail in.
  }
}

function bypassed(): boolean {
  try {
    return sessionStorage.getItem(BYPASS) === "1";
  } catch {
    return false;
  }
}

/**
 * May the game start?
 *
 * `serviceConfigured` is a parameter rather than an import so this stays a pure decision
 * and can be tested without a Worker, a browser or a network.
 */
export function gateState(serviceConfigured: boolean): GateState {
  if (!serviceConfigured) return { open: true, remembered: false };
  if (bypassed()) return { open: true, remembered: false };

  const at = rememberedAt();
  // `graceRemaining` already returns 0 for a missing, unparseable or lapsed stamp, so
  // this is the whole test. An earlier version compared the timestamp against a
  // recomputed period, which was the same question asked twice in two different units.
  if (at !== null && graceRemaining() > 0) return { open: true, remembered: true };
  /*
   * A token with no timestamp: signed in by the password path before the gate existed.
   * Admitted and stamped, so the next visit has a grace period too.
   *
   * "A token", not "a valid token" - `isSignedIn()` reports presence, not validity, and
   * it cannot report validity without a request. That is safe here because of the `at ===
   * null` guard: this branch can only run while there is no stamp, so it fires once and
   * every later visit goes through the bounded check above. An expired token therefore
   * buys 30 days, not an unlimited run of them.
   */
  if (at === null && isSignedIn()) {
    rememberSignIn();
    return { open: true, remembered: false };
  }
  return { open: false, reason: at === null ? "never" : "expired", serviceConfigured: true };
}

/** Days left in the grace period, for telling the player when they will be asked again. */
export function graceDaysLeft(): number {
  return Math.max(0, Math.ceil(graceRemaining() / (24 * 60 * 60 * 1000)));
}