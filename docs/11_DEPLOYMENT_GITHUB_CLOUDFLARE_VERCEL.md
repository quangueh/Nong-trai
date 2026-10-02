# Deployment: GitHub, Cloudflare, Vercel

## 1. Mục tiêu triển khai

Game phải có thể:

- Push code lên GitHub.
- Deploy frontend mobile web/PWA tự động khi push.
- Deploy backend/API cho gene, breeding, room battle.
- Chạy được trên điện thoại qua browser.
- Sau này có thể bọc thành app native bằng Capacitor hoặc làm app store build riêng.

MVP nên làm web-first thay vì Unity native nếu mục tiêu chính là Cloudflare Workers hoặc Vercel.

## 2. Kiến trúc khuyến nghị

Ưu tiên: **Cloudflare full stack**

- Frontend: Cloudflare Pages hoặc Worker Assets.
- Backend HTTP: Cloudflare Workers.
- Realtime room: Durable Objects + WebSocket.
- Persistent DB: D1, Postgres ngoài, Supabase, Neon hoặc Turso.
- Config/cache: KV.
- Asset storage: R2 nếu có ảnh/audio lớn.

Lý do:

- Room battle cần một “điểm điều phối” duy nhất.
- Mỗi phòng đấu có thể map vào một Durable Object.
- Durable Object giữ state phòng, WebSocket clients, battle timeline.
- Server là nguồn sự thật cho damage, skill, winner.

Phương án 2: **Vercel frontend + Cloudflare backend**

- Frontend: Vercel.
- Backend realtime: Cloudflare Worker + Durable Object.
- DB: Postgres/Supabase/Neon.

Phù hợp nếu thích workflow/frontend của Vercel nhưng vẫn muốn backend realtime chắc.

Phương án 3: **Vercel full stack**

- Frontend: Vercel.
- Backend: Vercel Functions.
- Realtime: WebSocket Functions.
- Durable room state: Redis/external store.
- DB: Vercel Postgres/Neon/Supabase.

Lưu ý: với Vercel, không nên giữ state trận quan trọng chỉ trong memory của function. Kết nối tương lai có thể không vào cùng instance, nên room state phải nằm trong Redis/external durable store.

## 3. Repo structure

Monorepo đề xuất:

```text
mutant-plant-arena/
  apps/
    web/
      src/
      public/
      vite.config.ts
      package.json
    worker-cloudflare/
      src/
        index.ts
        room-object.ts
        routes/
        ws/
      wrangler.toml
      package.json
    api-vercel/
      api/
      src/
      vercel.json
      package.json
  packages/
    shared/
      src/
        types/
        protocol/
        errors/
        validators/
    game-sim/
      src/
        genetics/
        battle/
        rng/
        formulas/
    config/
      species/
      traits/
      skills/
      care/
      battle/
    ui/
      src/
  docs/
  package.json
  pnpm-workspace.yaml
  turbo.json
  README.md
```

## 4. Package responsibilities

### `apps/web`

Chứa:

- Garden UI.
- Plant detail UI.
- Breeding lab UI.
- Battle room UI.
- Battle renderer.
- PWA manifest.
- Mobile responsive layout.

Không chứa:

- Battle winner logic authoritative.
- Official breeding result generation.
- Secret server seed.

### `apps/worker-cloudflare`

Chứa:

- HTTP API.
- WebSocket upgrade.
- Durable Object room.
- Server-side battle simulation.
- Official breeding result.
- Reward grant.
- Reconnect snapshot.

### `apps/api-vercel`

Chỉ cần nếu muốn deploy Vercel backend alternative.

Chứa:

- HTTP endpoints tương thích.
- WebSocket handler nếu dùng Vercel realtime.
- Redis adapter cho room state.

### `packages/game-sim`

Chứa logic deterministic:

- Seeded RNG.
- Gene mixing.
- Mutation roll.
- Skill generation.
- Battle formula.
- Status effect logic.
- Battle tick simulation.

Quan trọng: package này dùng chung cho client preview và server authority. Server mới là nơi quyết định thật.

### `packages/shared`

Chứa:

- TypeScript types.
- Zod/Valibot schemas.
- Network protocol.
- Error codes.
- Constants.

## 5. Cloudflare deployment

### 5.1 Cloudflare Pages cho frontend

Build settings:

- Root directory: `apps/web`
- Install command: `pnpm install`
- Build command: `pnpm build`
- Output directory: `dist`

Environment variables:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`
- `VITE_BUILD_ENV`

### 5.2 Cloudflare Worker cho backend

Worker responsibilities:

- Route HTTP API.
- Accept WebSocket upgrade.
- Forward room connection to Durable Object.
- Validate auth.

`wrangler.toml` concept:

```toml
name = "mutant-plant-arena-api"
main = "src/index.ts"
compatibility_date = "2026-09-30"

