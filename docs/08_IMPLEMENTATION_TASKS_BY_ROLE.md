# Implementation Tasks By Role

## 1. Game Designer AI

Làm:

- 5 giống nền.
- 30 trait đầu.
- 20 skill module đầu.
- 10 care actions/items.
- Balance power budget.
- Battle formula.

Done khi:

- Lai tạo có kết quả dự đoán được theo hướng nhưng vẫn bất ngờ.
- Không có skill nào phá game rõ ràng.

## 2. Genetics Programmer AI

Làm:

- DNA model.
- Gene mixing.
- Dominance.
- Mutation tier.
- Skill generation.
- Đọc và triển khai `15_GENE_POWER_BALANCE_DEEP_SPEC.md`.
- Sinh archetype vector, gene package và điểm yếu bắt buộc.
- Tính Genome Budget, Build Value, synergy tax và ECR.
- Viết static validator, forbidden-combo validator và batch simulation với benchmark roster.
- Xuất validation report giải thích chi phí từng gene/module; cây lỗi chỉ reroll module gây lỗi.

## Economy And Shop Programmer AI

- Đọc `16_SHOP_RARITY_SELLING_ECONOMY.md`.
- Triển khai catalog hạt cơ bản, mua hạt và inventory.
- Triển khai LeafCoin ledger bất biến và transaction idempotent.
- Triển khai cultivation level 1-100, XP curve, effective parent level, rarity interpolation bằng basis points, BreederLevel bonus có cap và pity server-side.
- Nối rarity band với gene content validator; rarity cao phải có nội dung tương ứng nhưng không vượt Ranked budget.
- Triển khai sell quote, confirm, pending deletion và undo an toàn.
- Triển khai NPC orders, economic sinks, telemetry và cảnh báo bất thường.

Done khi:

- Không thể duplicate coin bằng retry/reconnect.
- Tỷ lệ hiển thị khớp với tỷ lệ server dùng.
- Cây khóa/favorite/đang battle hoặc breeding không thể bán.
- Có audit record cho mọi cây SSS được tạo hoặc bán.
- Trait inheritance.
- Rarity calculation.

Done khi:

- Lai 2 cây tạo child hợp lệ.
- Cùng cha mẹ có thể ra con khác nhau.
- Kết quả lưu bằng data, render lại được.

## 3. Garden Gameplay AI

Làm:

- Garden slots.
- Plant lifecycle.
- Care actions.
- Stat growth.
- Plant collection.
- Rename/lock/favorite.

Done khi:

- Trồng và chăm cây làm thay đổi stat thật.
- Cây trưởng thành có thể được chọn đi battle/lai.

## 4. Battle Programmer AI

Làm:

- Battle simulation.
- Damage formula.
- Status effects.
- Skill execution.
- AI behavior.
- Battle event log.

Done khi:

- 2 cây đánh tự động đến kết quả.
- Battle deterministic theo seed.
- Có event để client render.

## 5. Multiplayer Backend AI

Làm:

- Room code.
- Join lobby.
- Select plant.
- Ready/start.
- Battle snapshot.
- Server simulation.
- Result/reward.
- Reconnect.

Done khi:

- 2 client đấu bằng mã phòng.
- Server chốt kết quả.
- Client không thể fake damage/winner.

## 6. UI AI

Làm:

- Vườn.
- Chi tiết cây.
- Chăm cây.
- Bộ sưu tập.
- Lai tạo.
- Mutation result.
- Lobby.
- Battle screen.
- Result.

Done khi:

- Người chơi hiểu cây khác nhau ở đâu.
- UI dùng được trên mobile nhỏ.

## 7. Art AI

Làm:

- Modular plant parts.
- Element VFX.
- Battle animations.
- Icons trait/element.

Done khi:

- 20 cây lai nhìn khác nhau rõ.
- Visual phản ánh gene chính.

## 8. QA AI

Làm:

- Test lai tạo.
- Test chăm cây.
- Test battle deterministic.
- Test room.
- Test reconnect.
- Test balance outlier.

Done khi:

- Không có duplicate reward.
- Không có cây NaN/invalid stat.
- Không có battle desync.

## 9. Deployment/DevOps AI

Làm:

- Tạo monorepo GitHub-ready.
- Tạo `apps/web`.
- Tạo `apps/worker-cloudflare`.
- Tạo `packages/shared`.
- Tạo `packages/game-sim`.
- Tạo scripts `dev`, `build`, `test`, `typecheck`.
- Tạo config Cloudflare Workers/Pages.
- Tạo config Vercel alternative nếu cần.
- Viết README deploy.

Done khi:

- Push GitHub có thể deploy frontend.
- Worker backend có thể chạy local.
- Có env example.
- Battle room có đường WebSocket hoặc realtime API rõ.
- Shared game simulation dùng được cả client và server.
