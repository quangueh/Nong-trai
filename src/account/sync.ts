/**
 * Account state and save synchronisation.
 *
 * The rule everything else follows: **localStorage is the game, the cloud is a
 * backup.** The store never waits on a request, and a request that fails changes
 * nothing about what the player can do.
 *
 * That is not a compromise forced by the network. It is forced by KV, which is
 * eventually consistent: a save written in one region can be invisible in another
 * for up to a minute. A cloud-first design would let a player log in on a second
 * device and load a garden that is a minute stale, then overwrite the first
 * device's newer one. Keeping the local copy authoritative removes that whole class
 * of bug, and it buys offline play for free.
 *
 * When to push, and why not more often:
 *
 *   on login    once
 *   on demand    the player presses it
 *   periodically but rarely
 *
 * KV's free tier allows about a thousand writes a day across the namespace. Syncing
 * on every mutation — every tap that commits — would exhaust that in an afternoon
 * and then fail silently for everyone. So this counts its own pushes and stops
 * rather than becoming the reason the account feature looks broken.
 */

import {
  AccountError,
  accountServiceAvailable,
  changePassword,
  fetchSave,
  googleSignIn as apiGoogleSignIn,
  login as apiLogin,
  pushSave,
  register as apiRegister,
  type AccountSession,
} from "./api";
import { forgetSessionKind, rememberSessionKind, type SessionKind } from "./kind";
import { forgetSignIn, rememberSignIn } from "./stamp";
import { getActiveAccountId, setActiveAccountId } from "../core/saveSlot";
import { DEFAULT_PLAYER_NAME } from "../core/types";

const TOKEN_KEY = "nong-trai-account-token";
const EMAIL_KEY = "nong-trai-account-email";
const SEEN_KEY = "nong-trai-account-savedAt";

/** How often to push without being asked. */
const AUTO_SYNC_MS = 5 * 60 * 1000;

/**
 * Daily write ceiling, self-imposed.
 *
 * The real limit belongs to Cloudflare and moves with the plan. This is a guess
 * that stops the client being the reason it is hit: at one push every five minutes
 * a player generates 288 a day, so three players sharing a namespace could reach
 * 1,000 between them. Stopping at 900 makes the symptom visible in the UI as
 * "paused" rather than as silent failures for everyone.
 */
const DAILY_WRITE_BUDGET = 900;

export type SyncState = "off" | "idle" | "syncing" | "synced" | "error" | "paused" | "conflict";

export interface AccountStatus {
  /** Null when playing without an account, which is always allowed. */
  email: string | null;
  state: SyncState;
  /** Player-facing sentence. Vietnamese, because that is the game's language. */
  message: string;
  lastSyncedAt: number | null;
  /** True when the server held a newer save than the one just offered. */
  serverWasNewer: boolean;
}

type Listener = (s: AccountStatus) => void;

/** What the store hands us so the cloud copy is the same shape as the local one. */
export interface SaveBridge {
  read(): { state: unknown; savedAt: number };
  /** Replace the whole local save, used after pulling the cloud copy down. */
  write(state: unknown, savedAt: number): void;
  /**
   * Rename the player inside the save. Optional: a bridge that cannot rename
   * simply skips the in-game-name step at sign-in.
   */
  renamePlayer?(name: string): void;
}

const listeners = new Set<Listener>();
let status: AccountStatus = {
  email: null,
  state: "off",
  message: "",
  lastSyncedAt: null,
  serverWasNewer: false,
};

let token: string | null = null;
let bridge: SaveBridge | null = null;
let autoTimer: number | null = null;

/**
 * A guest garden waiting on a player's decision.
 *
 * Set when a sign-in finds the anonymous slot had grown past what the account's
 * cloud copy holds — a real fork that nobody should resolve by guessing. The
 * conflict strip offers the choice; `resolveGuestChoice` is the only resolver. A
 * new sign-in clears whatever the previous one left undecided, because the
 * snapshot belongs to the moment it was taken.
 */
let pendingGuest: { state: unknown; savedAt: number } | null = null;

