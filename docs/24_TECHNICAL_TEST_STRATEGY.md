# Bộ kiểm thử kỹ thuật chuyên sâu

Ngày khảo sát: 10/10/2026. Áp dụng cho game web, Worker account/social, D1/KV/R2, room và PWA hiện tại.

## 1. Phạm vi và cách đọc kết quả

Đã khảo sát cấu trúc source, đường đi dữ liệu quan trọng và các test hiện có. Công cụ inventory dùng TypeScript AST để đọc import/export của toàn bộ module TypeScript/JavaScript trong `src`, `worker/src`, `public` và các `tools/test-*.ts`.

Inventory không phải chứng nhận đã đọc thủ công mọi dòng, không phải coverage dòng/nhánh và không chứng minh mỗi export được assert. Browser imports trong page, service worker được nạp bằng VM và requests tới runtime Cloudflare cần bằng chứng riêng.

Giữ nguyên thay đổi đang có ở store/nhiệm vụ. Lượt này thêm test/tooling và sửa lỗi khai báo/cú pháp trong test cũ; không sửa runtime Worker, không deploy, không chạy smoke có ghi vào production.

## 2. Lệnh chạy

```powershell
# Toàn bộ inventory module và dependency graph
npm run test:inventory

# Domain, integration local, schema, PWA, ads, ba seed fuzz,
# typecheck app/tools/worker và production build
npm run test:technical

# 11 browser suites hiện có, chạy tuần tự
# Cần Vite của đúng dự án tại localhost:5173 và Chromium đã cài
npm run test:technical:browser

# Hai nhóm trong một lượt, không fail-fast
npm run test:technical:all

# Nhóm test mới độc lập
npm run test:contracts
npm run test:schema
npm run test:pwa
npm run test:ads

# Lọc suite, tăng giới hạn khi cần
npm run test:technical -- --filter=test-social --timeout=300000
npm run test:technical:browser -- --filter=test-audio --timeout=300000
```

Chuẩn bị browser nếu chưa có:

```powershell
node node_modules/playwright-core/cli.js install chromium
npm run dev -- --port 5173 --strictPort
```

Các browser test cũ đang hardcode 5173. Runner không chiếm cổng, không kill server của người dùng và không tự chuyển sang server khác. Nếu cổng đang dùng, xác minh `/src/main.ts` là dự án này. Nếu không đúng, cần refactor URL contract trước khi chạy; không tùy tiện dùng server đang chiếm cổng.

## 3. Runner mới

`tools/run-technical-tests.ts` tự tìm mọi `tools/test-*.ts`. Phân loại browser theo import Playwright; các suite còn lại chạy local. Khi thêm một test dùng remote API nhưng không Playwright phải review inventory và exclusion trước khi chấp nhận pattern này.

- Mỗi suite chạy process riêng: tránh localStorage/module singleton/global mocks rò sang suite khác.
- Chạy tuần tự: tránh tranh tài nguyên browser và làm race khó chẩn đoán.
- Một suite fail không chặn các suite sau.
- Timeout mặc định 300 giây/suite; timeout không được đổi nhãn thành assertion fail.
- Windows timeout kết thúc cây process của suite, gồm browser con; không xóa file hay kill dev server.
- Ghi incremental report sau mỗi suite; có HEAD, dirty state, Node/platform và số suite dự kiến.
- `artifacts/technical-tests/<timestamp>/`: `report.json`, `report.md`, log riêng từng suite.
- Artifacts bị gitignore; kết quả cần chia sẻ lâu dài phải tóm tắt trong tài liệu hoặc tải từ CI.
- `smoke-worker.ts`, `verify-prod.ts`, balance diagnostics và screenshot-only scripts không được tự đưa vào nhóm local.

Giữ `npm test` cũ để không phá workflow hiện có. `test:technical` là đường chạy mới có báo cáo và coverage suite rộng hơn, không phải alias hứa rằng mọi rủi ro đã được kiểm tra.

## 4. Kim tự tháp kiểm thử

