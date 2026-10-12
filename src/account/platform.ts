/**
 * Are we inside the native app shell's WebView?
 *
 * Two signals, either one enough:
 *
 *   Android WebViews mark their user agent with `; wv)` — the marker Google
 *   also uses to refuse OAuth in embedded browsers, which is the whole reason
 *   this question matters.
 *
 *   Capacitor injects `window.Capacitor` even when the app loads the remote
 *   site through `server.url`, and `isNativePlatform()` answers true — checked
 *   second because it survives UA overrides a plugin might apply later.
 */
export function isAppShell(): boolean {
  return (
    (typeof navigator !== "undefined" && /; wv\)/.test(navigator.userAgent)) ||
    (typeof window !== "undefined" &&
      Boolean(
        (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
      ))
  );
}
