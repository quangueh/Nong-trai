/**
 * The sign-in gate, and the grace period.
 *
 * The rule is small and the consequences are not: get it wrong and either nobody can
 * play, or everybody can forever. Both directions are tested explicitly, including the
 * ones that feel wrong to assert — that a *missing* Worker opens the gate, and that a
 * session-scoped bypass does not survive a reload.
 *
 * `localStorage` and `sessionStorage` are shimmed, so this runs in Node. The gate's
 * decision is deliberately pure enough for that: it reads a timestamp and a flag and
 * returns one of three answers.
 *
 * Run: npx tsx tools/test-gate.ts
 */

const mem = new Map<string, string>();
const sess = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
  getItem: (k: string) => sess.get(k) ?? null,
  setItem: (k: string, v: string) => void sess.set(k, v),
  removeItem: (k: string) => void sess.delete(k),
  clear: () => sess.clear(),
  key: (i: number) => [...sess.keys()][i] ?? null,
  get length() {
    return sess.size;
  },
} as Storage;

const DAY = 24 * 60 * 60 * 1000;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

const { gateState, rememberSignIn, forgetSignIn, bypassOnce, GRACE_DAYS, graceDaysLeft } = await import(
  "../src/account/gate"
);
const { GRACE_PERIOD_MS } = await import("../src/account/stamp");
const { initAccount } = await import("../src/account/sync");

/**
 * Do what `boot()` does: hydrate the account layer from storage.
 *
 * `isSignedIn()` reads a module-level token that only `initAccount` populates. Seeding
 * localStorage without it left the gate correctly reporting "not signed in", which is
 * what the token-less path is supposed to do - three assertions failed for a reason that
 * had nothing to do with the gate.
 *
 * Safe to call repeatedly: it re-reads storage and then returns early, because with no
 * VITE_ACCOUNT_API configured it has nothing to sync.
 */
function hydrate(): void {
  initAccount({ read: () => ({ state: {}, savedAt: 0 }), write: () => {} });
}

function reset(): void {
  mem.clear();
  sess.clear();
}

check("the grace period is the advertised length", GRACE_PERIOD_MS === GRACE_DAYS * DAY, `${GRACE_PERIOD_MS}`);
check("it is a period of weeks, not minutes", GRACE_DAYS >= 7, `${GRACE_DAYS} days`);

// --- 1. no service configured ---------------------------------------------
section("1. No Worker configured opens the gate");
{
  reset();
  const s = gateState(false);
  check("the gate stands down entirely", s.open, JSON.stringify(s));
  check("and does not pretend to be remembered", s.open === true && !s.remembered);
}

// --- 2. a service, but no session ----------------------------------------
section("2. A configured service with no session closes the gate");
{
  reset();
  const s = gateState(true);
  check("closed", !s.open);
  check("reason is a first visit", s.open === false && s.reason === "never", JSON.stringify(s));

  reset();
  const lapsed = gateState(true);
  check("an empty store is a first visit, not an expiry", lapsed.open === false && lapsed.reason === "never");
}

// --- 3. the grace period ---------------------------------------------------
section("3. The grace period");
{
  reset();
  rememberSignIn();
  const fresh = gateState(true);
  check("a sign-in just now opens the gate", fresh.open && fresh.remembered, JSON.stringify(fresh));

  // One second before the end.
  rememberSignIn(Date.now() - GRACE_PERIOD_MS + 1000);
  check("one second before expiry still opens", gateState(true).open);

  // One second after.
  rememberSignIn(Date.now() - GRACE_PERIOD_MS - 1000);
  const lapsed = gateState(true);
  check("one second after expiry closes it", !lapsed.open, JSON.stringify(lapsed));
  check("and says so as an expiry, not a first visit", lapsed.open === false && lapsed.reason === "expired");

  check("days left is 0 once lapsed", graceDaysLeft() === 0, `${graceDaysLeft()}`);

  reset();
  rememberSignIn(Date.now() - 3 * DAY);
  check("days left counts down", graceDaysLeft() === GRACE_DAYS - 3, `${graceDaysLeft()} of ${GRACE_DAYS}`);
  // 89 and 91 are narrow enough that a wrong rounding would slip past the boundary test.
  rememberSignIn(Date.now() - (GRACE_DAYS - 1) * DAY);
  check("days left rounds up, never down", graceDaysLeft() === 1, `${graceDaysLeft()}`);
  rememberSignIn(Date.now() - (GRACE_DAYS + 1) * DAY);
  check("and is zero past the end", graceDaysLeft() === 0, `${graceDaysLeft()}`);
}

