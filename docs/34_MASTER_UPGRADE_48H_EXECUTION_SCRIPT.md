# MASTER SCRIPT: Nâng cấp toàn bộ Nông trại và kiểm chứng trong ngân sách 48 giờ

Ngày soạn: 10/10/2026. Đây là **prompt thực thi cho AI lập trình**, không phải thông báo rằng một phiên chạy 48 giờ đã bắt đầu. Dùng nguyên tài liệu này làm nhiệm vụ; các tài liệu liên kết là đặc tả bổ sung, không thay thế yêu cầu kiểm kê mã hiện tại.

## 1. Lệnh giao việc

Bạn là kỹ sư trưởng, game designer, technical artist, motion designer và QA của dự án Nông trại tại `D:\Nông trại`. Hãy đọc dự án hiện tại, nâng cấp game đến một trải nghiệm trồng cây, chăm cây, lai tạo và chiến đấu đẹp, rõ ràng, sống động, có chiều sâu, rồi kiểm thử có bằng chứng. Không dừng ở việc lập kế hoạch. Triển khai theo các cổng chất lượng dưới đây, giữ dữ liệu người chơi, giữ tính năng đang có và giữ mọi thay đổi của người khác.

Mục tiêu thẩm mỹ: botanical fantasy 2.5D, khu vườn trên mây có cây nhìn thấy rõ, giao diện kính lấy cảm hứng Liquid Glass, chuyển động hữu cơ, nhạc êm và không mệt tai. Không quảng cáo đây là giao diện chính thức của một phiên bản iOS. Kính là ngôn ngữ vật liệu, không phải phủ blur lên mọi thứ. Ba trải nghiệm ưu tiên là Vườn, Lai tạo và Đấu trường; tính năng phụ phải được nâng cấp đồng bộ, không bị bỏ quên.

48 giờ là **ngân sách làm việc dự kiến**, không phải đảm bảo chạy tự động khi ứng dụng đóng, không phải yêu cầu chờ cho đủ giờ, và không phải quyền hạ chuẩn để kịp hạn. Chỉ báo hoàn thành khi đạt nghiệm thu. Nếu thiếu thiết bị, reviewer, asset hoặc quyền phát hành, ghi rõ blocked tại tiêu chí đó, tiếp tục phần độc lập và giao kết quả trung thực.

Không thể bảo đảm tuyệt đối không sót lỗi. Cách chống bỏ sót bắt buộc là: kiểm kê live HEAD, ma trận truy vết tính năng, test âm tính, bằng chứng và kiểm tra chéo trước khi bàn giao. Không lấy danh sách trong tài liệu này làm giới hạn của dự án: phát hiện tính năng mới phải thêm vào ma trận.

## 2. Quy tắc không được phá

1. Đọc `AGENTS.md` thực tế và chỉ dẫn mới nhất của người dùng trước mọi công việc. Khi tài liệu và mã khác nhau, điều tra, ghi quyết định; không sửa mã chỉ để khớp tài liệu cũ.
2. Không reset, checkout đè, xóa hoặc format thay đổi người khác. Ghi `git status --short` trước mỗi package. Nếu có công việc đồng thời, phân quyền file rõ ràng và đọc lại file trước patch.
3. Không viết lại toàn bộ app, đổi framework, thay backend hay đổi schema chỉ vì muốn làm mới giao diện. Dùng cấu trúc TypeScript/DOM/Vite hiện có, các renderer, store, engine và helper đang hoạt động.
4. Domain là nguồn sự thật. Animation, âm thanh, helper, replay, tooltip và UI preview không được tự sinh tiền, XP, cây, thưởng hoặc kết quả trận.
5. Một giao dịch chỉ settle một lần; render lại, skip, back, resume, reconnect và xem replay không được settle lần nữa.
6. Không tăng rarity, đổi giá, pity, cooldown, reward, matchmaking hoặc power formula ngầm trong một PR giao diện. Thay đổi luật phải có đề xuất riêng, số liệu trước/sau, migration nếu cần và phê duyệt.
7. Không đưa secret, token, email người chơi, save thật hay cookie vào log, ảnh và artifact công khai. Fixture dùng tài khoản giả và backend giả.
8. Không gọi smoke production, tạo hàng loạt account thật, phát quảng cáo, dùng Workers AI hay ghi D1/KV thật trong vòng fuzz/soak.
9. Không làm test xanh bằng cách bỏ assertion, tăng timeout vô hạn, bỏ qua lỗi, luôn retry đến khi xanh hoặc sửa fixture thành không đi qua hành vi cần kiểm tra.
10. Không tự chấm UX, nhạc hoặc mỹ thuật thay người thật. Screenshot đẹp không chứng minh animation đẹp; waveform không chứng minh nhạc hay; viewport iPhone trên Chromium không chứng minh Safari thật.
11. Tất cả timer, RAF, observer, event listener, WebSocket và audio node phải có owner và cleanup. Không có global loop mới không ai quản lý.
12. Mọi asset phải có nguồn và quyền sử dụng; không sao chép art, nhạc hoặc sprite của game tham khảo. Không dùng placeholder làm kết quả cuối.

## 3. Điểm xuất phát đã quan sát, phải xác minh lại

HEAD khi soạn là `7cf493a6e44e693602a276dd2da54be450e4b155`. Đây chỉ là mốc đọc, không phải mốc cố định cho phiên AI tiếp theo.

| Phần hiện có | Bằng chứng cần đọc | Cách tiếp tục |
| --- | --- | --- |
| Runner kỹ thuật, inventory, contract/schema/PWA/ads tests | `tools/run-technical-tests.ts`, `tools/inventory-technical-tests.ts`, docs 24 và 25 | Chạy lại HEAD mới; số suite và trạng thái cũ không được dùng làm kết luận mới |
| Baseline và fixtures F01 đến F10 | `docs/29_WP00_BASELINE_REPORT.md`, `tools/fixtures.ts`, `tools/verify-fixtures.ts` | F06/F07/F08/F10 còn phần harness/thiết bị cần bổ sung |
| Người làm vườn và work-event adapter | `src/ui/gardener.ts`, `src/ui/gardenerQueue.ts`, `docs/30_WP04_GARDENER_ACCEPTANCE.md` | Giữ cơ chế post-settle, hoàn thiện art/path/video 24 ô và human review |
| Nhạc procedural bốn stem | `src/audio/music.ts`, `src/audio/audio.ts`, docs 31 và 32 | Đã có cấu trúc mix; còn stress SFX, nghe dài hạn và đánh giá con người |
| Lai tạo và contract settle | `src/ui/screens/breeding.ts`, `src/ui/fusion.ts`, `docs/33_WP06_BREEDING_ACCEPTANCE.md` | Giữ preview cùng nguồn odds; thêm test skip/unmount ceremony và review UX |
| Công việc battle chưa commit lúc đọc | `tools/dbg-battle.ts`, `tools/test-battle-view.ts`, `tools/test-battle-wp07.ts` | Không ghi đè hoặc coi là đã được merge/đã pass; đọc, phối hợp, xác minh trước tích hợp |
| Ảnh review hiện tại | `docs/review/`, `shots/` nếu có | Chụp lại sau sửa; không dùng ảnh cũ làm bằng chứng HEAD mới |