/**
 * Whether this device has successfully asked the server what it holds, at least once, for
 * the current session.
 *
 * ## The rule it enforces
 *
 * **Never write over a save you have not read.**
 *
 * Signing in makes the account's slot reload, and an unwritten slot reloads as a brand-new
 * garden which `loadOrCreate` persists. So the sequence "sign in → the Worker is slow →
 * the pull is abandoned after its 8s cap → the player plays → something saves" ends with an
 * empty garden being pushed over whatever the account actually had. The player is let in
 * early on purpose — a slow server must not keep anyone out — so the gap has to be closed
 * here instead of by blocking.
 *
 * Set on any *successful* fetch, including one that correctly reports no save: a new
 * account has been seen, and its first push is a creation rather than an overwrite. Left
 * false only when the save endpoint could not be reached at all, which is the one case where
 * "empty garden" and "the real save" are indistinguishable.
 *
 * Reset on sign-out, because the next session is a different account with a different
 * cloud copy.
 */
let cloudRead = false;

function emit(patch: Partial<AccountStatus>): void {
  status = { ...status, ...patch };
  for (const fn of [...listeners]) {
    try {
      fn(status);
    } catch {
      // A broken subscriber must not stop the others, and must never reach the
      // caller — this runs on the failure path of a network call.
    }
  }
}

export function onAccountStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function accountStatus(): AccountStatus {
  return status;
}

/**
 * Adopt the store.
 *
 * Called once at boot. The token is restored from localStorage so a returning
 * player is signed in without typing anything — the token is a bearer credential
 * with a 90-day life, and the alternative (asking for a password on every visit)
 * is what makes people not use accounts at all.
 */
export function initAccount(theBridge: SaveBridge): void {
  bridge = theBridge;
  token = localStorage.getItem(TOKEN_KEY);
  const email = localStorage.getItem(EMAIL_KEY);

  if (!accountServiceAvailable) {
    emit({ email: null, state: "off", message: "Chưa cấu hình tài khoản — chơi không cần đăng nhập." });
    return;
  }
  if (!token || !email) {
    emit({ email: null, state: "off", message: "Đăng nhập để chơi trên nhiều máy." });
    return;
  }
  emit({ email, state: "idle", message: "Đã đăng nhập." });
  void pull();
}