| Lớp | Mục tiêu | Công cụ/đường chạy |
| --- | --- | --- |
| Static gates | API/type lệch, source không build | tsc app/tools/worker, Vite build |
| Pure domain | Cùng inputs cùng outputs, giới hạn numeric | deterministic/core/genetics/care/economy |
| State contracts | Giao dịch, conservation, save isolation | GameStore với storage/time giả lập |
| Backend integration | Authority, migration, query, replay | Social thật + KV fake + node:sqlite schema thật |
| Transport/lifecycle | Room intents, fallback, teardown | Room suites local; browser ascent lifecycle |
| DOM integration | Event, modal, dữ liệu đúng UI | jsdom planting/ui/juice |
| Browser | Layout/interaction/auth/animation/audio | Playwright Chromium, fixture từng context |
| PWA | Cache routing, online/offline, update | VM chạy `public/sw.js` thật; real browser E2E còn thiếu |
| Production smoke | Binding/DNS/TLS/runtime khác local | Workflow smoke hiện có; chạy riêng có kiểm soát |

## 5. Test mới đã triển khai

### 5.1 `test-technical-contracts.ts`: 56 case cấp nhóm

- Sáu input mua hạt không hợp lệ: reject và không đổi toàn state.
- Năm boundary số lượng, gồm ngưỡng discount: số dư và số hạt thay đổi chính xác.
- Không đủ tiền: ledger, seed và quest state giữ nguyên.
- Batch planting: seed conservation, capacity, IDs unique, số emit được bounded.
- Lai: same-parent, battle-lock, immature, no-money đều không phá state.
- Lai thành công: hai bố mẹ mất, một con mới, fee đúng một lần, pity tăng một lần; retry ID cũ không đổi state.
- Exchange: toàn bộ cặp hợp lệ × 400 input, so kết quả với BigInt arithmetic độc lập; inverse cost tối thiểu cho 100 mức giá.
- Daily exchange cap giữ qua reload; round trip không sinh lợi.
- Save reload giữ identity/wallet/server timestamp; malformed account save không đọc nhầm account khác.
- Storage quota failure không crash, `saveFailed` hiển thị và hồi phục sau save tốt.
- Bảy care actions: preview không mutate, cooldown refusal không mutate, boundary cooldown -1ms/0ms.
- 24 seed battle ở các stance: full result replay bằng nhau, input không mutate, event seq/time tăng, numeric hữu hạn, một finish.
- Render 24 cây × 3 size: deterministic, không mutate, không NaN/Infinity/undefined trong SVG.

Case cấp nhóm chứa nhiều assert/vòng lặp; không đánh đồng 56 case với số lượng assertion hoặc độ bao phủ toàn bộ input space.

`hpPct` của engine là 0–100, không 0–1. Lai có thể trả breeder level-up reward từ XP kế thừa nên phải assert riêng fee ledger, không giả rằng wallet chỉ giảm fee. Quest có thể commit riêng khiến batch phát hai emit; test pin số emit bounded, không nói runtime đã đạt một commit duy nhất.

### 5.2 `test-schema-contracts.ts`: 6 case

Chạy SQL thật trên SQLite memory: schema idempotent, primary key friendship/duel, inbox/outbox query dùng index, retry replay/whisper unique, rollback marker/index.

SQLite memory không mô phỏng D1 latency, replica, quota hoặc semantics R2. Test rollback chứng minh schema hỗ trợ transaction, không chứng minh code migration đang dùng transaction.

### 5.3 `test-service-worker.ts`: 8 case

VM chạy JavaScript SW thật với cache/network giả: install/activate, cross-origin và non-GET bypass, asset cache miss/hit/revalidate/offline, không cache asset 500, navigation fallback, không poison shell khi navigation 500.

Test cuối hiện phát hiện lỗi runtime thật: navigation lưu response không kiểm tra `res.ok`. Giữ test đỏ để bảo vệ regression sau khi sửa. Chưa sửa SW trong lượt xây test.

VM không chứng minh worker sống đủ lâu để hoàn tất cache write không nằm trong `waitUntil`, không kiểm tra cold-start offline hay update multi-tab. Các mục đó ở backlog E2E bên dưới.

### 5.4 `test-ads-contracts.ts`: 6 case

Chạy source ads thật trong VM; thay Vite env bằng AST transform, không rewrite lifecycle. Assert production chưa cấu hình không reward/load script, viewed=true, dismissed=false, no-fill=false, duplicate callbacks không đổi kết quả, blocked script=false.

