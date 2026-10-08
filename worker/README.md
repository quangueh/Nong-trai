# Account Worker

The game is a static site. This Worker is the only server-side part, and it does
five things: create accounts, sign in, store a save under an account, change a
password, and **relay room messages between two devices** (`/api/room` — see
§Room relay below). Without the relay a room only reaches tabs of the same
browser, which is why two players on different machines saw nothing.

## Why it is a Worker and not part of the site

KV is **eventually consistent**. A write in one region is not visible in another
for up to 60 seconds. So the cloud save cannot be the source of truth — a player
who signs in on a second device could load a garden that is a minute stale and
then overwrite the newer one. The game therefore keeps playing against
`localStorage` and treats this as a *named backup*: it syncs on sign-in, on demand,
and occasionally. Conflicts are decided by `savedAt` and reported to the player
rather than resolved silently.

It also means the game works with no account at all, and with no Worker deployed.
That is deliberate: an account feature must never be the reason the game will not
start.

## Deploy

```bash
cd worker
npm install
npx wrangler login

# One namespace, used for both accounts and saves.
npx wrangler kv namespace create DB      # paste the printed id into wrangler.toml

# Secrets are not in wrangler.toml and must never be committed.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put TOKEN_SECRET    # paste the string above
npx wrangler secret put PBKDF2_ROUNDS   # 150000

npx wrangler deploy
```

Then point the game at it:

```bash
# .env.local in the repository root — gitignored
VITE_ACCOUNT_API=https://nong-trai-account.<your-subdomain>.workers.dev
```

Without that variable the account UI says so and everything else works unchanged.

## Endpoints

| | |
|---|---|
| `POST /api/register` | `{ email, password, name? }` → `{ playerId }` |
| `POST /api/login` | `{ email, password }` → `{ token, playerId }` |
| `GET /api/save` | bearer → `{ savedAt, state }`, or 404 |
| `PUT /api/save` | bearer, `{ savedAt, state }` → `{ savedAt, kept }` |
| `POST /api/password` | bearer, `{ current, next }` |
| `POST /api/friend` | bearer, `{ action, ... }` — add/remove/list |
| `POST /api/duel` | `{ action: send/inbox/sent/accept/decline/result }` |
| `POST /api/room` | `{ action: send/poll/reset }` — room message relay |
| `GET /api/health` | liveness |

## Room relay

`/api/room` is a keyed mailbox, not a referee. The game writes messages to
`room:{CODE}:m:{ts}:{rand}` keys and polls the prefix for keys newer than its
cursor minus a 10 s clock-skew window; dedupe happens client-side by key name and
by message `mid`. `reset` wipes a recycled code's leftovers at room creation.

There is no auth — the six-character room code is the capability, the same
contract BroadcastChannel already had. Bounds are structural instead: a message
caps at 32 KB, a room at 240 messages, and every key dies after 15 minutes.

Polling is roughly one `list` per client per 650 ms. KV `list` reads the central
metadata rather than the edge cache, so a message is visible within about a
second of its write — acceptable for lobby traffic and battle intents, because
the host's own simulation stays authoritative and its `result` is the only thing
that settles anything.

`kept` is `"yours"` or `"theirs"`. `"theirs"` means the server already held a newer
save and refused this one — the client shows a conflict prompt rather than
reporting a success that did not happen.

## Notes on the numbers

**KV writes.** The free plan allows roughly 1,000 per day across the namespace.
The client pushes on sign-in, on demand, and every five minutes — not on every
mutation, which would exhaust that in an afternoon. It also stops itself at 900 a
day and says so, so the limit shows up as "paused" rather than as silent failures.

**Passwords** are stretched with PBKDF2-SHA256 at 150,000 rounds, with a per-account
salt. A single fast hash on a leaked KV is a rainbow table, and KV is a key-value
store, not a secret store.

**Tokens** are HMAC-signed rather than looked up, so verifying a request costs no
KV read. That matters specifically because a KV *read* is the eventually-consistent
one; a token that sometimes fails to verify would be a support ticket.

**Rate limiting** is five attempts per email per minute, counted in KV. It is not
atomic, so it is not a security boundary — it exists to stop someone grinding
passwords against a leaked namespace, and the real cost of an attempt is the
PBKDF2 work.

## Display names and the leaderboard

Every save carries the player's in-game name (`state.name`). On `PUT /api/save`
the Worker reads it — ignoring the stock placeholder "Nhà Lai Tạo" — and:

- writes the leaderboard entry under that name (the account email rides along as
  a fallback for rows saved before names could be chosen);
- updates `account.name` when it differs, and re-points the `name:`/`handle:`
  search indexes — so a rename needs no dedicated endpoint, the next save push
  propagates it everywhere;
- releases the old name's share of the name-count index, so a freed name stops
  answering "ambiguous" to friend search.

`register` accepts an optional `name` so a brand-new account can be born named;
otherwise the client falls back to the email prefix, and the account sheet can
rename at any time.

