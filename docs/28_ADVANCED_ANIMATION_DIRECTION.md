# Advanced Animation Script: Botanical Glass Motion

Ngày 10/10/2026. Đặc tả nâng animation, đọc cùng docs 26–27. Đây là target thiết kế và triển khai, không phải hiệu ứng đã có hoặc đã đạt chỉ số.

## 1. Mục tiêu

Game đẹp khi đứng yên và sống động khi tương tác. Cây phải có trọng lượng, lá có độ mềm, nước có điểm chạm, chiêu có hướng và lai có quá trình hình thành. Không chỉ lắc cả SVG, thêm particle và flash.

Ba cấp cảm giác: **êm khi ngắm — rõ khi chăm — có lực khi đấu**. Không áp cùng spring/bounce cho mọi vật thể. Không dùng camera rung hoặc glow để che hình cây yếu.

### Nền code phải đọc trước

- `src/ui/fx/gardenFx.ts`: water, stage/unlock marks, reward/spend cues.
- `src/ui/screens/planting.ts`: ritual đơn/batch, reveal, skip và timers.
- `src/ui/fusion.ts`: fusion/reveal/reduced motion.
- `src/battle/battleFx.ts`: event-driven FX layer và anchors.
- `src/battle/juice.ts`: impact weight, shake, poses, hit-stop và destroy.
- `src/battle/battleView.ts`: engine event consumption, pause/speed và lifecycle.
- `src/core/prefs.ts`, audio modules: preferences và sound lifecycle.

Giữ engine logical clock, event semantics và API đang dùng. Audit effect ownership trước khi thêm lớp mới; một event không được chạy cả FX cũ và mới trùng nhau.

## 2. Motion tokens

| Token | Target | Dùng cho |
| --- | --- | --- |
| instant | 80–120ms | Press, focus cue |
| quick | 160–220ms | Selection, segmented, tool armed |
| settle | 240–360ms | Sheet, pose recovery, stat feedback |
| care | 450–800ms | Tưới/bón/tỉa/music care |
| ceremony | 1200–1800ms | Plant/fusion/rare reveal; có skip |
| ambient | 3500–7000ms | Plant idle, background foliage |

Ease đề xuất: UI enter `cubic-bezier(.2,.8,.2,1)`; exit `cubic-bezier(.4,0,1,1)`; organic idle sinusoidal, không ease-in-out reset mạnh ở loop boundary. Đây là token khởi điểm, phải chỉnh qua prototype.

Spring dùng có giới hạn cho leaf/pose settle, không chữ/HP/log. Sau overshoot nhỏ, vật thể phải về pose ổn định; không rung dai. Đơn vị choreography là ms, nhưng timeline runtime dùng clock phù hợp context.

## 3. Layer, pivot và blending

### Scene layers

World background → distant foliage/clouds → plot bases → actors/plants depth-sorted → local action FX → floating numbers/status → labels/HUD → tools/navigation → modal.

VFX không intercept pointer. HUD không nằm trong subtree camera shake/scale. Labels không sway theo cây. Shadow theo root pose vừa đủ, không theo từng leaf.

### Plant rig layers

```text
plant-root-anchor
  locomotion/attack-wrapper
    hit/recoil-wrapper
      stem-rig
        leaf-cluster-rigs
        bloom-rig
        fruit-rigs
        accessories/trait-rigs
```

Không mọi layer đều cần DOM wrapper riêng: dùng groups hoặc composited transforms theo renderer. Mục tiêu là ownership riêng, không một element bị idle và attack cùng ghi `transform`.

### Priority

Death/transform > attack/cast > hit reaction > care/celebration > idle. Priority chỉ quyết định presentation, không bỏ engine event. Ví dụ đang cast bị hit: giữ cast root, thêm recoil nhỏ ở hit layer; không reset cast pose về idle.

Idle weight giảm khi action bắt đầu và phục hồi 200–350ms sau action. Battle plant hướng về đối thủ, garden plant hướng tự nhiên. Root anchor ổn định khi bloom/fruit lắc.

## 4. Cây sống: idle nâng cao

Không tất cả cây đung đưa như nhau. Motion profile theo grammar và body parts, derive phase từ ID; geometry seed không phụ thuộc thời gian.