Chưa chứng minh SDK Google thật trả callback đúng, chưa bao phủ provider treo không callback hoặc concurrent requests. Không gọi quảng cáo thật để tự tạo lượt xem.

## 6. Bản đồ subsystem và test hiện có

| Subsystem | Suite hiện có / bổ sung | Rủi ro còn cần mở rộng |
| --- | --- | --- |
| RNG/genome/rarity | determinism, species, protocols, names, audit-fixes | Probability calibration với confidence intervals, RNG version migration |
| Care/growth | determinism, levels, experience, checkin, contracts | Clock rollback, resource exhaustion giữa auto ticks, hard cap mọi gene extremes |
| Quest/progression | quests, journey, progression-ui, streak | Main-chain dài, reset ngày, repeat/replay không phát event sai |
| Economy/exchange | economy, contracts, fuzz | Unsafe integer cực lớn, ledger currency attribution, mọi unlock tiers |
| Save/slots | slots, signin-flow, contracts | Storage read throws, corrupted nested fields, partial imports, concurrent tabs |
| Sync/auth client | auth-google, google-token, gate, auth-gate, signin-flow | Delayed A response sau chuyển B, clock skew, lost ACK, local write budget |
| Battle/ascent | determinism, morph, ascent, ascent-lifecycle, audit-fixes | Manual input replay, tất cả status transitions, settlement after navigation |
| Room | room, social | Real DO WebSocket, reconnect backlog dedupe, hibernation, concurrent send |
| Social/D1/R2 | social, schema | HTTP auth router, concurrent accept race, R2 failed put/get, migration recovery |
| Renderer | art, contracts, art-bench diagnostic | Bounding-box every habit/LOD, collision of SVG IDs, visual golden images |
| UI/chrome | ui, planting, feel, prefs, shop/filter/sort | Keyboard/focus isolation, aria, small viewport, long Vietnamese text |
| FX/audio | juice, levelup-ui, exp-animation, audio | No orphan timers, duplicate cue, mute live, reduced-motion settlement |
| PWA | service-worker | Real production install/offline/update multi-tab |
| Ads | ads-contracts | Timeout/provider never done, repeated request and duplicate grants |
| Error/AI/telemetry | Chưa có suite dedicated đầy đủ | Payload bound, dedupe/cap, SQL bind, AI cache, analytics failure non-fatal |

## 7. Ma trận chuyên sâu cần bổ sung tiếp

Các case dưới đây là backlog đặc tả, **không được báo là đã chạy** chỉ vì có tên suite gần giống.

### P0 — Dữ liệu, tài khoản, tiền và quyền hạn

| ID | Kịch bản | Oracle / kết quả bắt buộc |
| --- | --- | --- |
| SAVE-01 | Nạp từng version save cũ còn hỗ trợ | Migrate đúng, không mất cây/tiền, version rõ |
| SAVE-02 | Cắt/truncate JSON ở nhiều vị trí | Recovery được báo, không push fresh state đè cloud chưa đọc |
| SAVE-03 | Nested NaN/negative/unknown IDs/duplicate plant IDs | Policy repair/reject rõ; state hoạt động không crash |
| SAVE-04 | getItem/setItem quota/security exceptions | Không crash boot; RAM-only status không giả saved |
| SAVE-05 | Import A → đổi slot B trong request đang chạy | Response A không ghi B, guest không bị xóa |
| SYNC-01 | Pull chưa xong, người chơi đổi local state | Không silently overwrite local mới |
| SYNC-02 | Push thành công server nhưng ACK mất | Retry không nhân account write hoặc phá mới hơn |
| SYNC-03 | Device clock ±24h, rollback, equal stamp | Conflict policy deterministic, không báo sync giả |
| SYNC-04 | Sign-out bị mạng treo | Teardown bounded, token/slot/grace đúng |
| SYNC-05 | Hai tab đổi tài khoản cùng origin | Không ghi chéo save, storage events được xử lý theo policy |
| AUTH-01 | Token thiếu/sai signature/expired/garbled | 401, không data/write; response không leak token/hash |
| AUTH-02 | Google issuer/audience/expiry/JWKS rotate/error | Fail closed; mock key không gọi Google thật |
| AUTH-03 | Password unicode/length edge/malformed JSON | Validation/error envelope ổn định, throttle có giới hạn |
| AUTH-04 | Turnstile unset/missing/invalid/provider down | Gate đúng cấu hình, không bypass khi enabled |
| ECO-01 | Mọi count/value boundary MAX_SAFE_INTEGER | Không mất precision tạo tiền hoặc seed NaN |
| ECO-02 | Exchange mọi vòng 2–4 loại tiền | Tổng value không tăng, cap theo input value |
| ECO-03 | Failed action full state snapshot | Không trừ nửa chừng hoặc advance quest |
| ECO-04 | Double click giao dịch mất tài nguyên | Một settlement, pending/retry contract rõ |
| DUEL-01 | Account A dùng plant B / client gửi stats giả | Server lấy authoritative save, reject ownership |
| DUEL-02 | Hai accept đồng thời cùng invitation | Một result, state transition và reward policy đúng |
| DUEL-03 | Replay fallback R2 → D1 → KV | Đọc đúng mỗi nhánh, object missing khác binding error |
| DUEL-04 | Invitation expired/declined/done | Không accept lại, inbox/outbox nhất quán |

