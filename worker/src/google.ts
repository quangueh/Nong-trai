/**
 * Google ID token verification (docs: worker/README.md §Google sign-in).
 *
 * A client cannot be trusted to say who it is, so the only question is: is this a
 * token Google actually minted, for *this* application, and has it expired? That is
 * answered by checking four things and nothing else:
 *
 *   signature  RS256 over the JWS, against Google's published public key
 *   aud        equals our client ID — otherwise a token minted for some other app
 *              that the player is signed into would be accepted here
 *   iss        one of Google's issuers
 *   exp        in the future, with a little tolerance for clock skew
 *
 * The key is fetched from Google's JWKS endpoint and cached. Caching matters more
 * than it looks: the free Workers tier allows 1000 subrequests a day, and an
 * uncached lookup per sign-in would spend one of them on every tap of the button.
 * Google's own guidance is to cache for the hour a key is documented to live.
 *
 * Deliberately *not* verified: `nonce` and `hd`. `hd` is only meaningful for
 * Workspace accounts and checking it would lock out ordinary Gmail users, and the
 * aud check already binds the token to this app. `nonce` binds a token to one
 * browser session; the token is spent within seconds of being received over TLS and
 * cannot be replayed usefully because an attacker would need it before it is spent.
 * Both are documented rather than silently omitted.
 */

export interface GoogleClaims {
  /** Google's stable account id. The account key. */
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
  iat?: number;
}

/**
 * A discriminated union, which needs a type alias rather than an `interface`:
 * `interface X {…} | {…}` is not a thing, and the parse error it produces points at
 * the `|` rather than at the mistake.
 */
export type VerifyResult =
  | {
      ok: true;
      claims: GoogleClaims;
    }
  | {
      ok: false;
      /** Why it failed, for the server log. Never returned to the client verbatim. */
      reason: string;
    };

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Google rotates signing keys roughly daily; an hour of cache is the documented bound. */
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Clocks disagree. Two minutes is generous and short. */
const CLOCK_SKEW_MS = 120 * 1000;

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

let jwksCache: { at: number; keys: Jwk[] } | null = null;

async function googleKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) throw new Error("jwks empty");
  jwksCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

/** base64url -> Uint8Array. JWTs are base64url, not base64. */
function b64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verify a Google ID token.
 *
 * `clientId` is passed in rather than read from an env binding because the same
 * worker may serve a staging and a production game, and the token's `aud` has to be
 * compared against the app that actually asked for it.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<VerifyResult> {
  if (!clientId) return { ok: false, reason: "no client id configured" };

  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, reason: "not a JWS" };
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: GoogleClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(headerB64)));
    claims = JSON.parse(new TextDecoder().decode(b64url(payloadB64)));
  } catch {
    return { ok: false, reason: "unparseable token" };
  }

  // Refused before the key fetch. `alg: none` and HMAC-with-the-public-key are the two
  // classic JWT forgeries and both are cheap to rule out here.
  if (header.alg !== "RS256") return { ok: false, reason: `alg ${header.alg}` };
  if (!header.kid) return { ok: false, reason: "no kid" };

  let keys: Jwk[];
  try {
    keys = await googleKeys();
  } catch (e) {
    return { ok: false, reason: `jwks unavailable: ${String(e)}` };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  // A missing kid usually means Google rotated. Drop the cache and try once more, so a
  // rotation does not lock people out for the length of the cache window.
  if (!jwk) {
    jwksCache = null;
    try {
      keys = await googleKeys();
    } catch {
      return { ok: false, reason: "jwks unavailable on retry" };
    }
    const retry = keys.find((k) => k.kid === header.kid);
    if (!retry) return { ok: false, reason: "unknown kid" };
    return checkSignature(retry, `${headerB64}.${payloadB64}`, signatureB64, claims, clientId);
  }
  return checkSignature(jwk, `${headerB64}.${payloadB64}`, signatureB64, claims, clientId);
}

/**
 * `signed` is the JWS *signing input* — `header.payload`, without the signature.
 *
 * Passing the whole token here is a bug that reads plausibly: every part looks like it
 * belongs, and the only symptom is that every genuinely valid token is rejected with
 * "signature mismatch", which looks like a key problem rather than a message problem.
 * It was caught by minting a real RS256 token in `tools/test-google-token.ts`; a test
 * that only checked the payload's claims would have passed straight over it.
 */
async function checkSignature(
  jwk: Jwk,
  signed: string,
  signatureB64: string,
  claims: GoogleClaims,
  clientId: string,
): Promise<VerifyResult> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, alg: jwk.alg, n: jwk.n, e: jwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64url(signatureB64) as unknown as ArrayBuffer,
      new TextEncoder().encode(signed),
    );
    if (!ok) return { ok: false, reason: "signature mismatch" };
  } catch (e) {
    return { ok: false, reason: `verify threw: ${String(e)}` };
  }

  // The signature proves Google minted it. These four prove it was minted *for us* and
  // is still good. Any one of them failing is fatal.
  if (claims.aud !== clientId) return { ok: false, reason: "aud mismatch" };
  if (!ISSUERS.has(claims.iss)) return { ok: false, reason: `iss ${claims.iss}` };
  if (typeof claims.exp !== "number" || claims.exp * 1000 + CLOCK_SKEW_MS < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (!claims.sub) return { ok: false, reason: "no sub" };
  // An unverified email would let anyone with a Google account claim someone else's
  // save by asserting an address they do not own.
  if (!claims.email || claims.email_verified !== true) return { ok: false, reason: "email not verified" };

  return { ok: true, claims };
}

/**
 * The storage key for a Google account.
 *
 * Prefixed `google:` rather than reusing the email key, so a Google sign-in and a
 * password account made with the same address stay two separate saves. Merging them
 * silently would let whoever signed in last see the other's garden, and there is no
 * way for the player to tell which happened.
 */
export const googleAccountKey = (sub: string): string => `google:${sub}`;

export const googleSaveKey = (sub: string): string => `gsave:${sub}`;

/** Clear the JWKS cache. For tests. */
export function forgetGoogleKeys(): void {
  jwksCache = null;
}