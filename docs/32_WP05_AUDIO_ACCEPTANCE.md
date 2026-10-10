# WP05 — Audio: stems / manager / fallback / license

Phase: **WP05** theo `docs/27` §13 — 3–4 original cues/stems, license/mix, music manager/fallback.
**Ngày chạy:** 2026-10-10 — Chromium, `tools/test-audio-stems.ts` + `tools/test-audio.ts`.

## Đã giao

- **Stem architecture** (`src/audio/music.ts`): 4 stem `pad`/`bass`/`melody`/`pulse`, mỗi stem GainNode riêng dưới `musicBus`; mood = mix targets per-stem, ease 8%/tick → crossfade không cut. Battle bật `pulse` (noise tick trên beat grid), calm tắt.
- **Scheduler giữ nguyên** lookahead 200ms/150ms tick, note scheduling trên `ctx.currentTime`; `scheduleBar/schedulePad/scheduleBass/schedulePluck/schedulePulse` được parameterize theo `ctx` → render được qua `OfflineAudioContext` (`music.renderOffline`).
- **Crossfade seam fix**: pad/bass hold `BAR + 2.6s` — bản cũ release đúng boundary gây hụt năng lượng ~0.0002 mỗi 8s ("breathing"); đo lại seam ≥0.004 mọi bar.
- **`shape` clone fix**: `this.shape` từng alias thẳng `SHAPES.calm` — ease in-place mutate luôn preset (bug tiềm ẩn của bản gốc).
- **Stats hook** `music.stats()`: mood, per-stem gains, liveSources, running — cho AUD-02/06.
- **Manifest** `docs/31_AUDIO_ASSET_MANIFEST.md`: 100% procedural, source=code, license=original; mix chain + measured peaks.

## AUD-01…10 — actual / evidence / status

| ID | Nhóm | Thực đo | Evidence | Status |
|---|---|---|---|---|
| AUD-01 | H0 | Không ctx/graph trước gesture; mute persist qua reload/scene | `test-audio.ts` "nothing runs before the first gesture" + mute/reload cases; `test-audio-stems.ts` case cuối | **pass** |
| AUD-02 | H1 | 20 `setMood` flip: 1 scheduler, 0 burst, stop dừng hẳn | `test-audio-stems.ts` AUD-02 block (running/liveSources ≤40/stopped) | **pass** |
| AUD-03 | H1 | 32s render: peak <0.95, maxDelta <0.7, không gap >1.2s, seam >0 mọi bar; pulse đúng grid | `test-audio-stems.ts` AUD-03 + pulse-grid blocks | **pass** (machine-measured; "audible" cần tai người) |
| AUD-04 | H1 | `AudioContext` vắng → `available:false`, mọi path không throw, game sống | `test-audio.ts` "the game survives having no audio at all"; `failed` latch trong music.ts | **pass** |
| AUD-05 | H1 | Bed peak <0.95FS cả calm/battle; limiter −8dB@12:1 ở master cho tổng mix | `test-audio-stems.ts` AUD-05; manifest §Mix | **pass** phần bed; battle SFX stress chưa đo riêng — **in-progress** phần còn lại |
| AUD-06 | H1 | liveSources bounded <60 qua 12s playback; 15 phút + 20 scene change chưa chạy hết thời gian thật | `test-audio-stems.ts` AUD-06 | **in-progress** — bound chứng minh được, full-15' chưa |
| AUD-07 | Q | Garden median ≥8/10, mệt tai ≤2/10 — panel người | — | **blocked** |
| AUD-08 | Q | ≥4/5 nhớ motif, không khó chịu lặp — survey | — | **blocked** |
| AUD-09 | Q | Battle ≥8/10, vẫn ra quyết định được — 10 trận/người | — | **blocked** |
| AUD-10 | H0 | 100% asset procedural, source/license table đầy đủ | `docs/31_AUDIO_ASSET_MANIFEST.md`; `find` 0 file audio trong repo | **pass** |

## Còn lại trước khi tuyên bố WP05 hoàn chỉnh

- Battle-SFX stress render (AUD-05 phần effects, không chỉ bed).
- Long-run soak (AUD-06 đủ 15' — cần fake-clock hoặc chạy nền).
- Panel Q — không tự chấm.