Đọc docs 18 đến 20 để hiểu nghiên cứu logic, docs 21 đến 23 để hiểu art/UX, docs 24 đến 25 để hiểu test, docs 26 đến 28 để hiểu production/acceptance/motion. Các báo cáo 29 đến 33 là kết quả có phạm vi và thời điểm, không phải mọi tiêu chí đều đã pass. Lỗi cũ đã được báo fixed phải thành regression test, không được mặc định vẫn lỗi.

## 4. WP00: kiểm kê toàn bộ trước khi chỉnh

Thực hiện kiểm kê đủ các nhóm dưới đây. Dùng `rg --files`, đọc manifest và import graph, sau đó đọc nội dung từng module production. Sinh một ledger file-by-file: đường dẫn, vai trò, exported API, nơi gọi, trạng thái đọc, rủi ro và test liên quan. Không chỉ đọc entrypoint hoặc CSS rồi tuyên bố đã đọc toàn bộ.

- Root: package/lockfile, tsconfig app/tools, Vite, HTML, env mẫu, ignore rules, AGENTS, workflows và deploy config.
- `src/core`, `src/config`, `src/genetics`, `src/growth`, `src/progression`, `src/quests`, `src/economy`, `src/pve`, `src/battle`: dữ liệu, công thức, mutation, serialization, clock, RNG, settlement.
- `src/ui`, toàn bộ screens/components/sheets/FX, `src/render`, `src/styles.css`, `src/styles/liquid.css`: mount, repaint, identity, layout, interaction, cleanup và renderer.
- `src/audio`, `src/account`, `src/ads`, client room/error/sync: side effects, availability, auth, retries, buses, dedupe, persistence và fallback.
- `worker/src`, schema, wrangler config, worker tests và migrations: endpoint inventory, binding, auth, validation, quotas và storage ownership.
- `public`: SW, manifest, icon, headers, redirects, mọi ảnh/font/audio. Binary dùng manifest/hash/metadata và kiểm tra trực quan hoặc nghe, không giả vờ đọc như source text.
- `tools`: phân biệt automated tests, fixtures, shot tools, diagnostics, scripts ghi production. Đọc suite thực sự trước khi chạy.
- Docs: phân loại spec được duyệt, baseline lịch sử, backlog, acceptance có bằng chứng và kết luận đã lỗi thời.

Xuất baseline: HEAD/dirty list, feature inventory, asset manifest, fixture status, test report, screenshots, event-to-FX ownership map, network endpoint map, storage schema map, dependency risk và bảng bug. Chạy baseline trước sửa; lỗi có sẵn và lỗi mới phải phân biệt.

Mỗi dòng feature có các cột bắt buộc: `featureId`, đường vào UI, source/domain owner, đọc/ghi dữ liệu, state, happy test, negative test, lifecycle test, mobile evidence, acceptance ID, status, evidence path, remaining risk. Không được có dòng chỉ ghi “đã làm” mà không có đường kiểm chứng.

## 5. Ma trận phạm vi: không được bỏ tính năng phụ

Các hàng sau là tối thiểu. Tách tiếp thành từng chức năng thực khi kiểm kê; tính năng phát hiện ngoài bảng phải thêm hàng.

| ID | Bề mặt | Kiểm tra/nâng cấp bắt buộc |
| --- | --- | --- |
| S01 | First run, chơi khách, đăng nhập | Gate không chặn sai, lỗi mạng dễ phục hồi, giữ save khách, không overlay điểm danh đè trận |
| S02 | App shell/topbar/navigation | Wallet, route đang chọn, back, dock, safe area, refresh route, modal stack, focus, scroll restoration |
| S03 | Vườn/ô đất | Ô trống/khóa/có cây, mở ô, giới hạn slot, chọn một/nhiều, batch thao tác, stage và timer |
| S04 | Hạt giống/trồng | Kho hạt, tìm/lọc/sắp xếp, picker, số lượng, đủ/thiếu hạt, không đủ ô, hủy, trồng một/lô, ID unique |
| S05 | Chăm cây | Mọi action trong config, preview thật, cooldown, không đủ điều kiện, feedback thành công/thất bại, batch không gian lận |
| S06 | Plant detail | Tên dài, giống, rarity, genome, hệ, stats, cấp, kỹ năng, tăng trưởng, cooldown, provenance/lineage nếu dữ liệu có |
| S07 | Quản lý cây | Khóa, đổi tên nếu có, chọn chiến đấu, chọn bố mẹ, bán và xác nhận; lock phải chặn đúng hành vi |
| S08 | Gardener | Thuê/nhận buff, thời hạn, event/queue/path, catch-up, cây bị bán/khóa, hết hạn, route switch, summary |
| S09 | Check-in | Mốc ngày theo policy hiện tại, streak, claim một lần, reward table, timezone/qua nửa đêm, UI mở lại |
| S10 | Lai tạo | Chọn/đổi bố mẹ, eligibility, giá, mất bố mẹ, odds, protocol, pity, preview, confirm, ceremony, skip, result |
| S11 | Loài/bộ sưu tập | Discovered/undiscovered, filters, counters, tìm kiếm dấu tiếng Việt theo behavior đã chọn, detail và scroll |
| S12 | Lab/genetics/protocol | Trait explanations, unlock, upgrade nếu có, benchmark stats, skill level, preview và phí thật |
| S13 | Arena solo | Chọn đấu sĩ, đối thủ, luật, start, readiness, kết quả, retry, rewards và history nếu có |
| S14 | Battle runtime | HP/energy/status/cooldown, skill input, AI, pause/speed/skip theo mode, KO, draw, result, cleanup |
| S15 | Ascent/PvE | Stage chọn/mở/khóa, boss/affix, fail/retry, first-clear/repeat, stage quest, replay đầu vào đúng |
| S16 | Room multiplayer | Create/join/code, WS/backlog/poll, timeout/reconnect, reset, host/guest, ready, abandon, duplicate/out-of-order |
| S17 | Friends/search/duels | Inbox/outbox, request/accept/reject nếu có, friend states, handle search, expired duel, replay fallback |
| S18 | Leaderboard | Public/rank riêng, pagination/loading/empty/error, privacy, account filter, ties và refresh |
| S19 | Quests/journey/progression | Objective source, event count một lần, unlock, claim, level up, XP strip, reward summary, generated quests |
| S20 | Shop | Toàn bộ catalog, sort/filter, stock/unlock, quantity, fee/discount/cap, confirm, atomicity, feedback |
| S21 | Exchange/currencies | Công thức, rounding, BigInt boundaries, caps, inverse, không arbitrage, balance display và ledger |
| S22 | Settings | Music/SFX/ambience nếu có, mute, motion, quality, language behavior hiện tại, persisted prefs và defaults |
| S23 | Accounts/sync | Email/Google, session/logout, local/cloud conflict, delayed response, account isolation, corrupt/old save |
| S24 | Rewarded ads | Configured/unset, DEV simulation, viewed/dismissed/no-fill/error, duplicate callback, reward một lần |
| S25 | PWA/offline/update | Install, icons, standalone/safe area, offline shell, chunk refresh, cache version, 500 recovery, no private/API cache |
| S26 | Audio/global FX | Unlock gesture, transitions, cue ownership, hidden/resume, no burst, mute/prefs, unavailable fallback |
| S27 | Crash/error UX | Dedupe/cap reporter, sensitive-data filtering, user recovery, no recursive crash reporting |
| S28 | Backend/storage | KV/D1/DO/R2/AI/cron/optional bindings, migrations, authorization, validation và free-tier write budget |
| S29 | Accessibility/device | Keyboard/focus, labels/contrast, reduced motion, text zoom, orientation, touch precision, Safari thật |
| S30 | Build/CI/release | Reproducible install, all discovered suites, production preview, artifact upload, deploy order, rollback và monitoring |

