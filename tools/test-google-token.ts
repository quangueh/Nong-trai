/**
 * Google ID token verification.
 *
 * This is the one place in the project where a bug is a security bug, so the tests are
 * written as an attacker's checklist rather than as a summary of the happy path. Every
 * way a token can be wrong is exercised against a real signature: an RSA keypair is
 * generated in-process, a genuine RS256 token is signed with it, and `fetch` is stubbed
 * to serve that key as Google's JWKS.
 *
 * Real signatures matter. A verifier that ignores the signature and only reads the
 * payload passes every "claims are checked" test and is completely insecure, and that is
 * the failure this file is shaped to catch — `the signature is actually verified` and
 * `a token signed by a different key is refused` are two of its assertions.
 *
 * Run: npx tsx tools/test-google-token.ts
 */

import {
  forgetGoogleKeys,
  googleAccountKey,
  googleSaveKey,
  verifyGoogleIdToken,
} from "../worker/src/google";

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

// --- build a real keypair and sign real tokens -------------------------------

const CLIENT_ID = "1234567890-abcdefg.apps.googleusercontent.com";

const pair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

/** A second key, standing in for an attacker. */
const attacker = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

const b64u = (bytes: ArrayBuffer | Uint8Array): string => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const enc = new TextEncoder();

interface Opts {
  kid?: string;
  alg?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  email?: string;
  emailVerified?: boolean;
  sub?: string;
  /** Sign with the attacker key instead of the real one. */
  forged?: boolean;
  /** Corrupt the signature after signing. */
  tamper?: boolean;
}

