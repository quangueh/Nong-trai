# Đại Chiến Cây Đột Biến

Game mobile-web về **trồng, chăm, lai tạo gene và đem cây đi đại chiến bằng mã phòng**.

Mỗi cây là một cá thể sống có gene riêng: chỉ số, ngoại hình, tính cách chiến đấu và bộ chiêu được **sinh từ gene + seed**, không chọn từ danh sách cây cố định. Không có con mạnh nhất tuyệt đối — mỗi cây mạnh theo một kiểu và phải trả giá bằng một điểm yếu.

---

## Chạy game

```bash
npm install
npm run dev        # http://localhost:5173
```

Build production (deploy được lên Cloudflare Pages / Vercel / GitHub Pages):

```bash
npm run build      # -> dist/
npm run preview
```

> **Test phòng online:** mở game ở **hai tab/cửa sổ khác nhau**. Tab 1 bấm *Tạo phòng* để lấy mã 6 ký tự, tab 2 nhập mã đó. Truyền thông dùng `BroadcastChannel` nên hai client phải ở cùng một máy.

---

## Vòng lặp chơi

```
Mua hạt → gieo → chăm cây → cây trưởng thành
       ↓
   lai 2 cây → cây con đột biến (gene, chiêu, ngoại hình riêng)
       ↓
   đại chiến (với AI hoặc bạn bè qua mã phòng) → nhận coin
       ↓
   bán cây dư → tái đầu tư vào hạt, vật tư, ô đất
```

## Tính năng đã có

| Hệ thống | Mô tả |
|---|---|
| **Di truyền** | 5 giống nền → hàng nghìn biến thể. Trộn gene số thực + thẩm quyền + biến dị 4 cấp độ (vi mô → hỗn loạn). |
| **Sinh chiêu** | Chiêu là **tổ hợp module** (delivery × effect × element × modifier), không phải danh sách cố định. Tên chiêu sinh từ thành phần. |
| **Ngân sách sức mạnh** | Mỗi cây có genome budget theo tier. Mọi điểm mạnh phải trả giá: gene package bắt buộc có `requiresOneOf` (điểm yếu) + `counterTags` (bị khắc bởi). |
| **Chăm cây** | 7 hành động, mỗi hành động nhân với gene affinity, trần tiềm năng, ký ức chăm (chống spam), stress, tâm trạng và random có seed. |
| **Battle** | Tick 10 lần/giây, deterministic theo seed, có hệ khắc chế, status effect, 4 stance, AI theo personality, bảng sự kiện để client render. |
| **ECR** | Đo sức mạnh thật bằng mô phỏng 54 trận/cây với 9 cây benchmark, có trừ penalty theo độ biến thiên kèo. |
| **Độ hiếm** | Bảng 6 bậc C→SSS theo cấp cây cha mẹ (basis points, tổng đúng 10 000), có pity và ảnh hưởng cha mẹ có trần. |
| **Kinh tế** | LeafCoin + ledger bất biến, bán theo công thức có breakdown, cây A+ tự khoá, đơn hàng NPC, sink vật tư/lai/mở rộng vườn. |
| **Phòng online** | Mã 6 ký tự (loại bỏ `0 O 1 I L`), host là máy chủ authoritative, client chỉ gửi intent. |
| **Giao diện** | Mobile-first portrait, render cây bằng SVG sinh thủ công từ visual gene — không lưu bitmap. |

---

## Kiểm thử

```bash
npm test            # 258 kiểm tra: core + journey + UI + room
npm run typecheck   # TypeScript strict
npm run balance     # báo cáo cân bằng gene
npm run verify      # typecheck + test + balance + build
```

| Bộ test | Phủ | Kết quả |
|---|---|---|
| `test:core` | Determinism RNG, lai tạc không trùng, không NaN, battle deterministic, bảng rarity, kinh tế | 58 |
| `test:journey` | Hành trình người chơi qua `GameStore` thật: gieo → chăm → lớn → lai → đấu → bán → lưu | 56 |
| `test:ui` | Mọi màn hình + sheet trong jsdom: vườn, chi tiết, chăm, sưu tầm, lai, báo cáo đột biến, đấu, phòng, cửa hàng | 118 |
| `test:room` | 2 client thật qua `BroadcastChannel`: vào phòng, ready, replay không desync, chống giả mạo | 26 |

### Báo cáo cân bằng

`npm run balance` sinh hàng loạt cây và đo bằng mô phỏng. Báo cáo tách rõ **bảo đảm cứng** (phải đạt) và **mục tiêu tinh chỉnh** (cần telemetry sau playtest):

