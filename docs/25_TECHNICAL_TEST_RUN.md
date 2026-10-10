# Kết quả kiểm chứng kỹ thuật — 10/10/2026

## Lượt kiểm chứng lần hai (sau khi wire scripts vào package.json)

HEAD lượt này: `1b8cea7` + worktree. **Core 35/35 đạt** (`artifacts/technical-tests/2026-10-10T05-25-21-110Z`), **browser 11/11 đạt** khi chạy riêng `test-audio` sau sửa (`2026-10-10T05-23-16-307Z`); lượt browser toàn nhóm trước đó 10/11 với audio đỏ.

Hai lỗi sản phẩm thật được sửa trong lượt này, không phải sửa test để qua:

1. **`public/sw.js` — navigation 500 ghi đè cached shell** (đã ghi ở dưới). Sửa: chỉ `cache.put("/index.html")` khi `res.ok`, và đưa write vào `e.waitUntil` để worker không bị kill giữa put. `test:pwa` 7/8 → **8/8**.
2. **`src/battle/battleView.ts` — pause/resume là dead cues.** Audio engine thiết kế cặp cue mirrored `pause`/`resume` nhưng `togglePause` không bao giờ phát — pause một trận im lặng. `test-audio` bắt được khi nhánh ascent được đo đúng chỗ (xem sửa harness bên dưới).

Sửa harness `test-audio` (lỗi đo, không phải lỗi game):

- Chờ `.battlefield` (live replay) thay `.stagelive-panel` — panel đó là result overlay, nên toàn bộ phần pause trước đây chạy trên trận đã kết thúc (`togglePause` no-op vì `finished`), và hai lần `__recorded.length = 0` xoá mất `start`/`win`/`reward`/`unlock` đã phát. Giờ pause trong lúc replay sống, slice theo index, và wait thứ hai dùng đúng class result (selector cũ `.stagelive-panel.is-over` không tồn tại trong DOM — burn 150s timeout mỗi lượt; suite 277s → ~117s).
- Fixture arena: `speed=500` (interval 0.4s → nhiều swing trước lượt foe), `attack=40` (foe sống đủ cho combo ≥2), `evasion=0.2` (combo sống nhưng `enemy` cue vẫn bắn được — 0.6 làm foe miss 50%), `powerRating=240` giữ foe yếu. Poll đợi cả `combo` lẫn `enemy` thay vì đọc ngay sau combo (combo xuất hiện ~0.8s, hit của foe sớm nhất ~2.4s).
- Retry tối đa 2 lượt đấu cho phần dư RNG.

Sửa `tools/diag-plan.ts`: thêm `export {}` và bỏ biến thừa — file dùng top-level await nhưng thiếu module marker khiến gate `tsconfig.tools.json` đỏ.

## Phạm vi thực chạy

HEAD tại lượt core chính: `af655749c6b28f7987c8c0c11fbc1064acba523a`. Worktree có thay đổi store/nhiệm vụ từ trước, không phải checkout sạch. Mỗi JSON report có snapshot git status tại lúc bắt đầu; không suy kết quả sang một commit production khác.

Inventory: 136 module TypeScript/JavaScript gồm source, Worker, public và 39 test scripts. Đây là static inventory, không line/branch coverage.

## Core mới nhất

`npm run test:technical`: **34/35 suite/gate đạt**.

Bằng chứng local: `artifacts/technical-tests/2026-10-10T02-39-44-388Z/report.json` và `report.md`.

| Nhóm | Kết quả |
| --- | --- |
| App/tools/Worker typecheck | Đạt cả ba target |
| Production build | Đạt |
| Technical contracts mới | 56/56 case cấp nhóm |
| Schema SQLite mới | 6/6 |
| Rewarded ads mới | 6/6 |
| Service worker mới | 7/8; một lỗi runtime tái hiện được |
| Fuzz | Ba seed 1337, 42, 20261010 × 2.000 thao tác: đạt |
| Các core/integration/DOM suite còn lại | Đạt trong lượt core mới nhất |

Một lượt core trước có lỗi `test-planting`: scrim/Escape, nhưng rerun riêng đạt 71/71. Source cho thấy daily check-in nudge có timer mở sheet ngoài phạm vi test. Đã seed sessionStorage cờ đã hiển thị nhắc điểm danh trong fixture planting; lượt core sau đạt. Không dùng rerun để che lịch sử lần đỏ; chưa tuyên bố đã chứng minh hết flakiness.

## Lỗi sản phẩm đã tái hiện

**PWA: navigation HTTP 500 ghi đè cached shell.**

- Nguồn: `public/sw.js`, nhánh `req.mode === "navigate"`.
- Setup: cache `/index.html` chứa working shell; fetch trả 500 body `outage`.
- Expected: bản working shell không bị thay thế bằng response lỗi.
- Actual: cache `/index.html` thành `outage`; lần offline sau nhận trang lỗi.
- Repro: `npm run test:pwa`.
- Hướng sửa tiếp: chỉ cache navigation thành công, quyết định policy fallback cho HTTP errors và đưa cache-write lifetime vào `waitUntil` khi phù hợp.
- Chưa sửa runtime SW trong lượt xây test; test giữ đỏ để làm regression gate.

## Sửa test/tooling, không sửa game