## 6. Lịch làm việc và checkpoint 48 giờ

Thời gian dưới đây là phân bổ, không phải cam kết mỗi phase chắc xong trong số giờ đó. Nếu một gate đỏ, sửa hoặc ghi blocked và đổi lịch, không mang lỗi H0 sang phase phụ thuộc. Tính thời gian thực; không giả lập “đã soak 15 phút” bằng fake clock.

| Khoảng | Package | Đầu ra và điểm kiểm tra |
| --- | --- | --- |
| 00:00–04:00 | WP00 baseline + triage | Đọc/inventory, fixtures, baseline tests, bugs, ảnh, phạm vi có owner; biết điều gì đã làm |
| 04:00–08:00 | Art/UX vertical slice | 3 màn mẫu Vườn/Lai/Đấu + plant contact sheet + tokens; phê bình trực quan trước nhân rộng |
| 08:00–16:00 | Plants/garden/gardener | Grammar cây, stage silhouette, plots, care, path, touch; regression domain xanh |
| 16:00–22:00 | Breeding/genetics/collection | Atelier, genome legibility, odds, ceremony, lineage trung thực, collection và unlock |
| 22:00–30:00 | Battle/PvE/room | HUD, skill motion, seeded replay, network faults, result/teardown, combat balance evidence |
| 30:00–35:00 | Audio + integration | Nhạc/mix, SFX stress, lifecycle; phần nghe dài hạn bắt đầu khi audio ổn định |
| 35:00–40:00 | Parity toàn app | Accounts/social/shop/quests/settings/PWA, accessibility, hostile data và negative paths |
| 40:00–46:00 | Regression/soak/perf | All suites, production preview, real-time soak, route cycles, memory/profile, mobile/Safari review |
| 46:00–48:00 | Fix cuối + nghiệm thu | Re-run affected + full gates, scorecard, remaining blockers, release/rollback plan và handover |

Cứ 2 giờ cập nhật progress ledger; cứ 4 giờ tạo checkpoint gồm diff scope, tests đã chạy, ảnh/video mới, lỗi mới và quyết định. Báo người dùng ngắn gọn trong lúc làm, không im lặng nhiều giờ. Ưu tiên sửa lỗi mất dữ liệu/duplicate settlement trước tăng particles hay thêm species.

Nếu có agent phụ được hỗ trợ, chia theo file ownership: domain/tests, plant art, UI/motion, audio, QA. Không tạo chat mới hoặc nhắn task khác nếu người dùng chưa cho phép. Một owner tích hợp; không hai agent cùng sửa `store.ts`, `styles.css` hoặc battle view mà chưa thống nhất. Không chạy perf khi các agent đang stress CPU.

## 7. Design system và UX toàn app

### 7.1 Ngôn ngữ hình ảnh

- Khu vườn là cảnh chính mở, cây và đất có chất liệu riêng. Nền mây không che silhouette, không phải wallpaper làm cây chìm. Không đưa cả cảnh vào card trang trí.
- Kính dùng trên shell, HUD, sheet, mép plot hoặc hiệu ứng skill phù hợp. Giữ core thân/lá/hoa đủ opaque để nhận dạng. Có highlight viền, lớp trước/sau và sắc độ theo môi trường; không glassify mọi lá.
- Palette có màu lá, màu hoa, đất và điểm nhấn hệ cân bằng; không một màn toàn xanh tím hoặc toàn màu kem. Màu rarity và element phân biệt, có icon/text đi kèm.
- Tạo semantic tokens cho surface/text/border/focus/success/warning/danger/rarity/element/shadow/motion/spacing. Tái sử dụng, không rải giá trị ngẫu nhiên vào từng màn.
- Mặt kính có fallback opaque khi quality thấp hoặc môi trường không hỗ trợ. Mục tiêu tối đa 2 lớp blur lớn đồng thời; profile nếu vượt, không tăng `backdrop-filter` tùy tiện.
- Icon dùng thư viện sẵn hoặc hệ icon hiện có; nút công cụ có icon và accessible name. Không dùng emoji làm asset cây/skill cuối. Không thay renderer code-native đang tốt chỉ vì muốn ảnh raster.

### 7.2 Layout và tương tác

- Desktop lẫn mobile ưu tiên thông tin hành động ngay: cây cần chăm, lựa chọn bố mẹ, kỹ năng sẵn sàng. Không landing page, hero marketing hoặc đoạn text giải thích phong cách trong game.
- Hit target tối thiểu 48 CSS px cho điều khiển chính; glyph có thể nhỏ hơn. Body mục tiêu 16 px, secondary 14 px, caption tối thiểu 12 px. Letter spacing 0; không scale chữ theo viewport width.
- Dock có thể dùng 5 nhóm như masterplan, nhưng toàn bộ 7 route cũ và đường vào tính năng phụ phải còn truy cập được. Viết mapping cũ/mới, kiểm tra deep entry và back. Không tự bỏ một tab để vừa layout.
- Tên dài wrap hoặc ellipsis có cách xem tên đầy đủ; tiền lớn format không đẩy nút khỏi màn. Button giữ chiều cao ổn định trong loading, label đổi và disabled.
- Sheet có title, close, focus trap, Escape khi hợp lệ, focus return, scrim, body scroll và safe-area; không khóa nhầm scroll trang sau đóng. Confirm destructive đặt hậu quả trước CTA.
- Mọi list có empty/loading/error/retry/partial/selected/disabled states phù hợp. Tìm/lọc/sort không reset vô cớ, không repaint làm mất focus/caret/scroll.
- Không render lại toàn HUD mỗi tick nếu mất DOM identity. Dùng update nhỏ tại node cần đổi; đảm bảo các nút skill giữ identity qua 100 tick.
- Touch, mouse, keyboard đều hoạt động; tooltip không là cách duy nhất thấy phí/cooldown. Hover không được resize layout; selected không chỉ dựa màu.
- Kiểm tra portrait và landscape, keyboard mở khi nhập tên, text zoom 200%, safe areas và scroll khi nhiều overlay.

Gate UX: mọi S01–S30 có đường vào đã test; không nội dung/click target bị che; không thao tác chính mất focus hoặc bật modal ngoài ý định. Những thay đổi kiến trúc điều hướng lớn phải review trước nhân rộng.

## 8. Cây, chủng loài và tính cách thị giác

Đọc `plantRenderer.ts`, `plantGeometry.ts`, registry species, genome generator và benchmark traits trước thiết kế. Lập bảng gene/trait thực sự có trong dữ liệu → ảnh hưởng hình học/màu/chuyển động. Không bịa một đặc điểm di truyền chỉ từ hiệu ứng màu.

Tạo ít nhất 8 grammar thị giác dùng trait hiện có: cây thân thẳng; cây bụi phân nhánh; dây leo; rosette/succulent; tán lá rộng; hoa lớn; chùm quả; cây fantasy cấu trúc đặc biệt. Mapping phải deterministic. Nếu cần schema trait mới, đó là thay đổi domain được duyệt, không nhét vào save không version.