function stopAuto(): void {
  if (autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

function startAuto(): void {
  stopAuto();
  autoTimer = window.setInterval(() => {
    void push();
  }, AUTO_SYNC_MS);
}

// --- writes this device has done today -------------------------------------

function writesToday(): number {
  const day = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem(SEEN_KEY);
  if (!raw) return 0;
  try {
    const rec = JSON.parse(raw) as { day: string; n: number };
    return rec.day === day ? rec.n : 0;
  } catch {
    return 0;
  }
}

function noteWrite(): void {
  const day = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem(SEEN_KEY);
  let n = 0;
  try {
    const rec = JSON.parse(raw ?? "null") as { day: string; n: number } | null;
    if (rec && rec.day === day) n = rec.n;
  } catch {
    n = 0;
  }
  localStorage.setItem(SEEN_KEY, JSON.stringify({ day, n: n + 1 }));
}

// --- public API ------------------------------------------------------------

export async function signUp(email: string, password: string, name?: string): Promise<void> {
  await apiRegister(email, password, name);
  await signIn(email, password, name);
}

/**
 * The garden on screen right now — but only when it is the anonymous one.
 *
 * Read *before* `adoptSession` switches the slot: afterwards `bridge.read()`
 * returns the account's own slot, and the garden the player was growing survives
 * only on disk, not in memory. Already-signed-in returns null too: the current
 * save belongs to an account, and carrying it into a second account is how one
 * player's garden leaks into another's.
 */
function guestSnapshot(): { state: unknown; savedAt: number } | null {
  if (!bridge || getActiveAccountId() !== null) return null;
  const { state, savedAt } = bridge.read();
  return { state, savedAt };
}

/**
 * Whether a guest garden is worth offering back to the player.
 *
 * A guest slot exists the moment the game boots — `loadOrCreate` persists a fresh
 * garden there — so "a save exists" is not the test. Something must have happened
 * in it: a second plant, a fight, a breed, experience, or a coin purse that is no
 * longer the starting one. Without this, opening the game and signing straight in
 * would raise a "which garden?" prompt over a garden indistinguishable from none.
 */
function gardenStarted(state: unknown): boolean {
  const s = state as {
    plants?: unknown[];
    lifetimeExp?: number;
    leafCoin?: number;
    discovery?: { battles?: number; breeds?: number };
  } | null;
  if (!s || typeof s !== "object") return false;
  return (
    (Array.isArray(s.plants) ? s.plants.length : 0) > 1 ||
    (Number(s.lifetimeExp) || 0) > 0 ||
    (Number(s.leafCoin) || 0) !== 1200 ||
    (Number(s.discovery?.battles) || 0) > 0 ||
    (Number(s.discovery?.breeds) || 0) > 0
  );
}

/** Whether the conflict currently on the strip is the guest-vs-account one. */
export function guestChoiceOffered(): boolean {
  return pendingGuest !== null;
}

/**
 * Resolve the guest-vs-account fork.
 *
 * `true` writes the guest garden into the account's slot and pushes it — its
 * timestamp is newer than the cloud's, which is exactly why the choice was
 * offered, so the server takes it. `false` leaves whatever is already loaded,
 * which is the account's own save in both reachable branches.
 */
export async function resolveGuestChoice(keepGuest: boolean): Promise<void> {
  if (!pendingGuest) return;
  const g = pendingGuest;
  pendingGuest = null;
  if (keepGuest && bridge) {
    bridge.write(g.state, g.savedAt);
    emit({ state: "synced", message: "Đã giữ vườn chơi không đăng nhập.", lastSyncedAt: Date.now(), serverWasNewer: false });
    await push();
    return;
  }
  emit({ state: "synced", message: "Đã dùng vườn trên tài khoản.", lastSyncedAt: Date.now(), serverWasNewer: false });
}

export async function signIn(email: string, password: string, preferredName?: string): Promise<void> {
  const guest = guestSnapshot();
  const session: AccountSession = await apiLogin(email, password);
  adoptSession(session.token, email, session.playerId);
  // Bounded for the same reason as the Google path: a slow Worker must not be able to
  // keep a player out of the game they have just signed in to.
  let adoptedInPull = false;
  await settleWithin(ENTRY_SYNC_TIMEOUT_MS, pull((state) => {
    const name = adoptableName(email, preferredName, state);
    if (name) {
      (state as { name?: string }).name = name;
      adoptedInPull = true;
    }
  }, guest));
  // A pending guest fork must keep its `conflict` state — a push here would end
  // with "synced" and hide the choice the player still has to make.
  if (!pendingGuest && (adoptedInPull || adoptInGameName(email, preferredName))) void push();
}

/**
 * The name the account should wear, if the save does not already have a real one.
 *
 * A fresh garden calls its owner the stock "Nhà Lai Tạo" — a placeholder, not an
 * identity. Once a session exists the fallback is the account's email prefix, and
 * a name typed at registration wins over both. A save that already carries a
 * chosen name keeps it: signing in must never rename anyone.
 */
function adoptableName(email: string, preferredName: string | undefined, state: unknown): string | null {
  const current = typeof (state as { name?: unknown } | null | undefined)?.name === "string" ? (state as { name: string }).name.trim() : "";
  const isPlaceholder = !current || current === DEFAULT_PLAYER_NAME;
  const chosen = preferredName?.trim() ?? "";
  const next = chosen || (isPlaceholder ? (email.split("@")[0] ?? "").trim() : "");
  return next && next !== current ? next : null;
}

/**
 * Give the save a real name once there is an account to name it after.
 *
 * Covers the pull branches where no remote state was written — a fresh account
 * pushing its garden up, or a local save newer than the cloud — where renaming
 * through the store is correct because this device's copy is the authoritative
 * one. When the cloud copy is adopted, the name goes into `pull`'s write instead,
 * so the server timestamp that save arrives with survives.
 *
 * Returns whether a rename happened, so the caller can push it up once.
 */
function adoptInGameName(email: string, preferredName?: string): boolean {
  if (!bridge?.renamePlayer) return false;
  const next = adoptableName(email, preferredName, bridge.read().state);
  if (!next) return false;
  bridge.renamePlayer(next);
  return true;
}

/**
 * Rename the player, everywhere the name is shown.
 *
 * The name lives in the save, so changing it is a store mutation plus a push —
 * the Worker's save handler re-points the leaderboard row and the friend-search
 * indexes from the same payload, which is why there is no separate rename call
 * to forget.
 */
export async function updateName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError("bad_name", "Cần một cái tên.");
  bridge?.renamePlayer?.(trimmed);
  await push();
}

/**
 * Finish a sign-in that already has a token.
 *
 * Shared by the password path and the Google path so that "we have a token" means
 * exactly the same thing in both — the same slot switch, the same three localStorage
 * writes, the same status event, the same first pull. Written twice, the two would drift,
 * and the first thing that would break is the one nobody retests: signing in with Google
 * on a device that already has a password session.
 */
function adoptSession(newToken: string, email: string, playerId: string, kind: SessionKind = "password"): void {
  token = newToken;
  // A different account means a different cloud copy, so whatever this device had learned
  // about the previous one no longer authorises a write. The pull below re-establishes it.
  cloudRead = false;
  localStorage.setItem(TOKEN_KEY, newToken);
  localStorage.setItem(EMAIL_KEY, email);
  rememberSessionKind(kind);

  // Point the save at this account's own slot, and load what is in it.
  //
  // This is the line that makes two accounts two gardens. It has to happen *before* the
  // pull below, or the pull would fetch the new account's cloud save and apply it to a
  // store still holding the previous account's plants. And it has to happen *after* the
  // writes above, so a sign-in that fails later still leaves the player in a slot that
  // belongs to them rather than to whoever was here before.
  //
  // `saveSlot` announces the change to the store itself; there is nothing to remember
  // to call here.
  setActiveAccountId(playerId);

  // The grace period starts when the sign-in succeeds, not when the page loads. Reading
  // "is there a token" instead would treat an expired session as a live one and let it
  // through forever, which is precisely what the grace period is meant to bound.
  rememberSignIn();
  emit({ email, state: "idle", message: "Đã đăng nhập." });
  // A stale undecided guest fork from an earlier session does not belong to this
  // one — the snapshot was of a different moment's garden.
  pendingGuest = null;
  startAuto();
}

/**
 * Sign in with Google.
 *
 * The browser only forwards an ID token; the Worker verifies it and is the only party
 * that decides who this is. The session is then adopted exactly as a password session
 * would be, including the initial pull, so a returning player lands on the garden they
 * left rather than on a blank one.
 */
/**
 * How long sign-in will wait for the garden before letting the player in anyway.
 *
 * Authentication and synchronisation are different concerns, and a failure in the second
 * must not block the first. `pull` already swallows its own errors, so this bounds the
 * time it can take rather than the outcome - but a slow Worker and a hung one look
 * identical from outside, and only one of them should be able to keep a player out of a
 * game they have just proved they own.
 */
const ENTRY_SYNC_TIMEOUT_MS = 8000;

async function settleWithin(ms: number, work: Promise<unknown>): Promise<boolean> {
  // Widened rather than `number`: this one source compiles for Node, whose setTimeout
  // returns a Timeout object, and for the browser, which returns a number. A cast at the
  // call site would silence a real mismatch instead of describing it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const done = work.then(
    () => true,
    () => true,
  );
  try {
    return await Promise.race([done, cap]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Sign in with Google.
 *
 * The browser only forwards an ID token; the Worker verifies it and is the only party
 * that decides who this is. The session is adopted exactly as a password session would
 * be, and the gate opens on that alone - the garden sync is allowed to finish behind the
 * player rather than in front of them.
 */
export async function signInWithGoogle(idToken: string): Promise<{ created: boolean; email: string }> {
  const guest = guestSnapshot();
  const session = await apiGoogleSignIn(idToken);
  const email = session.email ?? session.name ?? "Google";
  adoptSession(session.token, email, session.playerId, "google");
  let adoptedInPull = false;
  await settleWithin(ENTRY_SYNC_TIMEOUT_MS, pull((state) => {
    const name = adoptableName(email, undefined, state);
    if (name) {
      (state as { name?: string }).name = name;
      adoptedInPull = true;
    }
  }, guest));
  // A Google account names itself after the address it signed in with — the same
  // handle the friends list searches by — until the player picks a real one. Not
  // while a guest fork is undecided: a push would stamp "synced" over the choice.
  if (!pendingGuest && (adoptedInPull || adoptInGameName(email))) void push();
  return { created: session.created, email: session.email ?? "" };
}

/**
 * Sign out.
 *
 * Resolves when the teardown has actually happened — not when it was started. Await this.
 *
 * ## Why it returns a promise at all
 *
 * Signing out does two things in order: a final push, so the session's work is not thrown
 * away, and then the removal of the token, the grace stamp and the save slot. Only the
 * second half matters for whether the player is signed in, and it cannot start until the
 * first finishes.
 *
 * The previous version was `void push().finally(...)`, and every caller worked around the
 * fact that it had no idea when that finished by waiting a guessed 400ms and then asking
 * for the login screen. A 400ms guess against a request whose own timeout is 8000ms is
 * not a guess, it is a coin flip: on any normal network the gate was raised while the
 * token was still present, the gate stood itself down, and the player pressed "đăng xuất"
 * and carried on playing — signed in, believing they were not.
 *
 * ## Why the wait is bounded at all
 *
 * The final push is best-effort and the teardown is not. If the network is down or slow,
 * `push()` still settles (the API aborts at 8s), but the promise is raced against a
 * shorter cap as a second line of defence, and **the cap wins by doing the teardown
 * anyway**. A player whose server is unreachable must still be able to sign out — being
 * unable to log out is a worse failure than losing one unsaved push.
 */
export function signOut(): Promise<void> {
  const teardown = (): void => {
    token = null;
    cloudRead = false;
    pendingGuest = null;
    stopAuto();
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(SEEN_KEY);
    } catch {
      // Storage disabled. The in-memory session is gone, which is what decides whether the
      // gate admits this visit; the next reload has no token either way.
    }
    forgetSessionKind();
    forgetSignIn();
    // Back to the anonymous garden, which is where it has been sitting untouched this
    // whole time. Signing out is not a reset: someone who played without an account,
    // then signed in, then signed out again, finds their own plants waiting.
    setActiveAccountId(null);
    emit({
      email: null,
      state: "off",
      message: "Đã đăng xuất. Vườn vẫn còn trên máy này.",
      lastSyncedAt: null,
      serverWasNewer: false,
    });
  };

  // `push` is already safe to call with no token and already swallows its own errors, so
  // this never rejects — the `then` is for symmetry and to be explicit about that.
  const flushed = push().then(
    () => undefined,
    () => undefined,
  );

  return Promise.race([flushed, capAfter(SIGN_OUT_PUSH_GRACE_MS)]).then(() => {
    teardown();
  });
}

/**
 * How long the final push may delay the sign-out.
 *
 * Deliberately much shorter than the API's own 8s abort. The push is insurance for work
 * already done; the sign-out is a thing the player asked for and is waiting on. When the
 * two conflict, the player wins.
 */
const SIGN_OUT_PUSH_GRACE_MS = 1500;

function capAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isSignedIn(): boolean {
  return Boolean(token);
}

/**
 * The session token, or null.
 *
 * Exported so a feature that authenticates its own requests does not have to keep its own
 * copy of one, or read it out of localStorage where the signing-in code is the only thing
 * that should be writing it. Null means signed out, and callers are expected to say so
 * rather than to send an unauthenticated request and read the 401 as an error.
 */
export function currentToken(): string | null {
  return token;
}

/**
 * Bring the cloud save down.
 *
 * ## Why this is never forced
 *
 * It used to take a `force` flag, and boot, password sign-in and Google sign-in all passed
 * `true`. Forced meant "write the cloud over the local slot regardless of timestamps", on the
 * theory that the cloud is newer by definition on login because this device has not seen it.
 *
 * That theory is wrong for the one case that matters most: a player who is *already* signed in
 * and reloads the page. Their local slot holds everything they have done, and the cloud may be
 * behind — a push throttled by the daily budget, a push that failed on a bad connection, or
 * simply the seconds of play since the last auto-sync. Forcing on boot threw all of it away and
 * replaced the garden with the cloud's older copy. From the player's side the game "kept
 * resetting to the beginning on refresh" while their plants sat on disk the whole time.
 *
 * The timestamps already say which copy is newer, and they are the server's own stamp for a
 * pulled save and this device's for a local one. So they decide, in both directions: an older
 * local slot is replaced by the cloud, and a newer one is kept and pushed up.
 */
export async function pull(
  adoptState?: (state: unknown) => void,
  guest?: { state: unknown; savedAt: number } | null,
): Promise<void> {
  if (!token || !bridge) return;
  // A new pull re-asks the question, so a fork offered by the previous one is void.
  pendingGuest = null;
  emit({ state: "syncing", message: "Đang tải vườn từ tài khoản…" });

  try {
    const remote = await fetchSave(token);
    // Reached the endpoint and it answered. Whether it held anything is now known, which is
    // what authorises a later push. See `cloudRead`.
    cloudRead = true;
    if (!remote) {
      /*
       * First run on this account: push the garden the player was actually growing.
       *
       * The slot switch already loaded the account's own slot — empty, so a fresh
       * garden — and pushing *that* would leave the guest's progress orphaned in the
       * anonymous slot while the account fills up with a level-1 garden. The guest
       * snapshot goes into the slot first so the push sends their garden, and the
       * name fix is folded in before the write so the one push carries it.
       */
      if (guest) {
        adoptState?.(guest.state);
        bridge.write(guest.state, guest.savedAt);
      }
      emit({ state: "idle", message: "Tài khoản mới — đang lưu vườn hiện tại lên." });
      await push();
      return;
    }

    const local = bridge.read();
    const localAt = Number(local.savedAt) || 0;

    /*
     * A guest garden newer than the account's cloud copy is a real fork: the player
     * grew something while signed out, and whichever side wins, the other side's
     * work is gone from view. Offered rather than decided silently — but only when
     * the garden is more than the fresh one every boot plants (see `gardenStarted`).
     */
    const guestIsNewerWork = !!guest && gardenStarted(guest.state) && guest.savedAt > remote.savedAt;

    /*
     * Local is newer or the same age: keep it, and send it up.
     *
     * The push is the part that was missing. Returning early without one left the cloud
     * behind for as long as the auto-sync interval, which is exactly the window in which a
     * reload would have looked like a reset.
     */
    if (remote.savedAt <= localAt) {
      emit({ state: "synced", message: "Vườn trên máy này là bản mới nhất.", lastSyncedAt: Date.now(), serverWasNewer: false });
      await push();
    } else {
      /*
       * `adoptState` folds an identity fix — the in-game name — into the remote copy
       * before it is written, rather than committing one on top. A commit would
       * re-stamp `savedAt` with this machine's clock and the adopted save would
       * forever look newer than the cloud it came from.
       */
      adoptState?.(remote.state);
      bridge.write(remote.state, remote.savedAt);
      emit({
        state: "synced",
        message: "Đã nạp vườn từ tài khoản.",
        lastSyncedAt: Date.now(),
        serverWasNewer: false,
      });
    }

    if (guestIsNewerWork) {
      pendingGuest = guest;
      emit({
        state: "conflict",
        message: "Vườn chơi không đăng nhập trên máy này mới hơn bản trên tài khoản — chọn bản muốn giữ.",
        serverWasNewer: true,
      });
    }
  } catch (err) {
    report(err, "Không tải được vườn từ tài khoản.");
  }
}

/** Send the local save up. Never throws — a failed push is a message, not a break. */
export async function push(): Promise<void> {
  if (!token || !bridge) return;
  if (writesToday() >= DAILY_WRITE_BUDGET) {
    emit({ state: "paused", message: "Đã tạm dừng đồng bộ hôm nay để giới hạn ghi của máy chủ." });
    return;
  }

  /*
   * The one hard refusal in this module.
   *
   * Refusing to write over a save this device has never managed to read is the difference
   * between "the server was slow and you played a bit" and "the account is gone". A failed
   * push is recoverable by pressing the button again; an overwritten save is not recoverable
   * by anything.
   *
   * The message says what to do rather than just refusing, because a player watching a sync
   * that silently stops needs to know it will start again on its own. `startAuto` retries
   * every five minutes, so the honest answer is "it will retry", not "press something".
   */
  if (!cloudRead) {
    emit({
      state: "error",
      message: "Chưa đọc được vườn trên tài khoản nên chưa ghi đè lên. Sẽ thử lại tự động.",
    });
    return;
  }

  emit({ state: "syncing", message: "Đang lưu lên tài khoản…" });

  try {
    const { state, savedAt } = bridge.read();
    const res = await pushSave(token, Number(savedAt) || Date.now(), state);
    noteWrite();

    if (res.kept === "theirs") {
      // The server had something newer and kept it. Saying so is the point: a
      // silent success here would look like a save that quietly did not happen.
      emit({
        state: "conflict",
        message: "Máy chủ có bản mới hơn nên giữ bản đó. Tải xuống để dùng.",
        lastSyncedAt: Date.now(),
        serverWasNewer: true,
      });
      return;
    }
    emit({ state: "synced", message: "Đã lưu lên tài khoản.", lastSyncedAt: Date.now(), serverWasNewer: false });
  } catch (err) {
    report(err, "Không lưu được lên tài khoản.");
  }
}

/** Resolve a conflict by taking the server's copy. */
export async function takeServer(): Promise<void> {
  if (!token || !bridge) return;
  pendingGuest = null;
  try {
    const remote = await fetchSave(token);
    if (!remote) return;
    bridge.write(remote.state, remote.savedAt);
    emit({ state: "synced", message: "Đã dùng bản trên máy chủ.", lastSyncedAt: Date.now(), serverWasNewer: false });
  } catch (err) {
    report(err, "Không tải được bản trên máy chủ.");
  }
}

/** Overwrite the server with this device's copy. */
export async function keepLocal(): Promise<void> {
  if (!token || !bridge) return;
  pendingGuest = null;
  try {
    const { state, savedAt } = bridge.read();
    // Nudged a millisecond past whatever the server holds, so last-write-wins
    // resolves the way the player just chose.
    await pushSave(token, (Number(savedAt) || Date.now()) + 1, state);
    noteWrite();
    emit({ state: "synced", message: "Đã giữ bản của máy này.", lastSyncedAt: Date.now(), serverWasNewer: false });
  } catch (err) {
    report(err, "Không ghi được bản của máy này.");
  }
}

export async function updatePassword(current: string, next: string): Promise<void> {
  if (!token) throw new AccountError("unauthorised", "Chưa đăng nhập.");
  await changePassword(token, current, next);
  emit({ message: "Đã đổi mật khẩu." });
}

function report(err: unknown, fallback: string): void {
  const code = err instanceof AccountError ? err.code : "unknown";
  const message =
    code === "offline" || code === "timeout"
      ? "Mất mạng — vườn vẫn được lưu trên máy này."
      : code === "unauthorised"
        ? "Phiên đăng nhập hết hạn. Đăng nhập lại để đồng bộ."
        : fallback;
  emit({ state: "error", message });
}