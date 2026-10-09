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
  hiển thị 12h gần nhất) + `client_errors` rows > 30 ngày.
- **Smart Placement** (`[placement] mode = "smart"`) — worker tự colocate gần D1,
  bỏ round-trip xuyên vùng mỗi query.
- **`/api/error`** — POST unauth nhận crash report client (cap 2000 chars) →
  D1 `client_errors`. Reporter phía client: `src/core/errors.ts` (≤4 report/load,
  dedupe, chỉ chạy khi có VITE_ACCOUNT_API).

## Optional bindings (code sẵn, chờ kích hoạt trong Dashboard)

- **R2 `REPLAYS`** — duel replay blobs, ĐÃ BOUND (`nong-trai-replays`).
  Read path thử R2 → D1 `duel_results` → KV cũ, nên replay ghi trước khi
  R2 bật vẫn đọc được.
- **Workers AI `AI`** — ĐÃ BOUND (không cần dashboard). `/api/whisper?species=spNNNN`
  sinh 1 câu flavor/lần đầu mỗi loài bằng llama-3.2-3b, cache vĩnh viễn trong
  D1 `species_whispers` (~10k neurons/ngày free; mỗi loài chỉ tốn neurons 1 lần).
- **Analytics Engine `ANALYTICS`** — đếm register/login/save/duel_send/duel_accept
  qua `track()` (fire-and-forget). Enable: Dashboard → Workers → Analytics Engine
  → Enable, uncomment binding, deploy lại.
- **Turnstile** — `TURNSTILE_SECRET` qua `wrangler secret put` + `VITE_TURNSTILE_SITE`
  cho frontend. Unset = check tắt hoàn toàn (dev/test không bị ảnh hưởng).
- **Cloudflare Web Analytics** — `VITE_CF_WEB_ANALYTICS_TOKEN` lúc build; unset =
  không inject beacon (xem `src/main.ts`).

## Frontend (Pages `nong-trai`)

- **PWA**: `public/manifest.webmanifest` + icon SVG/PNG (render từ
  `public/icon.svg`); cài được "Add to Home Screen", display standalone.
- **Service worker** `public/sw.js` — stale-while-revalidate cho same-origin GET,
  navigation fallback về `index.html` khi offline. Chỉ register khi
  `import.meta.env.PROD` (`src/main.ts`) — dev/test không chạy SW.
- **manualChunks** (`vite.config.ts`) — tách `battle`/`render`/`data` khỏi entry
  để `/assets/*` immutable cache chỉ revalidate chunk thay đổi mỗi deploy.
- `index.html` preconnect tới worker origin — tiết kiệm handshake của call đầu.
- **Điểm danh + người làm vườn**: `src/core/checkin.ts` (reward tables,
  deterministic per player-day), `store.claimCheckIn`/`autoCareTick`/
  `autoCareCatchUp` (buff 15p, offline replay từ `lastSeen`), UI `src/ui/checkin.ts`.
- **Ads**: `src/ads/ads.ts` — Google AdSense H5 rewarded (`adBreak`), gated
  `VITE_ADSENSE_CLIENT`; unset = nút QC ẩn ở prod, DEV hiện mô phỏng. Kích
  hoạt: tạo AdSense account → verify domain Pages → set env → rebuild+deploy.

## Free-tier notes

- KV free: ~100k read, **~1k write** mỗi ngày — giữ write tối thiểu: autosave
  chỉ push khi state đổi (`lastPushedSavedAt`), `indexAccount` chỉ ghi khi index
  khác. Không bao giờ viết KV trên đường read.
- D1 free: ~5tr read, ~100k write mỗi ngày — đây là nơi mọi dữ liệu quan hệ nên
  nằm, KHÔNG phải KV blob.
- Smoke test: `npx tsx tools/smoke-worker.ts` — 31/31 xanh (probe account thấy
  rank riêng của mình; board public vẫn lọc `@example.com`/`smoke-*`). GitHub
  Actions `smoke.yml` chạy lại test này mỗi đêm 02:00 UTC + curl Pages — free
  monitoring, đỏ = prod hỏng theo cách test local không thấy.
