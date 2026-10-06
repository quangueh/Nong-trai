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
 *
 * Read through a function rather than inline so `process.env` can be consulted as well.
 * Vite inlines `import.meta.env` at build time, which is right in a browser and absent
 * everywhere else — so under Node every entry point here refused with "not configured",
 * and the whole Google flow was untestable. One lookup with two sources keeps the browser
 * on the inlined value and lets the test drive the same code the game runs.
 */
function readClientId(): string {
  const fromVite = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (fromVite) return fromVite;
  // `process` does not exist in a browser bundle, so this branch is dead there — which is
  // the intent: it exists for the tooling that runs the module outside a bundler.
  const fromNode =
    typeof process !== "undefined"
      ? ((process.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "").trim()
      : "";
  return fromNode;
}

export const GOOGLE_CLIENT_ID = readClientId();

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
            fedcm?: boolean;
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
          /**
           * Turns off FedCM, which otherwise makes GIS render the account chooser inline
           * in the page instead of in a popup. Optional: older builds of the script omit
           * it, hence the `?.` at every call site.
           */
          disable_fedcm_prompt?: () => void;
        };
      };
    };
  }
}

/**
 * Whether Google's script and namespace are actually present.
 *
 * Exists so the UI can tell two failures apart. `renderGoogleButton` returns one `false`
 * for both "the script never arrived" — a blocked or offline network — and "the script
 * arrived and the render was refused", which is nearly always an origin the OAuth client
 * does not list. Those need different advice: the first is the player's network, the
 * second is a configuration neither of them can fix from here.
 *
 * Deliberately reports only what it can see. It says nothing about whether Google would
 * *accept* this origin, because the only evidence for that arrives asynchronously in a
 * console message from a cross-origin frame.
 */
export function googleScriptLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.google?.accounts?.id);
}

/**
 * The address the game is running on, for error messages about authorised origins.
 *
 * `location.host` rather than `location.origin` because the deployed game and a local
 * preview differ in port as well as host, and the port is exactly the part someone forgets
 * to add. Empty under a `file://` open, which the caller renders as such rather than
 * printing an empty origin that looks like a bug in the message.
 */
