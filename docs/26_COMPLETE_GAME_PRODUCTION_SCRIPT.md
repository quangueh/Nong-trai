# Script sản xuất toàn bộ game: Botanical Glass Garden

Ngày 10/10/2026. Tài liệu giao triển khai, không phải thông báo các tính năng đã được xây. Đọc cùng docs 21–25; bản này cụ thể hóa yêu cầu nhạc chill và người làm vườn nhìn thấy được.

**Đặc tả nghiệm thu chi tiết:** `docs/27_DETAILED_PRODUCTION_ACCEPTANCE_SPEC.md` quy định từng component/state/timeline, criterion ID, evidence và ngưỡng điểm. Khi giao AI phải đọc cả hai, không chỉ brief tổng này.

## 1. Brief bắt buộc

Làm game trồng, chăm, lai và chiến đấu bằng cây có chất lượng hình ảnh cao. Phong cách: vườn fantasy trên mây 2.5D, cây có hình khối rõ và Botanical Liquid Glass. Người chơi mở game muốn ngắm cây, nghe nhạc và chăm vườn; khi đấu vẫn đọc được chiến thuật.

Giữ Vite/TypeScript và pattern của repo. Đọc HEAD thực tế trước mỗi phase. Không dùng screenshot concept làm UI giả. Không sao chép nhân vật/asset/nhạc của game khác. Không đổi save, balance hoặc giá để phục vụ hình ảnh. Mỗi phase có sản phẩm chơi được, screenshot, test và giới hạn kiểm chứng.

Thứ tự ưu tiên: cây đẹp → vườn và chăm có cảm giác → người làm vườn → nhạc → lai → đấu → màn phụ → performance. Không chỉ thay CSS rồi gọi là redesign xong.

## 2. Kiến trúc màn hình

Năm mục chính: Vườn / Cây / Lai / Đấu / Chợ. Đấu chứa Vượt ải, Đấu trường, Phòng/Bạn bè, Xếp hạng. Giữ route/deep link cũ qua mapping. Account từ avatar, settings từ icon.

Mobile: viewport đầu thấy cây thật; nhiệm vụ gọn, dock kính không che công cụ chăm. Desktop: vùng chơi rộng, rail trái và inspector theo lựa chọn; không một điện thoại phóng to giữa màn hình.

Header chỉ hiển thị tài nguyên liên quan; ví mở đủ loại tiền. Trong trận ẩn dock để tránh rời trận vô tình. Bộ lọc, cây đã chọn và scroll được giữ theo route bằng ID.

## 3. Cây, chủng loài và gene

### Tạo hình

Nâng `src/render/plantRenderer.ts` và `plantGeometry.ts`, không chỉ đổi palette. Dựng 8–12 grammar silhouette có chủ đích: rosette, bush, cây thân cao, vine, cụm nấm, thorn crown, succulent, flowering fan; ánh xạ vào habit/body hiện có.

Mỗi cây có khối chính, khối phụ và focal point. Lá có cuống, mặt dưới, độ dày; hoa có lõi và cánh nhiều lớp; quả có cuống và shadow; thân không chỉ nét mảnh. Kính ở cuticle, giọt nước, mép cánh/tinh thể; không mọi cây là vật thể trong suốt.

Giữ nguồn sáng trên-trái, contact shadow tại gốc. Tán chiếm phần lớn portrait nhưng không crop hoa/gai. LOD 64–96px bỏ chi tiết nhỏ; 160px đọc được bộ phận; 320px có material và rig chi tiết.

Gene thay đổi shape/posture/bloom/fruit/accent trong envelope cân đối. Cùng cây giữ identity qua Vườn, detail và battle. Không thay RNG stream làm mọi cây đổi ngoại hình mà không có visual-version/migration quyết định rõ.

### Danh mục loài

Audit registry trước khi thêm loài. Mỗi nhóm cần silhouette, fantasy, element, vai trò, kỹ năng, điều kiện mở và giá có ý nghĩa. Không nâng “đa dạng” bằng cách thêm hàng nghìn bản chỉ đổi hue/tên.

