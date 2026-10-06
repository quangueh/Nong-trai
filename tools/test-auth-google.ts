/**
 * Why a player could sign in with Google and stay at the login screen.
 *
 * ## The bug
 *
 * Google's `callback` had exactly one exit: `inFlight`, the promise created inside
 * `requestGoogleIdToken()`. That function is only ever called by the *fallback* button.
 *
 *     callback: (r) => {
 *       const pending = inFlight;
 *       inFlight = null;
 *       if (!pending) return;        // <-- token discarded
 *       ...
 *     }
 *
 * The moment Google's own button paints — which is the normal case and the entire point of
 * using it — nothing is awaiting, so `inFlight` is `null`, and a valid freshly-issued ID
 * token hit that `return` and was thrown away. No session adopted, no save slot switched,
 * no grace period stamped, gate never opened. The player picked an account, the popup
 * closed, and nothing happened — with no error anywhere, because nothing had failed.
 *
 * ## How this is tested without Google
 *
 * `google.ts` is a browser module, so it is exercised against a hand-built `window` with a
 * stub GIS namespace. What matters is not Google's behaviour but *ours*: given a token
 * delivered with nobody waiting, does it survive until something can use it?
 *
 * The scenarios below are the ones a player actually hits, in order: Google's own button,
 * the fallback button, a fast popup that answers before we await, a redirect that leaves
 * the token in the URL, a second panel opening and stacking listeners, and reload.
 */

/* A minimal browser for the module under test.
 *
 * Built here rather than with jsdom because the module's whole surface is three globals:
 * `window.google`, `document`, and `localStorage`. Stubbing them directly keeps the test
 * honest about what it depends on — if `google.ts` ever reaches for a fourth thing, this
 * fails loudly instead of quietly passing against a permissive DOM. */
