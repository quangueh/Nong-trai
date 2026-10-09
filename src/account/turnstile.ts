/**
 * Turnstile — the bot check on register/login, gated on `VITE_TURNSTILE_SITE`.
 *
 * Unset means the whole thing is inert: no script is fetched, no widget is rendered,
 * and `takeToken()` answers undefined, which the API layer then simply omits from the
 * request body. That is what keeps local dev and every test sign-in challenge-free
 * while production can turn it on with one env var.
 *
 * The token is a single-use credential the widget mints for one attempt, so it is
 * stored at module level and consumed — not read repeatedly — by the API call.
 */

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id?: string): void;
    };
  }
}

const SITE = (import.meta.env?.VITE_TURNSTILE_SITE as string | undefined) ?? "";

let script: Promise<void> | null = null;
let token = "";
let widgetId: string | null = null;

export function turnstileEnabled(): boolean {
  return SITE !== "";
}

function loadScript(): Promise<void> {
  if (script) return script;
  script = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  return script;
}

/**
 * Render the widget into `box`. Called once per sign-in form; a no-op when the
 * site key is not configured, so the form builds identically either way.
 */
export async function mountTurnstile(box: HTMLElement): Promise<void> {
  if (!SITE || typeof document === "undefined") return;
  try {
    await loadScript();
    if (!window.turnstile) return;
    widgetId = window.turnstile.render(box, {
      sitekey: SITE,
      theme: "dark",
      callback: (t: string) => {
        token = t;
      },
      "expired-callback": () => {
        token = "";
      },
      "error-callback": () => {
        token = "";
      },
    });
  } catch {
    // A blocked challenge script leaves token empty — the server answers
    // turnstile_failed, which is the correct outcome for a failed check.
  }
}

/** The minted token, consumed. The API layer calls this inside each attempt. */
export function takeToken(): string | undefined {
  const t = token;
  token = "";
  return t || undefined;
}

/** Fresh widget for the next attempt — a used or expired token cannot retry. */
export function resetTurnstile(): void {
  token = "";
  if (widgetId && window.turnstile) {
    try {
      window.turnstile.reset(widgetId);
    } catch {
      /* a gone widget needs no reset */
    }
  }
}