Tạo bảng coverage theo habit × element × vai trò × progression; tìm nhóm thiếu trước khi bổ sung. Loài mới phải đi qua validateGenome, budget/ECR, renderer benchmark và balance test. Không hứa mọi tổ hợp gene đều có skill mới.

### Benchmark

48 cây deterministic bao phủ giai đoạn, rarity, habit và gene extremes; render 96/160/320px trên ba nền. Chọn 12 cây tiêu biểu human review. Test silhouette/grayscale, bounds, SVG IDs đa instance và motion. Mỗi cây phải đẹp khi đứng yên, không phụ thuộc glow che hình.

## 4. Ô đất và thao tác chăm

Ô đất là bệ đảo/chậu 2.5D: shadow → thân bệ → mặt đất → cỏ viền → cây → viền chọn → label. Đất có độ xốp; bệ có rim kính/men; text không nghiêng theo perspective.

| Thao tác | Diễn biến hình ảnh | Mục tiêu thời lượng |
| --- | --- | --- |
| Chọn ô | Viền lens sáng, tool indicator hiện | 100–150ms |
| Gieo | Hạt rơi, đất khép, mầm mở, portrait kết quả | 1.2–1.8s; skip ngay |
| Tưới | Vòi/giọt chạm đất, đất ẩm, lá bật nhẹ | 450–700ms |
| Bón | Hạt dinh dưỡng vào gốc, thân sáng ngắn | 400–650ms |
| Tỉa | Một nhánh/chi tiết phù hợp chuyển động, cue kéo | 350–550ms |
| Chăm bằng nhạc | Motif nhỏ ở cây, hoa/lá phản ứng nhẹ | 500–800ms |
| Lên giai đoạn | Gốc giữ anchor, bộ phận mở/morph | 650–1000ms |

Các thời lượng là target cần test, không trì hoãn domain settlement. Cooldown/chi phí/lý do không hợp lệ lấy từ engine. Không tự thêm moisture stat vào save để làm đất đổi màu.

## 5. Người làm vườn tự động nhìn thấy được

### Nhân vật chốt

Một **người làm vườn nhỏ**, dáng tròn mềm, áo xanh ngọc, tạp dề màu coral trầm, mũ sáng và bình tưới kính màu. Đây là nhân vật làm việc trong world, không bot icon hoặc pet chạy trên UI. Không thêm lựa chọn skin/chủng loại ngay đợt đầu.

Kích thước khởi điểm 36–48px trên mobile, 48–64px desktop; scale theo scene chứ không theo font. Nhân vật vẫn thấy rõ cạnh cây nhưng không che label/HP. Shadow và góc nhìn đồng nhất với đảo.

### State machine

`hidden → arrive → idle → chooseTarget → walk → faceTarget → work → acknowledge → chooseTarget/idle → leave → hidden`.

Clip cần có: idle, walk trái/phải/xa/gần, tưới, bón, tỉa, chăm bằng nhạc, kiểm tra cây, vui nhẹ, nghỉ, đến/rời. Dùng sprite/rig thống nhất; không đổi hình nhân vật giữa các clip. Nếu dùng sprite, có manifest frame/duration/pivot/hitbox; atlas tải khi mở Vườn hoặc buff bắt đầu.

### Công việc và sự thật domain

Hiện `autoCareTick()` trả số thao tác, chăm tối đa một action mỗi cây mỗi tick; `autoCareCatchUp()` xử lý offline. Không gọi `care()` lần nữa khi animation work kết thúc.

Đề xuất event presentation sau **thao tác thành công**:

```ts
interface GardenerWorkEvent {
  id: string;
  plantId: string;
  action: CareActionId;
  occurredAt: number;
  source: "live" | "catchup";
}
```

Giữ return number cho caller cũ; thêm subscription hoặc batch result adapter nhỏ, chỉ chốt sau audit. Event chỉ ghi sau `res.ok`; dữ liệu diễn không là nguồn tính XP/reward. Không thêm mutable callback dùng chung giữa các GameStore.

