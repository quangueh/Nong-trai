/**
 * The Google sign-in panel.
 *
 * Built as its own surface rather than a button dropped into the email form, because
 * they are not two ways of doing the same thing. One is a single tap that needs no
 * typing and no password to forget; the other is a form. Presenting them as equals -
 * two buttons in a column - made the better option look like the fallback.
 *
 * So: Google is the primary action, visually first and largest. The email form sits
 * below a divider and is explicitly the alternative. That ordering is also the honest
 * one, because Google is the only one of the two that cannot be phished by a typo in an
 * address.
 *
 * Google's own button is used when its script paints, because it carries the popup, the
 * origin checks and the accessibility that a hand-rolled button would not. When it does
 * not paint, a styled fallback takes its place so the option never silently vanishes.
 */

import { el, toast } from "./components";
import { sfx } from "../audio/audio";
import {
  GoogleSignInError,
  GOOGLE_CLIENT_ID,
  googleFailureMessage,
  googleSignInAvailable,
  onGoogleCredential,
  renderGoogleButton,
  requestGoogleIdToken,
  traceAuth,
} from "../account/google";
import { signInWithGoogle } from "../account/sync";

/** The four-colour Google mark, at the official 48-unit grid. */
const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
<path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.76 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"/>
<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

export interface GooglePanelResult {
  /** Append in order. Kept as an array so the caller decides the surrounding layout. */
  nodes: HTMLElement[];
  /** Re-run the sign-in. Used by the retry path and by the "tried and failed" copy. */
  run: () => void;
  /** The element errors are written into, so the caller does not have to find it. */
  errorSlot: HTMLElement;
  /**
   * Release the credential listener and any pending timer.
   *
   * Call it when the panel leaves the screen. A panel is built on every open, and each one
   * adds a listener to a module-level set — so without this, opening the account sheet three
   * times leaves three listeners, and a single token from Google completes the same sign-in
   * three times: three pushes, three slot switches, and a race for which one wins.
   */
  destroy: () => void;
}

export interface GooglePanelOptions {
  /**
   * Bring the styled button back if Google's does not respond.
   *
   * Only for the gate. The watchdog cannot observe Google's button at all, so it has to
   * be armed on a timer, and a timer that fires while the player is merely *looking* at
   * the account sheet would greet them with "Google's button is not responding" before
   * they had pressed anything. At the gate there is no other way in, so a stalled button
   * really is a dead end and the fallback is worth surfacing on its own.
   */
  fallbackOnStall?: boolean;
}

/**
 * Build the panel.
 *
 * `onSignedIn` is called after a successful sign-in. It is a callback rather than a
 * repaint hook inside this module because the sheet that owns the panel is the thing
 * that knows how to redraw itself.
 */
