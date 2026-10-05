/**
 * The sign-in timestamp, and nothing else.
 *
 * A leaf module on purpose. Both `sync.ts` (which stamps on sign-in) and `gate.ts`
 * (which reads it) need it, so putting it in either would make them import each other.
 * The cycle happened to be safe — every reference is inside a function body — but "happens
 * to be safe" is not a property worth keeping, because it stops being true the moment
 * someone adds a top-level call.
 *
 * No imports at all, so nothing can depend on this and it can depend on nothing.
 */

const REMEMBERED_AT = "nong-trai-account-remembered-at";

/** How long a sign-in is remembered on this browser. */
export const GRACE_DAYS = 30;
export const GRACE_PERIOD_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Stamp the moment a sign-in succeeded. */
export function rememberSignIn(at = Date.now()): void {
  try {
    localStorage.setItem(REMEMBERED_AT, String(at));
  } catch {
    // Storage disabled. The game still plays; the player just re-authenticates every
    // visit, which is a worse experience rather than a broken one.
  }
}

export function forgetSignIn(): void {
  try {
    localStorage.removeItem(REMEMBERED_AT);
  } catch {
    /* storage disabled */
  }
}

/** When the last sign-in happened, or null if there has never been one. */
export function rememberedAt(): number | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_AT);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Milliseconds of grace left. Zero when there is no sign-in to measure. */
export function graceRemaining(): number {
  const at = rememberedAt();
  if (at === null) return 0;
  return Math.max(0, at + GRACE_PERIOD_MS - Date.now());
}