Một batch có thể đã chăm nhiều cây cùng lúc trước khi nhân vật đi tới. Vì vậy UI mô tả nhân vật đang **diễn lại lượt chăm vừa thực hiện**, không hiển thị progress giả rằng XP chỉ nhận khi chạy tới. Nếu muốn thực sự chăm tuần tự theo bước chân, đó là đổi simulation riêng, cần balance/lifecycle test và không làm mặc định trong phase art.

Hàng đợi giới hạn; dedupe event ID. Tối đa khoảng 4 việc chi tiết hoặc 8 giây backlog là target ban đầu. Khi nhiều việc, nhóm các việc cùng vùng, hiển thị tổng thật rồi bỏ animation thừa; không phát lại toàn bộ offline catch-up trong vài phút.

### Đường đi

Tính anchor chân từ plot bounds trong tọa độ scene chung. Route trên lối đi giữa ô, không xuyên thân cây. Dùng graph waypoint/grid dựa layout; shortest path đơn giản đủ cho vườn nhỏ, không thêm physics engine.

Recompute khi resize/scroll/reorder hoặc ô biến mất. Target bị bán/lai/khóa trận thì hủy đoạn diễn phù hợp, không đụng dữ liệu. Offscreen không kéo camera bắt buộc; nhân vật có thể đi ra mép và hiện ở vùng mới với transition nhẹ.

Sprite `pointer-events: none`, không chặn chạm cây. Chỉ badge người làm vườn có nút mở detail: còn thời gian, thao tác vừa làm, cây đã chăm và nguồn buff. Timer đọc từ `autoCareUntil`, không timer riêng tự lệch.

### Tình huống bắt buộc

- Buff bắt đầu: nhân vật đi vào từ lối vườn, không popup chặn.
- Không cây hợp lệ: nghỉ cạnh bệ, trạng thái “Đang chờ cây có thể chăm”.
- Buff hết: hoàn tất/hủy visual hiện tại theo policy, rời vườn; không thêm action sau expiry.
- Rời Vườn: unmount actor/RAF; auto-care domain vẫn chạy theo policy hiện có.
- Quay lại/offline: tóm tắt lượt đã làm, không giả đang chăm cây đã nhận kết quả từ trước.
- Reduced motion: actor đứng gần cây, đổi pose/cue ngắn; không chạy vòng, vẫn có trạng thái công việc.
- Chất lượng Nhẹ: ít frame/particle hơn nhưng có actor và kết quả đúng.

## 6. Âm nhạc thật chill, không một vòng beep

### Direction

Original cozy botanical instrumental: felt piano mềm, nylon guitar/gentle pluck, marimba ít nốt, pad có texture, bass ấm vừa và ambient gió/lá/nước nhỏ. Không vocal, không EDM drop, không high-frequency sparkle liên tục, không tiếng chim/lá lặp dày.

Nền hiện tại trong `src/audio/music.ts` là procedural pad/pluck, mood calm/battle/silent. Giữ làm fallback nhẹ; soundtrack chính cần composition và sound design có chủ đích. Có thể dùng bản thu/samples có license hoặc nhạc sáng tác đặt hàng. Không mặc định có công cụ tạo nhạc hay tự nhận nhạc tổng hợp là “đã nghe rất hay”.

### Cue sheet

| Cue | BPM mục tiêu | Độ dài | Arrangement |
| --- | --- | --- | --- |
| Garden Day | 72–78 | 2–3 phút | Felt piano, pluck, pad; melody ngắn có khoảng nghỉ |
| Garden Evening | 64–70 | 2–3 phút | Mềm hơn, ít attack, pad ấm, bass thưa |
| Breeding Atelier | 74–80 | 90–150s | Motif gene bằng mallet/pluck, chờ đợi nhưng không căng |
| Battle | 88–98 | 90–150s | Cùng motif vườn, pulse/percussion nhẹ và bass rõ |
| Boss intensity | Đồng tempo battle | Stem | Tăng nhịp/pattern, không chỉ tăng volume |
| Victory | Theo nhạc đang chơi | 1.5–2.5s | Cadence sáng, thưởng gọn |
| Defeat | Theo nhạc đang chơi | 1–2s | Cadence dịu, không trừng phạt người chơi |
| Rare breeding | Theo atelier | 2–3s | Motif mở rộng; không còi/chime chói |