- Mỗi grammar khác silhouette, tỷ lệ, điểm neo, phân nhánh, mật độ và idle; không chỉ đổi hue của cùng một cây.
- Stage seed/sprout/young/mature theo dữ liệu thật có tiến trình nhận dạng rõ. Cây lớn không bỗng bé hơn ở bước trưởng thành do bounding-box hoặc camera. Regression growth ladder hiện có phải xanh.
- Lá có mặt trước/sau, thân có độ dày, hoa có khối và quả có attachment. Bóng tiếp đất neo cây với plot. Tránh mỗi phần tử là một viên bóng kính giống nhau.
- Rarity thêm detail có tiết chế; rarity cao không che mất cấu trúc gốc bằng aura. Hệ ảnh hưởng accents và skill language; không mặc định cùng hệ là cùng chủng loài.
- Render ID cho SVG filters/masks/gradients phải unique giữa nhiều instance. Không `Math.random()` trong render khiến cây đổi hình mỗi repaint. Derive pose phase từ ID nhưng genome shape phải stable.
- Kích thước context: thumbnail/list, plot, plant detail và battlefield dùng framing phù hợp; không crop hoa, stem root hoặc fruit do viewBox sai.
- Contact sheet tối thiểu 48 cây, bao phủ 8 grammar, các stage, rarity và hệ thực có, ở 3 kích thước và 3 nền. Ghi seed/ID để tái tạo, chụp cả long names.
- Không nâng cấp bằng cách thêm hàng trăm species na ná. Loài mới phải có identity card: silhouette, grammar, palette, role chiến đấu, skill/gene mapping, rarity, acquisition, balance budget, description và asset license.
- Chỉ thêm giống mới sau khi renderer/config/save compatibility và acquisition được kiểm chứng. Nếu chưa được duyệt gameplay, cải thiện cách thể hiện registry hiện có và đưa roster mới vào đề xuất, không silently activate.

Gate mỹ thuật: đối chiếu ART của docs 27; recognition mục tiêu 85% trên 40 silhouette ở 96 px, review tối thiểu 5 người, điểm vẻ đẹp median >=8/10. Chưa có panel thì ghi blocked, không dùng AI tự đoán “đẹp 9/10”. Gate kỹ thuật: art tests, deterministic render, geometry bounds và stable identity phải pass.

## 9. Vườn, chăm sóc và người làm vườn

### 9.1 Ô đất và cây có trạng thái sống

Thiết kế soil layer, rim/edge, contact shadow và plant layer rõ. Empty plot là nơi có thể trồng; locked plot thể hiện điều kiện mở; care-ready dễ thấy mà không mọi cây cùng nhấp nháy. State không dựa chỉ màu: icon, label ngắn hoặc meter có nghĩa thật.

Chăm cây phổ biến hoàn tất trong tối đa 2 tap từ cây đang nhìn thấy, không tính xác nhận destructive. Preview lấy từ domain, không tính riêng trong UI. Thành công phản hồi P95 <=100 ms trên thiết bị đo xác định; animation dài không được trì hoãn save hoặc trạng thái thật.

Batch care/trồng có kết quả per-item, bỏ qua cây không đủ điều kiện theo policy thật và tổng kết đúng. Không giảm tiền cho item fail; không gọi cùng action hai lần vì re-render. Với nhiều plot, viewport/camera responsive giữ mục tiêu chạm ổn định, không để cây phủ nút của ô bên cạnh.

### 9.2 Actor làm thay, không chỉ có biểu tượng tự động

Giữ người làm vườn hiện có làm mặc định. Art cuối phải nhìn rõ đầu/thân/chân, dụng cụ và hướng làm việc ở mobile; không thêm tùy chọn thú nuôi chưa có asset hoặc behavior hoàn chỉnh. Nhân vật là reenactment của domain work-event, không thực hiện chăm lần thứ hai.

- State cần phân biệt arrive/idle/select/walk/face/work/acknowledge/leave/hidden; có thể map vào tên state hiện tại, không buộc rewrite vì tên khác.
- Mỗi action thành công sinh đúng một event sau settle. Reject/cooldown/locked/expired không sinh event thành công. Event không persist vào save và listener lỗi không làm tick domain fail.
- Queue giữ tối đa 4 job chi tiết, age tối đa 8 giây theo spec; overflow/catch-up thành summary. Xác minh hằng số hiện có, thay đổi có test. Không diễn lại hàng phút việc offline.
- Path đi trong hành lang giữa plot, neo chân ở mặt đất, tránh labels/UI. Nếu target bị bán, đổi stage, khóa hoặc biến mất, hủy chuyển động an toàn và xử lý job theo policy, không teleport làm care khác.
- Walk mục tiêu 700–1000 ms cho chặng ngắn, stride ăn khớp tốc độ; quay người trước work; bình tưới/kéo gắn đúng tay; nước hoặc tool effect đúng cây.
- Repaint reattach một actor duy nhất; figure không intercept input. Badge thời hạn và sheet công việc có hit target riêng, summary đúng dữ liệu đã settle.
- Hết buff không care thêm; grant mới wake được; rời route không tăng listener/RAF; hidden/reduced motion không kéo backlog khi trở lại.

Test: event uniqueness, reject zero-event, catch-up source, bounded/dedup queue, action no duplicate reward, 20 route cycles, 24 plots scroll/resize, target removal mid-walk, expiry mid-work, background 5 phút và resume. Ghi video ở 1x và slow-motion; ACT-03 phần path, ACT-08/09 human review không được thay bằng screenshot.

## 10. Lai giống, genome, collection và lab

Atelier phải cho thấy 2 cây thật ở hai phía và vùng kết hợp trung tâm; không hai card nhỏ và một nút khó hiểu. Các panel là thông tin chức năng, không card lồng card. Mobile vẫn nhìn thấy lựa chọn bố mẹ, phí và CTA mà không cuộn tìm nhiều nơi.

- Parent picker filter eligibility bằng rule domain; inactive giải thích lý do: non-mature, locked, thiếu tiền, nursery full, protocol locked, cùng ID hoặc không tồn tại.
- Preview odds dùng cùng `breedingPreview` mà settle dùng, tổng basis points 10000, không UI làm tròn thành xác suất sai. Hiển thị protocol, phí, pity và tác động thật, không hứa guaranteed khi engine không bảo đảm.
- Confirm ghi tên cả hai bố mẹ, giá và hậu quả mất bố mẹ trước CTA. Không đánh giá atomicity qua net-wallet vì level-up có thể thưởng tiền; đối chiếu ledger.
- Breed settle trước ceremony: child, discovery, fee, pollen, pity và parents cập nhật một lần. Skip/unmount/refresh sau settle không mất child hoặc lặp fee. Save phải phản ánh kết quả thật, không phụ thuộc finish animation.
- Ceremony mục tiêu 1600 ms: anticipation, gene exchange, fusion, reveal, settle visual. Gene attribution chỉ highlight khi biết mapping nguồn; otherwise diễn kết hợp trừu tượng, không gán bố/mẹ giả.
- Result cho biết con mới so với parents: loài, trait, stat/role, rarity, skill và discovery thật. Có hành động hợp lý về vườn/xem detail/lai tiếp, không tự chọn nhầm con làm parent khi chưa mature.
- Collection có discovered/unknown states, sort/filter/search, stable counters và plant preview đẹp. Unknown không lộ dữ liệu mà gameplay cố ý giấu.
- Lab giải thích trait/protocol/level bằng copy ngắn gắn tác dụng thực; khóa/mở/phí/progress đúng. Lineage chỉ hiển thị dữ liệu có lưu, nếu muốn thêm lưu lineage phải version schema và test load save cũ.

