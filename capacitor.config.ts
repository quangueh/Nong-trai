import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The APK is a thin shell over the live site.
 *
 * `server.url` makes the native WebView load the deployed game instead of the
 * bundled `dist/` copy — which is what "push to GitHub → the app updates" means
 * here: Pages deploys the push, the service worker is already network-first for
 * navigations, and the next app open (even the next screen paint) runs the new
 * bundle. The APK itself only needs rebuilding when this file or `android/`
 * changes, never for game content.
 *
 * The bundled `dist/` still ships inside the APK as the last-resort shell —
 * `webDir` must exist for `cap sync`.
 */
const config: CapacitorConfig = {
  appId: "com.quang.nongtrai",
  appName: "Nông Trại",
  webDir: "dist",
  server: {
    url: "https://nong-trai-9u0.pages.dev",
    cleartext: false,
  },
  android: {
    // https-only — the Worker API and Google/Turnstile all ride TLS anyway.
    allowMixedContent: false,
  },
};

export default config;