| Grammar | Idle | Secondary motion |
| --- | --- | --- |
| Rosette | Tán thở rất nhẹ, không scale toàn tile | Lá ngoài trễ 100–180ms |
| Bush | Cụm tán nghiêng lệch nhau | Một số lá xoay cuống, không cả cụm đồng pha |
| Tall stem | Thân uốn từ root ±0.5–1.5° | Bloom trễ 120–220ms, fruit giữ trọng lượng |
| Vine | Sóng nhẹ dọc đoạn thân | Đầu vine cong, không dịch gốc |
| Mushroom | Thân/mũ settle mềm | Mũ phụ lệch nhịp, không squash vô hạn |
| Thorn crown | Ít sway, pose cứng hơn | Gai không rung như lá mềm |
| Succulent | Chuyển động thưa | Lá dày có inertia, không flutter nhanh |
| Flowering fan | Cánh mở/khép rất nhỏ | Center ổn định, mép cánh flutter nhẹ |

Idle cycle 3.5–7s; không liên tục hít-phồng toàn cây. Những cây có mắt theo gene hiện có được blink thưa khoảng 6–12s, phase riêng; không thêm mắt cho mọi loài. Không auto thêm gameplay mood state để diễn biểu cảm.

Wind event cosmetic ngắn: cây trước phản ứng rồi cây sau lệch 80–160ms theo vị trí. Không cả vườn cùng nghiêng đúng một nhịp. Hidden/offscreen cây ngừng rig chi tiết.

## 5. Chất kính trong animation

- Rim highlight đổi theo pose/selection, không một ánh sáng chạy vô tận quanh mọi ô.
- Giọt nước có squash lúc chạm rồi ripple cục bộ trên bề mặt phù hợp.
- Cánh/lá trong vừa phải ở cạnh, không pulse opacity làm cây khó đọc.
- Shield materialize bằng edge → tint → settle, mất bằng shrink/fade hoặc fracture nhỏ.
- Press kính nén khoảng 1–2% trong 100ms; release về trong 180ms, không phóng to che control bên cạnh.
- Selection lens đi 160–220ms giữa lựa chọn, nhưng interaction state cập nhật ngay.
- Không animate blur radius, không backdrop-filter từng giọt/lá/skill slot.

## 6. Gieo cây: shot-by-shot

Domain result phải có trước success ritual. Cùng Plant ID và geometry ở ritual/reveal/tile; không một mầm stock biến thành cây không liên quan.

| Mốc từ success | Shot | Chi tiết |
| --- | --- | --- |
| 0–120ms | Chọn điểm gieo | Bệ nổi nhẹ 2px, rim sáng một lần |
| 120–300ms | Hạt tới ô | Arc ngắn có chiều sâu; shadow nhỏ đi cùng |
| 300–480ms | Hạt chạm đất | Squash hạt, đất nén; 4–6 hạt đất nhỏ |
| 480–720ms | Đất khép | Soil response cục bộ, không rung toàn scene |
| 720–1100ms | Mầm mở | Thân dựng từ gốc, lá mở từ cuống |
| 1100–1450ms | Settle | Tán trễ, shadow ổn định, tên/result hiện |

Camera không zoom toàn app. Nếu ceremony modal cần scene riêng, giữ orientation và representation chính xác. Seed-stage vẫn là seed-stage, không dựng mature art trái dữ liệu.

Batch planting: một nhịp gieo nhóm, số ô/seed thật; stagger 60–100ms với total ceremony bounded ≤1.8s. Không bắt người chơi xem 24 lễ gieo nối tiếp. Skip và reduced motion hiện nhóm kết quả đầy đủ.

## 7. Chăm cây: từng action có vật lý riêng

### Tưới — 650ms target

0–120ms bình/vòi nghiêng; 120–350ms dòng nước tới gốc; impact giọt phân tán 3–6 điểm; 250–500ms đất đổi sắc; 350–650ms lá đáp lại và settle. Nước không đi xuyên toàn cây như confetti.

Nước ở actor tool phải tới đúng anchor cây. Khi user chăm trực tiếp, cue bắt đầu từ tool/điểm thao tác hợp lý, không tự sinh một bàn tay khổng lồ.

### Bón — 550ms target

0–120ms ném hạt dinh dưỡng; 120–300ms hạt vào gốc; 300–450ms một đường sáng tinh tế theo thân; 450–550ms settle. Gain number hiện theo kết quả thực; không mỗi leaf một số +XP.

