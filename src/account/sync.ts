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
import { setActiveAccountId } from "../core/saveSlot";

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
  void pull(true);
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

export async function signUp(email: string, password: string): Promise<void> {
  await apiRegister(email, password);
  await signIn(email, password);
}

export async function signIn(email: string, password: string): Promise<void> {
  const session: AccountSession = await apiLogin(email, password);
  adoptSession(session.token, email, session.playerId);
  // Bounded for the same reason as the Google path: a slow Worker must not be able to
  // keep a player out of the game they have just signed in to.
  await settleWithin(ENTRY_SYNC_TIMEOUT_MS, pull(true));
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
  const session = await apiGoogleSignIn(idToken);
  adoptSession(session.token, session.email ?? session.name ?? "Google", session.playerId, "google");
  await settleWithin(ENTRY_SYNC_TIMEOUT_MS, pull(true));
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
 * `force` is what happens on login: the cloud is newer by definition then, because
 * this device has not seen it. Without it, a routine sync on a second device would
 * refuse to pull and the player would be stuck playing whichever copy that device
 * happened to have.
 */
export async function pull(force = false): Promise<void> {
  if (!token || !bridge) return;
  emit({ state: "syncing", message: "Đang tải vườn từ tài khoản…" });

  try {
    const remote = await fetchSave(token);
    // Reached the endpoint and it answered. Whether it held anything is now known, which is
    // what authorises a later push. See `cloudRead`.
    cloudRead = true;
    if (!remote) {
      // First run on this account: push the local garden up rather than leaving
      // the account empty and pretending the player has nothing.
      emit({ state: "idle", message: "Tài khoản mới — đang lưu vườn hiện tại lên." });
      await push();
      return;
    }

    const local = bridge.read();
    const localAt = Number(local.savedAt) || 0;

    if (!force && remote.savedAt <= localAt) {
      emit({ state: "synced", message: "Vườn trên máy này là bản mới nhất.", lastSyncedAt: Date.now(), serverWasNewer: false });
      return;
    }
    if (!force && remote.savedAt < localAt) {
      emit({ state: "conflict", message: "Máy này có bản mới hơn — chưa tải xuống để khỏi mất.", serverWasNewer: false });
      return;
    }

    bridge.write(remote.state, remote.savedAt);
    emit({
      state: "synced",
      message: force ? "Đã nạp vườn từ tài khoản." : "Đã cập nhật vườn từ tài khoản.",
      lastSyncedAt: Date.now(),
      serverWasNewer: false,
    });
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