- `test-audit-fixes.ts`: đúng nguồn type `Stance`, bỏ import/variable không dùng, truyền arena rõ.
- `test-checkin.ts`: bỏ import/variable không dùng, vẫn giữ call kiểm thử.
- `p7-acceptance.ts`: khai báo kiểu return của `page.evaluate`.
- `test-quests.ts`: bỏ `claimedAt` khỏi fixture vì `QuestEntry` hiện không có field đó; giữ các thay đổi nhiệm vụ đang có.
- `test-planting.ts`: tách daily check-in nudge khỏi fixture trồng.
- `test-audio.ts`: bỏ TypeScript cast bên trong chuỗi JavaScript evaluate.
- `test-auth-gate.ts`, `test-exp-animation.ts`, `test-audio.ts`: chặn requests ngoài origin local cho những scenario không kiểm external providers.

Không đổi `worker/src`, không commit/deploy và không thay công thức game.

## Browser

Lượt toàn nhóm có giới hạn 180 giây/suite: `artifacts/technical-tests/2026-10-10T02-30-40-941Z/report.json`.

Lượt toàn nhóm hoàn tất: **7/11 suite đạt**. Đạt: ascent-lifecycle, gamefeel, levelup-ui, prefs, progression-ui, shop-sort, signin-flow. Không đạt: audio, auth-gate, exp-animation, shop-filter.

Lượt đầu tìm được lỗi harness audio `SyntaxError: Unexpected identifier 'as'`; đã sửa cú pháp. Auth gate và XP animation vượt giới hạn 180 giây nên được đánh dấu timeout, không gọi là assertion fail. Shop filter hết thời gian đợi dev handle `window.__game`, chưa tới assertions filter; chưa có căn cứ gọi đây là lỗi filter sản phẩm.

Rerun auth sau chặn request ngoài origin vẫn timeout ở giới hạn 300 giây. Rerun XP vượt qua các case desktop nhưng hết thời gian boot phone context. Đã sửa thêm cách đợi: `domcontentloaded` + điều kiện app sẵn sàng thay vì `networkidle`, và đặt options timeout ở đối số thứ ba của `waitForFunction` theo type definitions Playwright local. Đây là sửa contract harness, không nới assertion gameplay.

Rerun auth sau sửa cách đợi vẫn timeout tại giới hạn chẩn đoán 120 giây. Không khẳng định nguyên nhân duy nhất là request bên ngoài. Browser/dev-server timing cần một lượt isolated trước khi kết luận regression runtime.

Rerun XP sau sửa cách đợi cũng timeout 120 giây. Rerun audio sau sửa cú pháp timeout 300 giây; trước timeout có hai assertion về cue pause/resume không đạt. Đây là quan sát cần tái hiện trong fixture trận ổn định, chưa khẳng định nguyên nhân là audio engine thay vì target/state của test. Các log được giữ nguyên.

Reports rerun: `2026-10-10T02-48-42-875Z` (auth), `2026-10-10T02-49-06-703Z` (XP), `2026-10-10T02-47-48-911Z` (audio), nằm dưới `artifacts/technical-tests`.

Sign-in fixture sau đổi URL parser/hostname được chạy lại riêng: **đạt**, 91.5 giây. Bằng chứng: `artifacts/technical-tests/2026-10-10T02-53-17-197Z/report.json`. Các case cloud load, sign-out, delayed Worker, newer local reload và guest adoption/conflict đều đi qua.

Không coi Chromium emulation là chứng nhận Safari/iPhone. Một suite report FPS không chứng minh performance của bản production trên thiết bị thật.

Các browser suite legacy chưa tất cả hermetic; cần fixture server/env và mock network đồng nhất trong giai đoạn tiếp. Lượt hiện tại dùng Vite server đã có trên 5173 sau khi xác minh source endpoint, không thay env hoặc kill server đó.

## Kiểm tra runner

- `--filter=test-audit-fixes`: một suite được chọn, đạt, report đúng.
- `--filter=test-technical-contracts` với bản runner cuối: đạt, JSON/Markdown và planned/completed đúng; report `2026-10-10T02-53-28-913Z`.
- `--filter=fuzz-store --timeout=1000`: cố tình đặt giới hạn thấp; cả ba process bị timeout, runner vẫn chạy tiếp và trả exit 1. Đây là test cơ chế timeout, không phải kết luận fuzz có bug.
- Reports incremental, có trạng thái planned/completed trong bản runner mới.
- SIGINT/SIGTERM có cleanup process hiện hành, dừng các suite tiếp theo; cần thêm integration test riêng cho mọi platform trước khẳng định teardown hoàn hảo.
- POSIX dùng process group riêng cho suite để timeout không chỉ kill wrapper tsx; chưa kiểm chứng trên runner Linux hosted.
- `git diff --check`: đạt tại lượt kiểm tra.

## Dependency audit

`npm audit --json` báo một advisory **high** ở `source-map-js@1.2.1`, dependency của jsdom/css-tree và Vite/postcss. Advisory mô tả event-loop DoS khi xử lý indexed source map với offset lớn; bản vá 1.2.2. [GitHub advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Đây là phát hiện ở dependency graph tooling, chưa chứng minh website static production có endpoint khai thác được. Chưa chạy `npm audit fix`, chưa thay lockfile. Nên nâng patch có kiểm soát rồi chạy lại typecheck/core/build.

## Chưa kiểm chứng

- GitHub hosted workflow mới chưa được chạy.
- Các chỉnh sửa cuối cách đợi/fixture không được suy thành toàn nhóm browser đã pass; kết quả mỗi lượt có timestamp riêng.
- Không chạy smoke production có ghi account/save/room.
- Chưa test Cloudflare DO thật với hibernation/WebSocket hoặc fault injection R2/AI.
- Chưa có runtime line/branch coverage và mutation score.
- Chưa có production PWA E2E install/update/offline đa tab.
- Các case backlog trong doc 24 không được tính vào số test đã chạy.