### Tỉa — 450ms target

Tool approach → snip → leaf/branch phản ứng → settle. Không xóa bộ phận DNA/render vĩnh viễn nếu domain không đổi; chỉ chuyển động cosmetic phù hợp. Không giả tỉa một hoa rồi detail vẫn hoa khác.

### Sunlight/music/advanced care

Sunlight: hướng sáng cục bộ và lá hướng nhẹ, không full-screen yellow flash. Music: motif nhỏ theo cue, bloom/leaf đáp nhẹ, không biểu tượng nốt nhạc bay vô hạn. Advanced care có color/motif riêng theo action thật; mutation chỉ diễn khi result có mutation.

### Failure/cooldown

Đưa reason gần hành động, icon/tool settle; không success particles, không âm reward. Không shake camera vì thiếu tiền. Cooldown completion cue một lần khi thực sự chuyển ready.

## 8. Growth, unlock và reward

Stage-up giữ root anchor: stem/leaf/bloom thay đổi theo stage; phần mới xuất hiện theo growth sequence. Nếu topology khác và không morph ổn, dùng masked reveal/crossfade đẹp thay vì path morph vỡ.

Unlock plot: cloud veil tách và bệ lộ ra, 500–800ms; label/CTA có ngay, không chặn tương tác. Không 12 ô mở đồng thời cùng lễ dài.

Reward fly: tối đa 3–5 tokens đại diện, số tổng đúng; paths tránh modal và HUD quan trọng. Giá trị wallet lấy từ settled state, không tăng dần rồi ghi đè số thật. Token tới ví chỉ là acknowledgment.

Level-up queue: một focal celebration tại một thời điểm; stage/care/level event không tạo ba overlay cùng lúc. Summary nhiều cấp hiển thị cấp cuối và phần mở khóa thật.

## 9. Người làm vườn: walk cycle và thao tác

### Walk cycle 700–1000ms

Contact → down → passing → up, lặp theo tốc độ quãng đường. Footstep phase khớp chân chạm; root di chuyển ổn định, chân không trượt trên mặt đất. Tay ôm tool có inertia vừa; mũ/tạp dề follow nhưng không xuyên cơ thể.

Không chạy vòng ngẫu nhiên quanh cây. Đường đi có mục tiêu từ work queue; stop trước gốc/bệ và quay mặt vào cây. Turn 100–180ms, không mirror đột ngột khi đang tưới.

### Work

Water: tay đưa bình → nghiêng → nước → dựng bình → acknowledgment. Fertilize: lấy hạt → rải sát gốc → đóng túi. Prune: đưa kéo → một nhát → thu tool. Music: một động tác/cue ngắn, không biểu diễn 10 giây giữa vườn.

Mỗi clip có tool attachment anchor, contact/event markers và end pose. Work marker chỉ phát presentation VFX/SFX, không gọi store care/reward. Trong batch đã settle, actor đang diễn lại công việc theo doc 27.

Idle có kiểm tra bình/ngồi nghỉ nhẹ với khoảng nghỉ dài; không liên tục hút chú ý. Hết buff: cất tool, rời đường gần nhất. Target mất khi work: thu tool và chọn lại job, không tạo error flash trên cây đã bán.

## 10. Lai: transformation choreography

### Scene preparation

Chọn A/B: portrait vào bệ bằng translate/fade 200ms, root giữ ổn định; protocol đổi motif 180ms. Preview hiện ngay, không đợi hiệu ứng bệ. Cây bố mẹ luôn nhận ra được.

### Reveal 1600ms target

| Mốc | Hành vi |
| --- | --- |
| 0–200ms | Viền bệ sáng, bố mẹ giữ pose, gene được highlight |
| 200–500ms | Hai motif từ bộ phận liên quan đi vào tâm |
| 500–850ms | Khối chính/thân con hình thành |
| 850–1200ms | Lá mở theo nhánh, hoa/quả/trait motif thêm |
| 1200–1450ms | Material/rim settle, tán có secondary motion |
| 1450–1600ms | Tên/rarity/lineage/result action ổn định |

Không preview chính xác hình con trước outcome nếu chưa settle. Không chế highlight “gene kế thừa” trái dữ liệu. Nếu report chưa có attribution, dùng motif giao thoa chung thay vì claim cụ thể.

