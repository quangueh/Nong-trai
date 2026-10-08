# Brief triển khai AI: Liquid Glass game UI

Đọc `docs/21_LIQUID_GLASS_UX_UI_MASTERPLAN.md` trước. Đây là brief thực thi, không phải yêu cầu chạy toàn bộ các phase ngay khi đọc file.

Đọc thêm `docs/23_BOTANICAL_GLASS_ART_DIRECTION.md`: bổ sung yêu cầu kính cho ô đất/cây/skill, nâng renderer cây và animation, nghiên cứu game tham khảo. Áp dụng thứ tự art-first ở doc 23 trong các phase liên quan; không hiểu “kính chủ yếu navigation/tools” bên dưới là cấm botanical glass trong game art.

## Prompt nền

```text
Bạn đang nâng cấp game Đại Chiến Cây Đột Biến trong repo hiện tại.
Mục tiêu: thế giới thực vật sống động, công cụ Liquid Glass tinh tế,
UX mobile-first cao cấp, desktop thực sự thích nghi.

Nguồn quyết định: docs/21_LIQUID_GLASS_UX_UI_MASTERPLAN.md.
Giữ Vite + vanilla TypeScript/DOM và patterns hiện có.
Đọc HEAD, git diff và feature inventory trước khi chỉnh.
Không revert thay đổi người khác. Không đổi domain, economy, xác suất,
save schema, account policy hoặc network contract để phục vụ UI.

Triển khai đúng phase được giao, không ôm toàn redesign một lượt.
Giữ route/deep link cũ và đủ tính năng đang có ở HEAD thực tế.
Kính chủ yếu cho navigation/tools; dữ liệu dùng nền dễ đọc.
Cây và battle scene là trọng tâm; không landing page, không dashboard card lồng.
Dùng icon Lucide nhất quán, không emoji cho thao tác mới.

Mọi màn hình phải có state: empty, pending, disabled với lý do,
error/retry, success; không chỉ happy path.
Mọi hành động mất tài sản phải rõ hậu quả trước xác nhận.
Preview và eligibility phải lấy từ domain thật.
Không thêm nút tính năng chưa có implementation.

Kiểm tra responsive, focus, safe-area, long Vietnamese names,
solid mode và reduced motion. Không tắt zoom.
Sau mỗi phase: chạy tests liên quan, typecheck/build, chụp app thật,
báo điều đã làm, chưa làm và giới hạn kiểm chứng.
Không tuyên bố mượt iPhone nếu chỉ kiểm tra Chromium emulation.
```

## P0: Khảo sát baseline

```text
Chưa thay UI. Lập feature inventory từ toàn bộ route và các sheet.
Ghi HEAD hash và local changes, giữ nguyên chúng.
Khởi động dev server cổng trống; chụp baseline từ app hiện tại.
Tạo fixture mới chơi/midgame/endgame, gồm cây tên dài và các rarity.
Chạy typecheck/build và các suite UI/logic liên quan.
Chạy lại test:expanim từng lỗi trước đây, không coi kết quả cũ là hiện tại.
Xuất ma trận màn hình × state × domain action × test.
Chỉ đề xuất cấu trúc file sau khi biết coupling và cascade CSS.
```

## P1: Thiết kế trước code

```text
Tạo ba reference riêng rõ, lớn: Vườn mobile 390×844,
Battle mobile 390×844, Lai desktop 1366×768.
Không ghép nhiều màn hình vào một board nhỏ.
Thể hiện đủ cây, navigation, chi phí và controls thật.
Tạo wireflow trồng/chăm và chọn cây/đấu/kết quả.
Thiết kế token/component states và bản solid/reduced-motion tương ứng.
Tách asset môi trường không chứa UI khỏi reference screenshot.
Ghi art manifest: đường dẫn, kích thước, crop, source/license, load strategy.
Không dùng generated mockup như bằng chứng app đã triển khai.
```

## P2: Foundation

```text
Triển khai tokens, primitives, icons, shell năm tab và route mapping.
Giữ arena/ascent/leaderboard là route truy cập được trong mục Đấu.
Tạo sheet/dialog/focus handling, button/input states, safe-area padding.
Thiết lập giảm trong suốt và giảm chuyển động độc lập.
Giữ UI state theo route bằng IDs, không copy Plant làm nguồn sự thật.
Chuyển CSS có kiểm soát; không nối thêm một khối override khổng lồ.
Kiểm tra toàn bộ route/deep link và keyboard trước phase tiếp.
```

