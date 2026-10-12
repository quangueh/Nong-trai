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
      location.href = `${DEEP_SCHEME}://pair?code=${code}`;
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
 * App half. Called once at boot; redeems `com.quang.nongtrai://pair?code=…`
 * deep links as they arrive. The activity is `singleTask`, so a link opening
 * while the app runs lands on the live bridge rather than a new instance.
 */
export function listenForAuthDeepLink(): void {
  if (!isAppShell()) return;
  void App.addListener("appUrlOpen", (ev: URLOpenListenerEvent) => {
    void handleAuthUrl(ev.url);
  });
}

/** Parse and redeem a deep link. Exported for tests. */
export async function handleAuthUrl(url: string): Promise<boolean> {
  let code: string | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== `${DEEP_SCHEME}:` || u.hostname !== "pair") return false;
    code = u.searchParams.get("code");
  } catch {
    return false;
  }
  if (!code) return false;
  await signInWithPairCode(code);
  return true;
}
