# Audio asset manifest — WP05 / AUD-10

**Policy:** every audible element in the game is procedurally synthesized with Web Audio — there are **zero audio files** in the repository (`src/audio/` contains code, not assets). That makes the license question simple and auditable: every sound's *source* is the code that generates it, and that code is original to this repository.

| Asset | Type | Source (file of record) | License |
|---|---|---|---|
| `pad` stem — 4-voice detuned pad, 8s bar | Music stem | `src/audio/music.ts` → `schedulePad` | Original (code-composed, this repo) |
| `bass` stem — sine root per bar | Music stem | `src/audio/music.ts` → `scheduleBass` | Original |
| `melody` stem — pentatonic pluck walk | Music stem | `src/audio/music.ts` → `schedulePluck` | Original |
| `pulse` stem — filtered noise tick, beat grid, battle-only | Music stem | `src/audio/music.ts` → `schedulePulse` | Original |
| Composition — D-minor pentatonic `SCALE`, `PROGRESSION` [0,5,3,7], `BAR`=8s | Musical work | `src/audio/music.ts` | Original |
| `tap` `back` `error` `buy` `dig` `plant` `sprout` `bloom` `breed` `levelUp` | SFX cues | `src/audio/audio.ts` → `build()` case per name | Original |
| `hit` `crit` `miss` `heal` `shield` `cast` `death` `win` `lose` | Combat cues | `src/audio/audio.ts` → `build()` | Original |
| `hover` `start` `pause` `resume` `expGain` `unlock` `reward` `powerUp` | Interface/progression cues | `src/audio/audio.ts` → `build()` | Original |
| `combo` `enemy` `collect` `questProgress` | Feedback cues | `src/audio/audio.ts` → `build()` | Original |
| Noise buffer — white noise rendered into `AudioBuffer` | Shared material | `src/audio/audio.ts` → `makeNoise`/`noiseOf` | Original |

## Mix / headroom (AUD-05)

- Effects bus → highshelf −5dB @ 6.5kHz → master.
- Music bus (`musicOut`, persisted `musicVolume`, default 0.4) → lowpass 5.2kHz → master.
- Master → `DynamicsCompressor` (threshold −8dB, ratio 12) → destination.
- Measured offline render peaks: calm 32s <0.95 FS, battle 24s <0.95 FS (`tools/test-audio-stems.ts`).

## Verification

- `tools/test-audio-stems.ts` — stems mix per mood, 20-flip transport, seam/clicks/gaps/peak/pulse-grid/live-source bounds.
- `tools/test-audio.ts` — full cue arc through real UI (pause/resume, ladder win reward/unlock, arena combo/enemy), mute & volume persistence, no-audio fault tolerance.
- `renderOffline(seconds, mood)` on `music` is the shared scheduling path — what the test measures is what the live bed plays.

## Third-party content

None. No samples, loops, fonts-of-sound, or external tracks are shipped; AUD-10's "100% có source/license hợp lệ" is satisfied by the table above.