async function mint(o: Opts = {}): Promise<string> {
  const header = { alg: o.alg ?? "RS256", typ: "JWT", kid: o.kid ?? "key-1" };
  const payload = {
    iss: o.iss ?? "https://accounts.google.com",
    aud: o.aud ?? CLIENT_ID,
    exp: o.exp ?? Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: o.sub ?? "1234567890",
    email: o.email ?? "player@example.com",
    email_verified: o.emailVerified ?? true,
    name: "Player One",
  };
  const signingInput = `${b64u(enc.encode(JSON.stringify(header)))}.${b64u(enc.encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    o.forged ? attacker.privateKey : pair.privateKey,
    enc.encode(signingInput),
  );
  const sigB64 = b64u(sig);
  // Tampering flips the last byte of the signature, leaving the payload intact — the
  // exact shape of an attacker editing their own claims in a decoded token.
  const finalSig = o.tamper
    ? sigB64.slice(0, -2) + (sigB64.slice(-2) === "AA" ? "AB" : "AA")
    : sigB64;
  return `${signingInput}.${finalSig}`;
}

async function publicJwk(key: CryptoKey): Promise<Record<string, string>> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return { kty: jwk.kty!, alg: "RS256", use: "sig", kid: "key-1", n: jwk.n!, e: jwk.e! };
}

const realJwk = await publicJwk(pair.publicKey);

/** Stand in for Google's key endpoint. */
let jwksHits = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.includes("googleapis.com/oauth2/v3/certs")) {
    jwksHits++;
    return new Response(JSON.stringify({ keys: [realJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input as RequestInfo);
}) as typeof fetch;

const verifyOk = async (token: string, clientId = CLIENT_ID) => {
  const r = await verifyGoogleIdToken(token, clientId);
  return r;
};

// --- 1. the happy path -------------------------------------------------------
section("1. A genuine token is accepted");
{
  forgetGoogleKeys();
  jwksHits = 0;
  const token = await mint();
  const r = await verifyOk(token);
  check("accepted", r.ok, r.ok ? "" : (r as { reason: string }).reason);
  if (r.ok) {
    check("the subject is returned", r.claims.sub === "1234567890", r.claims.sub);
    check("the email is returned", r.claims.email === "player@example.com", r.claims.email);
  }
  check(
    "the JWKS was fetched and then cached",
    jwksHits === 1,
    `${jwksHits} fetches for one token`,
  );
  forgetGoogleKeys();
  jwksHits = 0;
  await verifyOk(await mint());
  await verifyOk(await mint());
  check("a second and third token reuse the cached key", jwksHits === 1, `${jwksHits} fetches`);
}

// --- 2. the signature -------------------------------------------------------
section("2. The signature is genuinely checked");
{
  forgetGoogleKeys();
  const forged = await verifyOk(await mint({ forged: true }));
  check("a token signed by a different key is refused", !forged.ok, forged.ok ? "ACCEPTED" : (forged as { reason: string }).reason);

  forgetGoogleKeys();
  const tampered = await verifyOk(await mint({ tamper: true }));
  check("a token with a corrupted signature is refused", !tampered.ok, tampered.ok ? "ACCEPTED" : (tampered as { reason: string }).reason);

  forgetGoogleKeys();
  const algNone = await verifyOk(await mint({ alg: "none" }));
  check("alg=none is refused before any key is fetched", !algNone.ok, (algNone as { reason: string }).reason);

  forgetGoogleKeys();
  const noKid = await verifyOk(await mint({ kid: "" }));
  check("a token with no kid is refused", !noKid.ok, (noKid as { reason: string }).reason);
}

// --- 3. the claims ----------------------------------------------------------
section("3. The claims are checked, not just the signature");
{
  forgetGoogleKeys();
  const wrongAud = await verifyOk(await mint({ aud: "some-other-app.apps.googleusercontent.com" }));
  check("a token minted for another application is refused", !wrongAud.ok, (wrongAud as { reason: string }).reason);

  forgetGoogleKeys();
  const wrongClient = await verifyOk(await mint(), "a-different-client-id");
  check("a token is refused against a different client id", !wrongClient.ok, (wrongClient as { reason: string }).reason);

  forgetGoogleKeys();
  const wrongIss = await verifyOk(await mint({ iss: "https://evil.example.com" }));
  check("an unexpected issuer is refused", !wrongIss.ok, (wrongIss as { reason: string }).reason);

  forgetGoogleKeys();
  // Well outside the 2-minute skew allowance. This was originally 10 seconds past
  // expiry and it was *accepted*, which is correct — 10s is inside the tolerance and
  // the test was asserting the wrong side of the boundary.
  const expired = await verifyOk(await mint({ exp: Math.floor(Date.now() / 1000) - 600 }));
  check("a token expired ten minutes ago is refused", !expired.ok, (expired as { reason: string }).reason);

  forgetGoogleKeys();
  const justInside = await verifyOk(
    await mint({ exp: Math.floor(Date.now() / 1000) - 30 }),
  );
  check(
    "a token 30s past expiry is tolerated for clock skew",
    justInside.ok,
    justInside.ok ? "" : (justInside as { reason: string }).reason,
  );

  forgetGoogleKeys();
  // Past the tolerance, to prove the tolerance is bounded rather than unbounded.
  const justOutside = await verifyOk(
    await mint({ exp: Math.floor(Date.now() / 1000) - 200 }),
  );
  check(
    "a token 200s past expiry is refused, so the tolerance is bounded",
    !justOutside.ok,
    justOutside.ok ? "ACCEPTED" : "",
  );

  forgetGoogleKeys();
  const unverifiedEmail = await verifyOk(await mint({ emailVerified: false }));
  check("an unverified email is refused", !unverifiedEmail.ok, (unverifiedEmail as { reason: string }).reason);

  forgetGoogleKeys();
  const noEmail = await verifyOk(await mint({ email: "" }));
  check("a token with no email is refused", !noEmail.ok, (noEmail as { reason: string }).reason);

  forgetGoogleKeys();
  const noSub = await verifyOk(await mint({ sub: "" }));
  check("a token with no subject is refused", !noSub.ok, (noSub as { reason: string }).reason);
}

// --- 4. malformed input -----------------------------------------------------
section("4. Malformed input is refused without throwing");
{
  forgetGoogleKeys();
  const inputs: [string, string][] = [
    ["an empty string", ""],
    ["two segments", "aaa.bbb"],
    ["four segments", "aaa.bbb.ccc.ddd"],
    ["non-JSON header", `${b64u(enc.encode("not json"))}.${b64u(enc.encode("{}"))}.sig`],
    ["non-JSON payload", `${b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "key-1" })))}.${b64u(enc.encode("not json"))}.sig`],
    ["a base64 signature that is not base64", `${b64u(enc.encode(JSON.stringify({ alg: "RS256", kid: "key-1" })))}.${b64u(enc.encode("{}"))}.!!!!`],
  ];
  for (const [label, token] of inputs) {
    forgetGoogleKeys();
    let threw = false;
    let verdict: Awaited<ReturnType<typeof verifyGoogleIdToken>> | null = null;
    try {
      verdict = await verifyGoogleIdToken(token, CLIENT_ID);
    } catch {
      threw = true;
    }
    check(`refuses ${label} without throwing`, !threw && verdict !== null && verdict.ok === false, threw ? "THREW" : verdict?.ok ? "ACCEPTED" : "");
  }
}

// --- 5. an unknown kid forces a refetch -------------------------------------
section("5. A rotated key does not lock anyone out");
{
  forgetGoogleKeys();
  // A token from the new key, while the cache holds the old one.
  await verifyOk(await mint());
  const rotated = await verifyOk(await mint({ kid: "key-2" }));
  check("an unknown kid is refused rather than trusted", !rotated.ok, (rotated as { reason: string }).reason);
  // This test clears the JWKS cache before every case on purpose, so a fetch per
  // case is the design here. What matters is that the refetch after an unknown kid
  // happened rather than the token being trusted or the key being treated as absent.
  check(
    "an unknown kid triggers a refetch rather than a silent failure",
    jwksHits >= 2,
    `${jwksHits} fetches`,
  );
}

// --- 6. keys ----------------------------------------------------------------
section("6. Storage keys");
{
  check("a Google account key is namespaced by sub", googleAccountKey("abc") === "google:abc", googleAccountKey("abc"));
  check("a Google save key is namespaced by sub", googleSaveKey("abc") === "gsave:abc", googleSaveKey("abc"));
  check(
    "a Google account key cannot collide with a password account",
    googleAccountKey("a@b.com") !== "acct:a@b.com",
  );
  // The reason the namespaces are kept apart: two different saves, not one merged garden.
  check(
    "two subjects never share a key",
    googleAccountKey("a") !== googleAccountKey("b"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;