Test: duplicate clicks, back khi confirm, skip giữa fusion, route switch mỗi phase, corrupt parent IDs, full nursery, fee threshold +/-1, pity threshold, all protocols, 10000-bps invariant và save/reload sau kết quả. Gate BRD H0/H1 xanh; 4/5 reviewer hiểu mất parents và con đổi gì, reveal median >=8/10.

## 11. Combat, skill và balance

Đọc engine/types/skill generator/battle view/controller/room/ascent trước đổi presentation. Lập bảng: event domain → visual clip → sound → HUD update → owner → cleanup. Không phát duplicate FX vì cả engine log và view callback cùng bắt một event.

### 11.1 Arena và battlefield

- Cây hai bên có scale/camera đúng, ground anchor, facing và vùng cast riêng. Bối cảnh hỗ trợ hệ đấu nhưng không làm cây chìm.
- HUD ưu tiên HP, energy, status và skill readiness. Tên dài wrap/collapse có full-name access; không che cây hoặc tràn hai HUD vào nhau.
- Skill button giữ DOM identity qua 100 tick; cooldown update không mất pointer/focus. Disabled nói được thiếu energy/cooldown/lock, click không đủ điều kiện không cast.
- HP text và state đọc domain ngay, bar tween khoảng 220 ms chỉ cosmetic. KO từ event thật, không từ bar animation kết thúc. Shield/heal/damage có ngôn ngữ khác nhau, heal không nhìn như trúng đòn.
- Speed/pause/skip chỉ hiển thị và hoạt động theo quyền mode hiện có. Không pause simulation mạng bằng pause animation local. Không giả input thủ công nếu mode là replay không interactive.
- Result cho thấy outcome, rewards thật, stage/quest progress và đường về. Xem lại replay không nhận thưởng, defeated/stage completed không đếm quest trùng.

### 11.2 Skill grammar

Phân loại các skill thật thành projectile, vine/entangle, burst/area, heal, shield, poison/status, dash/melee, morph/summon nếu engine có. Mỗi loại có anticipation, trajectory/contact, resolve và recovery riêng; không mọi skill là một vòng sáng cùng màu.

Skill projectile bay từ điểm phát đến target đúng; vine có hướng mọc và attachment; shield bám target và lifetime thật; status persist theo engine và hết đúng event; heal mở upward/bloom nhẹ; morph chuyển identity không respawn reward. Dùng element accent vừa đủ, không đổi kết quả damage từ VFX.

Hitstop là cosmetic nhỏ, không dừng clock domain; screen shake rất nhẹ và tắt khi reduced motion. Không shake UI text. Critical phải theo event flag thật, không tự random mỗi frame. Multi-hit phân nhóm để không lấp màn với số sát thương.

### 11.3 Balance không phải tất cả đều 50/50

Đo winrate theo rarity, level, power bands, role, matchup, skill/control mode, stage và seed. Lưu full distribution, time-to-kill, timeout/draw, burst spikes, chain CC, energy starvation và sustain loops. Mirror matchup cùng điều kiện mới dùng mục tiêu gần cân bằng; asymmetric matchup không bắt ép 50%.

Chạy balance report hiện có trước/sau mọi đổi luật. Dùng cùng seeds và roster, có confidence/sample size; không tuyên bố cải thiện từ vài trận đẹp. Không dùng fixture cây siêu mạnh làm bằng chứng balance production. Tăng skill/species chỉ khi role không trùng vô nghĩa và budget có dữ liệu.

Gate: full-log deterministic cùng seed + snapshot, engine không mutate inputs ngoài contract, settle/reward một lần, replay dùng snapshot trước settle, 10 trận UI liên tục không leak, same-seed normal/reduced-motion cùng kết quả. Network faults của room là gate riêng, không thay bằng solo tests.

## 12. Motion nâng cao và lifecycle

Tích hợp đầy đủ MOT-01 đến MOT-14 trong docs 28. Tạo motion ownership registry thay vì thêm rải rác `setTimeout`. Hợp đồng tối thiểu: owner ID, event ID, clip/channel, start time, cancel idempotent và finish-visual idempotent. Finish-visual không gọi domain settlement.

Pose channels tách root locomotion, hit/cast, stem, leaf, flower, fruit. Priority death/morph > cast > hit > care > idle; idle không overwrite cast transform. Pivot lá ở cuống, thân ở gốc; không rotate toàn cây như tấm sticker. Phase idle derive từ plant ID để vườn không sway đồng nhịp.

| Tình huống | Timeline mục tiêu | Điều kiện |
| --- | --- | --- |
| Trồng cây | Tối đa 1450 ms, batch stagger 60–100 ms, tổng <=1.8 s | Chỉ sau domain success; cancel vẫn giữ cây đã trồng |
| Tưới/bón/tỉa | Khoảng 650/550/450 ms | Tool contact và effect đúng action; reject không diễn thành công |
| Fusion | Khoảng 1600 ms | Có skip; result settled không phụ thuộc timeline |
| HUD/XP/level | Short tween, không blocking | Text/ledger thật; không reward lần nữa khi replay |
| Skill/hit/status | Theo domain event và tốc độ playback | Không timer tự kéo dài status vượt lifetime thật |
| Modal/nav | Khoảng 160–240 ms | Stable dimensions/focus, không delay action vô cớ |

Particle ceiling khởi điểm 80/40/16 theo high/medium/low, active rig detail 5/3/1 theo docs 28; đo rồi điều chỉnh có ghi lý do. Particle pool không giữ reference cây đã xóa; offscreen không animation nền vô hạn. Một scheduler dùng chung khi hợp lý, tránh RAF riêng cho từng leaf.

Kiểm thử interruption từng clip: cancel 0/25/50/90%, route change, bán target, resize, hidden, reduced motion, speed change, pause/resume và audio unavailable. Không flash finish rồi replay từ đầu khi resume. Quay video normal và slow-motion cả scene thật, không chỉ demo isolated.

## 13. Âm nhạc thật hay, không chỉ chạy được

Giữ engine procedural bốn stem hiện có nếu phù hợp; procedural hoàn toàn có thể là nhạc cuối **khi nghe thật đạt yêu cầu**, không mặc định bắt thay bằng WAV, cũng không coi code có license là chứng minh âm nhạc hay. Nếu dùng track/stems bên ngoài hoặc tạo mới, cập nhật manifest nguồn/quyền dùng/hash/duration/BPM/loop markers.

Thiết kế sound palette: felt piano, nylon/pluck mềm, pad ấm, mallet nhẹ, bass êm, percussion thưa; không vocal, không hi-hat chói, không kick dồn. Garden Day khoảng 76 BPM, Evening 64–70, Atelier 74–80, Battle 88–98 là định hướng sáng tác; engine mood hiện có không đổi tempo bằng cách tạo duplicate scheduler.