Rare outcome khác bằng một shot/motif tinh tế, không mặc định flash/rung mạnh hơn. Người chơi được ngắm result lâu tùy ý, không auto-dismiss. Skip gọi completion một lần và hiện result, không chạy lại âm celebration muộn.

## 11. Chiêu thức: pose, đường đi, impact

FX bám `SKILL_CAST_STARTED`, resolve/damage/heal/shield/status/morph/finish events hiện có. Không thêm windup cosmetic dài sau khi HP đã đổi rồi báo là chiêu chưa trúng.

### Projectile

Cast pose ở bộ phận phát; projectile có silhouette riêng hạt/gai/quả theo motif; trajectory rõ; impact nhỏ theo weight. Trail giảm density khi speed cao. Muzzle anchor di chuyển cùng pose, không bắn từ giữa thẻ.

### Melee/vine/root

Anticipation co thân → thrust/extend tới target → impact → recoil → settle. Root đi theo ground plane; vine có segment chain, không đường thẳng xuyên UI. Nếu engine delivery không có travel thời gian thật, dùng clip ngắn theo event contract, không dời simulation damage.

### Heal/shield/status

Heal: light từ gốc, leaf opening, số hồi ở lane riêng. Shield: vòm/rim kính, hit ripple và expire; phải phân biệt buff đang active với cosmetic residual. Status: icon luôn đọc được; material local dưới text, không blanket tint phủ đối thủ.

### Morph

Pose chuyển cấu trúc theo form thật, main mass trước, phụ kiện sau. Nếu không có topology-compatible morph, dùng blend/occlusion có chủ đích. Kết thúc theo event, không timer UI tự đoán. Đang morph bị hit vẫn giữ identity và anchor.

### Impact weight targets

| Weight | Recoil mục tiêu | Cosmetic hit-stop | Particles mobile |
| --- | --- | --- | --- |
| Light | 1–2px, 100–160ms | 0–20ms | 3–5 |
| Heavy | 2–4px, 160–240ms | 20–40ms | 5–8 |
| Crit | 3–5px, 180–280ms | 35–55ms | 6–10 |
| Kill | Pose kết thúc có trọng lượng | Tối đa 60ms nếu phù hợp | 8–12 |

Hit-stop chỉ dừng một số visual channels, không dừng engine, network hoặc UI input. Camera shake optional và nhỏ: biên độ tối đa khoảng 2–3px trên mobile; không mọi hit đều shake. No shake/recoil translation ở reduced motion.

## 12. Battle controls và result

Skill pressed cue bắt đầu dưới 100ms; selected/pending state phản ánh intent thật. Cooldown sweep dùng clock/state hiện hành; ready cue một lần. Không recreate buttons mỗi tick để animate.

HP bar giữ giá trị số cập nhật đúng; fill tween tối đa 160–220ms, có delayed-loss trail nhẹ nếu không gây hiểu nhầm. Chí mạng không làm HP number nhảy khỏi box. Multiple damage cùng tick merge presentation đúng tổng hoặc xếp lane có thứ tự.

Victory: pose ngẩng/tán mở → result xuất hiện, 500–800ms; defeat: hạ pose, fade nhẹ → result. Không cây biến mất hoàn toàn nếu cần xem result. Log/XP/reward không chồng ba cinematic.

Replay/fast-forward không chơi jingle/reward fly như nhận thưởng mới. Battle finish hủy projectiles/residual đang chạy hoặc settle nhanh để màn kết quả sạch.

## 13. Chuyển cảnh và micro-animation

Route transition 160–220ms: fade/translate nhỏ vùng nội dung, chrome giữ ổn định. Không trượt cả thế giới từ trái sang phải ở mọi tab. Nếu dùng shared element cây, giữ ID và không clone duplicate SVG defs.

Sheet đi từ trigger/ngữ cảnh hợp lý; scrim fade riêng, nội dung đọc được ngay. Close không animate làm người chơi bị giữ input vài giây. Focus semantics không phụ thuộc animationend.

Chọn hạt/parent/skill: edge highlight, portrait settle, text không jump. Search/filter không stagger mọi item mỗi keypress. List entrance giới hạn 4–6 item đầu, bỏ stagger khi refilter.

Button hover chỉ ở fine pointer; touch không stuck hover. Loading indicator có kích thước ổn định; trạng thái lỗi bền, không chỉ rung một lần rồi biến mất.

