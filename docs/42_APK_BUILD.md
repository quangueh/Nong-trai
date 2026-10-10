# 42 — APK build & realtime update chain

## Architecture

The Android app is a **thin WebView shell** (Capacitor 8) that loads the live
production URL instead of a bundled copy of the game:

```
push to main ──► deploy-pages.yml ──► wrangler pages deploy ──► nong-trai-9u0.pages.dev
                                                                       ▲
APK (android/) ──► WebView loads URL ────────────────────────────────────┘
```

- `capacitor.config.ts` → `server.url = https://nong-trai-9u0.pages.dev`
- The service worker is already network-first for navigations → a new deploy is
  picked up on the **next app open**, and same-origin assets refresh in the
  background (stale-while-revalidate). Offline = cached shell (SW), guest saves
  in WebView localStorage.
- **The APK never needs a rebuild for game/content changes** — only when
  `android/`, `capacitor.config.ts` or dependencies change.

## Getting the APK

`.github/workflows/android-apk.yml` builds `app-debug.apk` on every push/tag
and on `workflow_dispatch`. After the emulator boot smoke passes, the APK is
published back onto GitHub itself:

- **Rolling release `apk-latest`** — stable download link, always the newest
  verified build:
  `https://github.com/quangueh/Nong-trai/releases/download/apk-latest/app-debug.apk`
- **Actions → android-apk → artifacts → `nong-trai-debug-apk`** — same file,
  30-day retention.
- Tagged pushes (`git tag v1.0 && git push --tags`) also attach the APK to a
  permanent versioned Release.
- `emu-smoke` boots the APK on an API-34 emulator in CI: install → launch →
  asserts the activity is resumed and logcat has no FATAL → screenshot artifact.
  A red smoke run means the shell itself is broken — nothing is published.

Debug-signed APKs are fine for sideloading/personal use. Play-Store release
signing needs a keystore in secrets (`KEYSTORE_B64`, `KEY_ALIAS`,
`KEYSTORE_PASSWORD`, `KEY_PASSWORD`) — add a `release` job when that's wanted.

## Realtime updates on push

`deploy-pages.yml` runs on every push to `main`: build → `test:technical`
core gates → `wrangler pages deploy`. It needs two repo secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `74e68368993df775a81d79eba2345a1b` |
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages → Edit** (dash.cloudflare.com → My Profile → API Tokens) |

Without the secrets the job stays green, prints a notice, and skips the
upload — then the APK still updates whenever a manual
`wrangler pages deploy` happens.

## WebView-specific adjustments

- `MainActivity`: `mediaPlaybackRequiresUserGesture(false)` (music without a
  first tap), `domStorageEnabled(true)` + `databaseEnabled(true)` (saves),
  hardware back → WebView history then exit.
- `usesCleartextTraffic="false"` — https only.
- **Google sign-in is hidden inside the app**: Google refuses WebView user
  agents (`; wv` marker / `window.Capacitor`), so `googlePanel` shows an
  "use email or play guest" note instead of a button that can only fail.
  Email sign-in and guest mode work normally; a Google-linked account can be
  attached later on the web and the save syncs.

## Verification matrix

| Layer | Gate |
|---|---|
| Game logic (shared with web) | `npm test` — all suites, unchanged codebase |
| Technical contracts | `npm run test:technical` (also a deploy gate) |
| Production endpoint the APK loads | `tools/test-app-shell.ts` — boot, guest, garden, save-survives-reload, SW — runs nightly in `prod-smoke` too |
| The shell itself | `android-apk.yml` → assembleDebug + emulator boot smoke + screenshot |

## Local build (if Android SDK is ever installed)

```bash
npm ci && npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17 + Android SDK (compileSdk 36, minSdk 24, targetSdk 36).
