# AI Prompts

## Prompt tổng

```text
Bạn đang làm game mobile "Đại Chiến Cây Đột Biến". Game có vòng lặp mua hạt cơ bản, trồng/chăm, lai gene, giữ cây để đấu hoặc bán cây trưởng thành lấy tiền; đây không phải game bán nông sản đồng nhất. Core game là tạo cây chiến binh đột biến gần như độc nhất rồi đem cây đấu online bằng mã phòng. Hãy đọc 00_README_MASTER_PLAN.md trước, sau đó đọc file vai trò liên quan. Ưu tiên hệ thống gene/mutation/battle/economy data-driven. Không tạo danh sách cây cố định hữu hạn.
```

## Prompt Genetics AI

```text
Đọc 02_GENETICS_MUTATION_SYSTEM.md và 06_TECH_ARCHITECTURE_AND_DATA.md. Hãy triển khai DNA model, gene mixing, dominance, mutation tier, trait inheritance, skill generation và rarity calculation. Kết quả lai phải có logic từ cha mẹ nhưng vẫn bất ngờ. Cùng cặp cha mẹ có thể sinh cây con khác nhau nhờ server seed, care history và mutation roll.

Trước khi chốt cây con, bắt buộc đọc `15_GENE_POWER_BALANCE_DEEP_SPEC.md`. Mỗi cây phải được sinh trong Genome Budget của tier, có archetype vector, strength/weakness tags, drawback hoặc condition cho ưu điểm lớn, synergy tax và validation report. Không cho rarity/generation cộng sức mạnh miễn phí trong ranked. Chạy cây qua benchmark simulator để tính ECR; cây không đạt ngưỡng phải sửa hoặc reroll đúng module lỗi.

## Prompt Economy And Shop AI

Đọc `16_SHOP_RARITY_SELLING_ECONOMY.md`, `02_GENETICS_MUTATION_SYSTEM.md` và `15_GENE_POWER_BALANCE_DEEP_SPEC.md`. Hãy triển khai shop chỉ bán hạt cơ bản, LeafCoin ledger, mua hạt, cultivation level 1-100, XP curve, effective level trung bình của hai cây cha mẹ, nội suy tỷ lệ bằng integer basis points, bảng C-B-A-S-SS-SSS có version, BreederLevel bonus có cap, parent/care/catalyst modifier, breeding fatigue, pity, rarity content validator, sell quote/confirm/undo và NPC orders. Mọi roll, giá và giao dịch phải server-authoritative, idempotent, auditable. Không được đồng nhất rarity với sức mạnh Ranked và không cho client gửi coin delta hoặc kết quả roll.
```

## Prompt Battle AI

```text
Đọc 03_PLANT_BATTLE_SYSTEM.md và 04_MULTIPLAYER_ROOM_BATTLE.md. Hãy triển khai battle simulation 1v1 server-authoritative, deterministic theo seed, có skill generated, status effects, trait triggers, damage formula, timeout rules và event log để client render. Không tin client damage hoặc winner.
```

## Prompt UI AI

```text
Đọc 05_UI_UX_MOBILE_SPEC.md. Hãy thiết kế UI mobile portrait cho vườn cây, chi tiết cây, chăm cây, bộ sưu tập, lai tạo, mutation report, tạo/nhập mã phòng, lobby, battle screen và result. UI phải giúp người chơi hiểu cây này độc nhất ở đâu: gene, trait, hệ, kỹ năng, phả hệ.
```

## Prompt Backend AI

```text
Đọc 04_MULTIPLAYER_ROOM_BATTLE.md và 06_TECH_ARCHITECTURE_AND_DATA.md. Hãy làm backend room battle: create room, join by code, select plant, ready, start, snapshot cây từ server DB, simulate battle, broadcast events, reconnect, finalize result, grant reward idempotent. Server phải là nguồn sự thật.
```

## Prompt Deployment AI

```text
Đọc 11_DEPLOYMENT_GITHUB_CLOUDFLARE_VERCEL.md và 06_TECH_ARCHITECTURE_AND_DATA.md. Hãy tạo cấu trúc monorepo có thể push lên GitHub và deploy frontend lên Cloudflare Pages hoặc Vercel, backend lên Cloudflare Workers + Durable Objects. Ưu tiên TypeScript, shared package cho game simulation, schema validation, env vars rõ ràng, và scripts build/test/deploy.
```

## Prompt Growth/Care AI

```text
Đọc 12_GROWTH_POWER_DEEP_SPEC.md và 02_GENETICS_MUTATION_SYSTEM.md. Hãy triển khai cơ chế cây mạnh lên khi trồng/chăm: growth stages, care actions, care memory, stress, mood, stat potential, weighted random stat gain, mutation event, offline progress, server validation. Chăm cây phải làm thay đổi chỉ số thật và tạo khác biệt giữa từng người chơi.
```

## Prompt Battle Control AI

```text
Đọc 13_BATTLE_CONTROL_DEEP_SPEC.md và 03_PLANT_BATTLE_SYSTEM.md. Hãy triển khai hybrid battle: cây tự đánh nền, người chơi có thể đổi stance và kích hoạt skill/ultimate, nếu người chơi mất mạng thì AI tiếp quản. Server tick là nguồn sự thật, client chỉ gửi intent, không gửi damage/winner.
```

## Prompt Skill Leveling AI

```text
Đọc 14_SKILL_LEVELING_DEEP_SPEC.md, 02_GENETICS_MUTATION_SYSTEM.md và 13_BATTLE_CONTROL_DEEP_SPEC.md. Hãy triển khai hệ thống tăng cấp chiêu: skill XP từ battle/care/training, level curve, evolution nodes, stability, power budget, skill inheritance qua lai tạo, server validation và UI feedback.
```

## Prompt QA AI

```text
Đọc 09_QA_TEST_PLAN.md, 12_GROWTH_POWER_DEEP_SPEC.md, 13_BATTLE_CONTROL_DEEP_SPEC.md và 14_SKILL_LEVELING_DEEP_SPEC.md. Hãy test hệ thống lai tạo, chăm cây, render gene, battle deterministic, điều khiển skill, tăng cấp chiêu, phòng đấu mã, reconnect và anti-cheat. Tập trung tìm lỗi khiến cây invalid, battle desync, reward duplicate, skill tăng sai, hoặc mutation phá balance.
```