## 14. Nhạc, ambience và animation

Background clouds/foliage có rhythm thưa, không nhảy theo beat. Transition soundtrack/stems có thể sync bar, nhưng action feedback không chờ bar để bắt đầu.

Care VFX marker và SFX từ cùng presentation event, idempotent. Actor steps sync contact marker, rate-limit khi nhiều bước. Mute không tắt visual information, reduced motion không tự tắt nhạc.

Rare reveal jingle đúng một lần; skip không để timer âm thanh phát sau khi scene đóng. Ducking có owner/token để hai effect không restore gain sai thứ tự.

## 15. Runtime architecture và effect ownership

Khuyến nghị mở rộng utilities hiện có, không tạo animation framework mới nếu CSS/WAAPI + một driver đủ. UI gestures dùng monotonic clock; combat dùng battle presentation time có pause/speed mapping; expiry gameplay dùng domain clock, không trộn lẫn.

Contract tham khảo, chưa phải API đã tồn tại:

```ts
type MotionContext = "garden" | "battle" | "ceremony" | "ui";
type MotionChannel = "root" | "pose" | "hit" | "foliage" | "fx";
interface MotionHandle {
  cancel(reason: "unmount" | "skip" | "target-lost" | "replaced"): void;
  finishVisual(): void;
}
interface MotionRequest {
  ownerId: string;
  eventId: string;
  context: MotionContext;
  channel: MotionChannel;
  priority: number;
  durationMs: number;
}
```

Mỗi effect owner quản lý timers, RAF/WAAPI handles, nodes và callbacks. `destroy/cancel/finishVisual` idempotent. Không callback sau unmount; completion báo một lần. Completion không credit/debit/settle game.

Scheduled jobs có fallback timeout nhưng cũng được owner cancel; audit watchdogs/timers ở planting/fusion/garden/battle trước khi thêm. Reduced-motion đổi lúc effect chạy phải settle/cancel an toàn, không để pending UI.

Event dedupe theo engine seq/battle instance hoặc unique garden action ID; không dùng text/name làm khóa. Replayed scene reset visual dedupe đúng instance, không reset reward guards.

## 16. Budgets và quality presets

Các con số là target khởi điểm, profiling có thể đề xuất chỉnh với evidence.

| Budget mobile visible | Đẹp | Cân bằng | Nhẹ |
| --- | --- | --- | --- |
| Plants rig chi tiết | 4–5 | 2–3 | 1 selected hoặc tĩnh |
| Cosmetic particles cùng lúc | ≤80 | ≤40 | ≤16 |
| Actor work | Full clip | Full clip, ít secondary motion | Clip ít frame/cue ngắn |
| Trail/rim | Chi tiết có giới hạn | Giảm density | Static/material cơ bản |
| Camera | Ít, optional | Rất ít | Không shake |

Particles hết budget: bỏ ambient/old residual trước, giữ impact chính và thông tin gameplay. Không nhận một event rồi vẽ success sai chỉ vì budget hết; số/status vẫn cập nhật.

Một scheduler/coalesced jobs; không RAF riêng mỗi lá. Reuse geometry/anchors giữa các frame, invalidate theo resize/scroll/pose cần thiết. Không layout read/write ping-pong.

Không animate width/height/top/left của layout controls hoặc backdrop blur. Vector path morph/SVG material chỉ dùng cho vài đối tượng tiêu điểm đã profile; không phải mọi lá mỗi frame. Không `will-change` vô hạn trên toàn DOM.

## 17. Reduced motion và interruption matrix

| Effect | Reduced motion | Skip/unmount |
| --- | --- | --- |
| Idle/wind | Static pose | Stop driver |
| Planting | Hiện settled plant/result, fade ≤120ms | Result retained, nodes removed |
| Care | Local tint/icon/stat cue | Không action lần hai |
| Actor walk | Đứng gần target/pose đổi nhẹ | Queue view cleared, domain tiếp tục |
| Fusion | Static child + changes/lineage | Result retained, callback once |
| Attack | Short local highlight + numbers | Cancel residual, state đúng |
| Morph | State/form đổi không chuyển động lớn | Event state giữ đúng |
| Reward fly | Wallet acknowledgment, không đường bay | Wallet không đổi lần hai |
| Sheet/route | Fade ngắn/instant | Focus luôn đúng |

