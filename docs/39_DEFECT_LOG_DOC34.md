# Defect log — doc 34 upgrade pass

Theo §19: mỗi defect có ID, severity (H0/H1/Q), feature, HEAD, fixture, steps,
expected/actual, frequency, evidence, root cause, fix files, regression command,
retest result, residual risk. Chỉ defect thật tìm được trong pass này — không
ghi bug tưởng tượng hay bug đã sửa ở phase trước.

| ID | Sev | Feature | Defect | Root cause | Fix | Regression | Retest | Residual |
|---|---|---|---|---|---|---|---|---|
| DEF-34-01 | H0 | BRD-02 / pity | Bảng odds lai **không khớp kết quả**: target=C ra 0% C, target=S rơi 80% xuống A, **sssHard "bảo đảm" ra 0% SSS** (đo 360 breed) | `computeRarityScore` chỉ nudge `score·0.72 + target·0.28`; band cao không bao giờ đạt ngưỡng | `genomeGenerator.ts` — map điểm organic vào trong band đã roll | `test-breeding-wp06b.ts` sssHard block + tally probe 360 breed | 360/360 đúng band; sssHard → SSS + reset | Thấp — semantics trong-band giữ thứ tự organic; sellPrice/ECR theo band giờ đúng lời hứa |
| DEF-34-02 | H1 | BAT / room | Stance từ wire không validate — forged room message `"stance":"garbage"` → `STANCE_EFFECTS[undefined]` crash engine giữa trận | `initSide`/`changeStance` trust config.stances từ network | `src/battle/engine.ts` — validate stance ở cả hai boundary | `test-battle-sim-matrix.ts` forged-stance case | 17/17 | Thấp — còn các field wire khác đã có guard sẵn |
| DEF-34-03 | H1 | MOT-07 | `stageOverlay` finish không idempotent — click "Tiếp tục" + Escape cùng gesture gọi `onContinue()` **2 lần** → duplicate settlement downstream | thiếu cờ `finished` (khác `levelUp` đã có guard `leaving`) | `stageOverlay.ts` + `expGain.ts` — guard finished | `test-motion-contracts.ts` MOT-07 sections | 20/20 | Không |
| DEF-34-04 | H1 | MOT-01 | `expGain` double-fire: `done` chạy qua `animationend` **và** `setTimeout` fallback → `pulse(bar)` bắn 2 lần, flash kép | hai đường cleanup không khóa nhau | cùng fix DEF-34-03 | `test-motion-contracts.ts` cleanup section (spy classList.add) | pulses == chips | Không |
| DEF-34-05 | H1 | PERF | Input latency: `toLocaleString("vi-VN")` per-call tạo Intl formatter — ~88% thời gian cold nav (garden 1185ms, lab 1689ms); `queryCatalogue` sort 20k×localeCompare | không cache formatter/collator | `viNum()` cached (32 sites), cached Collator, `rel` order precompute, `sortedAll` cache | `test-input-latency.ts` p95+longtask | p95 87.9ms trên production build; longtask worst 86ms | Không — warm/cold tách rõ trong report |
| DEF-34-06 | H1 | PERF | Lab render 24 `seedCard` đồng bộ (~170ms sync) + icon `renderPlantSvg` ngay cả offscreen | không progressive mount / lazy art | `lab.ts` rAF batch mount + shelf-ready marker; `lazySvg` IO-mount + WeakMap cache | suites shop-filter/sort/aux/rel04/ui cập nhật chờ shelf-ready | tất cả xanh | Không |
| DEF-34-07 | H1 | A11Y | 4 vi phạm WCAG AA thật: `.qa-ad` #ffca4f trên nút sáng (~1.9:1), `.plot-cost` 4.43, `.unlock-head` 4.15, `.unlock-rule` 3.81 | màu nhạt trên nền sáng, compositing opacity | `styles.css` — 4 sửa màu | `test-contrast.ts` | 3/3, painter-flag đã manual verify | Còn gradient cases cần mắt người (đã check) |
| DEF-34-08 | H1 | REL-04 | `user-scalable=no` chặn pinch zoom — vi phạm a11y (iOS đã ignore nhưng Android/others không) | viewport meta từ lúc scaffold | `index.html` viewport | `test-rel04.ts` | 7/7 | Không |
| DEF-34-09 | H2→H1 | Test infra | `test-input-latency` đo sai: stamp trước click → mẫu ~0ms; 2×rAF gộp cả deferred settle vào "input latency" | instrumentation | đo first-paint riêng, settled riêng; warmup navs tách khỏi mẫu | chính suite | 6/6 | Test artifact, không phải product bug |
| DEF-34-10 | H2 | Test infra | Preview 4174 phục vụ bundle cũ sau rebuild → số liệu đo trên code cũ | preview giữ snapshot dist lúc start | preview mới ở 4175 sau mỗi build | — | bundle mới confirmed (asset hash đổi) | Quy trình: luôn verify asset hash |

## Bugs đã biết / mở (không che)

- **ECR median 0.310** ở `balance` nông (penalty bão hòa 96%) — tuning target có
  sẵn từ baseline, `balance:deep` PASS 0.410. Không phải regression pass này.
- **win-rate 0.750 / matchup σ 0.350** — tuning targets OPEN, cần playtest
  telemetry, ghi rõ trong docs/34_WP07 không tự nhận pass.
- Gardener ACT-08/09, panel ≥4/5 reviewer, soak 2h, iPhone Safari thật —
  quality/device blockers, không tự gán chữ pass.
