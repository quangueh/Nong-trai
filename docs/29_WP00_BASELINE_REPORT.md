# WP00 — Baseline report

Ngày 10/10/2026. Baseline theo `docs/27` §14 trước khi mở WP01–WP09. Đọc cùng docs 24–28 (28 là track animation song song, tiêu chí MOT-01…14, package M00–M07 xếp chồng lên WP02–WP07).

## 1. HEAD / dirty inventory

| Mục | Giá trị |
| --- | --- |
| HEAD | `0bf89f5` (`test(technical): contract suites, process-isolated runner, CI workflow`) |
| Dirty tại lúc ghi | `docs/26`, `docs/27` (chưa commit — spec), `tools/fixtures.ts` + `tools/verify-fixtures.ts` (WP00, chưa commit), `shots/wp00-f02-garden-mobile.png` |
| Module inventory | 136 modules, 39 test suites — `artifacts/technical-tests/module-inventory.json` (`npm run test:inventory`) |
| Shots archive | 155 ảnh trong `shots/` từ các vòng trước |

Quy ước giữ nguyên: đọc HEAD thực tế trước mỗi WP, giữ thay đổi người khác, commit scoped.

## 2. Fixtures F01–F10 — implementation status

Thư viện: `tools/fixtures.ts` (`applyFixture(page, id)`); verify: `tools/verify-fixtures.ts` (chạy thật trên Chromium + server 5173).

| ID | Loại | Trạng thái | Evidence |
| --- | --- | --- | --- |
| F01 | state | **pass** — 2 cây seed, 250 xu, không helper | verify-fixtures log |
| F02 | state | **pass** — 12 cây đủ 5 giai đoạn, đúng 2 cây care-ready, `autoCareUntil` = now+10min (đo 599s) | verify log + `shots/wp00-f02-garden-mobile.png` |
| F03 | state | **pass** — 24 cây (lai rải rarity/habit), đúng 1 cây `locks.battle` | verify log |
| F04 | state | **pass** — 2 bố mẹ mature, đủ tiền, breederLevel 60 (mọi protocol mở) | verify log |
| F05 | state | **pass** — leafCoin=5, 1 bố mẹ young, nursery 6/6 full | verify log |
| F09 | state | **pass** — tên tới 68 ký tự, leafCoin 9.9 tỷ | verify log |
| F06 | harness | **partial** — determinism đã có (test-battle*, 24 seeded replays trong test-technical-contracts); thiếu named long-fight fixture cho đo VFX | WP07 |
| F07 | harness | **partial** — room state machine đã test offline; thiếu network-fault injection | WP07 |
| F08 | harness | **partial** — conflict/isolation đã test; thiếu delayed-response vs worker thật | WP08 |
| F10 | harness | **partial** — offline/500/quota/ads-blocked đã test; thiếu PWA cài đặt trên thiết bị thật | REL-05 |

Seeds idempotent (`_reset` xóa plants/seeds/autoCareUntil) nên an toàn chạy kế tiếp trên cùng profile; verify vẫn xoá localStorage mỗi fixture để giả lập first-run.

## 3. Device list và điều kiện đo

| Thiết bị | Vai trò | Ghi chú |
| --- | --- | --- |
| Desktop Chromium (Playwright, 1366×768/1920×1080) | Đo chính hiện tại | Đã làm việc |
| Phone emulation 320×740 / 390×844 / 430×932, landscape | Viewport bắt buộc | Bắt đầu bằng fixtures |
| Tablet 768×1024 | Viewport bắt buộc | Chưa có routine |
| iPhone Safari thật | **Gate riêng — chưa có máy** | REL-06: ghi blocked khi thiếu, không quảng cáo đạt |
| Máy yếu hơn mục tiêu | Chưa chốt model | Ghi model/OS khi có |

Đo production trên Pages preview (`nong-trai-9u0.pages.dev` hoặc preview URL mới), không lấy số dev làm kết luận production (doc 27 §2).

## 4. Baseline tests / profile tại HEAD

