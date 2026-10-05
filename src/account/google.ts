/**
 * Google sign-in, client side.
 *
 * The game never sees a Google password and never handles an OAuth client secret. It
 * asks Google for an **ID token** — a signed statement about who the player is — and
 * hands that to the Worker, which verifies it against Google's published keys. The
 * Worker is the only party that decides anything.
 *
 * That split is the whole design. A token verified in the browser would be worth
 * nothing: the browser is the untrusted party.
 *
 * Google's own button is used rather than a hand-rolled popup. It handles the popup,
 * the origin checks, the "choose an account" step and the `FedCM`/third-party-cookie
 * changes without this file having to know about any of them.
 *
 * Every failure mode is a distinct error code rather than a boolean, because the UI has
 * to be able to say the difference between "you cancelled", "the Worker has no Google
 * client ID configured" and "Google said no" — those three need different advice from
 * the player.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

/**
 * The OAuth client ID the game is published under.
 *
 * A public value by design: it ships in every bundle of every site that uses Google
 * sign-in, and it is not a secret. What matters is that the Worker verifies tokens
 * against this same id — see `GOOGLE_CLIENT_ID` in `worker/README.md`.
 */
export const GOOGLE_CLIENT_ID = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";

export const googleSignInAvailable = GOOGLE_CLIENT_ID !== "";

export type GoogleFailure =
  | "unavailable"
  | "cancelled"
  | "no_token"
  | "worker_rejected"
  | "worker_not_configured"
  | "network";

export class GoogleSignInError extends Error {
  constructor(readonly code: GoogleFailure, message: string) {
    super(message);
    this.name = "GoogleSignInError";
  }
}

interface TokenResponse {
  credential?: string;
  /** Present on Google's newer callback shape. */
  id_token?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {
            client_id: string;
            callback: (r: TokenResponse) => void;
            ux_mode?: "popup" | "redirect";
            display?: "popup";
            context?: "signin" | "signup" | "continue";
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; width?: number; text?: string; size?: "large" | "medium" | "small" },
          ) => void;
          /**
           * The One Tap entry point. Required by the fallback button when Google's own
           * button did not paint — `renderButton` drives its own popup, but something has
           * to open the account chooser when it is not on screen.
           */
          prompt: () => void;
        };
      };
    };
  }
}

/**
 * Load the GIS script once.
 *
 * Resolves to null if the script cannot be loaded, which is what a blocked or offline
 * network looks like. Reuses an already-present script rather than injecting a second
 * tag, so opening the account sheet twice does not double-load it.
 */
let loading: Promise<boolean> | null = null;
function loadGis(): Promise<boolean> {
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      // A script already in the DOM that has finished loading will never fire `load`
      // again, so poll once for the namespace rather than waiting forever.
      if (window.google?.accounts?.id) resolve(true);
      return;
    }
    const tag = document.createElement("script");
    tag.src = GIS_SRC;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve(true);
    tag.onerror = () => resolve(false);
    document.head.appendChild(tag);
  });
  return loading;
}

/**
 * Whether `initialize` has already run.
 *
 * Google's Identity Services require `initialize()` before `renderButton()`, and they
 * say so at the point of failure: "Failed to render button before calling initialize()".
 * This module had them the wrong way round — `initialize` was called inside
 * `requestGoogleIdToken`, which only ran when the player pressed a button, so the button
 * never painted and the fallback it left behind did nothing except wait out a timeout.
 * Sign-in was therefore broken end to end, and the only symptom in the console was one
 * log line that reads like a warning rather than the total failure it was.
 */
let initialised = false;

/** The resolver for a sign-in that is currently in flight, if any. */
let inFlight: { resolve: (token: string) => void; reject: (e: unknown) => void } | null = null;

/**
 * Load the script and initialise GIS, once.
 *
 * `renderButton` and `prompt` both fail without it, and both may be called from
 * different places — the panel renders on open, the fallback button calls `prompt` —
 * so the initialisation cannot live inside either one.
 */