Hợp âm như add9/maj7/sus2 với voice-leading êm là lựa chọn khởi điểm; composer chọn theo mood, không random chord liên tục. Theme 4–8 ô nhịp phát triển thành A/B/bridge, không lặp một câu bốn nốt suốt phiên 30 phút.

### Music engine

- Một music bus, sfx bus và ambience bus. Một AudioContext được unlock bằng gesture thật.
- Track theo stem đồng tempo/loop length: harmony, melody, bass, pulse. Asset có BPM, bars, loopStart/loopEnd, format, loudness và license manifest.
- Ưu tiên loop authored không click. Kiểm tra tail/reverb qua boundary, không chỉ nối file MP3 có encoder padding.
- Đổi scene crossfade 2–4 giây hoặc stem transition ở bar boundary. Không restart nhạc khi mở sheet hoặc chăm cây.
- Battle intensity lấy phase/action pressure đã có, smoothing và hysteresis; không đổi mỗi tick.
- Event jingle duck music nhẹ khoảng 2–3dB rồi restore; limiter/headroom tránh clip.
- Mức mastering khởi điểm khoảng -18 đến -16 LUFS integrated, true peak dưới -1dBTP; kiểm tra mix thật trên loa điện thoại/tai nghe. Đây không phải guarantee nếu chưa đo.
- Lazy-load track; không decode mọi soundtrack lúc boot. Cache decoded buffers có giới hạn; không tạo source vô hạn.
- Mute/volume lưu riêng; đổi scene không bật lại mute. Tab hidden suspend hợp lý; resume không phát hàng loạt nốt cũ.
- Khi asset lỗi/offline, procedural fallback không chồng lên track cũ. Không âm thanh cũng chơi đủ mọi tính năng.

### SFX không gây mệt

Tưới dùng water cue mềm, bón dùng đất/hạt, bước chân rất nhỏ và chỉ gần actor, bấm UI click ngắn không metallic chói. Rate-limit sound chăm hàng loạt; variation bằng pitch/sample có giới hạn. Không phát footstep từng frame hoặc sound cho mỗi lá.

Attack/impact/shield/heal có timbre riêng; combat log không khiến mỗi dòng phát một cue. Khi pause phải nghe/nhìn thấy trạng thái đúng; không nhầm unlock audio với resume cue.

### Script đặt sáng tác nhạc

```text
Sáng tác nhạc original cho game vườn thực vật fantasy chill.
Theme ấm, tinh tế, nhiều khoảng thở; không vocal, không mô phỏng ca khúc có bản quyền.
Garden Day 76 BPM, 4/4, 48 bars: intro 4, A 16, B 16, return/loop 12.
Felt piano, nylon pluck, pad mềm, bass thưa, percussion rất nhẹ.
Xuất full mix và stems harmony/melody/bass/pulse cùng độ dài và điểm bắt đầu.
Loop liền mạch có xử lý reverb tail; giữ cùng theme cho Atelier/Battle.
Kèm BPM, key, loop points, source/license, WAV master và web delivery phù hợp.
Đánh giá bằng nghe thật tối thiểu 15 phút, không chỉ waveform hoặc tên preset.
```

## 7. Lai giống: script tương tác

Chọn A → chọn B → protocol → preview → xem chi phí/hậu quả → xác nhận → domain settle → reveal → cây mới/detail.

Atelier có hai bệ kính và cây lớn. Gene liên quan được highlight bằng nhãn thật. Protocol đổi motif/chất liệu bệ và ảnh hưởng được giải thích rõ, không chỉ đổi tint.

Reveal: nhận silhouette → thân hình thành → tán/hoa mở → đặc tính xuất hiện → đứng yên cho ngắm. Không white flash kéo dài. Skip hiện đủ kết quả ngay; không bỏ reward/lineage.

