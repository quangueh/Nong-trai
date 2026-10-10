# Motion & Event→FX Ownership Registry (docs/34 §11–12, docs/28 MOT-01..14)

Contract cho mọi clip trong game. Hai bug thật tìm được khi lập registry này đã
vá kèm regression test (xem §4).

## 1. Quy tắc ownership (hợp đồng tối thiểu theo spec)

Mọi hệ thống motion phải có:

- **Owner ID** — một module/class chịu trách nhiệm duy nhất cho clip đó.
- **Event ID** — domain event hoặc user intent kích hoạt.
- **Channel** — transform / opacity / DOM-spawn (không hai owner cùng ghi một
  channel trên một node).
- **Cancel idempotent** — gọi cancel n lần = gọi 1 lần.
- **Finish-visual idempotent** — completion callback chạy ≤1 lần dù clip kết
  thúc bằng timer, animationend, click, Escape hay unmount.
- **FX không settle** — finish-visual không được gọi domain mutation; settlement
  xảy ra trước (atomic trong store) hoặc sau (trong onContinue), không bao giờ
  trong chính clip.

## 2. Registry

| Owner | Event → clip | Channel | Cancel path | Finish guard | Test |
|---|---|---|---|---|---|
| `ui/fusion.ts` `playFusion` | breed settle → ceremony | overlay DOM | click + timer | `finished` flag | test-motion-contracts §fusion |
| `ui/fx/stageOverlay.ts` `showStageResult` | stage outcome → tally + panel | overlay DOM + textContent count | Escape/go; `cancelled` dừng count | `finished` flag **(vá đợt này)** | test-motion-contracts §stage |
| `ui/fx/stageOverlay.ts` `showStageBrief` | pre-fight brief | overlay DOM | nút Hủy | single-shot mount | test-battle-view (gián tiếp) |
| `ui/fx/levelUp.ts` `celebrateLevelUp` | level-up notice → celebration | overlay DOM | Escape/backdrop/Go | `leaving` flag | motion-contracts MOT-01 |
| `ui/fx/expGain.ts` `celebrateExpGain` | EXP grant → chips bay vào bar | DOM-spawn chip + trail | animationend + fallback 1500ms | `finished` flag **(vá đợt này)** | motion-contracts §cleanup |
| `ui/fx/gardenFx.ts` `waterPlotFx` | care "water" thành công | plot-local DOM + class | single timeout 1800ms | cleanup idempotent (class remove) | gardener-actor + ui |
| `ui/fx/gardenFx.ts` `harvestFx` | cây mature đi đánh | plot-local DOM | single timeout 1400ms | — | — |
| `ui/fx/gardenFx.ts` `rewardFly` | quest/claim trả thưởng | DOM-spawn chips → HUD | animationend + timeout | cleanup idempotent | — |
| `ui/fx/gardenFx.ts` `markStageUp/markUnlock` | stage-up / mở ô | class marker 1-shot | `consume*` đọc-xoá | consume-once | test-ui |
| `battle/juice.ts` `CombatJuice` | hit/cast/KO events → lunge/shake/charge | transform (RAF-driven) | `cancelAnimationFrame` + `destroy()` | RAF cancelled on destroy | test-battle-view + soak (0 leftover) |
| `battle/battleFx.ts` `FxLayer` | status/hit VFX → spawned node | DOM-spawn + host class | `setTimeout` per-node + `destroy()` gỡ host class | node.remove idempotent | test-battle-view + soak |
| `ui/gardener.ts` actor | care work events → walk/work sprite | transform + sprite frames (RAF) | parked timers; `!isConnected` → self-destroy | work ack ≤1 (queue dedup) | test-gardener-actor 11/11 |
| `ui/checkin.ts` | daily check-in sheet | overlay + retry timers | dismiss stack | attempt loop bounded | test-checkin |
| `ui/app.ts` notices | domain `Notice` → banner | banner stack, dedup `key` | auto-expire + dismiss | `hold` trong lúc settle | nhiều suite |
| `core/prefs.ts` | motion pref | `data-motion` trên root | setMotionPref/watchSystem | resolved 1 nguồn | test-prefs, REL-04 |

**Quy tắc channel:** transform trên plant/actor thuộc CombatJuice/gardener;
class trên card thuộc gardenFx; overlay DOM thuộc fx/\*. Không clip nào ghi
transform lên node owner khác đang lái — đây là lý do juice tách `travel`
(translate) khỏi `charge` (scale) thay vì gộp vào `style.transform`.