### P1 — Simulation, transport và vòng đời

| ID | Kịch bản | Oracle / kết quả bắt buộc |
| --- | --- | --- |
| SIM-01 | Same seed/snapshot/intents ở client/server | Full event log equal, không chỉ winner |
| SIM-02 | Serialize → replay → serialize | Không mutate original Plant hoặc reward lần hai |
| SIM-03 | All skills/status/traits, zero/extreme values | No NaN, finite durations, event đúng effect |
| SIM-04 | Hit/death/revive/reflect cùng tick | Order rõ, không double death/finish |
| SIM-05 | Manual focus/stance/cast boundary | Cooldown/energy/intent timing đúng |
| SIM-06 | Pause/speed changes renderer | Không đổi simulation outcome khi inputs logical same |
| PVE-01 | Clear frontier/replay/loss/draw/boss | Reward/attempt/highest/quest event đúng từng nhánh |
| PVE-02 | Navigate/close/unmount trong fight | Không live timer hoặc settlement lặp |
| ROOM-01 | WS mở/chặn/đứt giữa trận | Fallback poll một loop, không double delivery |
| ROOM-02 | Reconnect nhận backlog và frames mới | Dedupe/order giữ; không replay intent hai lần |
| ROOM-03 | DO hibernation/restart + storage TTL | Mailbox còn đúng, socket lifecycle đúng |
| ROOM-04 | Oversize message/bad room/reset/reused code | Validation bounded, isolation giữa rooms |
| CARE-01 | Auto catch-up dài/ngày đổi/buff hết hạn | Bounded work, resource không âm, không catch-up hai lần |
| QUEST-01 | Claim liên tiếp/daily rollover/main-chain dài | Một reward, progression không reset/lặp sai |

### P1 — UI/PWA/accessibility

| ID | Kịch bản | Oracle / kết quả bắt buộc |
| --- | --- | --- |
| UI-01 | Mọi route, Back và deep link nhiệm vụ | Đúng ngữ cảnh, filter/scroll không mất vô cớ |
| UI-02 | Sheet stack, Escape, scrim, Tab/Shift+Tab | Topmost close, focus restore, game không nhận shortcut nền |
| UI-03 | Mua/trồng/chăm/lai/đấu qua UI thật | Result/chi phí khớp store; không test bằng cách chỉ sửa DOM |
| UI-04 | 320/390/430/768/1366/1920px + landscape | Không overflow/crop/CTA che; text tiếng Việt dài |
| UI-05 | Solid/reduced-motion/200% text zoom | Hoàn thành luồng; skip không mất result |
| FX-01 | 20 mở/đóng sheet và 10 trận | Listener/timer/observer counts về baseline |
| PWA-01 | Build thật, install, reload offline | Shell + chunks đủ; không chỉ index có cache |
| PWA-02 | Release N → N+1, nhiều tab đang mở | Không asset mismatch, không mutate save mid-run |
| PWA-03 | 500/404/revalidate/cache quota | Không poison cache; response luôn hợp lệ |
| ADS-01 | Không callback / missing breakStatus / script treo | Promise bounded, no reward và không lock UI mãi |
| ERR-01 | >4 lỗi/deduped lỗi/oversize/payload HTML | Cap/dedupe đúng, SQL parameterized, không leak secrets |