Khác biệt con phải đọc được: shape, posture, bộ phận và trait, không chỉ màu. Xác suất preview dùng distribution domain đã xác minh. Bố mẹ bị tiêu thụ có confirmation cả tên/portrait. Không tự thêm mode hợp nhất, bảo tồn bố mẹ hoặc trait mới chưa có logic/test.

## 8. Chiến đấu: script tương tác và VFX

Chọn cây → đọc đối thủ/điều kiện → đổi stance nếu muốn → bắt đầu → đấu → kết quả → tiếp/đổi cây/replay.

Scene đầy chiều sâu; hai cây đối mặt, gốc và impact point rõ. HUD nằm ở biên, số HP và timer có nền đọc được. Skill slot kính: icon vật thể riêng, cost, cooldown số và sweep; tên không làm toolbar nhảy.

Mỗi chiêu có anticipation/cast/travel/impact/residual/recovery. Hạt/gai bắn từ đúng bộ phận; root/vine sát đất; shield là vòm kính; heal là sinh trưởng; debuff có dấu hiệu và status icon. Mapping theo skill thật, không thêm ability giả.

VFX nhận engine events, không tự roll damage. Time scale nhanh có clip rút gọn; không queue trễ sau trận. Damage numbers có lane tránh tên/HP. Rarity cao không mặc định nhiều white flash/shake.

Pause, auto, speed, stance, focus, room reconnect và replay giữ đủ. Replay không settle thưởng nữa. Log là view phụ, không chiếm nửa màn hình thường.

## 9. Màn phụ vẫn phải hoàn chỉnh

Cây: Cây của tôi/Bách khoa tách rõ; loài không còn sở hữu vẫn xem được. So sánh tối đa hai cây, stat order nhất quán.

Chợ: giữ Hạt/Vật tư/Đất/Quy đổi/Đơn hàng; catalogue phân trang, search toàn phạm vi đúng, quest pin giữ lại. Exchange hiển thị fee/thực nhận/cap từ domain; double submit bị chặn.

Tài khoản: login/link/sync/conflict/logout, form labels/errors/focus đủ. Xung đột có dữ liệu local/cloud và lối chọn rõ. Không bỏ auth policy để làm flow đẹp.

Settings: âm nhạc, SFX, ambience nếu triển khai; mute; motion; transparency; quality. Dùng slider/toggle/segmented đúng loại dữ liệu. Không thêm setting có UI nhưng không tác dụng.

## 10. Kiến trúc đề xuất và giới hạn hiệu năng

| Vùng | Thay đổi đề xuất |
| --- | --- |
| `src/render/*` | Grammar, material, LOD, bounds và rig metadata |
| `src/ui/screens/plotCard.ts`, `garden.ts`, `gardenBar.ts` | Bệ đảo, chăm, anchors và tool states |
| `src/core/store.ts` | Presentation event auto-care sau success; giữ caller contract |
| Module gardener mới | Actor state machine, path, bounded queue, teardown |
| `src/audio/music.ts`, `audio.ts` | Track/stem manager, buses, fallback, mix/lifecycle |
| Asset manifest mới | Artwork/sprite/music metadata và license |
| `breeding.ts`, fusion/FX | Atelier, preview, confirmation, reveal |
| `src/battle/*`, arena/ascent/result | Scene, pose, skill mapping, HUD và timeline |

Tên module/path asset mới chỉ chốt sau audit import và conventions hiện tại. Không tạo framework mới để phục vụ một actor.

Một scheduler cho motion; không RAF riêng từng lá. Chỉ actor visible chạy; ngừng khi unmount/hidden. Kính minh họa không backdrop-filter từng vật thể. Scene canvas/WebGL chỉ thêm nếu benchmark chứng minh cần; nếu dùng 3D dùng Three.js, không chuyển toàn game sang 3D theo cảm tính.

Chất lượng Đẹp/Cân bằng/Nhẹ; reduced motion riêng. Art tĩnh phải đẹp ở mọi preset. Không thuê nhiều worker/nhân vật gây mất đọc scene khi chưa đo.

