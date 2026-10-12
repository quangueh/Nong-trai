/**
 * Browser-bounce sign-in for the app shell.
 *
 * Google refuses OAuth inside a WebView — that is their anti-phishing policy,
 * not something application code can route around. What Google does allow is a
 * real browser. So the app opens the site itself in a Chrome Custom Tab, the
 * player signs in there exactly like a web visit (an already-signed-in browser
 * needs no taps at all), and the site fires a deep link back into the app
 * carrying a one-time pairing code. The app redeems it for the same session —
 * same account, same save, whichever kind the account is.
 *
 * Two halves live here because both sides are the same bundle: `armAppBounce`
 * is the web half (runs in the Custom Tab), `listenForAuthDeepLink` the app
 * half (runs in the WebView). Each no-ops on the other's side.
 */

import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isAppShell } from "./platform";
import { issuePairCode, onAccountStatus, signInWithPairCode } from "./sync";

const APPAUTH_FLAG = "appauth";
const DEEP_SCHEME = "com.quang.nongtrai";

/**
 * App half: open this very site in the system browser with the bounce flag,
 * so a sign-in there comes back here as a pairing code.
 */
export async function openBrowserSignIn(): Promise<void> {
  await Browser.open({ url: `${location.origin}/?${APPAUTH_FLAG}=1` });
}

/**
 * Web half. Armed at boot; does nothing unless the page was opened with
 * `?appauth=1`, which only `openBrowserSignIn` produces.
 *
 * `onAccountStatus` fires immediately with the current value, so a browser
 * that already holds a session bounces to the deep link with zero interaction —
 * the player sees the tab flash and the app come back signed in.
 */
export function armAppAuthBounce(): void {
  if (isAppShell()) return;
  if (new URLSearchParams(location.search).get(APPAUTH_FLAG) !== "1") return;

  let fired = false;
  const bounce = async (): Promise<void> => {
    if (fired) return;
    fired = true;
    try {
      const { code } = await issuePairCode();
      const deep = `${DEEP_SCHEME}://pair?code=${code}`;
      /*
       * Chrome may swallow a programmatic jump to a custom scheme — no user
       * activation, no intent. The overlay covers that: the auto-jump is tried
       * first, and if it lands the app simply comes forward and this page is
       * never seen again. If it does not, the player taps the same link.
       */
      showReturnOverlay(deep);
      location.href = deep;
    } catch {
      // A failed issue must not burn the flag — a later status change retries.
      fired = false;
    }
  };

  const stop = onAccountStatus((s) => {
    if (s.email) void bounce();
  });
  // A tab left open forever stops watching — ten minutes matches the code TTL.
  setTimeout(stop, 10 * 60 * 1000);
}

/**
 * The sign-in was adopted but the jump back did not happen — show the player a
 * way home that a tap (real user activation) can always take.
 */
function showReturnOverlay(deep: string): void {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;" +
    "align-items:center;justify-content:center;gap:16px;padding:24px;" +
    "background:rgba(12,26,16,.96);color:#eaf5e9;text-align:center;font-family:inherit";
  const note = document.createElement("div");
  note.style.cssText = "max-width:30em;line-height:1.5;font-size:15px";
  note.textContent = "Đăng nhập xong — quay lại app để vào vườn.";
  const link = document.createElement("a");
  link.href = deep;
  link.textContent = "Mở lại app Nông Trại";
  link.style.cssText =
    "display:inline-block;padding:14px 28px;border-radius:999px;" +
    "background:#7bd88f;color:#0c1a10;font-weight:700;font-size:17px;text-decoration:none";
  overlay.append(note, link);
  document.body.append(overlay);
}

/**
 * App half. Called once at boot; redeems `com.quang.nongtrai://pair?code=…`
 * deep links as they arrive. The activity is `singleTask`, so a link opening
 * while the app runs lands on the live bridge rather than a new instance.
 * A link that *cold-starts* the app is delivered through `getLaunchUrl`
 * instead of the event — both paths land on the same handler.
 */
export function listenForAuthDeepLink(): void {
  if (!isAppShell()) return;
  void App.addListener("appUrlOpen", (ev: URLOpenListenerEvent) => {
    void handleAuthUrl(ev.url);
  });
  void App.getLaunchUrl()
    .then((res) => {
      if (res?.url) return handleAuthUrl(res.url);
    })
    .catch(() => undefined);
}

/**
 * Extract the pairing code from a deep link, or `null` when the link is not
 * one of ours. Pure — the WebView's URL parser treats `com.quang.nongtrai` as
 * a non-special scheme, so `://pair` lands in the path (`//pair`) with an
 * empty host rather than in `hostname`. Accept either shape because parsers
 * disagree on non-special authorities. Exported for tests.
 */
export function pairCodeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== `${DEEP_SCHEME}:`) return null;
    const target = u.hostname || u.pathname.replace(/^\/+/, "");
    if (target !== "pair") return null;
    return u.searchParams.get("code") || null;
  } catch {
    return null;
  }
}

/** Parse and redeem a deep link. Exported for tests. */
export async function handleAuthUrl(url: string): Promise<boolean> {
  const code = pairCodeFromUrl(url);
  if (!code) return false;
  await signInWithPairCode(code);
  return true;
}