async function initGis(): Promise<boolean> {
  if (!googleSignInAvailable) return false;
  const ok = await loadGis();
  if (!ok || !window.google?.accounts?.id) return false;
  if (initialised) return true;
  try {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      // `popup` in both fields, deliberately. `ux_mode: "popup"` governs the rendered
      // button's behaviour; `display: "popup"` governs the One Tap prompt that the
      // fallback button drives. Setting only the first leaves the fallback with no
      // way to open anything.
      ux_mode: "popup",
      display: "popup",
      context: "signin",
      auto_select: false,
      callback: (r: TokenResponse) => {
        const pending = inFlight;
        inFlight = null;
        const token = r.credential ?? r.id_token;
        if (!pending) return;
        if (!token) {
          // Google's docs call this the "cancelled" response: an empty credential with
          // no error means the player dismissed the chooser.
          pending.reject(new GoogleSignInError("cancelled", "Sign-in was dismissed"));
          return;
        }
        pending.resolve(token);
      },
    });
    initialised = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask Google for an ID token.
 *
 * Used by the fallback button. When Google's own button is on screen it drives its own
 * popup and this is never called, which is why it goes through `prompt()` rather than
 * pretending to be the primary path.
 */
export async function requestGoogleIdToken(): Promise<string> {
  if (!googleSignInAvailable) throw new GoogleSignInError("unavailable", "Google sign-in is not configured");
  const ok = await initGis();
  if (!ok) throw new GoogleSignInError("network", "Could not load Google's sign-in");

  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      inFlight = null;
      reject(new GoogleSignInError("no_token", "Google did not return a token in time"));
    }, 90_000);

    inFlight = {
      resolve: (token) => {
        window.clearTimeout(timer);
        resolve(token);
      },
      reject: (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    };

    try {
      window.google!.accounts.id.prompt();
    } catch (e) {
      inFlight = null;
      window.clearTimeout(timer);
      reject(new GoogleSignInError("unavailable", `Google sign-in failed to start: ${String(e)}`));
    }
  });
}

/**
 * Render Google's own sign-in button into `parent`.
 *
 * Returns false when it could not, which the caller treats as "offer the fallback". The
 * button is Google's component rather than a styled div on purpose: it carries the
 * accessibility and the origin handling that a hand-rolled one would not.
 */
export async function renderGoogleButton(parent: HTMLElement): Promise<boolean> {
  if (!googleSignInAvailable) return false;
  const ok = await initGis();
  if (!ok || !window.google?.accounts?.id) return false;
  try {
    // Google replaces the container's contents with an iframe. Cleared first so a
    // re-render does not stack two iframes.
    parent.replaceChildren();
    window.google.accounts.id.renderButton(parent, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      width: Math.min(320, Math.max(220, parent.clientWidth || 280)),
    });
    /*
     * Verify that something actually landed in the container.
     *
     * Returning true after an unchecked call was a real bug and produced the exact
     * failure this module exists to avoid: `renderButton` can complete without painting
     * — an unsupported origin, a blocked iframe, a stale script — and the caller, seeing
     * `true`, skipped its fallback and left an empty box. A player looking at a blank
     * area has no way to tell whether the game lacks Google sign-in or their browser
     * blocked it.
     *
     * Two frames, because Google builds the button asynchronously: an iframe is the
     * normal case, and a styled div is the fallback some configurations render.
     */
    for (let i = 0; i < 20; i++) {
      if (parent.firstElementChild) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    parent.replaceChildren();
    return false;
  } catch {
    return false;
  }
}

/** Vietnamese copy, keyed by failure. Returned as text rather than thrown. */
export function googleFailureMessage(code: GoogleFailure): string {
  switch (code) {
    case "unavailable":
      return "Chưa cấu hình đăng nhập Google.";
    case "cancelled":
      return "Đã huỷ đăng nhập.";
    case "no_token":
      return "Google không trả về mã đăng nhập. Thử lại.";
    case "worker_not_configured":
      return "Máy chủ chưa cấu hình Google (thiếu GOOGLE_CLIENT_ID).";
    case "worker_rejected":
      return "Máy chủ không chấp nhận mã đăng nhập. Thử lại hoặc dùng email.";
    case "network":
      return "Không tải được dịch vụ đăng nhập của Google.";
  }
}

/**
 * The prompt fallback, for when the GIS script is blocked.
 *
 * Kept because "the button never appears" with no explanation is the single most
 * confusing way for this feature to fail. This explains itself instead of failing
 * silently, which is the difference between a bug report and a shrug.
 */
export function googleFallbackHtml(clientId: string): string {
  return `<div class="google-fallback">
    <div class="tiny muted">Không tải được nút đăng nhập Google (có thể trình chặn chạy script bên thứ ba).</div>
    <div class="tiny mono muted" style="margin-top:4px;word-break:break-all">VITE_GOOGLE_CLIENT_ID=${clientId.slice(0, 18)}…</div>
  </div>`;
}