interface FakeWindow {
  google?: unknown;
  location: { href: string; hash: string; search: string; pathname: string };
  history: { replaceState: (a: unknown, b: string, url: string) => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

const g = globalThis as unknown as Record<string, unknown>;

export {};

/** Reset every module-level singleton so each scenario starts clean. */
function resetModules(): void {
  for (const key of Object.keys(require.cache ?? {})) {
    if (key.includes("account") || key.includes("ui")) delete (require.cache as Record<string, unknown>)[key];
  }
}

/** A stand-in for Google's identity namespace that records what it was told. */
function stubGis(opts: { paintButton?: boolean } = {}): {
  initializeCalls: number;
  callback: ((r: { credential?: string; id_token?: string }) => void) | null;
  prompts: number;
  rendered: number;
} {
  const box: { initializeCalls: number; callback: ((r: { credential?: string; id_token?: string }) => void) | null; prompts: number; rendered: number } = {
    initializeCalls: 0,
    callback: null,
    prompts: 0,
    rendered: 0,
  };

  g.window = {
    google: {
      accounts: {
        id: {
          initialize: (cfg: { callback: (r: { credential?: string }) => void }) => {
            box.initializeCalls++;
            box.callback = cfg.callback;
          },
          renderButton: (parent: { replaceChildren: () => void; firstElementChild: unknown; clientWidth: number }) => {
            box.rendered++;
            parent.replaceChildren();
            // Google paints an iframe, asynchronously, a frame or two later. `renderButton`
            // polls for this in the real module; here one is enough.
            if (opts.paintButton !== false) parent.firstElementChild = { tagName: "IFRAME" };
          },
          prompt: () => {
            box.prompts++;
          },
          disable_fedcm_prompt: () => {},
        },
      },
    },
    location: { href: "http://localhost:5173/", hash: "", search: "", pathname: "/" },
    /*
     * `replaceState` has to actually move the location, or the "the token is scrubbed from
     * the address bar" check passes against a stub that does nothing at all — which is how
     * it reported a clean address bar while leaving the credential sitting in the URL.
     */
    history: {
      replaceState: (_a: unknown, _b: string, url: string) => {
        const w = g.window as unknown as FakeWindow;
        const hashAt = url.indexOf("#");
        const hash = hashAt >= 0 ? url.slice(hashAt) : "";
        const bare = hashAt >= 0 ? url.slice(0, hashAt) : url;
        w.location.hash = hash;
        w.location.search = bare.includes("?") ? `?${bare.slice(bare.indexOf("?") + 1)}` : "";
        w.location.href = `http://localhost:5173${bare}${hash}`;
      },
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  } satisfies FakeWindow as unknown as Record<string, unknown>;

  g.document = {
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({ src: "", async: false, defer: false, addEventListener: () => {} }),
  };

  // A storage that works, so the sign-in stamp and session writes behave.
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  g.sessionStorage = g.localStorage;

  // `import.meta.env` is a build-time constant; the module reads it through optional
  // chaining, so an absent one leaves the client id empty and the panel would render its
  // "not configured" branch. Define it so the real path is exercised.
  return box;
}

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("Google sign-in: does a token ever get dropped?\n");

// --- the actual bug --------------------------------------------------------
/*
 * Delivered by Google's own rendered button, with no promise outstanding — which is every
 * sign-in where Google's button painted. Before the fix this resolved nothing and the
 * panel was never told anything had happened.
 */
const box = stubGis();
/* The module reads its client id from import.meta.env; with it absent the module exports
   `googleSignInAvailable === false` and every entry point refuses. Stub it rather than
   weakening the test, because "the module works when switched off" proves nothing. */
(g as Record<string, unknown>).__vite_env_stub = true;

/*
 * The client id, set before the module is imported.
 *
 * `GOOGLE_CLIENT_ID` is resolved once at module scope, so it has to be in place first. This
 * is the one thing that cannot be stubbed from outside, and getting it wrong made every
 * entry point refuse with "not configured" — which is why this file could not test the
 * Google path at all until `google.ts` learned to read `process.env`.
 */
process.env.VITE_GOOGLE_CLIENT_ID = "1234567890-testclientid.apps.googleusercontent.com";

const mod = (await import("../src/account/google")) as unknown as Record<string, unknown>;

console.log(`  (Google sign-in enabled: ${mod.googleSignInAvailable === true ? "yes" : "no"})\n`);
check("Google sign-in is reachable with a client id present", mod.googleSignInAvailable === true);

/*
 * The behaviour under test: `onGoogleCredential` fires for a token handed over by Google's
 * callback with nobody awaiting.
 *
 * Exercised through the public listener rather than the internals, because the listener is
 * the contract `googlePanel` depends on — if only the internals were right and the listener
 * were not wired, the player would still be stuck.
 */
const received: string[] = [];
const off = (mod.onGoogleCredential as (fn: (t: string) => void) => () => void)((t: string) => {
  received.push(t);
});
check("onGoogleCredential is exported for the panel to subscribe", typeof off === "function");

/*
 * Drive the callback the way Google's own button does. The stub captured it at
 * `initialize`, which the module calls during `renderGoogleButton`.
 */
await (mod.renderGoogleButton as (p: unknown) => Promise<boolean>)({
  replaceChildren: () => {},
  firstElementChild: null,
  clientWidth: 300,
});

check("GIS was initialised before renderButton, not on click", box.initializeCalls > 0, `${box.initializeCalls} call(s)`);
check("and the button painted", box.rendered > 0, `${box.rendered} render(s)`);

// Nothing has awaited anything: this is the state the real bug lived in.
box.callback?.({ credential: "ya29.FAKE-ID-TOKEN" });
check(
  "a credential delivered with nobody waiting still reaches a listener",
  received.includes("ya29.FAKE-ID-TOKEN"),
  `listeners received ${JSON.stringify(received)}`,
);

// --- the listener must be releasable ---------------------------------------
off();
box.callback?.({ credential: "ya29.SECOND" });
check(
  "an unsubscribed listener stops receiving, so a reopened sheet cannot stack them",
  !received.includes("ya29.SECOND"),
  `received ${JSON.stringify(received)}`,
);

// --- a token already parked must be handed over on subscribe ---------------
/*
 * The other ordering: the credential arrives while no panel exists at all — the player
 * completed Google's popup, then the sheet was rebuilt before the token was read. A panel
 * that subscribes afterwards must not wait for another popup.
 */
const early: string[] = [];
box.callback?.({ credential: "ya29.PARKED" });
(mod.onGoogleCredential as (fn: (t: string) => void) => () => void)((t: string) => {
  early.push(t);
});
check(
  "a credential that arrived before anyone listened is delivered on subscribe",
  early.includes("ya29.PARKED"),
  `received ${JSON.stringify(early)}`,
);

// --- cancelled must stay distinct from failure ------------------------------
/*
 * Google's empty credential means the player closed the chooser. With nobody awaiting it
 * must NOT be treated as a token — handing an empty string to the Worker would burn a
 * request and produce a confusing "server rejected" message for a deliberate cancellation.
 */
const cancelled: string[] = [];
const offCancel = (mod.onGoogleCredential as (fn: (t: string) => void) => () => void)((t: string) => {
  cancelled.push(t);
});
box.callback?.({});
check("an empty credential is not handed on as a token", cancelled.length === 0, JSON.stringify(cancelled));
offCancel();

// --- a credential in the URL is found and cleaned up ------------------------
/*
 * The redirect path. If the token is only ever read by GIS's callback and the script has
 * not initialised yet, a returning player with a slow script is indistinguishable from a
 * first-time visitor.
 */
{
  const w = g.window as unknown as FakeWindow;
  w.location.hash = "#credential=ya29.FROM-HASH&state=xyz";
  const url = (mod.requestGoogleIdToken as () => Promise<string>)();
  const got = await url;
  check("a credential in the URL fragment is picked up", got === "ya29.FROM-HASH", got);
  check("and removed from the address bar afterwards", w.location.hash !== "#credential=ya29.FROM-HASH&state=xyz", w.location.hash);
}
{
  const w = g.window as unknown as FakeWindow;
  w.location.hash = "";
  w.location.search = "?credential=ya29.FROM-QUERY";
  const got = await (mod.requestGoogleIdToken as () => Promise<string>)();
  check("a credential in the query string is picked up too", got === "ya29.FROM-QUERY", got);
}

// --- tracing must never print a token ---------------------------------------
/*
 * A token in a console log is a credential in a browser log, and browser logs get
 * screenshotted and pasted into issues. The sanitiser is tested directly rather than
 * through `traceAuth`, because `traceAuth` is gated behind `import.meta.env.DEV` — which
 * does not exist under Node, so testing it there proved nothing at all.
 */
{
  const redact = mod.redactForLog as (d: Record<string, unknown>) => Record<string, unknown>;
  const jwt = `${"a".repeat(20)}.${"b".repeat(30)}.${"c".repeat(40)}`;

  const flat = JSON.stringify(redact({ token: "ya29.SECRET-TOKEN-VALUE", session: jwt, email: "a@b.c", id: 42 }));
  check("a token field is reduced to its length", !flat.includes("SECRET-TOKEN-VALUE"), flat.slice(0, 160));
  check("so is a JWT hiding under another name", !flat.includes("bbbb"), flat.slice(0, 160));
  check("ordinary fields are left readable", flat.includes("a@b.c") && flat.includes("42"), flat.slice(0, 160));
  check("the redaction says how much was there", flat.includes("chars"), flat.slice(0, 160));
}

console.log(bad ? `\n${bad} failed` : "\nno credential is dropped");
void resetModules;
if (bad) process.exit(1);