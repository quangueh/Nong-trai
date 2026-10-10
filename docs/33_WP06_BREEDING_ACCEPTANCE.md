# WP06 — Breeding atelier: acceptance report

Phase: **WP06** — atelier, preview/protocol/confirmation/reveal/result (BRD-01…06).
**Ngày chạy:** 2026-10-10 — `tools/test-breeding-wp06.ts` **28/28**, `tools/test-ui.ts` breeding section.

## BRD-01…06 — actual / evidence / status

| ID | Nhóm | Thực đo | Evidence | Status |
|---|---|---|---|---|
| BRD-01 | H0 | Confirm dialog ghi tên 2 bố mẹ + hậu quả "không thể hoàn tác"; fee trên card trước confirm; settle atomic: ledger ghi đúng 1 dòng "Phí lai", pollen +4 một lần, parents xóa 1 lần, child push 1 lần; breed lần 2 trên cùng pair refuse sạch | `test-ui.ts` confirm-sheet section; `test-breeding-wp06.ts` atomicity + double-spend blocks | **pass** |
| BRD-02 | H0 | Preview trả bảng bps (Σ=10000), `breed` roll qua **cùng** `breedingPreview` (kết quả rarity ∈ bảng); protocol đổi cả fee (×multiplier) lẫn odds (surge↑S) qua cùng call; pity +1/settle, reset theo bậc trúng | `test-breeding-wp06.ts` normalization/roll/protocol/pity blocks | **pass** |
| BRD-03 | H0 | `store.breed` settle trong domain trước khi ceremony chạy — result object mang child, child đã trong `state.plants`, discovery ghi nhận; unmount/skip không mất con (không có settle thứ 2 vì breed là một call đồng bộ) | `test-breeding-wp06.ts` BRD-03 block | **pass** (domain); UI skip-mid-ceremony chưa có test chuyên — ghi nhận rủi ro nhỏ |
| BRD-04 | H1 | Invalid IDs → `"Chọn 2 cây"`, tự lai refuse, immature/battle-locked/thiếu xu/protocol khóa đều refuse **không trừ xu, không đụng plant** | `test-breeding-wp06.ts` reject-path block (8 case) | **pass** |
| BRD-05 | Q | ≥4/5 reviewer hiểu con đổi gì & mất bố mẹ trước xác nhận | Cost panel "⚠ Cây cha mẹ sẽ mất" + confirm body có sẵn; chưa có panel | **blocked** |
| BRD-06 | Q | Reveal ≥8/10, không bắt chờ | Fusion ceremony + mutation report có sẵn; chưa chấm | **blocked** |

## Ghi chú phát hiện trong test

- `breed` → XP thừa hưởng → **breeder lên cấp → +200 leafCoin "Cấp nhà lai tạo"** trong cùng settle: net-balance không phải thước đo fee — ledger mới là bằng chứng đúng.
- Test fixture: `localStorage` shim phải `clear()` giữa các `new GameStore()` — không thì save commit từ block trước kế thừa sang (đúng nỗi "đổi DB mất data" mà contract tests chống).
