# Game Director Audit — Đại Chiến Cây Đột Biến

Audit 2025: engine = Vite + vanilla TS + DOM renderer. Stack thật, không phải farm-sim
3D — đọc audit này theo đúng genre của nó.

## Core fantasy

> "Ta nuôi và lai tạo một vườn chiến binh thực vật — mỗi cây là một build duy nhất
> do chính ta tạo ra."

Đây là **creature-breeder / battler** lai farm theme, không phải Stardew-like.
"Farm" trong game này = gym: care actions là **sculpt-stat** (water→HP/def,
moonlight→mutation), có cost + cooldown + risk tag (overwater) + diminishing
returns (potential/memory/stress/mood factors). Áp đặt soil/season/harvest của
farming-sim vào đây là sai lens — chiều sâu đúng của nó là build-crafting.

## Core loop

PLANT (mua hạt, chọn ô) → TEND (care sculpt stat + mutation) → GROW (4 stage,
~4.5 phút nén) → BATTLE (vượt ải PvE / đấu PvP) → BREED (lai gen, rarity) →
EARN/SELL → EXPAND (ô đất, nursery cap) → DISCOVER (species/trait/element).

Tầng loop: giây (tend tap), phút (stage tick, fight), ngày (weather, gardenDay,
ember cap, quests), dài hạn (rarity ladder, awakening, ascent, collection).

## Scorecard (0–10)

| Hạng mục | Điểm | Evidence | Vấn đề chính |
|---|---|---|---|
| Visual Quality | 7 | procedural SVG per-plant, element underglow, rarity rim | ceiling thấp do DOM/SVG — chấp nhận được |
| Art Direction | 7.5 | palette ấm nhất quán, element/rarity là ngôn ngữ chung | thiếu lớp "world alive" (ambient motion) |
| UI Consistency | 8 | sheet/quest/card thống nhất, dismissOnEscape chuẩn | — |
| UX Clarity | 8 | qabar, quest tracker, hints transient, **care preview ≈gain** | — |
| HUD Readability | 7.5 | topbar gọn, fight sạch | — |
| Navigation | 8 | nav rail + route transition + Escape xuyên suốt | — |
| Farming Feel | 6 | care có decision thật | không có harvest moment; grow = chờ |
| Game Feel | 8.5 | hitstop/shake/element FX/K.O./victor | — |
| Progression | 7.5 | nhiều track, next-goal nhìn thấy | — |
| Economy | 6.5 | balance-report PASS (100% trong ±10% budget) | sink cuối game mỏng — xu lạm phát |
| Exploration | 2 | không có — genre screen-based | chấp nhận, không vá |
| Reward Feedback | 8 | toast→notice→celebration→milestone ladder | — |
| Player Motivation | 7 | quest/ascent/collection/rarity | streaks/daily cadence có thể mạnh hơn |
| Accessibility | 8 | RM 3-state, focus-on-open, Escape, ≥44px targets | chưa test colorblind, font-scale |
| Responsive | 8 | audit 20/20 cả 2 viewport | — |
| Performance | 8 | 60fps đo được, 0 node leak | — |
| Code Architecture | 8 | store tập trung, event-driven battle, save repair | garden.ts ~1.2k dòng — chịu được |

## Top vấn đề (Impact / Cost / Risk)

| # | Vấn đề | Sev | Impact | Cost | Risk |
|---|---|---|---|---|---|
| 0 | **Phantom stat gains** — statusPower/elementPower/growthRate/mutationChance roll + toast nhưng không field nào đổi (~20-25% care gain là giả); genePackages cũng grant trượt | **P0** | Cao (honesty + balance) | TB | Thấp | ✅ FIXED |
| 1 | **Care decision mù** — trả items/xu mà không thấy dự kiến kết quả | P1 | Cao (meaningful choice) | TB | Thấp | ✅ FIXED |
| 2 | **Garden thiếu "alive"** — card grid tĩnh, không ambient | P2 | Cao (đẹp hơn rõ) | TB (CSS) | Thấp |
| 3 | **Weather chỉ là flavour** — bonus nhỏ, không tạo decision ngày | P1 | Cao (daily decision) | TB | TB (cân bằng) |
| 4 | First-session funnel chưa probe | P1 | Cao (retention) | Thấp | — | ✅ VERIFIED OK |
| 5 | Economy sink cuối game mỏng | P2 | TB | Cao (design) | TB |
| 6 | Empty/error states chưa sweep hệ thống | P2 | TB | Thấp | Thấp |
| 7 | Không có harvest moment (mature = chờ bán/đánh) | P2 | TB | TB | TB |
| 8 | Ambient audio (chim/gió) chưa có | P3 | TB | Thấp | Thấp |
| 9 | Colorblind check (element = màu + dot) | P2 | TB | Thấp | Thấp |
| 10 | Quests chủ yếu đếm số | P2 | TB | TB | Thấp |
| 11 | Touch targets dưới 44px (stagemap 38px, .btn.sm 32px) | P2 | TB | Thấp | Thấp | ✅ FIXED |

## Roadmap

- **Phase A (đợt này — xong)**: #0 phantom-gain fix + #1 care preview + #4 fresh-save probe + #11 tap targets.
- **Phase B**: #3 weather→decision coupling (mưa = tưới miễn phí, nắng = boost hệ lửa, v.v.) + #2 ambient layer nhẹ.
- **Phase C**: #5 economy sink + #6 empty-state sweep + #9 colorblind pass.
- **Defer**: exploration (sai genre), seasons đầy đủ (scope creep), gamepad.

## Phase A — ghi chú triển khai

- **`previewCare(plant, actionId)`** (`growth/care.ts`): chạy đúng công thức gain
  của `applyCare` trừ roll ±15% — sheet Chăm giờ hiển thị "≈ +3 HP · +1 Thủ ·
  ĐB 16%" trước khi trả tiền. Quyết định thật thay vì bấm mò.
- **Phantom stats bị triệt tiêu**: `statusPower`/`elementPower` không tồn tại
  field nào — weight của chúng chuyển về `skillPower` (nơi status/element
  potency thật sự chảy qua). `mutationChance`/`growthRate` ghi vào
  `growthStats` — mutationChance được đọc lại bởi mutation roll, growthRate
  giờ rút ngắn stage qua `stageDurationMs` (baseline-neutral: 0.5 = như cũ,
  0.9 cap ≈ nhanh hơn 20%).
- **genePackages**: statGrants statusPower/elementPower (im lặng trượt) gộp
  vào skillPower — pollen_choke 1.3, toxin_engine/dual_element_core 1.26.
- **Touch**: stagemap cell 38→44px, .btn.sm thêm min-height 36px.
- **First-run probe** (`tools/probe-firstrun.ts`): save mới đã tốt — starter
  plant tự gieo, quest "Gieo 1 hạt" dẫn, chip "Tưới tất cả −1" + "Gieo vào
  ô trống" hiện ngữ cảnh, 1200 xu + 30 vật tư + 5 tinh thể khởi đầu.

## Đang tốt — KHÔNG chạm

Juice pipeline (hitstop/shake/element FX), death clarity (K.O./victor/revive),
replay fidelity (replayAs freeze), save repair + :backup, Escape/focus mọi
modal, blur-pause, transient hint, offline catch-up, balance-report PASS.