- Có motif nhận diện và biến thể hòa âm, khoảng thở; không loop vài nốt đơn điệu rồi gọi “chill”. Battle tăng pulse/tension nhưng vẫn nghe rõ action và không căng quá.
- Buses music/SFX/ambience/master có owner; mỗi scene chỉ một music scheduler. Mute/prefs persist độc lập theo UI hiện có; nếu thêm ambience setting phải tích hợp đầy đủ.
- Audio chỉ unlock sau gesture; unavailable/blocked vẫn chơi được. Hidden stop hoặc suspend theo policy, resume không backlog burst. Pause combat có cue nhưng không unlock context ngoài ý định.
- Crossfade 2–4 s hoặc musical boundary phù hợp; stems aligned nếu dùng recorded assets. Stop cắt scheduling và giải phóng sources; presets không alias object bị mutate.
- SFX tool/cast/hit/KO/rare/level-up có nhận diện khác nhau, dedupe event. Duck khoảng 2–3 dB khi cần; không cue reward ở replay một lần nữa.
- Mục tiêu peak <0.95 full scale cho hỗn hợp, không chỉ music bed. Đo stress music + nhiều skill + level-up + UI. Kiểm tra seam/click bằng render lẫn tai nghe; limiter không phải cách che clipping nguồn.

Test thật 15 phút Garden và 20 scene transitions, 10 trận liên tục, mute/reload, no AudioContext, failed assets, hidden 5 phút, stop/start nhanh và source bounds. Fake-clock giúp logic nhưng không thay bằng chứng nghe/soak thời gian thực. Panel 5 người: Garden pleasant median >=8/10, fatigue <=2/10; battle >=8/10 và vẫn ra quyết định; >=4/5 nhận motif mà không khó chịu lặp. Chưa có người nghe thì AUD Q blocked.

## 14. Economy, progression và mọi màn còn lại

Tách phần này thành package con theo S17–S24; không dồn “polish phụ” rồi hết giờ bỏ luôn.

- Shop: catalog hiện tại đủ item, sort/filter nhất quán, quantity/fee/cap rõ, purchase atomic, insufficient path không mutation, discount round đúng, large values không overflow.
- Exchange: giữ arithmetic chính xác, test inverse/caps/no-arbitrage, disabled tại boundaries, input paste/invalid/zero/max đều xử lý và không âm tiền.
- Quests/journey: gọi một event cho một fact, source hint dẫn đúng nơi kiếm hạt/tài nguyên, unlock/claim một lần, XP và level-up feedback không chặn trận.
- Check-in: cùng day policy giữa domain/UI, streak và timezone boundary, claim duplicate/reload, helper reward expiry đúng và không phát overlay bất ngờ giữa battle.
- Social: loading/empty/search no-result/error/retry, pending/accepted/expired, inbox/outbox thống nhất, handle/name validation, double accept và replay unavailable có phục hồi.
- Leaderboard: rank riêng khác public filter hợp lý, long names/large scores, paginate và retry giữ state, không lộ trường riêng.
- Settings: mọi toggle thực sự tác động và persist; quality/reduced motion không đổi gameplay; mute không tự bật sau route switch.
- Ads: unset production ẩn đúng, DEV simulation ghi rõ, viewed thưởng đúng một lần, dismissed/no-fill/script-fail không thưởng và không khóa UI mãi.
- Account: login/logout/Google errors/Turnstile config, account switching không rò save; conflict choices giải thích timestamp thực; callback cũ không overwrite account mới.

## 15. Backend, dữ liệu, bảo mật và offline

Không mở rộng backend nếu nâng UI không cần. Khi chạm backend, test các contract bên dưới trước và sau; mọi thay đổi `worker/src/` phải theo quy tắc commit rồi deploy Worker trong AGENTS khi bước phát hành được cho phép.

- KV chỉ account/save blob và khóa phù hợp; không thêm write trên read hoặc poll. Dirty autosave không push state không đổi, indexAccount không ghi index giống cũ.
- D1 dùng cho quan hệ/search/leaderboard/duels. Test schema apply idempotent, keys/indexes, rollback/retry và migration markers. Không xóa bảng production để “làm sạch”.
- Room DO: validate code/payload, backlog ordering, WS fanout, reconnect/dedupe, hibernation và poll fallback 650 ms theo current contract. Không song song WS/poll tạo event duplicate.
- Replays đọc R2 rồi D1 rồi KV legacy theo hiện trạng; missing/corrupt/errors phân biệt và phục hồi, replay cũ vẫn đọc được.
- Workers AI flavor cached không gọi lại mỗi render/hover; test bằng mock, không dùng quota thật. Optional bindings unset không crash.
- Cron boundary/retention, client error cap/dedupe/rate behavior, Analytics fire-and-forget không làm request fail. Không thêm private data vào telemetry.
- Endpoint authorization: unauth, expired token, wrong account, malformed body, overlength fields, unauthorized duel/save access, duplicate request và out-of-order sync. Escape text vào DOM; kiểm tra XSS qua names/handles/whisper.
- Save: old schema/corrupt/partial/quota/storage unavailable, Date/time boundaries, timestamp conflicts, two-tab stale state và logout during sync. UI error không gọi reset save như đường phục hồi mặc định.
- SW: production-only registration, successful shell only, no cache poison từ navigation 500, no caching auth/private/API, version update không mix incompatible chunks. Offline reload đã có cache và first visit offline là hai trường hợp khác nhau.
- Network giả: timeout, 401/403/429/500, delayed success, aborted request, no connection, recovered connection. Retry bounded và idempotent; không biến lỗi thành success toast.

## 16. Fixture, device và evidence matrix

Giữ fixtures hiện có và hoàn thiện harness, không thay live game bằng fake HTML để chụp đẹp.

| Fixture | Nội dung và mục đích |
| --- | --- |
| F01 | Người mới, ít tài nguyên, first-run/gate/empty/unlock |
| F02 | 12 cây đủ stage, care-ready, helper active; garden/actor/care |
| F03 | 24 cây đa dạng, có battle lock; density/path/filter/resize |
| F04 | Parents mature đủ tiền, protocol unlocked; valid breeding |
| F05 | Thiếu tiền, immature, nursery full; invalid paths và zero mutation |
| F06 | Named seeded long fight, status/skill/KO/replay; UI có đủ thời gian đo |
| F07 | Room/social network injection: reconnect, duplicate, timeout, delay |
| F08 | Local/cloud/account-switch conflicts, stale callbacks và save isolation |
| F09 | Tên tiếng Việt 40–68 ký tự, tiền lớn, extreme stats; overflow/readability |
| F10 | Offline/500/quota/audio absent/ads blocked/PWA update |

Viewports bắt buộc: 320×740, 390×844, 430×932, 768×1024, 1366×768, 1920×1080; bổ sung landscape phone. Mọi màn có screenshot portrait nhỏ nhất và desktop; Vườn/Lai/Battle đi qua tất cả viewport. Modal/picker/settings/result chụp riêng, không chỉ full-page bỏ qua nội dung bên trong.

Phải có Safari iPhone thật để kết luận hỗ trợ iPhone: recording model, OS/browser, standalone/browser, touch, audio unlock, safe area, animation, memory pressure và offline update. Thiếu thiết bị thì gate riêng blocked; Chromium emulation vẫn hữu ích nhưng không thay thế.

Evidence filename có HEAD ngắn, fixture, screen, viewport và timestamp; report ghi source/test command, environment, expected/actual và pass/fail. Hash/report từ HEAD cũ không dùng làm bằng chứng bản mới trừ test không bị ảnh hưởng và quyết định tái sử dụng được ghi rõ.