Tab hidden không tích lũy hàng nghìn frames/particle; resume từ state hiện tại. Không phát cả lịch sử combat/care cũ thành burst. Nếu cần recap, dùng summary thật.

## 18. Nghiệm thu animation

| ID | Loại | Điều kiện đạt | Bằng chứng |
| --- | --- | --- | --- |
| MOT-01 | H0 | Animation không mutate DNA/wallet/XP/settlement | State equality + spies |
| MOT-02 | H0 | Một event → đúng effect/cue một lần; duplicate không double reward | Event replay tests |
| MOT-03 | H1 | Idle/hit/cast không overwrite transform sai channel | Video + pose assertions |
| MOT-04 | H1 | Root/framing không trượt/crop ở mọi grammar/size | Bounds + contact sheet |
| MOT-05 | H1 | 0 labels/HP/controls bị VFX che trong stress fixture | Screenshots + protected-region check |
| MOT-06 | H1 | Pause/speed/finish/replay không backlog sai scene | Fake timeline + battle tests |
| MOT-07 | H1 | Skip/unmount/target lost gọi completion ≤1 và cleanup đủ | Lifecycle tests |
| MOT-08 | H1 | 20 route/sheet cycles và 10 fights: active effects/timers về baseline | Instrumented counts |
| MOT-09 | H1 | Reduced motion thay đổi giữa clip vẫn dùng được, không overlay kẹt | Browser tests |
| MOT-10 | H1 | Scene+actor+audio đạt frame targets doc 27 trên device đã chốt | Production profiling |
| MOT-11 | Q | ≥4/5 reviewer nhận đúng action chăm/skill không nhìn log | Blind clip recognition |
| MOT-12 | Q | Median độ đẹp/chuyển động ≥8/10; mỏi/phân tâm ≤2/10 sau 15 phút | Panel + task notes |
| MOT-13 | H1 | Mọi quality preset giữ gameplay information và action feedback | Side-by-side/task evidence |
| MOT-14 | H1 | Loop boundary/pose end không snap rõ khi xem 0.5× | Slow-motion review |

Không chỉ đánh giá một clip cinematic. Panel phải xem idle 30s, 20 lần chăm liên tiếp, batch planting, helper nhiều cây, 5 lượt lai, 10 trận và reduced-motion journey.

## 19. Work packages nâng animation

1. **M00 Audit:** map event → FX → owner → cleanup → sound; ghi overlap/timer risks, không kết luận leak từ tên hàm.
2. **M01 Rig proof:** 8 grammar representative + root/leaf/bloom pivots, idle/action/hit blending; benchmark và review.
3. **M02 Garden:** planting đơn/batch, care actions, growth/unlock/reward, skip/cancel.
4. **M03 Actor:** walk/contact/tool markers/path/idle/work/leave và queue thật.
5. **M04 Fusion:** parent motif/child formation/result và rarity cue.
6. **M05 Combat:** delivery/effect mapping, pose/impact/HUD, pause/speed/replay.
7. **M06 UI/audio polish:** navigation/sheet/selection/ready, cue dedupe và ducking.
8. **M07 Quality gate:** profiling, presets, interruption, reduced motion, panel và evidence.

Mỗi package phải gửi video app thật normal/slow motion, timeline trace, test log, screenshot protected HUD regions và actual device performance. Không đánh dấu done chỉ vì thêm keyframes.

## 20. Prompt giao AI

```text
Nâng animation theo docs/28_ADVANCED_ANIMATION_DIRECTION.md và docs 26–27.
Đọc FX/juice/planting/fusion/garden/prefs hiện tại trước khi code.
Chỉ triển khai motion package được giao; giữ event/domain/save contracts.
Ưu tiên rig theo bộ phận và choreography, không thêm particle để che art yếu.
Tách transform channels; idle không overwrite cast/hit.
Hit-stop/camera là cosmetic, không dừng simulation/network/input.
Actor work markers không thực hiện care/reward lần hai.
Mọi effect có owner, dedupe, cancel, completion một lần và cleanup.
Đủ normal/reduced-motion/quality presets và interruption cases.
Xuất criterion ID -> actual -> evidence -> status,
kèm video app thật, tests và production profiling trên thiết bị xác định.
Không báo đẹp/mượt/hoàn tất nếu chỉ có concept hoặc chưa đo.
```
