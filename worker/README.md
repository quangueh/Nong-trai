# Account Worker

The game is a static site. This Worker is the only server-side part, and it does
four things: create accounts, sign in, store a save under an account, and change a
password.

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
| `POST /api/register` | `{ email, password }` → `{ playerId }` |
| `POST /api/login` | `{ email, password }` → `{ token, playerId }` |
| `GET /api/save` | bearer → `{ savedAt, state }`, or 404 |
| `PUT /api/save` | bearer, `{ savedAt, state }` → `{ savedAt, kept }` |
| `POST /api/password` | bearer, `{ current, next }` |
| `GET /api/health` | liveness |

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

**CORS** is permissive because the game is likely served from a different host than
the Worker. Once the production host is known, replace the `*` in
`src/index.ts` with it — one line.

**`playerId`** is returned on register and login but the game does not depend on
it being stable. The player's identity for save purposes is their email.
