# Doc 34 — handover report (§22)

Kết luận một dòng theo spec: **technical-ready nhưng còn quality/device
blockers** — không tuyên bố "đạt toàn bộ gates" vì Gate C cần panel người và
Gate D còn iPhone Safari thật.

## 1. HEAD / diff scope / tính năng mới

- HEAD: `9acdb9b` — 7 commit scoped trong pass này:
  - `6ee82c3` perf: cached locale formatting + progressive/lazy render
  - `8faa62b` fix(battle): forged-stance validation ở wire boundary
  - `2f53b60` feat(audio): duck music dưới SFX (đo được)
  - `3eff82f` + `9acdb9b` fix(breeding): rolled band = settled band; report
    thêm block Cha mẹ + Khám phá mới; free-run vẫn organic
  - `28a85a6` fix(fx): finish idempotent trên stageOverlay/expGain
  - `b366f30` test+docs: contrast fixes, fault harnesses, evidence
- File đổi (product): `genomeGenerator.ts`, `store.ts`, `breeding.ts`,
  `engine.ts`, `audio.ts`, `stageOverlay.ts`, `expGain.ts`, `styles.css`,
  `currency.ts`, `shop.ts`, `lab.ts`, `lazySvg.ts`, `components.ts`, `app.ts`,
  `checkin.ts`, `garden.ts`, `unlocks.ts`, `levels.ts`, `generated.ts`,
  `levelUp.ts`, `index.html` (zoom).
- Không đụng `worker/src/` → Worker version giữ nguyên, không cần deploy.

## 2. Feature inventory

`docs/37_FEATURE_INVENTORY_S01_S30.md` — đủ cột owner/test/evidence/status/risk,
kèm hàng phát hiện thêm ngoài ma trận. Registry motion/FX: `docs/38`.

## 3. Criterion map docs 27/28

| Tài liệu | Map |
|---|---|
| docs 27 WP04 | `docs/30` (ACT-01..09; video 24-plot đã có) |
| docs 27 WP05 | `docs/32` (audio stems/peak/duck/stress/mute) |
| docs 27 WP06 | `docs/33` (BRD-01..06 + §10 bổ sung + DEF-34-01) |
| docs 27 WP07 | `docs/34_WP07` (BAT criteria, 11/11 view suite) |
| docs 27 WP08 | `docs/35` (AUX domain 15/15 + browser 17/17) |
| docs 27 WP09 | `docs/36` (REL-01..07 measured) |
| docs 28 MOT | `docs/38` + `test-motion-contracts` 20/20 (instrumentable slice) |
| Scorecard | Gate C — **chưa có panel người**, rubric trong docs 27 sẵn dùng |

## 4. Commands / counts / exits

| Lệnh | Kết quả |
|---|---|
| `npm run test:technical` | **44/44** (typecheck×3, contracts, schema, PWA, ads, fuzz 5 seeds ×2000 ops, production-build) — report `artifacts/technical-tests/2026-10-10T14-34-47-759Z/` |
| `npm test` (legacy) | **EXIT 0, 0 FAIL** — 16 result lines đều "0 failed" (≥1200 checks) |
| `npm run balance:deep` | PASS — ECR 0.410; win-rate/σ OPEN (tuning, cần telemetry) |
| `test-breeding-wp06b` | 29/29 · `test-room-faults` 19/19 · `test-faults-f08-f10` 14/14 · `test-motion-contracts` 20/20 · `test-audio-duck` 9/9 · `test-input-latency` 6/6 · `test-contrast` 3/3 · `test-battle-sim-matrix` 17/17 · `shot-viewport-sweep` 25/25 · `test-protocols` 40/40 |
| `test:technical:browser` | đang chạy ở HEAD cuối — số liệu cập nhật khi xong |
| Failed/skipped | `typecheck-tools` fail 1 lần (unused var) → sửa → 44/44; `test-protocols` fail 4 lần do band-map → sửa semantics + test → 40/40 |

## 5. Evidence

- `artifacts/upgrade-48h/` — video gardener 24-plot (mobile+desktop .webm),
  gardener PNG series, contact sheet 48 cây ×8 grammar, viewport sweep 49 ảnh.
- `shots/` — các màn phụ (account, arena, ascent, collection…).
- Audio: manifest `docs/31`, số đo trong `docs/32`.

## 6. Rules/balance trước-sau

- **DEF-34-01 (rules change có chủ đích):** rarity con lai trước đây lệch band
  đã roll (C→B/A, SSS→S). Sau: band con = band roll (360/360). Hệ quả: cây lai
  ở band thấp không còn được "nâng" rarity miễn phí — đúng lời hứa odds.
- `breedPlants` không-target vẫn organic (protocol test/balance tools).
- Không migration, không schema change — `MutationReport` là transient.

## 7. Performance / soak / audio counters

- Production build, preview local (Chromium headless, Windows):
  garden p95 **16.7ms**, input-latency p95 **87.9ms**, longtask worst 86ms,
  DOM **2347 nodes** (từ 8572), heap phẳng ~40MB — `docs/36`, `test-performance`.
- Soak 15' garden+nhạc + hidden 5' + 20 route + 10 trận: 11/11 —
  liveSources 4→11→8 (nhạc thật), 0 request storm, 0 battlefield sót.
- Ducking: dip ~0.55× / ~350ms mỗi SFX (`test-audio-duck`).

## 8. Release / rollback

- `docs/40_ROLLBACK_RECORD.md` — known-good `33736c7` + Pages `fab06d07`,
  Worker `3f0d6f8a`, SW policy, lệnh rollback.
- Live: `https://nong-trai-9u0.pages.dev` → deployment `d12d2933`,
  bundle `index-CC06PkrN.js` (curl-verified), sw/manifest 200.
- Repro: `npm run test:technical`, `npm run test:technical:browser`,
  `npx tsx tools/test-<suite>.ts` (BASE mặc định 5173 dev / 4175 preview).

## 9. Residual risks / cần người dùng

- **Gate C**: scorecard ≥90/100 + mỗi nhóm ≥8/10 cần ≥5 reviewer (≥3 người mới).
- **REL-06**: iPhone Safari thật — không có thiết bị; số headless không đại diện GPU iPhone.
- ACT-08/09 (gardener recognition + foot-slide slow-mo), BRD-05/06 (reviewer
  hiểu cost + chấm reveal) — quality gates còn mở, đã ghi trong docs 30/33.
- Soak 2 giờ: bounded theo minimum spec (15'), chưa chạy bản 2h.
- Hosted CI: `.github/workflows/smoke.yml` tồn tại nhưng chưa có run —
  nói thẳng: chưa chạy được CI hosted.
- Audio "nghe thật hay" — counters/duck đo được; đánh giá thẩm mỹ cần tai người.
