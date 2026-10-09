# Nông trại — agent notes

## Deploy

- Frontend: `npm run build` (typecheck + vite build), rồi deploy Pages:
  `npx wrangler pages deploy dist --project-name=nong-trai --branch=main`
  (chạy trong `worker/` — nơi wrangler đã login). Site: `https://nong-trai-9u0.pages.dev`.
- Worker (account/social/leaderboard/room): `npm run deploy:worker` —
  `wrangler deploy` trong `worker/`. **Mọi thay đổi trong `worker/src/` phải
  chạy lệnh này sau khi commit**, không thì code mới không lên production.
  Wrangler đã login bằng OAuth của tài khoản quangfortask@gmail.com.

## Backend layout (Worker `nong-trai-account`)

- **KV `DB`** — account records (`acct:…`, `google:…`), session-adjacent keys và
  save blobs (`save:…`, `gsave:…`). Blob-per-key, đúng việc của KV.
- **D1 `nong-trai-db`** (binding `D1`) — friends, duels (một row/duel, inbox và
  outbox là 2 query trên cùng row), search indexes (`handles`, `names`), lb
  (leaderboard), `social_migrated`/`meta` (lazy-migration markers), `duel_results`
  (replay fallback). Schema: `worker/schema.sql` — apply bằng
  `npx wrangler d1 execute nong-trai-db --remote --file=schema.sql`.
  Test dùng `node:sqlite` qua interface `D1Like` trong `worker/src/social.ts`.
- **Durable Object `ROOMS` (RoomMailbox)** — mailbox phòng đấu. POST send/poll/reset
  như cũ + `GET /api/room/ws?code=XXXXXX` mở WebSocket (Hibernation API): backlog
  replay khi connect, mỗi `send` fan-out frame `{k,m}` cho mọi socket. Client
  (`src/core/room.ts`) dùng WS khi mở được, fallback poll 650ms khi không.
- **Cron `17 */6 * * *`** — `scheduled()` xoá duel rows > 7 ngày (inbox live chỉ
  hiển thị 12h gần nhất).

## Optional bindings (code sẵn, chờ kích hoạt trong Dashboard)

- **R2 `REPLAYS`** — duel replay blobs. Enable: Dashboard → R2 → Enable, rồi
  `npx wrangler r2 bucket create nong-trai-replays`, uncomment binding trong
  `wrangler.toml`, deploy lại. Chưa bind thì replay nằm trong `duel_results` (D1).
- **Analytics Engine `ANALYTICS`** — đếm register/login/save/duel_send/duel_accept
  qua `track()` (fire-and-forget). Enable: Dashboard → Workers → Analytics Engine
  → Enable, uncomment binding, deploy lại.
- **Turnstile** — `TURNSTILE_SECRET` qua `wrangler secret put` + `VITE_TURNSTILE_SITE`
  cho frontend. Unset = check tắt hoàn toàn (dev/test không bị ảnh hưởng).

## Free-tier notes

- KV free: ~100k read, **~1k write** mỗi ngày — giữ write tối thiểu: autosave
  chỉ push khi state đổi (`lastPushedSavedAt`), `indexAccount` chỉ ghi khi index
  khác. Không bao giờ viết KV trên đường read.
- D1 free: ~5tr read, ~100k write mỗi ngày — đây là nơi mọi dữ liệu quan hệ nên
  nằm, KHÔNG phải KV blob.
- Smoke test: `npx tsx tools/smoke-worker.ts` — check leaderboard "me" sẽ FAIL
  với account `*@example.com` (bị `isTestEntry` lọt, có sẵn từ trước D1).
