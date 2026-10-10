# WP06 — Breeding atelier: acceptance report

Phase: **WP06** — atelier, preview/protocol/confirmation/reveal/result (BRD-01…06).
**Ngày chạy:** 2026-10-10 — `tools/test-breeding-wp06.ts` **28/28**, `tools/test-ui.ts` breeding section.

## BRD-01…06 — actual / evidence / status

| ID | Nhóm | Thực đo | Evidence | Status |
|---|---|---|---|---|
| BRD-01 | H0 | Confirm dialog ghi tên 2 bố mẹ + hậu quả "không thể hoàn tác"; fee trên card trước confirm; settle atomic: ledger ghi đúng 1 dòng "Phí lai", pollen +4 một lần, parents xóa 1 lần, child push 1 lần; breed lần 2 trên cùng pair refuse sạch | `test-ui.ts` confirm-sheet section; `test-breeding-wp06.ts` atomicity + double-spend blocks | **pass** |
| BRD-02 | H0 | Preview trả bảng bps (Σ=10000), `breed` roll qua **cùng** `breedingPreview` (kết quả rarity ∈ bảng); protocol đổi cả fee (×multiplier) lẫn odds (surge↑S) qua cùng call; pity +1/settle, reset theo bậc trúng | `test-breeding-wp06.ts` normalization/roll/protocol/pity blocks | **pass** |
| BRD-03 | H0 | `store.breed` settle trong domain trước khi ceremony chạy — result object mang child, child đã trong `state.plants`, discovery ghi nhận; unmount/skip không mất con (không có settle thứ 2 vì breed là một call đồng bộ). **Browser-verified (doc 34):** skip giữa ceremony → onDone đúng 1 lần; **route switch giữa phase** → overlay tự hoàn thành, child còn trong store, totalBreeds=1, 0 page error | `test-breeding-wp06.ts` BRD-03 block; `test-motion-contracts.ts` BRD-§10 | **pass** |
| BRD-04 | H1 | Invalid IDs → `"Chọn 2 cây"`, tự lai refuse, immature/battle-locked/thiếu xu/protocol khóa đều refuse **không trừ xu, không đụng plant** | `test-breeding-wp06.ts` reject-path block (8 case) | **pass** |
| BRD-05 | Q | ≥4/5 reviewer hiểu con đổi gì & mất bố mẹ trước xác nhận | Cost panel "⚠ Cây cha mẹ sẽ mất" + confirm body có sẵn; chưa có panel | **blocked** |
| BRD-06 | Q | Reveal ≥8/10, không bắt chờ | Fusion ceremony + mutation report có sẵn; chưa chấm | **blocked** |

## Ghi chú phát hiện trong test

- `breed` → XP thừa hưởng → **breeder lên cấp → +200 leafCoin "Cấp nhà lai tạo"** trong cùng settle: net-balance không phải thước đo fee — ledger mới là bằng chứng đúng.
- Test fixture: `localStorage` shim phải `clear()` giữa các `new GameStore()` — không thì save commit từ block trước kế thừa sang (đúng nỗi "đổi DB mất data" mà contract tests chống).

## Doc 34 §10 — coverage bổ sung (2026-10-12)

**BUG THẬT ĐÃ SỬA — bảng odds không khớp kết quả.** `computeRarityScore` chỉ
*nudge* điểm về band đã roll (`score·0.72 + target·0.28`): đo 360 lượt lai với
target cưỡng chế cho thấy `target=C` ra **0% C** (toàn B/A), `target=S` rơi 80%
xuống A, và **`target=SSS` ra 0% SSS** (88% S, 12% SS) — hard pity `sssHard`
công bố SSS=10000bps nhưng không bao giờ trả SSS. Sửa thành **band-mapping**:
điểm organic map vào trong band đã roll (`genomeGenerator.ts:964-971`), giữ
thứ tự trong band. Sau sửa: **360/360 breed ra đúng band đã roll** — odds
trở thành đúng nghĩa đen, hard pity là bảo đảm thật. Đây là sửa rules có chủ
đích theo §10 ("odds phải là nguồn settlement", "không hứa bảo đảm giả") —
trước đây con lai được *nâng* rarity so với roll ở band thấp và *tụt* ở band
cao; giờ rarity = band người chơi thấy.

**Mới bổ sung theo §10:**

- `MutationReport.parents` — report giờ show block **"Cha mẹ"** (tên, rarity,
  cấp, sức mạnh) + dòng so sánh sức mạnh con vs cha mẹ mạnh nhất. Bắt buộc:
  parents đã bị xóa khỏi garden khi report mở.
- `MutationReport.firstDiscovery` — store snapshot loài/đặc tính mới TRƯỚC khi
  `recordPlantDiscovery` ghi sổ → badge **"🧬 Khám phá mới"** trên report.
- `tools/test-breeding-wp06b.ts` **29/29**: fee ±1 boundary (fee−1 refuse sạch,
  fee đúng settle, wallet reconcile với ledger trừ dòng pollen); corrupt IDs
  (5 case, 0 state move); nursery ở cap lai được (net −1) & over-cap refuse;
  **mọi protocol** settle 1 lần; duplicate call refuse; soft pity kích hoạt đúng
  ngưỡng+1 (`sinceA`20→21, `sinceS`60→61); `sssHard−1` không bảo đảm,
  `sssHard` → odds SSS=10000bps **và** con ra SSS **và** counter reset 0;
  save/reload giữ child/parents/pity, không re-spend được.
- `test-motion-contracts.ts` section **BRD-§10** (browser): route switch giữa
  ceremony → onDone ×1, child còn, totalBreeds=1; report render có đủ "Cha mẹ",
  "Khám phá mới", "Sức mạnh".