[[durable_objects.bindings]]
name = "ROOM_OBJECT"
class_name = "RoomObject"

[[migrations]]
tag = "v1"
new_classes = ["RoomObject"]

[[kv_namespaces]]
binding = "CONFIG_KV"
id = "replace-with-kv-id"
```

Durable Object mapping:

```text
roomCode -> roomId -> Durable Object id
matchId -> Durable Object id
```

MVP có thể dùng một Durable Object cho cả lobby và battle.

### 5.3 Cloudflare Worker routes

HTTP:

- `POST /auth/anonymous`
- `GET /config/bootstrap`
- `GET /plants`
- `POST /plants/:plantId/care`
- `POST /breed`
- `POST /rooms`
- `POST /rooms/join`
- `POST /rooms/:roomId/select-plant`
- `POST /rooms/:roomId/ready`
- `POST /rooms/:roomId/start`
- `GET /rooms/:roomId/snapshot`

WebSocket:

- `GET /rooms/:roomId/ws`

### 5.4 Durable Object responsibilities

Room Durable Object giữ:

- Room state.
- Player sockets.
- Selected plants.
- Ready states.
- Countdown.
- Battle snapshot.
- Battle seed.
- Battle tick loop.
- Event sequence.
- Last known client ack.
- Final result.

Không nên giữ vĩnh viễn:

- Full plant database.
- Full player account.
- Long-term battle history.

Khi trận kết thúc, Durable Object ghi result về DB.

## 6. Vercel deployment

### 6.1 Vercel frontend

Import GitHub repository vào Vercel.

Build settings:

- Framework: Vite hoặc Next.js.
- Root directory: `apps/web`.
- Build command: `pnpm build`.
- Output: `dist` nếu Vite.

Environment variables:

- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`

### 6.2 Vercel backend alternative

Nếu dùng Vercel backend:

- Dùng Vercel Functions cho API.
- Dùng Redis/external store cho room state.
- Không lưu battle authoritative state chỉ trong memory.

Required external services:

- Redis/Upstash/Vercel Marketplace Redis.
- Postgres/Neon/Supabase.

Room state key design:

```text
room:{roomId}:state
room:{roomId}:players
match:{matchId}:snapshot
match:{matchId}:events
reward:{matchId}:{playerId}
```

Nếu WebSocket reconnect vào function khác:

- Function đọc lại state từ Redis.
- Client gửi `lastSeq`.
- Server gửi events thiếu hoặc full snapshot.

## 7. GitHub workflow

Branches:

- `main`: production.
- `dev`: staging.
- feature branches: preview deployments.

Pull request checklist:

- Typecheck pass.
- Unit tests pass.
- Battle deterministic tests pass.
- Breeding tests pass.
- Build frontend pass.
- Build worker pass.

Recommended commands:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 8. Local development

Run frontend:

```bash
pnpm --filter web dev
```

Run Cloudflare Worker:

```bash
pnpm --filter worker-cloudflare dev
```

Run both:

```bash
pnpm dev
```

Local env:

```text
VITE_API_BASE_URL=http://localhost:8787
VITE_WS_BASE_URL=ws://localhost:8787
DATABASE_URL=...
JWT_SECRET=...
```

## 9. Network protocol

Client -> server messages:

```json
{
  "type": "ROOM_READY",
  "requestId": "uuid",
  "roomId": "room_123",
  "payload": {
    "ready": true
  }
}
```

Server -> client messages:

```json
{
  "type": "ROOM_PATCH",
  "seq": 12,
  "serverTime": 1790000000,
  "payload": {}
}
```

Every realtime message must have:

- `type`
- `seq` for server messages.
- `requestId` for client actions needing ack.
- `serverTime` for authoritative timing.

## 10. Deployment decision

Recommended MVP:

```text
Frontend: Cloudflare Pages or Vercel
Backend: Cloudflare Workers + Durable Objects
DB: Postgres/Supabase/Neon or D1 if simple
Assets: R2 or static frontend assets
```

Why:

- Room battle needs authoritative state.
- Durable Objects map naturally to one room/match.
- Frontend can still be hosted anywhere.

## 11. Production requirements

Before production:

- Auth token validation.
- Rate limits.
- Request schema validation.
- Idempotent reward grant.
- Battle replay seed stored.
- Error logs.
- Analytics events.
- Backup/restore for plant DB.
- Config versioning.

## 12. Acceptance criteria

- Push to GitHub triggers frontend deployment.
- Backend deploys from GitHub or `wrangler deploy`.
- Web client can create account anonymously.
- Web client can create plant.
- Official breeding result is generated server-side.
- Two devices can join room by code.
- Battle result is same on both devices.
- Refresh during battle reconnects to snapshot/result.
- Reward cannot be claimed twice.