export function currentOrigin(): string {
  try {
    return location.host || location.protocol;
  } catch {
    return "";
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
 * Somewhere for an ID token to arrive that nobody is waiting for.
 *
 * This is the whole reason a player could sign in with Google and stay at the login screen.
 *
 * Google's callback has exactly one exit: `inFlight`, a promise that only exists while
 * `requestGoogleIdToken()` is awaiting. And that function is only ever called by the
 * *fallback* button — the styled one. So the moment Google's own button paints, which is
 * the normal case and the whole point of using it, `inFlight` is `null`, and the callback
 * hit this:
 *
 *     if (!pending) return;
 *
 * A valid, verified, freshly-issued ID token, discarded on the floor. No session adopted, no
 * save slot switched, no grace period stamped, gate never opened. The player picked an
 * account, the popup closed, and nothing happened — with no error anywhere, because from
 * the code's point of view nothing had failed.
 *
 * So a credential with no waiter is now *kept* rather than dropped, and handed to whoever
 * is listening. It expires in about an hour and is single-use, so holding one briefly is
 * free; discarding it is not.
 */
let parkedCredential: string | null = null;

/** Listeners for credentials delivered by Google's own button. */
type CredentialListener = (token: string) => void;
const credentialListeners = new Set<CredentialListener>();

/**
 * Take the parked credential, if there is one.
 *
 * Separate from the listener set because the two paths can race: a token can arrive from
 * Google's button between the moment the fallback is clicked and the moment it awaits.
 * Whoever gets there first takes it; the other waits for the next one.
 */
function takeParkedCredential(): string | null {
  const token = parkedCredential;
  parkedCredential = null;
  return token;
}

/**
 * Be told when Google hands over an ID token.
 *
 * The panel subscribes at construction, which is *before* it tries to render Google's
 * button — so there is no window in which a credential can arrive with nobody listening.
 *
 * Returns an unsubscribe function. The panel tears its own down when it is removed from the
 * DOM, because a sheet that is closed and reopened would otherwise stack two listeners and
 * complete the same sign-in twice.
 */
export function onGoogleCredential(fn: CredentialListener): () => void {
  credentialListeners.add(fn);
  const parked = takeParkedCredential();
  if (parked) {
    try {
      fn(parked);
    } catch {
      /* a broken listener must not break the others */
    }
  }
  return () => credentialListeners.delete(fn);
}

/**
 * Replace anything credential-shaped with a description of it.
 *
 * Split out of `traceAuth` because it is the security-relevant half and the half worth
 * testing on its own. `traceAuth` is gated behind `import.meta.env.DEV`, which does not
 * exist under Node — so testing it directly proved nothing, and the one guarantee that
 * actually matters ("a token can never reach a console") had no check at all.
 *
 * Not limited to a key named `token`. A bearer credential under any name is still a
 * bearer credential, so this rewrites by value as well as by key.
 */
export function redactForLog(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (typeof v === "string" && looksLikeCredential(v)) out[k] = `<${v.length} chars>`;
    else if (typeof v === "string" && v.split(".").length === 3 && v.length > 40) out[k] = `<${v.length} chars, JWT>`;
    else out[k] = v;
  }
  return out;
}

/** A JWT, or any string long and dot-separated enough to be one. */
function looksLikeCredential(value: string): boolean {
  return value.length > 20 && value.includes(".") && /^[A-Za-z0-9_.-]+$/.test(value);
}

/** Dev-only tracing of the auth state. Never prints a token, only its presence and length. */
export function traceAuth(event: string, detail: Record<string, unknown> = {}): void {
  if (!import.meta.env?.DEV) return;
  // eslint-disable-next-line no-console
  console.info(`[auth] ${event}`, redactForLog(detail));
}

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
      /*
       * FedCM off.
       *
       * With FedCM on, GIS renders the account chooser **inline in the page** rather than
       * in a popup - the account chip that appeared inside the sign-in card with the
       * player's own name and email. Choosing an account there does not complete the
       * flow, so the player picked an account and then nothing happened.
       *
       * Google's documented opt-out is the `disable_fedcm_prompt` method, which this
       * build of the script does not have: the methods it exposes are PromptMoment
       * Notification, cancel, disableAutoSelect, initialize, prompt, renderButton,
       * revoke, setLogLevel and storeCredential. Called through `?.` it would have been
       * a silent no-op, which is why the flag below carries the weight instead.
       */
      fedcm: false,
      callback: (r: TokenResponse) => {
        const token = r.credential ?? r.id_token;
        const pending = inFlight;
        inFlight = null;

        if (pending) {
          if (!token) {
            // Google's docs call this the "cancelled" response: an empty credential with
            // no error means the player dismissed the chooser.
            pending.reject(new GoogleSignInError("cancelled", "Sign-in was dismissed"));
          } else {
            pending.resolve(token);
          }
          return;
        }

        /*
         * Nobody is waiting, so this came from Google's own rendered button.
         *
         * Previously `return`d here, which is the bug documented on `parkedCredential`.
         * Now the token is kept and offered to the panel.
         */
        if (!token) return;
        parkedCredential = token;
        for (const fn of [...credentialListeners]) {
          try {
            fn(token);
          } catch {
            /* one broken listener must not stop the rest */
          }
        }
      },
    });
    /*
     * FedCM off, deliberately.
     *
     * With FedCM enabled, GIS renders the account chooser **inline in the page** rather
     * than in a popup - the account chip that appeared inside the sign-in card. Selecting
     * an account there does not complete the flow, so the player picked an account and
     * then nothing happened. Google's own guidance is to call `disable_fedcm_prompt`
     * when the inline prompt is not wanted, which restores the classic popup that works
     * everywhere.
     *
     * Wrapped because it is the one call that has been known to be missing from older
     * builds of the GIS script, and a sign-in that dies on a missing function is worse
     * than one that merely renders inline.
     */
    try {
      window.google.accounts.id.disable_fedcm_prompt?.();
    } catch {
      // Older script. The popup still works; only FedCM stays available.
    }

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

  /*
   * A credential that arrived while nobody was waiting.
   *
   * This is the case where the player pressed the fallback, Google's popup answered
   * *before* this function got as far as awaiting — a fast account chooser on a warm
   * connection. Re-prompting then would open a second popup over a completed sign-in.
   */
  const parked = takeParkedCredential();
  if (parked) return parked;

  /*
   * A credential delivered by a redirect rather than a popup.
   *
   * Google puts the ID token in the URL fragment when `ux_mode` is `redirect`, and GIS
   * re-delivers it to `callback` on the next page load. Both paths are covered, but if the
   * script has not managed to initialise yet the token is sitting in the address bar and
   * nobody is looking at it. Reading it here means a returning player with a slow script
   * still gets in rather than staring at a login form they have already satisfied.
   *
   * The fragment is stripped afterwards: leaving a bearer token in the address bar means it
   * survives into history, into the clipboard and into any screenshot the player takes.
   */
  const fromUrl = readCredentialFromUrl();
  if (fromUrl) return fromUrl;

  const ok = await initGis();
  if (!ok) throw new GoogleSignInError("network", "Could not load Google's sign-in");

  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      inFlight = null;
      reject(
        new GoogleSignInError(
          "no_token",
          "Google không trả về mã đăng nhập. Nếu bạn đã chọn tài khoản xong mà vẫn bị kẹt, hãy kiểm tra header Cross-Origin-Opener-Policy của trang là same-origin-allow-popups.",
        ),
      );
    }, 45_000);

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

/**
 * Take an ID token out of the address bar, if one is there, and clean up after it.
 *
 * Written against `location.hash` and the query string rather than assuming one or the
 * other, because GIS has used both: the popup flow puts the credential in the fragment,
 * and a redirect puts it in a query parameter. Checking only the fragment meant a redirect
 * return was indistinguishable from a first visit.
 *
 * The URL is rewritten with `replaceState` so the token does not linger in history. The
 * fragment is dropped entirely rather than rebuilt — nothing else in this game routes on
 * it, and keeping a half-parsed fragment around is how a credential ends up in a bookmark.
 */
function readCredentialFromUrl(): string | null {
  const find = (raw: string): string | null => {
    const m = raw.match(/(?:^|[#&?])credential=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  let token: string | null = null;
  try {
    token = find(window.location.hash) ?? find(window.location.search);
  } catch {
    // Some embeddings put the document in a sandboxed frame where location is opaque.
    return null;
  }
  if (!token) return null;

  try {
    const clean = `${window.location.pathname}${window.location.search.replace(/[?&]credential=[^&]*/, "")}`;
    window.history.replaceState(null, "", `${clean}${window.location.hash.replace(/.*credential=[^&]*/, "")}`);
  } catch {
    // replaceState can be refused; not a reason to refuse the sign-in.
  }
  return token;
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