## 11. Các phase giao AI và acceptance gate

1. **Baseline:** đọc HEAD, giữ local changes, chạy test, chụp mọi route, inventory assets/features.
2. **Art proof:** ba concept lớn Vườn/Lai/Đấu + 12 cây + actor sheet; tham khảo nguồn chính thức trong doc 23. Chốt trước khi code toàn app.
3. **Plant foundation:** renderer/LOD/bounds + benchmark 48 cây; identity không đổi ngẫu nhiên; render tests.
4. **Garden slice:** trồng/chăm/detail/task/seedbag đủ; đẹp mobile/desktop/solid; transactions giữ nguyên.
5. **Visible gardener:** live event adapter, rig/path/work/expiry/catch-up; queue bounded; không double care/reward.
6. **Audio:** composition/assets licensed + buses/stems/fallback; nghe thật và test autoplay/mute/lifecycle.
7. **Breeding:** atelier/protocol/preview/confirmation/reveal/result; genetics regression và skip/reduced motion.
8. **Battle:** scene/pose/VFX/HUD/lobby/ascent/replay/result; determinism/room/settlement/lifecycle.
9. **Whole-app parity:** collection/shop/account/social/settings; không mất route/features.
10. **Release:** performance/accessibility/Safari thật, production PWA, regression và report trước/sau.

Không bypass lỗi PWA/test browser đã ghi ở docs 24–25 để tự tuyên bố release ready. Nếu sửa Worker runtime phải commit/deploy theo AGENTS.md; đây không là lý do tự deploy từ phase concept.

## 12. Bộ test riêng cho người làm vườn và nhạc

- Một action auto-care thành công → một presentation event; rejected action → không event.
- Actor chạy/work không gọi care/grant XP/claim reward.
- Batch nhiều cây, duplicate event, queue quá dài, plant bán/lai/khóa, resize/scroll và rời route.
- Offline catch-up nhiều lượt → summary đúng, không replay toàn timeline hoặc trừ tài nguyên lần nữa.
- Expiry boundary, extension buff, reduced motion, quality Nhẹ và tab hidden.
- Đổi scene/mở sheet không restart track; mute tồn tại qua mọi transition.
- Không AudioContext trước gesture; resume không burst; chỉ một music bus.
- Track fail/decode fail/offline/no-audio → fallback hoặc silence đúng, không crash.
- Stem cùng phase, loop không click, peak không clip, ducking restore và source nodes cleanup.
- Nghe Garden ít nhất 15 phút; Battle ít nhất 10 trận; ghi đánh giá thực, không kết luận hay chỉ từ test code.
- Viewport 320/390/430/768/1366/1920px, portrait/landscape: actor/particle không che controls.

## 13. Prompt tổng để giao AI triển khai

```text
Triển khai game theo docs/26_COMPLETE_GAME_PRODUCTION_SCRIPT.md,
đồng thời đọc docs 21–25 và AGENTS.md.
Đọc mã hiện tại, giữ mọi thay đổi người khác. Chỉ làm phase được giao.
Không kết thúc ở checklist: phase implementation phải có code chạy được và test.

Mục tiêu: cây có hình khối đẹp, vườn fantasy 2.5D với Botanical Glass,
nhạc original thật chill và người làm vườn visible chạy đến từng cây làm việc.
Actor bám event auto-care thật; animation không thực hiện giao dịch lần hai.
Nhạc nhiều lớp có composition, licensing và fallback, không một loop beep đơn giản.
Lai/chiến đấu có scene, pose, skill/reveal riêng nhưng giữ domain contracts.

Tạo concept riêng đủ lớn trước code phần visually important.
Không dùng asset game tham khảo, screenshot giả, emoji thay art hoặc nút chức năng giả.
Không đổi giá/rarity/balance/save/network contract vì muốn hiệu ứng đẹp.
Mỗi phase báo files đổi, screenshots thật, tests pass/fail,
performance/device đã thử và phần chưa chứng minh.
Không báo toàn app hoàn tất khi chỉ Vườn đẹp; không báo nhạc hay nếu chưa nghe.
```
