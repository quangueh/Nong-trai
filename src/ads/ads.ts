/**
 * Rewarded ads — the monetisation layer.
 *
 * Provider: **Google AdSense for H5 games** (`adBreak`/`adConfig` on
 * adsbygoogle.js). It is the network that actually pays for a web game of this
 * size: rewarded video is the highest-eCPM format that exists on the open web,
 * it is opt-in only (the player chooses to watch for a buff — never a forced
 * interstitial), and it needs nothing server-side. Alternatives (AppLixir,
 * AdinPlay) exist but pay less per view and add a second account to run.
 *
 * Activation is two env vars and a dashboard — see `.env.example`:
 *   VITE_ADSENSE_CLIENT  — the ca-pub-… id from the AdSense account
 * Until it is set the module reports `adsConfigured = false` and the UI hides
 * the ad button entirely; in dev a clearly-labelled simulated ad stands in so
 * the flow is still testable end to end.
 *
 * One hard rule baked in here: a failed or dismissed ad resolves `false` and
 * NEVER grants the reward. The caller decides what "reward earned" means —
 * this module only reports whether the video was watched.
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (opts: Record<string, unknown>) => void;
    adConfig?: (opts: Record<string, unknown>) => void;
  }
}

const CLIENT = (import.meta.env?.VITE_ADSENSE_CLIENT as string | undefined) ?? "";
const IS_DEV = Boolean(import.meta.env?.DEV);

/** An ad unit exists at all. False hides every ad button in production. */
export const adsConfigured = CLIENT.length > 0;

let loader: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.adBreak) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
    s.onload = () => {
      window.adsbygoogle = window.adsbygoogle || [];
      // The H5 API is two push-consumers, not direct calls — defined before
      // first use so preloading can start immediately.
      window.adBreak = window.adConfig = (o: Record<string, unknown>) => {
        window.adsbygoogle!.push(o);
      };
      window.adConfig({ preloadAdBreaks: "auto", sound: "on" });
      resolve();
    };
    s.onerror = () => reject(new Error("ad_script_blocked"));
    document.head.appendChild(s);
  });
  return loader;
}

/**
 * Show one rewarded video; resolves true iff it was watched to the end.
 *
 * The `adBreak` lifecycle for a reward placement: `beforeReward` hands us a
 * function that starts the video, `adViewed` means the player finished it,
 * `adDismissed` means they closed it early, `adBreakDone` always fires last.
 * A blocked script, a missing placement or a dismissal all land on `false`.
 */
export async function showRewardedAd(name = "gardener"): Promise<boolean> {
  if (!adsConfigured) {
    return IS_DEV ? simulatedAd() : false;
  }
  try {
    await loadScript();
  } catch {
    // Script blocked (ad blocker, offline). Not an error the player caused —
    // the caller shows a "quảng cáo không khả dụng" toast rather than a crash.
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (watched: boolean) => {
      if (!settled) {
        settled = true;
        resolve(watched);
      }
    };
    window.adBreak!({
      type: "reward",
      name,
      beforeReward: (showAdFn: () => void) => showAdFn(),
      adViewed: () => done(true),
      adDismissed: () => done(false),
      // A placement that never renders (no fill, frequency cap) ends here
      // without adViewed — resolving false keeps the button honest.
      adBreakDone: (info?: { breakStatus?: string }) => {
        if (info?.breakStatus && info.breakStatus !== "viewed" && !settled) done(false);
      },
    });
  });
}

/**
 * The dev stand-in: a dark overlay, a 3-second countdown, clearly marked as a
 * simulation. Only reachable when `import.meta.env.DEV`, so a production build
 * without the client id can never fake an ad view.
 */
function simulatedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ad-sim";
    let left = 3;
    const tick = () => {
      overlay.textContent = `📺 Quảng cáo mô phỏng (dev) — ${left}s`;
      if (left-- <= 0) {
        clearInterval(iv);
        overlay.remove();
        resolve(true);
      }
    };
    const iv = window.setInterval(tick, 1000);
    tick();
    document.body.appendChild(overlay);
  });
}
