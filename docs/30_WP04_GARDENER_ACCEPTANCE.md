# WP04 — Người làm vườn visible: acceptance report

Phase: **WP04** theo `docs/27` §13 (adapter work-event → actor atlas/rig → state/path/queue).
Spec liên quan: `docs/26` §5 (gardener design), `docs/27` §7.3 (ACT-01…09), `docs/28` (motion rules).

**Ngày chạy:** 2026-10-10 — Chromium (Playwright-core), viewport 390×844 và 1366×768, dev server `:5173`, fixture F02/F03 (`tools/fixtures.ts`).

## Kiến trúc đã giao

- **Event adapter** — `GameStore.onGardenerWork` / `GardenerWorkEvent`: phát **sau** `res.ok` của `applyCare`, một event duy nhất mỗi action thành công, `seq` tăng đơn điệu, `source: "live" | "catchup"`, không persist vào save, listener lỗi bị cô lập khỏi domain tick (`src/core/store.ts`, `src/core/types.ts`).
- **Queue** — `src/ui/gardenerQueue.ts`: bounded `MAX_JOBS`, dedup theo `event.id`, fold event quá `MAX_AGE` và overflow vào `summary`, giữ tối đa 1 catch-up minh họa, `drain` giữ work-history.
- **Actor** — `src/ui/gardener.ts`: singleton sống ngoài chu kỳ repaint (`screenHost.replaceChildren` mỗi `paint()`), `mountGardener` idempotent re-attach vào `.garden-scene` mới, states `park/idle/walk/work/done/leave/hidden`, SVG figure (nón rơm, tạp dề, bình tưới) + badge `⏳ {phút}c` mở detail sheet, expiry timer đậu actor khi hết buff, event-driven wake (không RAF rỗng suốt 15 phút), reduced-motion thay walk bằng hiện tại chỗ, `pointer-events:none` trên figure.
- **Mount** — `src/ui/screens/garden.ts` gọi `mountGardener(scene, store)` cuối `paintPlots`.
- **Styles** — `src/styles.css` block `.gdr*` sau `.gardener-btn`.

## Kết quả kiểm chứng

| Suite | Kết quả | Ghi chú |
|---|---|---|
| `tools/test-gardener.ts` (core) | **15/15 pass** | event uniqueness, reject→0 event, catchup source, seq, unsubscribe, error isolation, no-persist, quest integration, queue bounds/dedup/age/drain |
| `tools/test-gardener-actor.ts` (browser) | **11/11 pass** | mount trong scene, input không chặn, tick→work→done, không duplicate care, sold-target cancel, expiry park, re-grant wake, detail sheet, repaint idempotent, 20 route cycles, reduced motion |
| `npm run test:technical` (core profile) | **36/36 pass** | gồm typecheck×3 + production build + fuzz×3 + toàn bộ suite cũ |
| `npm run test:technical:browser` | **12/12 pass** | gồm `test-gardener-actor` + `test-audio` sau khi sửa fixture flake |
| `tools/shot-gardener.ts` | evidence shots | `shots/gardener/*.png` |

## ACT-01…09 — actual / evidence / status

| ID | Nhóm | Thực đo | Evidence | Status |
|---|---|---|---|---|
| ACT-01 | H0 | Tick thành công phát đúng N event unique (id `gw:{seq}:{at}:{plant}:{rand}`), action bị cooldown/expiry phát 0 event | `test-gardener.ts` case "exactly one event per successful action" + "no event after expiry" + "no event from rejected action" | **pass** |
| ACT-02 | H0 | Actor walk/work/done/cancel không gọi `applyCare`, không XP/reward/save-write; assert bằng spy + state equality | `test-gardener-actor.ts` "actor work never calls care/reward again" (spy `applyCare` + snapshot `state.plants`, wallet, quest log) | **pass** |
| ACT-03 | H1 | Figure `pointer-events:none` (không click-block); actor neo vào plot qua `.garden-scene` transform, re-attach sau repaint. **Video 24-plot đã quay** (`recordVideo`, F03 24/24 ô, mobile 390×844 + desktop 1366×768): actor đi bộ giữa các ô, work→done→walk chu kỳ kế tiếp trên bãi đầy | `test-gardener-actor.ts` "figure never intercepts input", "repaint keeps exactly one actor"; `shots/gardener-video/mobile-24plot.webm`, `desktop-24plot.webm` | **pass** — cơ chế + video path đủ bằng chứng |
| ACT-04 | H1 | Queue cap `MAX_JOBS`, dedup `id`, fold quá `MAX_AGE`+overflow vào `summary`, catch-up giữ ≤1 job minh họa | `test-gardener.ts` queue cases (overflow fold, dedup, age fold, catchup summary, drain) | **pass** |
| ACT-05 | H0 | Battle-locked bị domain skip (không event, không care); sau `autoCareUntil` tick trả 0 — actor không thể chăm trái policy vì event chỉ sinh từ domain | `test-gardener.ts` "battle-locked plant skipped", "no event after expiry" | **pass** |
| ACT-06 | H1 | 20 chu kỳ rời/vào Vườn: listener count về baseline, 0 actor thừa, 0 RAF/leak | `test-gardener-actor.ts` "leaving and returning 20 times leaves no extra listeners" (đếm `gardenerListeners.size` + số `.gdr`) | **pass** |
| ACT-07 | H1 | Reduced-motion: actor vẫn xuất hiện, work→done thực hiện được, không bật walk-clip loop | `test-gardener-actor.ts` "reduced motion" (`emulate media reduced-motion`, assert `data-state` work/done, CSS tắt keyframes qua `@media (prefers-reduced-motion)`) | **pass** |
| ACT-08 | Q | Blind-recognition panel ≥4/5 trong 3 giây — cần người thật | `shots/gardener/2-walking-zoom.png`, `3-working-zoom.png`, `5-detail-sheet.png` (actor rõ ràng tại ô, badge `10p`) — **chưa có panel** | **blocked** — chờ human review |
| ACT-09 | Q | Foot sliding/pose mismatch qua 5 lượt slow-motion — cần video review người | Screenshots có, slow-motion video + review log chưa có | **blocked** — chờ human review |

## Bug/fix phát sinh trong phase

- **Fixture race** (test-side, không phải product): boot `autoCareCatchUp` + interval 12s ăn care-ready trước tick test → reset `careMemory` phải xóa cả `lastAction` (fallback trong `careCooldownLeft` tái dựng cooldown từ `lastAction.at` khi `lastUse` trống). Sửa trong `test-gardener-actor.ts`, không đụng product.
- **`togglePause` cues chết** + **stage-fight flake** trong `test-audio` — stage 10 boss ~240+affix power vs plant `powerRating=250` stats mặc định là coin-flip → fixture giờ set `stats` rõ (hp 3000, atk 220, def 300, spd 350, sp 200) cho thắng chắc mà vẫn đủ lâu để bấm pause. Đã pass 120.7s.

## Chưa giao (không tự tuyên bố pass)

- ACT-08/ACT-09 — hai tiêu chí Q cần panel người + slow-motion video review.
- ~~ACT-03 phần "24 plot resize/scroll path video"~~ — **đã quay** `tools/shot-gardener-video.ts`: F03 24/24 ô, hai viewport, walk→work→done→walk chu kỳ liên tiếp + pan toàn vườn. Files `shots/gardener-video/*.webm`.
- Screenshot ở `shots/gardener/` là evidence tĩnh; chưa có video loop cho motion-review.
