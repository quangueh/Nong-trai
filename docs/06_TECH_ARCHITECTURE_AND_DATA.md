# Tech Architecture And Data

## 1. Engine / Runtime

Khuyến nghị MVP nếu cần đẩy GitHub rồi deploy Cloudflare/Vercel:

- Web/PWA first.
- TypeScript.
- Vite hoặc Next.js cho frontend.
- PixiJS hoặc Phaser cho battle/garden renderer.
- Shared TypeScript package cho gene, battle simulation, config schema.
- Server authoritative cho breeding chính thức và battle online.

Unity 2D vẫn có thể dùng nếu làm app native/WebGL, nhưng không phải đường nhanh nhất để triển khai bằng Cloudflare Workers hoặc Vercel. Nếu mục tiêu là deploy web/mobile qua GitHub, ưu tiên stack web trước.

## 2. Client systems

- `GardenSystem`
- `PlantEntitySystem`
- `CareSystem`
- `GeneticsSystem`
- `MutationSystem`
- `BreedingSystem`
- `PlantCollectionSystem`
- `BattlePreviewSystem`
- `BattleRenderer`
- `RoomClient`
- `NetworkClient`
- `ConfigService`
- `SaveSystem`
- `UIManager`

Recommended monorepo packages:

- `apps/web`: frontend mobile web/PWA.
- `apps/worker-cloudflare`: Cloudflare Worker + Durable Objects.
- `apps/api-vercel`: Vercel API/Functions alternative.
- `packages/shared`: shared types, validators, constants.
- `packages/game-sim`: deterministic breeding/battle logic.
- `packages/config`: base species, traits, skills, formulas.
- `packages/ui`: reusable UI components if using React.

## 3. Backend systems

- `AuthService`
- `PlayerService`
- `PlantService`
- `BreedingService`
- `BattleService`
- `RoomService`
- `RewardService`
- `RandomSeedService`

Recommended backend for realtime room MVP:

- Cloudflare Worker as HTTP/WebSocket entry.
- One Durable Object per room or match.
- D1/Postgres/Supabase for persistent player/plant data.
- KV/R2 optional for config/cache/assets.

Vercel alternative:

- Vercel Functions for HTTP and WebSocket entry.
- Redis/external durable store for room state.
- Postgres for player/plant data.
- Use the same `packages/game-sim` to keep battle logic identical.

## 4. Plant data model

```json
{
  "plantId": "plant_001",
  "ownerId": "player_001",
  "name": "Mầm Gai Sét",
  "generation": 3,
  "baseLineage": ["thornroot", "voltvine"],
  "stage": "mature",
  "level": 8,
  "xp": 120,
  "dna": {},
  "visualGenes": {},
  "combatStats": {
    "hp": 240,
    "attack": 42,
    "defense": 35,
    "speed": 28,
    "skillPower": 51
  },
  "skills": [],
  "traits": [],
  "mutationHistory": [],
  "parents": {
    "a": "plant_parent_a",
    "b": "plant_parent_b"
  },
  "locked": false,
  "createdAt": 0,
  "updatedAt": 0
}
```

## 5. Deterministic random

Cần dùng seed để:

- Có thể debug.
- Có thể replay battle.
- Server và client đồng bộ.

Breeding seed:

```text
hash(parentAId + parentBId + playerId + serverNonce + breedingAttempt)
```

Battle seed:

```text
hash(matchId + plantAId + plantBId + serverNonce)
```

Client không tự tạo kết quả lai chính thức. Server tạo hoặc validate kết quả.

## 6. Config-driven modules

Config cần có:

- Base species.
- Element rules.
- Body parts.
- Skill modules.
- Trait definitions.
- Mutation tables.
- Care actions.
- Battle formulas.
- Reward tables.

## 7. Skill module data

```json
{
  "moduleId": "poison_cloud",
  "delivery": "area",
  "allowedElements": ["poison", "wood"],
  "baseEffects": ["damage_over_time"],
  "powerCost": 18,
  "cooldownRange": [6, 12],
  "scalesWith": ["statusPower", "skillPower"]
}
```

## 8. Trait data

```json
{
  "traitId": "thick_bark",
  "name": "Vỏ Dày",
  "rarity": "common",
  "effects": [
    {
      "type": "damage_reduction",
      "value": 0.08
    }
  ],
  "tags": ["defense", "wood"]
}
```

## 9. Battle snapshot

```json
{
  "snapshotId": "snap_001",
  "plantId": "plant_001",
  "ownerId": "player_001",
  "displayName": "Mầm Gai Sét",
  "stats": {},
  "skills": [],
  "traits": [],
  "elements": ["wood", "electric"],
  "visualGenes": {},
  "powerRating": 512
}
```

## 10. Room API minimum

- `createRoom`
- `joinRoom`
- `leaveRoom`
- `selectPlant`
- `setReady`
- `startBattle`
- `getBattleSnapshot`
- `submitBattleInput`
- `getResult`

## 11. Storage concern

Cây có thể rất nhiều. Cần:

- Giới hạn nursery ban đầu.
- Archive hoặc storage expansion.
- Không lưu bitmap riêng cho mỗi cây.
- Chỉ lưu gene/part/tint/seed rồi render lại.

## 12. Balance safety

Mỗi cây có:

- `powerRating`
- `powerBudget`
- `battleTier`

Phòng đấu tương lai có thể giới hạn:

- Tier C/B/A/S.
- Max power.
- Generation cap.

MVP có thể cho tự do nhưng cảnh báo chênh lệch.