| Suite | Kết quả | Nguồn |
| --- | --- | --- |
| `npm run test:technical` (core) | **35/35** — typecheck 3 target, contracts, schema, PWA, ads, fuzz ×3, build | report `artifacts/technical-tests/2026-10-10T05-23*` |
| `npm run test:technical:browser` | **11/11** | cùng run + audio rerun sau fix |
| `npm test` (legacy chain) | 33/33 suite xanh (vòng trước) | doc 25 |
| Production smoke (`verify:prod`) | pass trên worker thật | vòng trước |

Baseline performance (dev, headless — chỉ là tham chiếu, chưa phải số production):
- Combat: ~60fps ổn định.
- Garden idle: ~19fps headless do software raster; khi tắt animation đo được ~59fps → cần đo lại trên GPU/device thật trước khi kết luận budget REL-03.
- `prefers-reduced-motion` đã hoạt động.

## 5. Phân loại lỗi cũ (bug register)

Tất cả lỗi đã ghi ở docs 24–25 và phát hiện trong các vòng test gần nhất đều **resolved**:

| Bug | Trạng thái | Commit |
| --- | --- | --- |
| SW cache navigation 500 poison offline shell | fixed + prod verified | `7e744f9` |
| `togglePause` không phát cue pause/resume (dead cues) | fixed | `d037785` |
| test-audio: sai selector/wipe record/combo flaky/backtick | fixed | `d037785` |
| `dayKey()` UTC vs UI local (check-in lệch ngày) | fixed | vòng trước |
| Người làm vườn thuê không tính quest chăm cây | fixed | vòng trước |
| Sheet điểm danh đè trận đấu (11fps ảo) | fixed | vòng trước |
| Growth ladder height đảo ở ~39% registry | fixed — 0/40.000 plan, 0/2.223 measure regressions | `d611e21` |
| Quest chain trùng `enemy_defeated`/`stage_completed`; thiếu bước nuôi; hint không nêu nguồn kiếm hạt | fixed | `e03d41e` |
| verify-prod dùng tên tab cũ + viewport sai | fixed | `1b8cea7` |

Không còn issue nào đang `blocked` hay mở. Danh sách này là nguồn regression cho các WP sau — fixture/test mới phải giữ chúng xanh.

## 6. Scope classification cho WP01–WP09

| WP | Có thể làm ngay | Cần bên ngoài / chưa chốt |
| --- | --- | --- |
| WP01 concept | Có thể tạo concept bằng code/SVG + review | 5 reviewer thật cho tiêu chí Q |
| M00 audit (doc 28) | Map event→FX→owner→cleanup làm được ngay | — |
| WP02 plant grammar | Renderer/LOD/benchmark/code tests làm được | Panel chấm ART-05..07 cần người |
| WP03 garden slice | Làm được | — |
| WP04 gardener | Work-event adapter, actor, path, queue, tests làm được | Sprite atlas đẹp cần asset; review ACT-08/09 cần người |
| WP05 nhạc | Engine (buses/stems/fallback/lifecycle) làm được | **Track/stems original + license cần composer hoặc nguồn licensed — không thể tự khai báo** (AUD-10, nghe ≥15 phút) |
| WP06 breeding | Làm được | Panel BRD-05/06 cần người |
| WP07 battle | Làm được; F06/F07 harness bổ sung được | Panel BAT-06/07 cần người |
| WP08 parity | Làm được | — |
| WP09 release | Perf/a11y/regression làm được | iPhone Safari thật, panel ≥90 |

## 7. WP00 gate

- [x] HEAD/dirty inventory ghi lại
- [x] Fixtures F01–F10 định nghĩa, 6/6 state fixture verify pass
- [x] Device list + điều kiện đo ghi rõ (kể cả phần chưa có)
- [x] Baseline screenshots (`shots/`, `wp00-f02`) + test reports
- [x] Lỗi cũ phân loại — không issue mở
- [ ] Performance profile **production** — hoãn đến khi có preview/device (REL-03)

**Kết luận: WP00 đạt để mở WP01–WP08.** WP09 giữ blocked ở real-device/panel cho tới khi có thiết bị và người chấm.
