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
import { googlePanel } from "./googlePanel";
import { buildEmailSignIn } from "./emailSignIn";
import { accountServiceAvailable } from "../account/api";

export interface SignInGateOptions {
  /** Called once the player is in, so the host can take the overlay down. */
  onEnter: () => void;
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

  const enter = (): void => {
    overlay.remove();
    options.onEnter();
  };

  const email = buildEmailSignIn();
  // The shared form announces its own success rather than taking a callback, so a host
  // that forgets to wire one still gets taken through the gate.
  email.form.addEventListener("signed-in", () => {
    toast("Đã đăng nhập.");
    enter();
  });

  const google = googlePanel(enter, () => {
    // The panel writes its own message.
  });

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