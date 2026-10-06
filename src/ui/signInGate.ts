/**
 * The sign-in gate.
 *
 * Shown over the game at boot when there is no usable session. The player asked for
 * this: to play you must be logged in, but a login is remembered for a period rather
 * than demanded on every visit.
 *
 * Two escapes are deliberate, and both are about the same thing — the gate must never be
 * the reason somebody cannot play:
 *
 * **It stands down when no Worker is configured.** Decided in `gate.ts`, and the reason
 * is written there: with no service there is nothing to authenticate against, and a wall
 * with no door behind it is worse than no wall.
 *
 * **"Chơi không cần tài khoản" is session-scoped.** One visit, then the gate is back.
 * Persisted, it would be a hole that nothing ever closes, which defeats the point of
 * adding a gate at all. The button is offered plainly rather than hidden, because a
 * player whose Worker is down should be told that this is why, not left guessing.
 *
 * Both halves of the form are reused — `googlePanel` and `buildEmailSignIn` — because the
 * gate and the account sheet must not be able to disagree about how a player signs in.
 */

import { el, toast } from "./components";
import { sfx } from "../audio/audio";
import { bypassOnce, gateState, graceDaysLeft, GRACE_DAYS } from "../account/gate";
import { accountStatus, onAccountStatus } from "../account/sync";
import { googlePanel } from "./googlePanel";
import { buildEmailSignIn } from "./emailSignIn";
import { accountServiceAvailable } from "../account/api";

export interface SignInGateOptions {
  /** Called once the player is in, so the host can take the overlay down. */
  onEnter: () => void;
}

/**
 * The gate currently on screen, if any.
 *
 * Module-level so that anything which establishes a session can stand the gate down —
 * not only the closure `showSignInGateIfNeeded` handed to the panel it built.
 *
 * ## Why that matters
 *
 * Before this, the gate came down in exactly one way: `enter()`, the local closure passed
 * into `googlePanel` as its `onSignedIn` callback. Any other path that produced a valid
 * session left the login screen up over a signed-in player:
 *
 *   - the email form, which fires a `signed-in` event the gate listens for — that one worked
 *   - the Google button's own credential path, which reached `complete()` and so `enter()`
 *   - **anything else**, including the account sheet's sign-in, a session restored by a
 *     background refresh, or a future sign-in route nobody has written yet
 *
 * That is the whole "signed in but stuck at the login screen" family of bug: the gate's
 * dismissal was wired to *who told it to* rather than to *the fact of being signed in*. One
 * forgotten callback and the player is locked out of a game they just proved they own, with
 * no error anywhere.
 *
 * So the gate watches the session itself. Whoever signs the player in, the gate stands down.
 */
let liveGate: { overlay: HTMLElement; enter: () => void } | null = null;

/**
 * Stand the gate down, if it is up.
 *
 * Safe to call when there is no gate, and safe to call twice: the second call is a no-op.
 * Every sign-in path calls it, which is the point — no path can be the one that forgets.
 */
export function dismissSignInGate(): void {
  const gate = liveGate;
  if (!gate) return;
  liveGate = null;
  gate.enter();
}

/**
 * Show the gate, or do nothing.
 *
 * Decides for itself rather than being asked. A caller that had to remember the check
 * would eventually forget it, and the failure would be a gate that silently stopped
 * appearing — invisible right up until somebody tested it.
 */
export function showSignInGateIfNeeded(options: SignInGateOptions): void {
  if (!accountServiceAvailable) return;

  const state = gateState(true);
  if (state.open) return;

  const host = document.querySelector(".shell");
  if (!host) return;

  const overlay = el("div", { class: "overlay gate-overlay" });
  const card = el("div", { class: "sheet gate-card" });

  // Declared before `enter` because `enter` tears the panel down, and it is assigned after.
// A direct `google.destroy()` inside `enter` would close over a `const` that is still in
// its temporal dead zone if the email form ever fired synchronously during setup.
let destroyGoogle = (): void => {};

  const enter = (): void => {
    stopWatchingSession();
    destroyGoogle();
    overlay.remove();
    if (liveGate?.overlay === overlay) liveGate = null;
    options.onEnter();
  };

  /*
   * Watch the session rather than trusting the caller.
   *
   * `onAccountStatus` fires the moment `adoptSession` reports a signed-in state — before
   * the garden sync, before the panel's own `onSignedIn` — so the gate comes down on the
   * fact of being signed in. The panel still calls `onEnter` directly for its own button;
   * that is now redundant rather than load-bearing, which is the correct way round: the
   * redundancy is the safety net, not the mechanism.
   *
   * Only a *transition* counts, never the initial value. `onAccountStatus` calls its
   * listener immediately, and at the moment this gate is built the status can already
   * name a signed-in player — one whose session is nonetheless lapsed, which is precisely
   * why this gate exists. Reacting to the first value tore the gate down in the same tick
   * it was created, so a lapsed player was waved straight in and never asked to sign in
   * again. Caught by `test-auth-gate.ts`, and worth the comment.
   */
  let stopWatchingSession = (): void => {};
  const hadSessionAtBuild = Boolean(accountStatus().email);
  const watch = onAccountStatus((status) => {
    if (status.email && !hadSessionAtBuild) enter();
  });
  stopWatchingSession = watch;

  liveGate = { overlay, enter };

  const email = buildEmailSignIn();
  // The shared form announces its own success rather than taking a callback, so a host
  // that forgets to wire one still gets taken through the gate.
  email.form.addEventListener("signed-in", () => {
    toast("Đã đăng nhập.");
    enter();
  });

  const google = googlePanel(
    enter,
    () => {
      // The panel writes its own message.
    },
    // The gate is the one place with no alternative way in, so a stalled Google button
    // is a dead end rather than an inconvenience.
    { fallbackOnStall: true },
  );
  destroyGoogle = google.destroy;

  const skip = el("button", { class: "gate-skip", type: "button" }, [
    "Chơi không cần tài khoản (chỉ lần này)",
  ]);
  skip.addEventListener("click", () => {
    bypassOnce();
    enter();
  });

  const reason =
    state.reason === "expired"
      ? `Phiên đăng nhập gần đây đã hết hạn. Đăng nhập lại để chơi tiếp trên mọi máy.`
      : `Đăng nhập một lần, được nhớ trong ${GRACE_DAYS} ngày. Vườn của bạn đồng bộ giữa mọi máy.`;

  card.append(
    el("div", { class: "gate-head" }, [
      el("div", { class: "gate-mark" }, ["🌿"]),
      el("h2", { class: "gate-title" }, ["Đăng nhập để vào game"]),
    ]),
    el("p", { class: "tiny muted gate-sub" }, [reason]),
    ...google.nodes,
    el("div", { class: "account-sep tiny muted" }, ["hoặc — đăng nhập bằng email"]),
    email.form,
    skip,
  );

  overlay.appendChild(card);
  host.appendChild(overlay);
  card.querySelector<HTMLInputElement>(".field")?.focus();
}

/** Exposed for the gate's own copy, and for a test that checks the two agree. */
export function gateGraceNote(): string {
  const d = graceDaysLeft();
  return d > 0 ? `Phiên đăng nhập hết hạn sau ${d} ngày nữa.` : "";
}

// `sfx` is imported for the side effect of being the single audio entry point; the gate
// itself is silent, which is deliberate - a sound on load is a sound before any gesture
// has unlocked audio, and browsers discard it anyway.
void sfx;