## 17. Quy trình test kỹ thuật và chống flake

### 17.1 Lệnh hiện có cần xác nhận từ package.json

Chạy từng lệnh có log và exit code. Không nối lệnh khiến một lỗi bị che. Không giả các lệnh dưới đây đã chạy trong phiên viết script.

```powershell
git status --short
git rev-parse HEAD
npm run test:inventory
npm run typecheck
npm run test:contracts
npm run test:schema
npm run test:pwa
npm run test:ads
npm run test:technical
npm run test:technical:browser
npm run build
npm run balance
npm run balance:deep
```

Chạy `npm test` một lần cho compatibility legacy; runner discovery là nguồn suite inventory live, không dùng số 36/12 trong báo cáo cũ làm số expected vĩnh viễn. Suite mới untracked phải đọc và xác nhận an toàn trước chạy. Rà tất cả script trong package; script không thuộc default runner vẫn cần owner/gate, hoặc lý do không chạy.

Browser runner hiện kiểm tra `localhost:5173/src/main.ts`; nhiều tool hardcode cổng 5173. Đọc runner và tools trước khởi động server. Nếu cổng đã thuộc user hoặc app khác, không kill; chuẩn hóa BASE_URL có default backward-compatible và test thay đổi đó, rồi dùng cổng khác. Chạy production preview riêng để đo build, không suy performance production từ Vite dev.

Network test dùng mock origin/route như cấu hình CI, không để vô tình chạm worker thật. Mỗi suite fresh context/localStorage khi cần; fixture seed rồi validate ready state. Dùng explicit waits theo state/DOM/response, không tăng sleep để chữa flake. Timeout phải ghi operation đang chờ, ảnh cuối và console/network failures.

### 17.2 Tầng test

1. Static: app/tools/worker typecheck, production build, import/config/schema contract và inventory.
2. Unit/property: genome bounds, RNG determinism, currency, care cooldown, queue, clock, rewards, save/load và idempotency.
3. Integration: store + real domain modules, account mocks, room state machine, schema SQLite qua D1Like, ads callbacks và SW VM.
4. Browser: luồng thật, modal/focus, stable DOM, canvas/SVG nonblank, overlap, route teardown, audio lifecycle và fault injection.
5. Visual/motion: screenshot trước/sau, video 1x/slow-motion, contact sheets, human review và reduced-motion parity.
6. Performance/soak: bounded real-time session, CPU/memory/DOM/audio/network counters, production build và thiết bị cố định.
7. Release: hosted CI nếu chạy được, preview deploy được cho phép, production smoke riêng được cho phép, real-device và rollback readiness.

Mỗi bug thêm minimal regression trước hoặc cùng fix. Fuzz chạy các seeds hiện có và mở rộng ít nhất 5 seeds ×2000 operations cho đường domain đã đổi nếu thời gian cho phép; seed/report phải tái hiện được. Battle full-log nhiều seeds/matchups, không chỉ winner. Không thay audit import reachability bằng tuyên bố coverage: đó không phải statement/branch coverage.

### 17.3 Soak có ngân sách

- 15 phút Garden nghe nhạc thật + helper/care; giữ counters, không chỉ screenshot cuối.
- 20 lần chuyển scene kiểm tra single scheduler/no burst; 20 route cycles kiểm tra listener/DOM cleanup.
- 10 trận UI liên tục ở normal, thêm reduced-motion/no-audio, 100 battle simulations tối thiểu cho deterministic/regression contract; balance batch dùng tool riêng.
- Một phiên tích hợp 2 giờ: garden/care/breed/shop/ascent/room mock/save reload/hidden resume, cadence thao tác hữu hạn. Không gọi ads thật hoặc production API.
- Soak dài hơn chỉ khi có lý do rủi ro và thời gian, không chạy 48 giờ spam vô ích. Dừng soak khi phát hiện mất dữ liệu hoặc runaway requests, lưu repro rồi sửa trước chạy lại.
- Đo heap/DOM/listeners/audio sources/network ở start, 15/30/60/120 phút; GC behavior và warmup phải được ghi, không so raw heap hai thời điểm rồi kết luận leak.
- Test sessions có timeout, cleanup context/server đã tạo, không để process test cần thiết chạy khi bàn giao. Dev server phục vụ người dùng có thể giữ lại có chủ đích và phải ghi URL/ownership.

## 18. Performance, khả năng tiếp cận và quality tiers

Mỗi profile ghi model/device/OS/browser/build/quality/viewport/fixture, warmup và thao tác. Đo ít nhất 3 lần ×60 giây garden dense và battle active, report median và P95, long tasks, input latency, frame distribution, DOM count và network rate. Không chạy cùng full test suite để rồi quy CPU contention thành lỗi game.

Mục tiêu đầu: P95 frame time <=20 ms trên thiết bị mục tiêu đã xác định; interaction P95 <=100 ms; garden DOM ceiling 5000 như ngưỡng điều tra ban đầu, không mục tiêu để tăng node tới đó. Nếu chưa đạt, profile bottleneck trước: repaint, geometry, filters, layout, particles, GC hoặc audio schedule. Số headless software raster không đại diện GPU iPhone.

High/medium/low giảm blur, particle, rig detail và ambient motion, không giảm thông tin chiến đấu hoặc thay gameplay. Auto-quality nếu thêm phải có hysteresis, preference override và không flicker cấp liên tục. Thử low-quality và reduced motion như chế độ sản phẩm thật.

Kiểm tra contrast WCAG AA cho text theo kích thước, visible focus, accessible names, trạng thái không chỉ màu, keyboard order, focus return, zoom 200%, touch và screen-reader labels cho tài nguyên/skill. Không dùng aria-live liên tục mỗi tick HP hoặc timer gây spam. Flash/shake mạnh phải loại bỏ; motion reduction vẫn giữ feedback trạng thái.

## 19. Defect log, traceability và bằng chứng trung thực

Tạo `artifacts/upgrade-48h/` cho reports, screenshot/video, profile và logs; không đưa binary lớn vào Git nếu repo không có policy. Lưu bản tổng hợp đọc được trong docs khi hoàn tất. Tên file có run ID; dữ liệu người chơi phải redacted.

Defect bắt buộc: ID, severity H0/H1/Q, feature ID, HEAD, fixture, steps, expected, actual, frequency, console/network, evidence, root cause, fix files, regression command, retest result và residual risk. Không đánh dấu closed chỉ vì patch đã viết.

Status cho từng tiêu chí: `not-started`, `in-progress`, `pass`, `fail`, `blocked`, `not-applicable`. Pass phải có evidence; blocked phải có dependency và phần đã kiểm chứng; not-applicable phải có lý do xác minh, không là cách giấu feature khó. Test bị skip không tính pass.

Ledger mỗi checkpoint phải có: startedAt/currentAt/timeSpent, current HEAD/dirty, active package, features completed/pending, tests passed/failed/skipped, H0/H1 open, external blockers, evidence mới, next actions và scope decisions. Không ghi các con số ước lượng như đã đo.

Khi sửa file chung, đọc diff cuối xác nhận không mất code người khác. Mọi criterion của docs 27 và MOT của docs 28 có hàng ánh xạ sang feature/package/test/evidence; không chỉ ghi “đã tuân thủ toàn bộ docs”.