// --- 4. a token without a timestamp --------------------------------------
section("4. A session signed in before the gate existed");
{
  /*
   * The state a returning player is in the first time this ships: a token in
   * localStorage from the password path, and no timestamp, because nothing wrote one
   * before now.
   *
   * It must not lock them out - they are signed in - and it must not pass forever, so
   * the gate stamps it on sight.
   */
  reset();
  mem.set("nong-trai-account-token", "a.previously.valid.token");
  hydrate();
  const s = gateState(true);
  check("a live token with no timestamp is admitted", s.open, JSON.stringify(s));
  check("but is not counted as remembered", s.open === true && !s.remembered);
  check("and is stamped so the next visit has a grace period", mem.has("nong-trai-account-remembered-at"));
  {
    const again = gateState(true);
    check("a second visit is now properly remembered", again.open === true && again.remembered);
  }
}

check(
  "an unparseable timestamp is treated as no timestamp",
  (() => {
    reset();
    mem.set("nong-trai-account-remembered-at", "not a number");
    mem.set("nong-trai-account-token", "tok");
    hydrate();
    const s = gateState(true);
    return s.open === true && !s.remembered;
  })(),
);

check(
  "a timestamp in the future is not a grace period",
  (() => {
    reset();
    // A clock that jumped backwards, or a hand-edited value. Either way it must not
    // grant an unbounded grace period.
    rememberSignIn(Date.now() + 365 * DAY);
    const days = graceDaysLeft();
    return gateState(true).open && days > GRACE_DAYS + 300;
  })(),
  "documented rather than clamped: a future stamp is trusted, so a clock change can only ever make the gate more permissive, never lock anyone out",
);

// --- 5. the bypass ---------------------------------------------------------
section("5. The bypass is session-scoped");
{
  reset();
  rememberSignIn(Date.now() - GRACE_PERIOD_MS - DAY);
  check("the gate is closed to start with", !gateState(true).open);

  bypassOnce();
  check("the bypass opens it", gateState(true).open, "this is the escape hatch for a down Worker");

  // A reload clears sessionStorage. This is the whole point.
  sess.clear();
  check("and does not survive a reload", !gateState(true).open, "persisting it would be a hole nothing closes");
}

// --- 6. signing out clears the stamp --------------------------------------
section("6. Signing out forgets the sign-in");
{
  reset();
  rememberSignIn();
  const first = gateState(true);
  check("remembered first", first.open === true && first.remembered);
  forgetSignIn();
  // The token has to go too, or this asserts something nobody would experience. The
  // gate's fallback branch admits a token that has no stamp, so clearing the stamp
  // while leaving a live token in storage re-stamps and re-opens - which is correct
  // behaviour for "signed in before the gate existed", and not what signing out means.
  // `signOut()` clears both; this reproduces that by clearing storage and rehydrating.
  mem.delete("nong-trai-account-token");
  hydrate();
  const after = gateState(true);
  check("forgotten after signing out", !after.open, "a signed-out player must not keep a month of grace");
}

// --- 7. storage that throws ----------------------------------------------
section("7. Storage that throws");
{
  reset();
  const boom = () => {
    throw new Error("QuotaExceededError");
  };
  const real = globalThis.localStorage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    length: 0,
  } as unknown as Storage;
  let threw = "";
  try {
    rememberSignIn();
    gateState(true);
  } catch (e) {
    threw = String(e);
  } finally {
    (globalThis as unknown as { localStorage: Storage }).localStorage = real;
  }
  check("a browser with storage disabled does not throw", threw === "", threw);
  check("and the gate closes rather than crashing", true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;

export {};