### P2 — Load, hiệu năng và chaos

- Deterministic state-machine fuzz nhiều seed, trace operation/args trước khi fail; shrinking trace về repro nhỏ.
- 10.000+ species search/pagination: DOM node budget, input latency, không query toàn cây mỗi keypress nếu quá chậm.
- Plant SVG đa instance: unique defs IDs, render size/DOM node budget và grayscale silhouette regression.
- 30 phút fight/replay/navigation soak: memory plateau, RAF và AudioContext scheduling không tích lũy.
- D1 read/write counters trên read routes; không KV write cho steady-state leaderboard/search/poll.
- Thử exception ở từng dependency KV/D1/R2/AI/analytics; domain transaction không được báo thành công nếu phần bắt buộc thất bại.
- Thử quota/free-tier workload bằng fake counters trước, không stress production hay đốt neuron AI.
- Mutation testing cho guards trọng yếu: bỏ debit guard, bỏ owner check, bỏ event dedupe; tests phải phát hiện. Chưa tích hợp mutation engine trong lượt này.

## 8. Fixture, clock và mock policy

- Seed cố định, timestamp cố định xa midnight trừ test boundary; dùng UTC date constructor để không lệch máy CI.
- Fixture fresh/mid/endgame, old save và hostile save có version; không dùng save thật người dùng.
- State snapshot trước/sau failed action; assertion independent arithmetic khi kiểm economy, không chỉ gọi lại hàm đang test.
- Browser context mới từng scenario; không sử dụng browser profile đang đăng nhập.
- Mock external API trước boot, không đợi app gọi rồi mới intercept.
- Ưu tiên đợi state/locator, không sleep cố định cho animation khi đang kiểm logic.
- `waitForFunction(fn, arg, options)`: timeout ở đối số thứ ba; truyền object options ở vị trí arg không thiết lập timeout. Dùng `domcontentloaded` + điều kiện ready cụ thể, tránh phụ thuộc `networkidle` ở màn hình có polling.
- Kết quả flaky phải lưu seed/trace/screenshot và chạy lại để phân loại, không auto-retry rồi che lần đỏ.
- Không sửa test để cho implementation sai “pass”; khi oracle sai thì ghi lý do từ contract nguồn.

## 9. CI và release gate

Workflow mới `.github/workflows/technical-tests.yml`: pull request hoặc manual dispatch, không scheduler mới và không deploy. Hai job core/browser, Node 24, upload log/JSON/screenshots dù fail. Worker dependencies được cài để typecheck config Worker thật.

Browser CI cấu hình `VITE_ACCOUNT_API=https://account.test` để gate có service contract mà không dùng production. Sign-in fixture nhận cả hostname production cũ và hostname giả, xác định path bằng URL parser. Các browser suite khác cần tiếp tục chuẩn hóa mock network trước khi có thể gọi toàn nhóm là hermetic; fake hostname không phải một Worker local đang chạy.

Release gate:

1. Typecheck ba target và production build.
2. Core/integration/PWA/ads/fuzz không có assertion failure mới.
3. Browser không timeout/block và luồng quan trọng không flaky.
4. Mọi baseline failure có issue và owner; không “all green” khi bỏ suite.
5. Nếu đổi Worker runtime: commit/deploy theo AGENTS.md, rồi chạy production smoke có kiểm soát.
6. Nếu đổi SW/PWA: test build production thật, không dùng Vite dev để chứng minh offline.

Workflow hiện sẽ báo đỏ vì test PWA mới bắt được bug; đây là regression gate có chủ đích, không lỗi cần xóa test. GitHub workflow chưa chạy trên runner hosted trong lượt này.

## 10. Các giới hạn cần nói thẳng

Không có tỷ lệ line/branch coverage đã đo. AST reachability và số lượng suite không được dùng làm “coverage 100%”. Chưa chạy load test production, chưa chứng minh DO hibernation/WebSocket trên runtime Cloudflare, chưa test Safari/iPhone thật. Bộ test mới là nền kỹ thuật và gate rõ ràng, không chứng nhận mọi lỗi của dự án đã hết.

Kết quả thực chạy và lỗi phát hiện được ghi trong `docs/25_TECHNICAL_TEST_RUN.md` khi các lượt kiểm chứng hoàn tất.
