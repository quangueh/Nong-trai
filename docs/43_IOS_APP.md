# 43 — iOS app

## The honest two tiers

iOS has no free equivalent of "sideload an APK". Every installable `.ipa` must
be signed, and Apple only grants durable signing through the **Apple Developer
Program ($99/year)** — a free account signs for 7 days and 3 devices max, which
is not a usable "my game on my phone" answer.

So the project ships in two tiers:

### Tier 1 — what works today, free: the PWA

The game is already a complete iOS app in the PWA sense:

```
Safari → nong-trai-9u0.pages.dev → Share → Add to Home Screen
```

- Standalone icon `Nông Trại` (apple-touch-icon + `apple-mobile-web-app-capable`
  already configured).
- Full screen, no browser chrome.
- Saves in localStorage, same as the Android shell.
- Service worker → offline play + **auto-update on every open** — the same
  update story as the APK; pushing to GitHub updates the iPhone app at next
  launch.

### Tier 2 — the native shell, ready for a dev account

`ios/` holds the generated Capacitor Xcode project (`com.quang.nongtrai`,
SPM-based — no CocoaPods). `ios-app.yml` on `macos-latest`:

1. builds the web bundle + `cap sync ios`,
2. compiles the app for the iOS Simulator **unsigned** — a real Xcode gate that
   needs zero Apple credentials,
3. boots it in a simulator: install → launch → alive-check + screenshot
   artifact (`ios-smoke-screenshot`).

It produces a `Debug-iphonesimulator/App.app` — runs on Mac simulators only;
**not installable on a physical iPhone** without signing.

### When an Apple Developer account exists

Add the signing secrets (`IOS_CERT_P12`, `IOS_CERT_PASSWORD`,
`IOS_PROFILE`, `IOS_TEAM_ID`) and switch the build to
`xcodebuild archive -allowProvisioningUpdates` + `-exportArchive` with
`app-store`/`ad-hoc`/`development` method — TestFlight then gives proper
auto-updating distribution. The workflow, project and smoke harness are
already in place; that step is configuration, not engineering.

## Notes

- `Info.plist` display name `Nông Trại`, bundle id `com.quang.nongtrai`,
  device family iPhone+iPad.
- The app loads `server.url` (see `capacitor.config.ts`) — same realtime
  update chain as Android; `window.Capacitor.isNativePlatform()` is how the
  page detects the shell (Google sign-in is hidden there too — Apple WKs are
  blocked by Google the same way).
