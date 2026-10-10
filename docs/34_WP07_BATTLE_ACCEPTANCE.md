# WP07 — Battle acceptance (BAT-01…08)

Status theo spec `docs/27_ACCEPTANCE_SPEC.md`. Mọi claim đều có suite tự động;
tiêu chí Q (human review) đánh dấu blocked, không tự tuyên bố.

## Suites

| Suite | Loại | Kết quả |
|---|---|---|
| `tools/test-battle-wp07.ts` | domain (Node, không DOM) | **19/19** |
| `tools/test-battle-view.ts` | browser (Playwright, Chromium thật) | **11/11** |
| `tools/test-determinism.ts` (đã có) | seeded replay | pass |
| `tools/test-audio.ts` (battle arc) | browser | pass |

## BAT-01 — một trận, một kết quả, một lần trả

`runAscentStage()` chạy `simulateBattle()` **đúng một lần**, trả thưởng trước
replay, và `replayAs` là snapshot fighter **trước** settle — replay không thể
đưa ra kết quả thứ hai.

- Ải đã clear từ chối đấu lại → không trả thưởng đôi.
- Trận thua settle đúng một lần; ải không mở nhưng vẫn được thử lại.
- Ledger ghi đúng 1 dòng thưởng mỗi trận (cả win/loss/draw).

Domain: `gate`/`refund`/`replayAs`/`nextUnlocked` đều được assert bằng state diff.

## BAT-02 — deterministic

`seed` được ghi vào stage result; `simulateBattle(seed, stances)` tái hiện y
hệt — đã được `test-determinism.ts` (24 seeded battles) và `watchDuel` replay
path chứng minh. Browser side: BAT-05 assert reward ledger line khớp result
banner.

## BAT-03 — HUD không chồng lấn

Trên viewport 390×844 với tên hostile dài nhất registry (68+ ký tự, áp F09 in
place): hai `.battler` card không overlap, các `.skillbtn` không overlap nhau
hay với `.energymeter`/`.phase`/`.clock`/`.combometer`. Đo bằng
`getBoundingClientRect` thật — 3/3 pass.

## BAT-04 — nút skill giữ identity qua tick; bấm là trúng

- `renderSkills()` build nút **một lần**; `refreshSkillBar()` chỉ ghi
  disabled/cooldown/energy — không replace node.
- Test giữ node refs qua ~80 tick (8s) → `document.contains` vẫn đúng toàn bộ.
- Press thật qua listener: **tắt auto-cast** qua nút "🤖 Tự ra chiêu" (auto mặc
  định BẬT — engine claim skill ngay khi hồi nên enabled window < poll
  interval), sau đó poll tối đa 30s tới khi một skill `ready` rồi click — cast
  thành công.

Fixture: foe bred ±40% quanh `powerRating=400`; plant của ta `attack=30` (foe
~800hp → ~30 hit, trận sống quá cửa sổ đo), `defense=8000` (foe không thủng),
`hp=6000`. Energy +4 mỗi hit nên vẫn đủ cost kịp.

## BAT-05 — settle một lần, result dọn dẹp

- Tối đa 1 `.battlefield` tồn tại tại mọi thời điểm.
- Trận kết thúc → `.result-banner` xuất hiện, battlefield dọn sạch.
- Ledger đúng 1 dòng "Thắng trận|Hòa|Tham gia trận" mỗi trận.
- Bấm nút result (đấu tiếp/quay lại) **không** thêm dòng ledger nào —
  `after === before`.

## BAT-06 — replay/replayAs

`replayAs` chứa fighter snapshot trước settle (domain). Duel replay path
(`watchDuel`) chạy cùng seed Worker đã settle — không phải "ý kiến thứ hai".
`interactive:false, hideControls:true` → chỉ giữ nút pause cho người xem.

## BAT-07 — arena/PvP surface

- Quick-match ("Đấu với AI"): foe bred động, cân bằng ±40% powerRating,
  warning khi chênh lực >25% — đã verify bằng browser run.
- Room/duel settle phía Worker + replay seeded — domain + duel replay cover.
- Leaderboard path: `tools/test-social.ts` (đã có) cover trust/anti-cheat.

## BAT-08 — reduced motion + không audio

Context `reducedMotion:"reduce"` + không audio init: trận vẫn chạy tới result,
`.result-banner` có nội dung, outcome ghi vào `battleRecord`. 2/2 pass.

## Human-review criteria (blocked đúng spec)

| ID | Nội dung | Trạng thái |
|---|---|---|
| BAT-03/04 phần Q | Đánh giá mắt người: tên dài, combat readability | blocked — chờ panel |
| BAT-08 phần Q | Reduced-motion readability | blocked — chờ panel |

Phần tự động của cả 3 tiêu chí đều pass.

## Bug phát giác/sửa trong WP07

1. **`test-battle-view` fixture** — foe chết trong ~10s ở atk=80 → nút biến mất
   trước khi probe xong. Fix bằng stats (atk thấp + def tường), không phải bug
   sản phẩm.
2. **Auto-cast default ON** là thiết kế — nhưng làm mọi nút enabled bị engine
   claim trong <1s. Test giờ tắt auto qua nút thật trước khi đo press.
3. Không có bug sản phẩm mới: settle-once, node identity, gate, replayAs đều
   đúng sẵn; suite chứng minh bằng contract test chứ không phải smoke.