```
Bảo đảm cứng
  ✓ không có tổ hợp gene vô lệch     0
  ✓ mọi build hợp lệ ranked           0
  ✓ >95% build nằm trong ±10% budget  100.0%
  ✓ tỉ lệ hết giờ < 8%                0.0%
  ✓ ECR trung vị trong 0.35-0.65       0.400

Mục tiêu tinh chỉnh (cần playtest)
  · win rate 47-53%                    0.750
  · matchup std dev <= 0.09            0.360
```

Hai mục tiêu tinh chỉnh còn mở là **có thật** — theo `docs/15` chúng cần telemetry từ người chơi thật (10.000 trận/cây, chơi nhiều đời) để hiệu chỉnh hệ số, không phải sửa bằng cảm tính.

---

## Kiến trúc

```
src/
  core/       rng.ts          deterministic PRNG + hash
              types.ts        DNA, Plant, Skill, Growth model
              store.ts        GameStore: state, economy, actions, persistence
              room.ts         RoomClient / HostRoom (server-authoritative)
  config/     elements.ts     8 hệ + counter graph
              species.ts      5 giống nền
              traits.ts       34 trait (mọi cái mạnh đều có giá)
              genePackages.ts 20 gene package + drawback + counter
              skills.ts       delivery/effect/modifier + cách đặt tên
              rarity.ts       bảng C→SSS, pity, interpolation
              balance.ts      tier budget, stat cost, synergy, forbidden combos
              careActions.ts  7 hành động chăm
  genetics/   genomeGenerator.ts  trộn gene → mutation → package → build → fit budget
              skillGenerator.ts   sinh chiêu từ gene + tiến hoá theo cấp
              names.ts            đặt tên cây
              ecrCalculator.ts    đo ECR bằng mô phỏng
              benchmarkRoster.ts  11 cây benchmark cố định
  growth/     care.ts         công thức tăng stat theo gene
              stages.ts       vòng đời, offline progress, awaken
  battle/     engine.ts       mô phỏng tick deterministic + BattleSession
              battleView.ts   render trận, điều khiển, animation
  economy/    shop.ts         giá bán, câu quality, đơn NPC
  render/     plantRenderer.ts  vẽ cây từ visual gene
  ui/         app.ts + screens/  router, 5 màn hình, sheet
tools/        4 bộ test + balance-report
docs/         đặc tả gốc (16 file)
```

### Ba quyết định thiết kế đáng chú ý

**1. Sinh rồi mới cân — không cân trước.**
Bản đầu generator *nhân tỉ lệ* chỉ số trước khi tính budget, khiến mọi cây sinh ra yếu và kiểm tra budget trở nên vô nghĩa. Đúng thứ tự trong `docs/15 §10` là: sinh tự do → định giá → trừ bù. `fitToBudget` dùng **bisection** vì build value đơn điệu theo hệ số biểu diễn; một bước nhân tỉ lệ đơn thuần sẽ dao động (stat value có độ dốc ~450 điểm cho mỗi 1.0 scale).

**2. Giá skill phải tính cả hồi chiêu.**
Ban đầu `budgetCost` là hằng số, nên một chiêu hồi 3 giây và một chiêu hồi 9 giây có cùng giá — tức là chiêu nhanh là sát thương miễn phí và thống trị mọi kèo. `docs/15 §12` yêu cầu tính cooldown; giờ `cdFactor` định giá nó. Tương tự, `actionSpeed` được định giá theo **hiệu suất thực tế** chứ không theo giá trị thô, vì engine giảm dần lợi ích của tốc độ.

**3. Skill yếu hơn bị giảm công, không bị xoá.**
`trimNonStatOverBudget` giảm `power` trước khi bỏ chiêu. Bỏ chiêu dồn toàn bộ budget vào chỉ số thô, tạo ra "cây chỉ số" đánh bại mọi benchmark cân bằng — lỗi tệ hơn nhiều so với một chiêu yếu.

---

## Điểm chưa hoàn thiện

- **Matchmaking xếp hạng** — ECR đã đo và sẵn sàng dùng, nhưng chưa có hàng đợi xếp hạng thật.
- **Reconnect** — trận phòng chạy trên host; nếu host đóng tab, trận dừng. Cần worker thật.
- **Backend thật** — `BroadcastChannel` chỉ phục vụ 2 client trên một máy. Giao thức `RoomMessage` đã tách transport, nên đổi sang WebSocket Worker là thay lớp truyền tải (xem `docs/11`).
- **Cân bằng 47-53%** — xem mục tiên chỉnh ở trên.
- **Chợ người chơi, escrow, thuế** — ngoài phạm vi MVP (`docs/16`).

## Cài đặt lại

Bấm ⚙ trên thanh trên cùng để xoá save và bắt đầu vườn mới.