## P3: Vườn vertical slice

```text
Làm trọn Vườn, trồng, chăm, detail, Hôm nay, Túi hạt và reward/level-up.
Cây phải xuất hiện rõ trong viewport đầu, toolbar không chồng dock.
Giữ armed-tool và anchoring theo cột nội dung hiện có.
Chăm cây hợp lệ trong tối đa hai lần chạm khi đã thấy cây.
Không đổi thứ tự ô do repaint và không mất focus.
Chụp mobile/desktop/solid/reduced-motion; chạy garden/planting/preferences/
progression/levelup/experience/expanim suites liên quan.
Ghi domain before/after với cùng fixture để chứng minh redesign không đổi logic.
```

## P4: Cây và Lai

```text
Làm Cây của tôi/Bách khoa, filters, detail loài đã mất sở hữu,
picker A/B, protocol, preview, destructive confirmation, reveal/result.
Eligibility dùng domain; mọi protocol giữ đúng hành vi thật.
Không đưa xác suất chưa xác minh thành thông tin bảo đảm.
Giữ lựa chọn khi đóng picker; xử lý cây đã bị tiêu thụ sau cập nhật store.
Skip/reduced-motion luôn đưa tới kết quả đầy đủ, không settle hai lần.
Chạy species/names/protocols/levels và tests UI liên quan.
```

## P5: Đấu

```text
Làm Vượt ải, arena, room/friends, battlefield, HUD, skills,
stance/auto/pause/speed, result, replay và leaderboard.
Scene không blank, cây không crop, damage không đè tên/HP.
Kiểm kê logic social mới tại HEAD trước khi chỉnh arena/result.
Giữ room lifecycle, cleanup, reconnect và settlement semantics.
Replay không cấp thưởng lại hoặc sửa live state.
Chạy core/room/ascent/ascent-life/social và các battle UI tests.
Kiểm tra portrait, landscape và desktop thấp 1366×768.
```

## P6: Chợ và tài khoản

```text
Làm Hạt/Vật tư/Đất/Quy đổi/Đơn hàng, leaderboard còn thiếu,
account/login/link/sync/conflict/settings và các trạng thái mạng lỗi.
Catalogue phân trang; search/filter/quest pin vẫn đúng.
Quy đổi hiển thị tỷ giá/phí/thực nhận/hạn mức từ domain.
Không submit trùng hoặc báo success trước xác nhận.
Giữ auth policy; form có labels/errors/focus thật.
Chạy economy/shop/shop-sort/auth/auth-gate/signin/google/gate
và suites khác đúng vùng thay đổi.
```

## P7: Hoàn thiện và nghiệm thu

```text
Kiểm tra toàn inventory, tất cả viewports trong master plan,
long Vietnamese strings, 200% zoom, keyboard, solid/reduced-motion.
Đo performance và memory; kiểm tra 20 sheet cycles và 10 fights.
Kiểm tra iPhone Safari thật nếu có; nếu không, ghi chưa kiểm chứng.
Tối ưu assets, blur planes, animation và imports.
Dọn CSS cũ chỉ khi đã chứng minh không còn dùng.
Chạy typecheck, build, regression suite; phân biệt baseline failure
với regression mới, không bỏ test để báo pass.
Khởi động preview/dev server cổng trống và đưa URL chơi thử.
Xuất trước/sau screenshots cùng fixture và báo cáo release gate.
```

## Evidence mỗi checkpoint

| Bằng chứng | Nội dung bắt buộc |
| --- | --- |
| Scope | Màn hình/components đã đổi và domain được giữ |
| Feature coverage | Tính năng hiện tại còn đường truy cập; deferred ghi lý do |
| Screenshots | Từ app thật, tên file gồm screen-state-viewport-theme-motion |
| Tests | Lệnh, pass/fail, baseline/regression và chưa chạy |
| Performance | Thiết bị/browser, cách đo, số liệu; không suy từ cảm giác |
| UX walkthrough | Các bước hoàn thành và điểm còn vướng |
| Next gate | Điều kiện đủ để sang phase sau |

Không release nếu còn mất dữ liệu, giao dịch lặp, reward replay, CTA bị che,
route mất hoặc luồng chính không dùng được ở solid/reduced motion.
