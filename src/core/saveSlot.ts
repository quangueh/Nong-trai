/**
 * Which garden this browser is currently holding.
 *
 * The bug this exists to fix: the save lived at one fixed localStorage key, so it was
 * scoped to the *origin* rather than to the *account*. Two people signing in to two
 * accounts on one machine - a shared computer, a browser profile, a phone passed round -
 * got the same garden, because there was only ever one slot to read. Each new account
 * began life showing the previous one's plants, which is exactly the opposite of having
 * separate accounts, and worse than that: the second account's play was then pushed up as
 * the *first* account's cloud backup.
 *
 * So a save slot is chosen by account. Two properties matter:
 *
 * **An unknown account starts empty.** That is deliberate and it is what "each user
 * begins from the beginning" means. The alternative - adopting whatever the slot held -
 * is what produced the bug, and it is also how one player's garden ends up visible to
 * whoever signs in next.
 *
 * **The guest slot is never destroyed.** Someone who plays without an account, then signs
 * in, then signs out again, finds their garden exactly where they left it. Signing into
 * an account does not consume the anonymous save; it opens a different one beside it.
 *
 * A leaf module with no imports. The store needs it to decide which key to write, and the
 * account layer needs it to announce which account is signed in, and neither should have
 * to import the other to say so.
 */

/**
 * The key holding the signed-in account's garden, or null for the guest garden.
 *
 * Persisted, because the gate's grace period means a returning player is let in without
 * re-authenticating: if the id were only in memory, the page would boot into the guest
 * slot and then switch slots a second later, and the player would watch their own garden
 * blink out and be replaced.
 */
const ACTIVE_KEY = "nong-trai-active-account";

/** The anonymous save. Unchanged from before accounts existed, so old gardens still load. */
const GUEST_KEY = "mutant-sprout-save-v1";

/** Where the chosen account is recorded. Exported so a test can assert on it directly. */
export const ACTIVE_ACCOUNT_KEY = ACTIVE_KEY;

const PREFIX = "mutant-sprout-save-v1:";

let activeAccountId: string | null = null;

/**
 * Read the persisted account before anything constructs the store.
 *
 * Called from the app entry point rather than lazily on first use, because the store's
 * constructor reads the save and there is no second chance to be in the right slot.
 */
export function restoreActiveAccount(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    activeAccountId = raw && raw.length > 0 ? raw : null;
  } catch {
    activeAccountId = null;
  }
  return activeAccountId;
}

export function getActiveAccountId(): string | null {
  return activeAccountId;
}

/**
 * Switch to an account's slot.
 *
 * Returns whether the slot actually changed, so a caller that reloads the save can skip
 * the work when the account is the one already open - reloading on every status event
 * would throw away a garden that is merely being pushed.
 *
 * Subscribers are notified from here rather than from each call site. The first version
 * had the account layer remember to call the reload itself, which works right up until
 * someone adds a third call site and forgets - and the failure is silent, because the
 * store keeps the previous account's garden in memory and writes it over the new
 * account's slot on the next save. The module that knows the slot changed is the one
 * that announces it.
 */
export function setActiveAccountId(id: string | null): boolean {
  const next = id && id.length > 0 ? id : null;
  const changed = next !== activeAccountId;
  activeAccountId = next;
  try {
    if (next) localStorage.setItem(ACTIVE_KEY, next);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // A browser refusing storage still gets correct behaviour this session; only the
    // next reload would lose the choice.
  }
  if (changed) for (const fn of subscribers) fn(next);
  return changed;
}

const subscribers: ((accountId: string | null) => void)[] = [];

/**
 * Be told when the active slot changes, so the save can be re-read.
 *
 * Returns an unsubscribe function. The store registers once, at startup; tests register
 * their own so the slot behaviour can be checked without a browser.
 */
export function onSlotChange(fn: (accountId: string | null) => void): () => void {
  subscribers.push(fn);
  return () => {
    const at = subscribers.indexOf(fn);
    if (at >= 0) subscribers.splice(at, 1);
  };
}

/**
 * The localStorage key for a slot.
 *
 * The account id is hashed rather than pasted into the key. It is not a secret - the
 * Worker chose it and the game already stores the account's email in this origin - but a
 * key is the one place that shows up in every storage inspector, and there is no reason
 * for an identifier to be readable there.
 */
export function saveSlotKey(id: string | null): string {
  if (!id) return GUEST_KEY;
  return PREFIX + hash(id);
}

/** Whether a slot has ever been written. A fresh account's slot is empty by definition. */
export function slotHasSave(id: string | null): boolean {
  try {
    return localStorage.getItem(saveSlotKey(id)) !== null;
  } catch {
    return false;
  }
}

/** Remove a slot. Used by "start over", and by sign-out only for the account's own slot. */
export function clearSlot(id: string | null): void {
  try {
    localStorage.removeItem(saveSlotKey(id));
  } catch {
    // ignore
  }
}

/**
 * FNV-1a, 64 bits as two interleaved 32-bit halves.
 *
 * Only needs to make a collision between two account ids implausible - it is not
 * defending anything, since the input is not secret and the output protects nothing that
 * is not already in storage. Written out rather than hashed with WebCrypto because this
 * runs on every single save, and `crypto.subtle.digest` is async: making `save()` async
 * to rename a storage key would be a bad trade.
 */
function hash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(36).padStart(7, "0") + h2.toString(36).padStart(7, "0");
}
