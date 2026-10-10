# Rollback record — doc 34 deploy

Ghi theo §21: known-good commit, Pages deployment ID, Worker version, schema
compatibility, SW cache/update policy. Rollback code không phục hồi schema
destructive — pass này **không có schema/data migration nào**, nên rollback là
thuần code.

## Trạng thái hiện tại (sau deploy)

| Thành phần | Giá trị |
|---|---|
| HEAD | `9acdb9b` + perf follow-up (unlocks/lazySvg) — commit cuối trong git log |
| Pages production | `https://nong-trai-9u0.pages.dev` → deployment `562cc9bd` |
| Bundle live | `index-BxYIDbsN.js` (đã curl verify trên cả deployment URL lẫn domain) |
| Worker version | `3f0d6f8a-2217-4ef2-bce2-61d9ae0b0f45` (100%) — `worker/src/` không đổi trong pass này |
| sw.js / manifest | 200 / 200 |

## Known-good trước deploy (điểm quay về)

| Thành phần | Giá trị | Lệnh rollback |
|---|---|---|
| Frontend commit | `33736c7` | `git checkout 33736c7 && npm run build && npx wrangler pages deploy dist --project-name=nong-trai` |
| Pages deployment | `fab06d07-3664-4fc0-b5d4-e1be2b5b45e7` (`https://fab06d07.nong-trai-9u0.pages.dev`, bundle `index-_tdiaPge.js`) | Cloudflare dashboard → Pages → nong-trai → Deployments → Rollback to `fab06d07` (hoặc deploy lại `dist` build từ `33736c7`) |
| Worker | `3f0d6f8a-2217-4ef2-bce2-61d9ae0b0f45` — không đổi | không cần rollback |
| Schema/save | Không migration trong pass này; mọi thay đổi là code/UI/test | save format nguyên vẹn — rollback code không mất data |

## SW cache/update policy

`public/sw.js` cache-first cho asset tĩnh có hash trong tên; `index.html` luôn
fetch network với fallback cache. Rollback frontend an toàn: tên asset đổi theo
content hash nên client mới sẽ kéo đúng file cũ (`index-_tdiaPge.js`) sau một
lần reload index — không cần xóa cache thủ công.

## Schema compatibility note

- `MutationReport` được thêm 2 field (`parents`, `firstDiscovery`) — đây là
  object **transient** trả từ `breedPlants`, không lưu vào save. Rollback an
  toàn.
- `plant.dna`, `state.pity`, `state.discovery`, ledger — không đổi schema.
- Old-save compat đã được bảo chứng bởi suite save/load/migration trong
  `test:technical` + `npm test` (slot/account isolation F08).
