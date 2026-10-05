/**
 * Smoke test against a deployed Worker.
 *
 * Exercises the whole account loop over real HTTPS: register, login, push a save, read
 * it back, change a password, log in with the new one, and check the old password is
 * refused.
 *
 * This exists because the local suites cannot see the platform. Every one of them runs
 * on Node, where PBKDF2 has no iteration ceiling and `atob`/`crypto.subtle` behave
 * however the Worker happens to behave. That gap is not hypothetical — the Worker
 * shipped configured for 150,000 PBKDF2 rounds, which Cloudflare rejects outright, and
 * every local test passed. Only a request over the wire found it.
 *
 * Nothing here needs a Cloudflare or Google account. It registers a throwaway email per
 * run.
 *
 * Usage: npx tsx tools/smoke-worker.ts https://your-worker.workers.dev
 */
const WORKER = (process.argv[2] ?? "https://nong-trai-account.w46824884.workers.dev").replace(/\/$/, "");

/**
 * Our own request shape rather than the DOM's `RequestInit`.
 *
 * `body` here is a plain object that gets serialised, not a `BodyInit`, so borrowing the
 * DOM type makes every call site a type error about `FormData`. And this file uses
 * top-level await, which `tsc` only accepts in a module — hence the empty export.
 */
interface CallInit {
  method?: "GET" | "POST" | "PUT";
  token?: string;
  body?: Record<string, unknown>;
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function req(path: string, init: CallInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${WORKER}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  return { status: res.status, body };
}

const email = `smoke-${Date.now()}@example.com`;
const NEXT = "a brand new long password";
const PASSWORD = "correct horse battery staple";

console.log(`worker: ${WORKER}\nemail:  ${email}\n`);

console.log("1. liveness");
{
  const r = await req("/api/health");
  check("health responds ok", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
}

console.log("\n2. register and log in");
let token = "";
let playerId = "";
{
  const r = await req("/api/register", { method: "POST", body: { email, password: PASSWORD } });
  check("register succeeds", r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  playerId = String(r.body.playerId ?? "");

  const bad = await req("/api/register", { method: "POST", body: { email, password: PASSWORD } });
  check("registering the same email twice is refused", bad.status === 409, `${bad.status}`);

  const li = await req("/api/login", { method: "POST", body: { email, password: PASSWORD } });
  check("login succeeds", li.status === 200 && Boolean(li.body.token), `${li.status} ${JSON.stringify(li.body)}`);
  token = String(li.body.token ?? "");
  check("login returns the same player id", String(li.body.playerId ?? "") === playerId);

  const wrong = await req("/api/login", { method: "POST", body: { email, password: "wrong" } });
  check("a wrong password is refused", wrong.status === 401, `${wrong.status}`);

  const anon = await req("/api/save");
  check("reading a save without a token is refused", anon.status === 401, `${anon.status}`);
}

console.log("\n3. the save loop");
{
  const before = await req("/api/save", { token });
  check("a fresh account has no save yet", before.status === 404, `${before.status}`);

  const state = { playerId, leafCoin: 1234, plants: [{ name: "Test cây" }], savedAt: 1 };
  const put = await req("/api/save", { method: "PUT", token, body: { savedAt: Date.now(), state } });
  check("push succeeds", put.status === 200 && put.body.kept === "yours", `${put.status} ${JSON.stringify(put.body)}`);

  const got = await req("/api/save", { token });
  check("read back returns the save", got.status === 200 && Boolean(got.body.savedAt));
  const echoed = got.body.state as { leafCoin?: number } | undefined;
  check("the state survived the round trip", echoed?.leafCoin === 1234, JSON.stringify(echoed));

  // The conflict rule, which is the part that decides whose garden wins.
  const stale = await req("/api/save", {
    method: "PUT",
    token,
    body: { savedAt: 1, state: { ...state, leafCoin: 999999 } },
  });
  check("an older push is refused, not applied", stale.status === 200 && stale.body.kept === "theirs", JSON.stringify(stale.body));
  const stillThere = await req("/api/save", { token });
  const after = stillThere.body.state as { leafCoin?: number } | undefined;
  check("the newer save is still the one stored", after?.leafCoin === 1234, JSON.stringify(after));
}

console.log("\n4. password change");
{
  const weak = await req("/api/password", { method: "POST", token, body: { current: PASSWORD, next: "short" } });
  check("a short new password is refused", weak.status === 400 && weak.body.error === "weak_password", JSON.stringify(weak.body));

  const wrongCurrent = await req("/api/password", {
    method: "POST",
    token,
    body: { current: "not it", next: "a new long password" },
  });
  check("a wrong current password is refused", wrongCurrent.status === 401, `${wrongCurrent.status}`);

  const ok = await req("/api/password", { method: "POST", token, body: { current: PASSWORD, next: NEXT } });
  check("changing the password succeeds", ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`);

  const withNew = await req("/api/login", { method: "POST", body: { email, password: NEXT } });
  check("the new password logs in", withNew.status === 200, `${withNew.status}`);

  const withOld = await req("/api/login", { method: "POST", body: { email, password: PASSWORD } });
  check("the old password no longer works", withOld.status === 401, `${withOld.status}`);
}

console.log("\n5. google sign-in refuses what it should");
{
  const noToken = await req("/api/google", { method: "POST", body: {} });
  check("no token is rejected", noToken.status === 400 && noToken.body.error === "missing");

  const garbage = await req("/api/google", { method: "POST", body: { idToken: "not.a.jwt" } });
  check("a malformed token is rejected", garbage.status === 401 && garbage.body.error === "google_rejected", JSON.stringify(garbage.body));

  // A well-formed JWT that nobody signed. Signature verification must reject it, which
  // is only meaningful if the Worker really did reach Google's key endpoint.
  const fake = `${btoa(JSON.stringify({ alg: "RS256", kid: "nope" }))}.${btoa(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "985241634573-u19ok6lg1vt7i2f221hr2smrmbs0v3nl.apps.googleusercontent.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "x",
      email: "x@example.com",
      email_verified: true,
    }),
  )}.c2lnbmF0dXJl`;
  const forged = await req("/api/google", { method: "POST", body: { idToken: fake } });
  check(
    "an unsigned token is rejected",
    forged.status === 401 && forged.body.error === "google_rejected",
    JSON.stringify(forged.body),
  );

  // `NEXT`, not the password this section set: the current password is now NEXT, and
  // using the old one here answered bad_credentials, which is correct behaviour being
  // reported as a failure by a test that had the wrong value.
  const pwOnEmail = await req("/api/password", {
    method: "POST",
    token,
    body: { current: NEXT, next: "yet another long password" },
  });
  check("password change still works for an email account", pwOnEmail.status === 200, JSON.stringify(pwOnEmail.body));
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`\nthrowaway account left behind: ${email}`);
if (fail > 0) process.exitCode = 1;

export {};