Rows whose account email ends `@example.com`, or whose name carries a probe
prefix (`smoke-`, `probe-`, `lb-probe-`, `test-` followed by digits), are kept
off the published boards — `tools/smoke-worker.ts` registers a throwaway account
and pushes a save on every run, and those entries would otherwise top the board.

**CORS** is permissive because the game is likely served from a different host than
the Worker. Once the production host is known, replace the `*` in
`src/index.ts` with it — one line.

**`playerId`** is returned on register and login but the game does not depend on
it being stable. The player's identity for save purposes is their email.

## Google sign-in

The player can sign in with a Google account instead of a password. The game never
sees a Google password and never holds an OAuth client secret; it asks Google for an
**ID token** and hands that to this Worker, which verifies it against Google's
published keys. **This Worker is the only party that decides anything** — a token
checked in the browser would be worth nothing, because the browser is the untrusted
side.

### Setup

1. **Google Cloud console** → *APIs & Services* → *Credentials* → *Create credentials*
   → *OAuth client ID* → **Web application**.
   - **Authorised JavaScript origins** must include the game's real origin, e.g.
     `https://your-game.pages.dev` and `http://localhost:5173` for local work.
     A trailing slash matters; an origin without one is rejected by Google.
   - Leave *Authorised redirect URIs* empty. The One Tap / GIS popup flow does not use
     one, and an unused entry is a liability rather than a convenience.
2. Put the client ID in the **Worker's** `wrangler.toml` as `GOOGLE_CLIENT_ID` (already
   present, empty).
3. Put the **same** client ID in the game's `.env`:

   ```
   VITE_ACCOUNT_API=https://your-worker.workers.dev
   VITE_GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
   ```

   The two must match. The token's `aud` claim is checked against the Worker's value,
   and a mismatch refuses *every* sign-in with no useful message to the player — so if
   sign-in "just does not work", compare these two strings first.

4. `npx wrangler secret put TOKEN_SECRET` and `npm run deploy` from `worker/`.

Nothing else is needed. There is no client secret to configure and no consent screen to
approve.

### What is checked on every token

| Check | Why |
| --- | --- |
| `alg` is `RS256` | Rules out `alg: none` and HMAC-with-the-public-key, the two classic JWT forgeries. Checked *before* the key fetch. |
| signature over `header.payload` | The token really was minted by Google. |
| `kid` is in Google's JWKS | An unknown key is refused. A refetch is tried first, so a key rotation does not lock anyone out for an hour. |
| `aud` equals `GOOGLE_CLIENT_ID` | Otherwise a token minted for a *different* app the player is signed into would be accepted here. |
| `iss` is `accounts.google.com` | Not minted by someone who learned our client id. |
| `exp` in the future, ±2 min | Tokens are short-lived; the tolerance covers clock skew and no more. |
| `email_verified === true` | An unverified address would let anyone assert someone else's save. |

Deliberately **not** checked:

- `nonce` — binds a token to one browser session. The token is spent within seconds of
  arriving over TLS and is useless afterwards, so the replay window is small. Adding
  nonce would mean stateful single-use tracking, which costs a KV write per sign-in on a
  namespace with a ~1,000 writes/day budget.
- `hd` — only present for Google Workspace accounts. Checking it would lock out every
  ordinary Gmail player.

`tools/test-google-token.ts` exercises all of this against a real RSA signature, not a
stubbed verify function — a verifier that ignored the signature would pass every
"claims are checked" test and be completely insecure.

### Deliberate limitations

- **No password on a Google account.** `/api/password` answers `no_password`. The
  account sheet shows a sentence instead of the form, so nobody types a password that
  cannot work. This is a real limitation, not an oversight.
- **Google and email accounts do not merge.** A Google sign-in is stored under
  `google:<sub>` and an email account under `acct:<email>`, even when the addresses
  match. Merging them silently would let whoever signed in last see the other's garden,
  and the player has no way to tell which happened. Consequence: signing in with Google
  on a device that previously used a password starts a *new*, empty garden.
- **No `hd` check**, so a Workspace and a personal Gmail account with the same address
  are still two accounts — consistent with the point above.

## Cloudflare's PBKDF2 ceiling

Workers **reject a `deriveBits` call that asks for more than 100,000 PBKDF2
iterations** — the whole call throws. This Worker shipped configured for 150,000, so
every `register` and `login` answered a bare `server` code and the password path was
simply broken.

It passed every local test. That is the point worth keeping: `tools/test-*.ts` run on
Node, whose `crypto` has no such ceiling, so nothing short of a request over the wire
could have found it. `PBKDF2_ROUNDS` is now clamped in code rather than trusted from
the config, because a value that kills the endpoint is worse than one that is ignored.

100,000 rounds is below what OWASP currently recommends for PBKDF2-SHA256 (600,000).
That gap is the platform's ceiling, not a choice made here.

`npx tsx tools/smoke-worker.ts` exercises the deployed Worker over real HTTPS —
register, login, push, read back, conflict resolution, password change, and the three
ways a Google token must be refused. It registers a throwaway email per run and leaves
it behind; those are the only entries in KV.