## 3. Event → FX map (một event → đúng một owner)

| Domain/user event | Visual owner | Audio owner | Ghi chú |
|---|---|---|---|
| plant seed | — (card mới repaint) | `sfx("plant")` garden.ts | |
| care water ok | `waterPlotFx` | sfx qua caller | FX chỉ chạy khi `applyCare` trả ok |
| care reject | — | `sfx("error")` | không FX cho hành động bị từ chối |
| harvest/collect | `harvestFx` | `sfx("collect", pitch∝số cây)` | |
| quest claim | `rewardFly` → HUD | `sfx("reward")` | |
| mua hàng | — | `sfx("buy")` / `error` | |
| dig/remove | — | `sfx("dig")` | |
| unlock plot | `markUnlock` → bed FX | `sfx("buy")` | |
| breed settle | `playFusion` → `openMutationReport` | `sfx("bloom")` + fusion `levelUp` | settle **trước** ceremony trong `store.breed` |
| level-up | `celebrateLevelUp` | `sfx("levelUp")` + `powerUp` | notice dedup `lvlup` |
| EXP grant | `celebrateExpGain` → bar | `sfx("expGain", pitch i*2)` ≤ CHIP_TICKS | bound số tiếng tick |
| stage win/lose | `showStageResult` | `reward`/`lose` + `unlock` trễ 520ms | finish idempotent (vá) |
| battle event (hit/cast/status/KO) | `CombatJuice` + `FxLayer` | `sfx` qua battleView map | xem battleView.ts:158-900 |
| auto-care tick | gardener actor work event | — | actor không tự grant |
| check-in | checkin sheet | `sfx` qua sheet | |
| account/sync | sync strip | — | text-only, không FX |
| notice domain | `app.showNotice` stack | — | dedup key + hold khi settle |

Không có event nào có hai visual owner cùng channel; FX reject/error chỉ phát
`error` cue — không spawn visual.

## 4. Bug tìm được khi lập registry (đã vá)

1. **`stageOverlay.showStageResult` — finish không idempotent** (MOT-07 vi
   phạm): `go.click` và `dismissOnEscape` cùng gọi `finish()` → `onContinue()`
   chạy 2 lần → double-navigation/settle path. Vá bằng `finished` flag theo
   đúng pattern `leaving` của levelUp. Regression: `test-motion-contracts`
   "Escape+click in one gesture continues once" + "Escape mid-tally".
2. **`expGain.celebrateExpGain` — pulse double-fire** (MOT-02 vi phạm):
   `done` bắn qua `animationend` **và** `setTimeout(1500)` → `pulse(bar)` chạy
   hai lần = reflow replay flash, một thưởng nháy hai lần. Vá bằng `finished`
   guard. Regression: "bar pulsed once per chip" (spy `classList.add`).

## 5. MOT-01..14 status

| ID | Trạng thái | Bằng chứng |
|---|---|---|
| MOT-01 FX không mutate domain | **pass** | motion-contracts §MOT-01 (snapshot equality sau 3 celebration đồng thời) |
| MOT-02 một event → một effect | **pass** | map §3; expGain pulse-once; notice dedup |
| MOT-03 channel không overwrite | pass by construction | juice tách travel/charge; §2 channel column |
| MOT-04 framing ổn mọi grammar/size | covered | shot-\* suites + contact sheet (đang làm) |
| MOT-05 không label bị VFX che | covered | battle-view suite asserts HUD readable |
| MOT-06 pause/speed không backlog | pass | test-battle-view pause/resume; juice RAF cancel |
| MOT-07 finish ≤1 & cleanup đủ | **pass** | motion-contracts 12/12 + 2 bug đã vá |
| MOT-08 20 cycles baseline | pass | test-soak (timers/listeners/DOM về baseline) |
| MOT-09 reduced-motion mid-clip | **pass** | motion-contracts §MOT-09 (calm 730ms) |
| MOT-10 frame targets | pass | test-performance prod build p95 16.7ms |
| MOT-11/12 reviewer nhận action / ≥8 đẹp | **blocked** | cần panel người thật |
| MOT-13 quality preset giữ info | pass | reduced-motion giữ text/state |
| MOT-14 loop boundary 0.5× | **blocked** | cần slow-mo video review |
