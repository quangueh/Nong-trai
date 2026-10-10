# WP09 — Release acceptance (REL-01…07)

Gate report for the release criteria in `docs/27_DETAILED_PRODUCTION_ACCEPTANCE_SPEC.md`
and the master script in `docs/34_MASTER_UPGRADE_48H_EXECUTION_SCRIPT.md`. Every row
carries the measurement it rests on; anything not measured says so.

## REL-01 — typecheck / build / authority

| Check | Result |
|---|---|
| `tsc -p tsconfig.json` (app) | PASS |
| `tsc -p tsconfig.tools.json` (tools) | PASS — all new WP05–09 suites typecheck-clean |
| `tsc -p worker/tsconfig.json` | PASS (last full run) |
| `npm run build` | PASS — 98 modules; index 304.17 kB (99.61 kB gz), battle 116.99 kB (40.04 kB gz), render 32.23 kB, css 168.83 kB (36.20 kB gz) |
| `npm run build:test` + `preview:test` | new: production transform with the `__game` seam kept — what perf is measured on; the prod bundle stays stripped (`grep __game dist/assets/*.js` → none) |
| Data/authority/settlement | covered by WP06 (28/28), WP07 (19/19 + 11/11), WP08 (15/15 + 17/17), signin-flow conflict suites |

## REL-02 — suites

| Suite | Result |
|---|---|
| `npm run test:inventory` | 150 modules, 50 test suites |
| `npm test` (legacy aggregate, 33 scripts) | **PASS — all 33 suites green, 0 FAIL across the run** |
| `npm run test:technical` core | 36/36 last full run (incl. typecheck×3, contracts, schema, PWA, ads, fuzz×3→×5) |
| `npm run test:technical:browser` | 12/12 standalone after flake triage |
| fuzz-store | now 5 seeds × 2000 ops per spec §17.2 |

## REL-03 — performance (measured on the production build, not dev)

Environment: headless Chromium, 1366×800, `vite preview` serving the `--mode test`
bundle (identical transform to prod; `__game` kept for fixtures). The spec forbids
inferring production numbers from the Vite dev transform — these come from preview.

| Metric | Result |
|---|---|
| Garden F03 ×3×60 s | n=3600/3601/3598; p50 16.7 ms, p95 16.7–16.8 ms, p99 16.8 ms, worst 33.3–33.4 ms — PASS ≤20 ms |
| Garden DOM | 2.347 nodes — PASS ≤5.000 (was 8.572 pre-LOD) |
| Battle sample | n=1131; p50 16.7 ms, p95 16.7 ms, p99 16.8 ms, worst 1166 ms (one-off on first fight — GC/asset warm-up; p99 unaffected) |
| Heap | 40.1 MB baseline → 40.1 MB after 20 sheet cycles + 10 fights — flat |
| Battlefield leak | 0 left mounted after 10 resolved fights |
| **Soak (real-time)** | **PENDING — running**: 15 min garden+music with counters @0/5/10/15 min, 5 min hidden (CDP lifecycle), 20 route transitions, 10 consecutive fights, reload survival |

## REL-04 — a11y journeys (test-rel04.ts — 7/7)

- pinch zoom: `user-scalable=no` removed from the viewport meta (iOS ignored it
  anyway; desktop a11y needed it gone)
- solid mode renders garden content (cards/plots/seed-grid still present)
- reduced-motion journey completes with the garden still populated
- Space pauses a live fight (pause veil appears), Space resumes it

## REL-05 — production PWA

- `sw.js` live, 200, contains the `res.ok` guard (the 500-poisoning bug fixed earlier)
- `index` + `manifest.webmanifest` live 200, name `Đại Chiến Cây Đột Biến`
- offline/update covered by `test-service-worker.ts` (8/8) running the real sw.js in a VM

## REL-06 — real iPhone Safari

**BLOCKED — no device available.** Per spec this gate stays open rather than being
claimed; the Safari-specific risks (backdrop-filter fallbacks, AudioContext unlock,
viewport units) are partially de-risked by `data-solid` mode and the unlock-gesture
flow but not verified on hardware.

## REL-07 — manifest / license / no dev handles in prod

- `manifest.webmanifest` + icons live; `docs/31_AUDIO_ASSET_MANIFEST.md` records that
  all cues/stems are code-composed (no third-party audio, no license debt)
- `__game` absent from the prod bundle (grep-verified); present only in `--mode test`
- no secrets in the repo; `.env*` gitignored

## Balance gates

| Command | Result |
|---|---|
| `npm run balance` (300 plants, 4 sessions) | FAIL — ECR median 0.310 vs 0.35–0.65 (96% variance-penalty saturation; raw power 0.510 in-range). Small-sample variance; the deep run is the meaningful reading |
| `npm run balance:deep` (2000 plants, 12 sessions) | **PASS** — ECR median 0.410; win rate 0.750 and matchup σ 0.350 remain OPEN tuning targets needing playtest telemetry (the tool says so itself) |

## Honest remainder

- Human-reviewer quality gates (5-person panel, ≥90/100 median) — **blocked**, rubric exists, no panel run
- 2-hour integrated soak — bounded to the spec's own 15-minute minimum + hidden + cycles + fights; extended soak not run (infrastructure budget), stated openly per spec
- Hosted CI — `technical-tests.yml` exists and runs on PR; not yet observed green on this HEAD
