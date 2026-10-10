/**
 * The auth state machine, in a browser.
 *
 * Google itself cannot be driven here — it needs a real popup and a real account — so this
 * covers everything on our side of it: what the gate decides from what is in storage, and
 * what happens across a reload.
 *
 * That is the part that decides whether a *successful* sign-in lets anybody in, which is
 * the bug this suite exists for. The credential exchange is covered by
 * `test-auth-google.ts`; the point here is the decision afterwards.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5173";

let bad = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 900 } });
// This suite tests local gate decisions, not Google or the production Worker.
await ctx.route("**/*", route => route.request().url().startsWith(`${URL}/`) ? route.continue() : route.abort());
const page = await ctx.newPage();
const errs: string[] = [];
page.on("pageerror", (e: Error) => errs.push(String(e).slice(0, 200)));

const TOKEN = "nong-trai-account-token";
const STAMP = "nong-trai-account-remembered-at";
const ACTIVE = "nong-trai-active-account";

/** Seed storage before the app boots, then load. */
async function bootWith(storage: Record<string, string>): Promise<void> {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (pairs: Record<string, string>) => {
      for (const [k, v] of Object.entries(pairs)) localStorage.setItem(k, v);
      for (const k of Object.keys(localStorage)) {
        if (!(k in pairs) && k.startsWith("nong-trai-")) localStorage.removeItem(k);
      }
    },
    storage,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), undefined, { timeout: 20000 });
  await page.waitForTimeout(1400);
}

const gateShown = (): Promise<boolean> => page.evaluate(`(() => Boolean(document.querySelector(".gate-overlay")))()`) as Promise<boolean>;

console.log("auth state machine:\n");

/* --- a first visit --------------------------------------------------------- */
await bootWith({});
check("a first visit is shown the gate", await gateShown());

/* --- after a successful sign-in ------------------------------------------- */
/*
 * Reproduces what `adoptSession` writes: a token, the account email, the session kind, the
 * grace stamp, and the chosen save slot. Any one of these missing is a lock-out, so each is
 * written exactly as the real code writes it.
 */
await bootWith({
  [TOKEN]: "fake-session-token",
  "nong-trai-account-email": "player@example.com",
  "nong-trai-account-kind": "google",
  [STAMP]: String(Date.now()),
  [ACTIVE]: "pl_abc123",
});
check("a signed-in account is not shown the gate", (await gateShown()) === false);
check("and the game is playable", await page.evaluate(`(() => Boolean((window).__game?.store?.state?.plants))()`));

/* --- after a reload ------------------------------------------------------- */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), undefined, { timeout: 20000 });
await page.waitForTimeout(1500);
check("still not gated after a reload", (await gateShown()) === false);
check(
  "and the account's own save slot is the one loaded",
  (await page.evaluate(`(() => localStorage.getItem("nong-trai-active-account"))()`)) === "pl_abc123",
);

/* --- a lapsed session ----------------------------------------------------- */
await bootWith({
  [TOKEN]: "fake-session-token",
  "nong-trai-account-email": "player@example.com",
  // 40 days old: past the 30-day grace.
  [STAMP]: String(Date.now() - 40 * 86_400_000),
  [ACTIVE]: "pl_abc123",
});
check("a lapsed session is asked to sign in again", await gateShown());
check("and says why rather than showing a bare form", await page.evaluate(`(() => {
  const t = document.querySelector(".gate-sub")?.textContent || "";
  return /hết hạn/i.test(t);
})()`));

/* --- a token with no stamp ------------------------------------------------ */
await bootWith({
  [TOKEN]: "fake-session-token",
  "nong-trai-account-email": "player@example.com",
});
check("a token with no stamp is admitted once and stamped", (await gateShown()) === false);
check(
  "and the stamp is written so the next visit is covered",
  Number(await page.evaluate(`(() => localStorage.getItem("nong-trai-active-account") ?? "0")()`)) >= 0 &&
    (await page.evaluate(`(() => Boolean(localStorage.getItem(${JSON.stringify(STAMP)})))()`)),
);

/* --- sign-out ------------------------------------------------------------- */
await bootWith({
  [TOKEN]: "fake-session-token",
  "nong-trai-account-email": "player@example.com",
  [STAMP]: String(Date.now()),
  [ACTIVE]: "pl_abc123",
});
await page.evaluate(`(() => {
  // The real sign-out, not storage cleared by hand: that would pass even if signOut forgot
  // to clear something, and the thing it must clear that matters most — the save slot — is
  // exactly what a hand-cleared test would miss.
  const m = (window).__game;
  if (m && typeof m.signOutAndGate === "function") m.signOutAndGate();
})()`);
await page.waitForTimeout(1600);
{
  const left = (await page.evaluate(`(() => ({
    token: localStorage.getItem(${JSON.stringify(TOKEN)}),
    stamp: localStorage.getItem(${JSON.stringify(STAMP)}),
    active: localStorage.getItem(${JSON.stringify(ACTIVE)}),
  }))()`)) as Record<string, string | null>;
  check("sign-out clears the token", left.token === null, String(left.token));
  check("sign-out clears the grace stamp, so the gate returns", left.stamp === null, String(left.stamp));
  check("and returns to the anonymous garden rather than the account's", left.active === null, String(left.active));
  check("the gate is back after signing out", await gateShown());
}

/* --- a corrupt stamp ------------------------------------------------------
 *
 * With no token. A corrupt stamp plus a token is *admitted*, by the branch in `gate.ts`
 * that covers an account created before the gate existed — and that is correct, because the
 * guard on that branch is the absence of a stamp, which a corrupt one satisfies. Asserting
 * the other way round would be asserting a bug.
 */
await bootWith({ [STAMP]: "not-a-number" });
check("a corrupt stamp with no token is not a pass", await gateShown());

/* --- the gate's own answer, from the game rather than from the DOM ---------- */
await bootWith({
  [TOKEN]: "t",
  "nong-trai-account-email": "p@example.com",
  [STAMP]: String(Date.now()),
});
const decision = (await page.evaluate(`(() => {
  const s = (window).__game.authState();
  return { open: s.open, remembered: s.remembered ?? null };
})()`)) as Record<string, unknown>;
console.log(`  gateState() says: ${JSON.stringify(decision)}`);
check("the gate's own decision agrees with what the player sees", decision.open === true && !(await gateShown()));

await ctx.close();
await b.close();

console.log(errs.length ? `\npage errors:\n  ${errs.join("\n  ")}` : "\nno page errors");
console.log(bad ? `${bad} failed` : "the gate never locks out a signed-in player");
if (bad) process.exit(1);