## 20. Các cổng nghiệm thu

### Gate A: an toàn dữ liệu và logic

Tất cả H0 trong phạm vi pass: save/account isolation, transactions, care/breed/reward một lần, seeded replay, preview truth, no duplicated quest, room state integrity, auth/privacy và asset rights. Không có known data-loss/duplicate-credit defect. Gate này không được bù bằng điểm thẩm mỹ.

### Gate B: sử dụng và lifecycle

Tất cả H1 trong phạm vi pass: routes/features đủ, layout không overlap ở viewports bắt buộc, responsive actions/focus, teardown, offline failure recovery, audio scheduler/mute, reduced-motion parity, network retries bounded và performance theo thiết bị/điều kiện được ghi.

### Gate C: chất lượng con người

Scorecard 100 điểm: plants/species 20, garden 15, helper 10, music 15, breeding 10, battle 20, consistency toàn app 10. Tối thiểu 5 reviewer, ít nhất 3 người mới; nhiệm vụ đánh giá thống nhất, ghi điểm cá nhân và median, không sửa survey sau xem kết quả.

Điểm đạt tổng >=90/100 và **mỗi nhóm quy về thang 10 phải >=8/10**. Đồng thời recognition/understanding/fatigue criteria riêng của docs 27 phải đạt. Nếu thiếu panel, status là technical-ready / quality-blocked, không “siêu phẩm hoàn tất”.

### Gate D: kiểm thử và phát hành

All discovered mandatory suites pass ở HEAD bàn giao, build/typecheck xanh, regression âm tính có bằng chứng, soak/profile/reduced motion hoàn tất; real iPhone Safari được xác minh hoặc release gate blocked. Hosted CI chưa chạy phải nói chưa chạy. Không đạt chỉ bằng test local rồi tuyên bố production ổn.

## 21. Commit, deploy và rollback có điều kiện

Nếu nhiệm vụ chỉ là triển khai local/review, không tự public release. Nếu người dùng đã cho phép commit/deploy, commit scoped theo package, không gom untracked của người khác. Trước deploy đọc lại AGENTS và config hiện tại.

- Frontend: `npm run build`; xác minh thư mục dist tuyệt đối thực có. AGENTS yêu cầu Pages deploy từ `worker/`; không dùng nhầm `worker/dist` nếu build nằm root. Chốt đường dẫn input đúng trước chạy Wrangler, không đoán từ lệnh mẫu.
- Worker: mọi thay đổi `worker/src/` phải deploy sau commit qua `npm run deploy:worker`, xác minh active version và smoke có giới hạn. Frontend dùng endpoint mới chỉ sau backend compatible đã lên.
- Schema: backward-compatible additive migrations trước code cần cột/bảng mới; remote apply chỉ khi được cho phép, có backup/rollback strategy. Không tự đổi production schema trong test.
- Secrets/bindings/Turnstile/ads/beacon optional phải được verify không in secret. Workers AI/R2 đã có nhưng test vẫn mock để tiết kiệm quota.
- Preview/prod verify chỉ chạy được cho phép; smoke có side effects được ghi trước. Không ghi 1000 save/duel vào free-tier để “stress”.
- Rollback: ghi known-good commit, Pages deployment ID, Worker version, schema compatibility và SW cache/update policy. Rollback code không phục hồi schema destructive hoặc dữ liệu mất; vì vậy không làm destructive migration vô kế hoạch.

Phát hành thành công phải có URL/version/time và post-deploy evidence. Nếu chỉ tạo build/local screenshot, báo đúng là local, không production.

## 22. Bàn giao bắt buộc

Giao một báo cáo ngắn cho người dùng và bộ evidence đầy đủ trong workspace:

1. HEAD/diff scope, file thay đổi, package đã hoàn thành và tính năng mới thực sự có.
2. Feature inventory S01–S30 cùng các hàng phát hiện thêm, không hàng mất owner/test/status.
3. Criterion map của docs 27/28, scorecard và reviewer/device availability.
4. Commands đã chạy, exit codes, suite counts thực tế, failed/skipped/blocked và link report.
5. Screenshots tất cả màn chính/phụ, contact sheets cây, video motion/gardener/battle và audio listening record.
6. Balance trước/sau nếu luật đổi; save compatibility/migration evidence nếu dữ liệu đổi.
7. Performance/soak/audio counters và environment; không FPS/beauty/audio claim không đo.
8. Release/rollback state, URL local/preview/prod đúng, hướng dẫn tái hiện test và lỗi còn lại.
9. Residual risks và việc cần người dùng: review thẩm mỹ, nghe nhạc, iPhone thật, asset/license hoặc quyền phát hành.

Kết luận chỉ chọn một: **đạt toàn bộ gates**, **technical-ready nhưng còn quality/device/release blockers**, hoặc **chưa đạt do lỗi kỹ thuật**. Liệt kê phần thiếu rõ ràng. Không dùng “xong 100%” khi còn H0/H1, skipped tests hoặc panel chưa có.

## 23. Checklist cuối chống bỏ sót

- [ ] Đã đọc và ledger toàn bộ production modules/config/assets; không chỉ UI.
- [ ] Đã kiểm kê HEAD/dirty và giữ mọi thay đổi người khác.
- [ ] Mỗi chức năng live có traceability; routes/màn phụ không biến mất sau redesign.
- [ ] Trồng/chăm/bán/lai/mua/đổi/claim/đấu đều có happy + reject + duplicate + reload tests.
- [ ] Cây đa dạng silhouette, stage/trait/ID stable, không crop hoặc filter collision.
- [ ] Gardener visible, path 24 ô có video, không duplicate care/reward, queue/catch-up bounded.
- [ ] Lai có warning mất parents, preview cùng nguồn, skip/unmount không mất child.
- [ ] Skill distinct, HUD readable, full-log replay deterministic, KO/result settle đúng một lần.
- [ ] Mọi motion/audio/network resource có cleanup và interruption tests.
- [ ] Nhạc nghe thật đủ thời lượng, SFX mixed stress, source/license manifest đầy đủ.
- [ ] Shop/quests/check-in/social/account/ads/settings/collection/lab đã kiểm tra không bỏ vì ít nổi bật.
- [ ] PWA/offline/500/save conflict/quota/account switch không mất dữ liệu.
- [ ] Viewport nhỏ, long names, tiền lớn, landscape, reduced motion, quality thấp, zoom và focus đã test.
- [ ] Performance production/device thật tách khỏi số headless/dev; Safari gate trung thực.
- [ ] Toàn bộ required suites tại HEAD cuối xanh; test failures không bị giấu bởi retry/skip.
- [ ] Score >=90/100, mỗi nhóm >=8/10, tất cả H0/H1 đạt; thiếu panel ghi blocked.
- [ ] Deploy nếu được phép đúng thứ tự/config, không production stress, rollback có record.
- [ ] Bàn giao có evidence/repro/remaining risks, không còn process test cần thiết đang chạy.

**Bắt đầu thực thi từ WP00. Sau kiểm kê, cập nhật lịch theo HEAD và bugs thực tế, rồi triển khai từng vertical slice có kiểm chứng. Không làm lại phần đã tốt chỉ để tạo nhiều diff; dành công sức cho phần chưa đẹp, chưa rõ, chưa ổn định và chưa có bằng chứng.**