export function googlePanel(
  onSignedIn: () => void,
  onFailure: (message: string) => void,
  options: GooglePanelOptions = {},
): GooglePanelResult {
  const fallbackOnStall = options.fallbackOnStall === true;
  const errorSlot = el("p", { class: "account-err" });
  /*
   * Progress lives here rather than inside `attempt`, so it is appended with the rest
   * of the panel and occupies its line from the start. An empty paragraph is a fixed,
   * predictable slot - adding the element only when there is something to say makes the
   * form jump the first time a message appears.
   */
  const stepSlot = el("p", { class: "gpanel-step tiny muted" });

  /*
   * Declared with the other slots rather than beside `attempt`, because `reviveFallback`
   * reads it and the watchdog is armed the moment Google's button paints — which happens
   * long before anybody clicks. A `let` declared further down would be a temporal dead
   * zone error thrown from a timer, which is the least legible way this file could fail.
   */
  let busy = false;

  /** Shown when the watchdog revives the fallback. Hidden until then, if ever. */
  const fallbackNote = el("p", { class: "gpanel-note tiny muted" }, [
    "Nút bên dưới gọi cùng một luồng đăng nhập.",
  ]);
  fallbackNote.hidden = true;

  const brand = el("div", { class: "gpanel-brand" });
  brand.innerHTML = GOOGLE_G;

  const heading = el("div", { class: "gpanel-text" }, [
    el("div", { class: "gpanel-title" }, ["Tiếp tục với Google"]),
    el("div", { class: "gpanel-sub" }, ["Tạo tài khoản hoặc quay lại. Không cần mật khẩu, không cần nhớ mật khẩu."]),
  ]);

  const action = el("button", { class: "gpanel-btn", type: "button" });
  action.append(brand, heading);

  /*
   * The real Google button replaces the styled one in place.
   *
   * It is given its own child to render into rather than the slot itself, because
   * `renderGoogleButton` empties whatever it is handed before it calls Google's
   * renderer — so handing it the slot meant a failed render took the fallback with it,
   * leaving an empty 56px gap. That is the one case the fallback exists for, so it is
   * exactly the case that must not destroy it.
   */
  const inner = el("div", { class: "gpanel-inner" });
  const slot = el("div", { class: "gpanel-slot" }, [action, inner]);
  action.addEventListener("click", () => void attempt());

  /*
   * The watchdog, and why there is one.
   *
   * Hiding this button when Google's paints removed the only fallback. Google's button
   * handles its own clicks, so nothing here can tell whether it worked, and a button that
   * silently does nothing leaves the player at the gate with no way in but the email form
   * - for a third-party failure they can do nothing about.
   *
   * So it comes back on its own: if the button has not moved the flow within a few seconds,
   * this is revealed again. Invisible when things work, which is the only time anyone looks
   * at it.
   */
  let watchdog: number | undefined;
  const reviveFallback = (): void => {
    if (watchdog !== undefined) {
      window.clearTimeout(watchdog);
      watchdog = undefined;
    }
    /*
     * A sign-in in flight means the button is working.
     *
     * Announcing a dead button while a popup is open in front of the player is both false
     * and the most demoralising thing this panel could say. It happened: the watchdog fired
     * at six seconds, well inside the time it takes to read a sentence and pick an account,
     * and it fired on the *account sheet* too, where `fallbackOnStall` was supposed to be
     * off.
     */
    if (busy) return;
    action.hidden = false;
    // A caption, not an accusation. The button may well be fine; the fallback is here so
    // that "nothing happened" is never a dead end, not because something is wrong.
    fallbackNote.hidden = false;
  };
  const armWatchdog = (): void => {
    if (!fallbackOnStall) return;
    if (watchdog !== undefined) window.clearTimeout(watchdog);
    watchdog = window.setTimeout(reviveFallback, 9000);
  };
  const disarmWatchdog = (): void => {
    if (watchdog === undefined) return;
    window.clearTimeout(watchdog);
    watchdog = undefined;
  };

  const setStep = (text: string): void => {
    stepSlot.textContent = text;
  };

  /**
   * Turn an ID token into a session, and let the player in.
   *
   * Split out from `attempt` because it is now reached by two different routes that have
   * nothing else in common: the fallback button's `prompt()`, and the token Google's own
   * rendered button hands over on its own. Before this existed, only the first route got
   * here — so the button that actually works could not finish signing in.
   *
   * `busy` is claimed *before* the await, so a token delivered twice (once to the parked
   * slot, once live) cannot start two sign-ins and race each other into two sessions.
   */
  async function complete(idToken: string): Promise<void> {
    if (busy) return;
    busy = true;
    action.classList.add("is-busy");
    disarmWatchdog();
    try {
      setStep("Đang xác thực với máy chủ…");
      traceAuth("token received", { chars: idToken.length });
      const session = await signInWithGoogle(idToken);

      setStep("Đang đồng bộ vườn…");
      sfx.play("levelUp");
      traceAuth("session adopted", { created: session.created, email: session.email });
      toast(session.created ? "Đã tạo tài khoản. Đã đồng bộ." : "Đã quay lại. Đồng bộ xong.");
      onSignedIn();
    } catch (e) {
      const message = e instanceof GoogleSignInError ? googleFailureMessage(e.code) : describe(e);
      setStep("");
      traceAuth("sign-in failed", { message });
      // Cancellation is not an error. Saying "sign-in failed" after the player
      // deliberately closed the popup is the kind of small lie that teaches people to
      // distrust the messages.
      if (!(e instanceof GoogleSignInError && e.code === "cancelled")) {
        sfx.play("error");
        errorSlot.textContent = message;
        onFailure(message);
      }
    } finally {
      busy = false;
      action.classList.remove("is-busy");
    }
  }

  /**
   * Drive the sign-in from our own button.
   *
   * Only needed when Google's own button is not on screen — it drives its own popup and
   * its own token, and reaches `complete` through the credential listener below rather than
   * through here.
   */
  async function attempt(): Promise<void> {
    if (busy) return;
    errorSlot.textContent = "";
    action.classList.add("is-busy");
    armWatchdog();
    try {
      setStep("Đang mở cửa sổ đăng nhập Google…");
      const idToken = await requestGoogleIdToken();
      await complete(idToken);
    } catch (e) {
      const message = e instanceof GoogleSignInError ? googleFailureMessage(e.code) : describe(e);
      setStep("");
      traceAuth("token request failed", { message });
      if (!(e instanceof GoogleSignInError && e.code === "cancelled")) {
        sfx.play("error");
        errorSlot.textContent = message;
        onFailure(message);
      }
    }
  }

  /*
   * Google's own button hands its token over on its own initiative, with nobody having
   * asked for it. This is the listener that catches it.
   *
   * Registered at construction rather than after `renderGoogleButton` resolves, because a
   * credential can arrive at any point from there on and a window with no listener is
   * exactly the bug this whole mechanism exists to close. The unsubscribe is kept and
   * handed back on the result, so a sheet opened repeatedly does not stack listeners.
   */

  if (!googleSignInAvailable) {
    // Removes both the styled button and Google's empty target. Replaced the whole
    // slot, which would have left one of the two behind on the next render.
    action.remove();
    inner.remove();
    slot.append(
      el("div", { class: "gpanel-off" }, [
        el("div", { class: "small", style: "font-weight:700" }, ["Đăng nhập Google"]),
        el("div", { class: "tiny muted", style: "margin-top:3px" }, [
          `Chưa bố trí đị bềt đế. Thiếu VITE_GOOGLE_CLIENT_ID (hiện có: ${
            GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.slice(0, 12) + "…" : "rỗng"
          }).`,
        ]),
      ]),
    );
  } else {
    void renderGoogleButton(inner).then((painted) => {
      if (!painted) {
        // Google's own button did not appear, so the styled one stays and does the same
        // job through `requestGoogleIdToken`. A blocked render is then cosmetic rather
        // than a missing feature, which is why nothing is announced — but the fallback
        // has to be *already on screen* for that to be true, hence the separate child.
        inner.remove();
        action.title = "Nút Google chưa tải được; dùng nút này.";
        return;
      }
      action.hidden = true;
      /*
       * Armed the moment Google's button appears, not on a click.
       *
       * It cannot be armed on a click: Google's button is a cross-origin iframe, so a
       * click inside it never reaches a listener on our container, and by the time we
       * could see one the fallback would already be hidden and the attempt already
       * over. Arming at paint covers the whole window where the player is looking at a
       * button that may do nothing.
       */
      armWatchdog();
    });
  }

  const reassurance = el("p", { class: "gpanel-note tiny muted" }, [
    "Tài khoản Google là của riêng bạn. Game chỉ nhận một mã chứng minh bạn là ai, không đọc mật khẩu và không thấy email.",
  ]);

  // One wrapper, assembled in the order a reader should meet them: who this is, the
  // button, what went wrong if anything, then what is and is not being asked for.
  const wrap = el("div", { class: "gpanel-wrap" });
  wrap.append(slot, stepSlot, errorSlot, fallbackNote, reassurance);

  /*
   * Tear the credential listener down.
   *
   * A panel is built every time the gate or the account sheet opens, and each one adds a
   * listener to a module-level set. Without this, opening the sheet three times leaves three
   * listeners, and one token from Google completes the same sign-in three times — three
   * `push`es, three slot switches, and a race between them for which session wins.
   */
  const offCredential = onGoogleCredential((token) => {
    traceAuth("credential from Google button");
    void complete(token);
  });

  return {
    nodes: [wrap],
    run: () => void attempt(),
    errorSlot,
    destroy: () => {
      offCredential();
      disarmWatchdog();
    },
  };
}

/** Anything that is not an `AccountError` gets a generic line, never a raw stack. */
function describe(e: unknown): string {
  return e instanceof Error && e.message ? `Không đăng nhập được: ${e.message}` : "Không đăng nhập được. Thử lại.";
}