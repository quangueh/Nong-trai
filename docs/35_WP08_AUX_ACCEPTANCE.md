# WP08 — Collection / Chợ / Exchange / Orders / Account / Settings (AUX-01…08)

Status theo `docs/27 §11`. Domain contract trong `tools/test-aux-wp08.ts`
(**15/15**); browser-visible halves trong `tools/test-aux-wp08-view.ts`
(**17/17**). Tiêu chí đã được suite khác chứng minh end-to-end thì tham chiếu
thay vì chạy lại.

## Suites

| Suite | Phạm vi | Kết quả |
|---|---|---|
| `tools/test-aux-wp08.ts` | AUX-01, 02, 03 (domain) | 15/15 |
| `tools/test-aux-wp08-view.ts` | AUX-01, 02, 04, 06, 08 (DOM) | 17/17 |
| `tools/test-signin-flow.ts` §6–8 | AUX-05, AUX-07 (E2E, Worker stub) | pass |
| `tools/test-prefs.ts` | AUX-08 (prefs domain) | pass |
| `tools/test-technical-contracts.ts` | AUX-03 (atomic buy/exchange, BigInt) | pass |

## AUX-01 — owned và discovered tách

- Domain: `sell()` cây cuối của một loài → `discovery.species` vẫn giữ loài đó
  (dex = "đã từng mở", không phải "đang có").
- UI: tab "Bộ sưu tập" render card `.dex-gone` với nhãn "Đã mở · hiện không
  còn"; click toast thay vì mở detail cây không còn.
- "Cây của tôi" và "Bộ sưu tập" là 2 tab — chính separation spec yêu cầu.

## AUX-02 — search/filter/pagination đúng và không DOM toàn registry

- `queryCatalogue` page ≤ `perPage` với registry 1005 loài; các trang phân
  hoạch không trùng; sort chạy **trước** slice (page boundary monotone).
- Search accent-insensitive ("la gai" → "Lá Gai").
- Locked filter áp trong query → không có trang rỗng khi pager báo còn.
- Affordable so giá với đúng ví tiền của loài (4 ví, không phải 1).
- Pin `species` → đúng 1 card, kèm gate (không lau locked thành open).
- Browser: `.seed-grid` render ≤24 cards, pager hiện, input search thật thu
  hẹp shelf.

## AUX-03 — mua/quy đổi/giao hàng đúng cost/cap; fail không mất nửa

- Mua quá ví → refuse, không debit/không hạt/không ledger.
- Loài locked → refuse kể cả khi đủ tiền.
- Exchange quá `EXCHANGE_DAILY_CAP` → refuse nguyên, cap không drift, hai ví
  nguyên vẹn.
- Exchange vào `ember` → refuse (ember chỉ kiếm từ chiến đấu); cùng loại tiền →
  refuse.
- `fulfillOrder` với cây không đạt → `ok:false`, không trả thưởng không lấy
  cây.

## AUX-04 — quest pin + back-to-context

- `navigate("lab", { seed })` → chip "🎯 {loài} ✕" + shelf thu về đúng 1 card.
- Bấm chip dismiss → shelf phục hồi đầy đủ, search box vẫn trống cho gõ thật.
- Pin sống ngoài `search` nên không chiếm ô nhập.

## AUX-05 — account A response muộn không ghi account B

- `pull()` chụp `reqToken` + `sessionRev` trước await; response chỉ được ghi
  khi `sessionIsCurrent(rev, reqToken)` — response trễ về session đã đổi → bỏ.
- E2E: `test-signin-flow.ts` §8 — fork guest-vs-account raise `conflict` với
  `guestChoiceOffered()`, resolve đúng hướng.

## AUX-06 — offline/error/retry/pending/empty có trạng thái riêng

- Leaderboard: `unavailable` (không service) → hàng của chính mình + lý do;
  `error` → "Không tải được bảng — sẽ thử lại."; loading → "Đang tải…". Browser
  verify settle vào state thật, không spinner vĩnh viễn, own rows vẫn có.
- Friends panel: signed-out → `.callout` nêu lý do (không phải "Chưa có bạn
  nào"); pending invite → "⏳ đang chờ"; empty → "Chưa có bạn nào".
- Refresh `⟳` là retry thật (`refreshBoards(true)`).

## AUX-07 — save conflict rõ local/cloud, không success giả

- `pull()` so timestamps hai phía; guest fork → `state:"conflict"` +
  `resolveGuestChoice` — quyết định của player, không đoán.
- Push mà server giữ bản mới hơn → `conflict` báo thẳng (không claim synced).
- E2E: §6 (reload giữ local mới hơn cloud), §7 (guest carry-up account mới),
  §8 (fork offered not decided) — `test-signin-flow.ts`.

## AUX-08 — mọi setting có tác dụng kiểm được

| Control | Hiệu ứng verify được |
|---|---|
| Âm thanh on/off | `sfx.muted` + label "Đang tắt" đồng bộ 2 slider |
| Slider hiệu ứng | `sfx.setVolume` → gain live + `nongtrai.volume` persist |
| Slider nhạc nền | `sfx.musicVolume` → stem bus live + key riêng |
| Chuyển động (3 state) | `data-motion` + `nongtrai.motion` + `reducedMotion()` |
| Độ trong suốt (3 state) | `data-solid` + `nongtrai.glass` + CSS blur strip |
| Chất lượng (3 state) | `data-quality` + ambient budget |
| Xoá vườn | `confirm` + reload — reset thật, không placeholder |
| Tài khoản row | mở account sheet thật |

Browser verify: mỗi control đổi `data-*` attr và/hoặc persisted key — không
control nào "cho có". Domain (clamp/persist/system-override) trong
`test-prefs.ts`.

## Không có bug sản phẩm mới

Toàn bộ AUX-01…08 pass trên implementation hiện có — suite này chứng minh
contract chứ không vá bug. Fixture fixes: cây mới `locks.manual=true` (chống
bán nhầm, docs/16 §20), dex sau tab "Bộ sưu tập", glass cycle 3-state.
