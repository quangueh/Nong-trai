# Đặc tả sản xuất và nghiệm thu chi tiết

Ngày 10/10/2026. Phiên bản đề xuất 1.0. Đọc cùng docs 21–26 và AGENTS.md.

Animation nâng cao được đặc tả riêng trong `docs/28_ADVANCED_ANIMATION_DIRECTION.md`: choreography từng action, blending channels, budgets, interruption và tiêu chí MOT-01…14.

**Đây là yêu cầu cho bản nâng cấp, không phải số liệu app hiện tại đã đạt.** Mọi ngưỡng dưới đây là target nội bộ cần kiểm chứng và hiệu chỉnh tại prototype. Không đổi ngưỡng sau khi đo chỉ để báo pass; thay đổi phải ghi lý do và được duyệt.

## 0. Quy tắc nghiệm thu

Một hạng mục hoàn thành phải có: implementation thật, fixture tái hiện, test/report, screenshot/video hoặc audio và người đánh giá. Concept, lời mô tả hoặc test chỉ kiểm class tồn tại không đủ.

Trạng thái tiêu chí: `not-started / in-progress / pass / fail / blocked / not-applicable`. `blocked` không được tính là pass. `not-applicable` phải có lý do và scope đã chốt; không dùng để bỏ màn hình khó.

Phân loại:

- **H0:** dữ liệu, quyền hạn, giao dịch, settlement; vi phạm chặn phát hành.
- **H1:** khả năng thao tác, đọc thông tin, lifecycle, responsive; vi phạm chặn nghiệm thu phase.
- **Q:** chất lượng thẩm mỹ/cảm giác; chấm bằng rubric và bằng chứng.
- **B:** backlog chưa có backend/domain; không vẽ control giả và không tính là đã làm.

Không ghi “đạt” nếu chỉ thấy hợp lý khi đọc code. Kết quả phải ghi build/hash, worktree state, thiết bị/browser, fixture/seed, thao tác, actual và evidence path.

## 1. Scope đóng trước khi bắt đầu

### Phải giữ

Trồng đơn/batch, mọi care action, cooldown/anti-spam, growth/XP/stage, cây sở hữu và loài khám phá, bán, protocol/pity/preview/lai, ascent/replay/reward, stance/skill/focus/auto/pause/speed, room/friends/duel, leaderboard, mọi view Chợ, account/gate/sync/conflict, check-in/auto-care/ads, preferences/PWA.

Inventory tại HEAD thực tế là nguồn quyết định; danh sách này không cho phép bỏ tính năng mới xuất hiện trong repo. Giữ route/deep link và save backward compatibility.

### Phải thêm về presentation

Grammar cây và LOD tốt hơn, Botanical Glass trong world, scene Vườn/Lai/Đấu, người làm vườn visible, nhạc có composition/stems, motion theo bộ phận và ngữ pháp VFX.

### Gameplay mới không tự động được duyệt

Loài/trait/skill/protocol mới, bảo tồn bố mẹ, fusion mode khác, helper tự tiêu tiền, tốc độ chăm mới, auto-battle mới, mua skin, rarity odds mới. Mỗi mục có proposal riêng: nhu cầu → domain → balance → migration → tests → UI.

## 2. Thiết bị, fixture và điều kiện đo

| Fixture | Dữ liệu cần có |
| --- | --- |
| F01 | Lần đầu, ít cây, hạt cơ bản, chưa có helper |
| F02 | 12 cây nhiều giai đoạn, 2 cây cần chăm, helper còn 10 phút |
| F03 | 24 cây, nhiều rarity/element/habit, một cây battle-locked |
| F04 | Hai bố mẹ hợp lệ, đủ tiền và mọi protocol đã mở theo domain |
| F05 | Thiếu tiền, immature parent, cùng parent, hết capacity |
| F06 | Một trận kéo dài đủ đo, inputs/seed cố định, statuses đa dạng |
| F07 | Room connecting/reconnect/expired/opponent-left, API fail |
| F08 | Guest/local/cloud khác nhau, delayed requests và save conflict |
| F09 | Tên cây tiếng Việt 40–60 ký tự; số tiền lớn; văn bản nhiều dòng |
| F10 | Offline sau cài PWA, storage quota failure, audio unavailable |

Viewport bắt buộc: 320×740, 390×844, 430×932, 768×1024, 1366×768, 1920×1080, phone landscape. Dùng pairwise cho trạng thái; Vườn/actor/battle/detail phải kiểm toàn bộ viewport.

Desktop Chromium chỉ chứng minh phần đã đo. Safari/iPhone thật là gate riêng. Tại P0 ghi model/OS/browser của một điện thoại mục tiêu và một máy thấp hơn; không dùng chữ “mobile tầm trung” mà không nêu thiết bị.

Đo performance trên production preview, không dùng số từ dev làm kết luận production. Đo riêng ảnh hưởng art, blur, actor, audio và combat; không benchmark khi chạy nhiều suite browser song song.

## 3. Shell và hệ component

### Kích thước khởi điểm

| Component | Spec |
| --- | --- |
| Header mobile | Nội dung 56px + safe-area; không dồn mọi loại tiền lên header |
| Navigation dock | 5 mục; vùng nội dung 64px, margin cạnh 12px; bottom offset 8px + inset |
| Icon button | Hitbox 48×48px; glyph 20–24px; focus ring không bị crop |
| Primary action | Min-height 48px, padding ngang 16px, body 16px; hai dòng nếu tên dài |
| Segmented | Track 48px; tối đa số mục đọc vừa; chuyển menu nếu không vừa |
| Plant tile | Vùng art aspect-ratio ổn định; thông tin ngoài tán; hitbox toàn tile rõ |
| Sheet | Padding 16px; max-height theo dvh/inset; footer không đè nội dung |
| Repeated card | Radius 8px; không card lồng; dock/sheet dùng radius lớn theo hệ kính |
| Typography | Body 16px, secondary 14px, caption 12px, section 20px; letter-spacing 0 |

Không khóa chiều cao một component nếu chữ cần wrap. Giữ vùng art/control ổn định, cho vùng text tăng chiều cao có chủ đích. 320px có layout riêng khi hai cột không đọc được.

### Vật liệu

UI glass: tint đủ đọc, blur khoảng 16–24px, highlight một cạnh và shadow tiết chế. Content surface: gần opaque. Botanical glass: hình/material cục bộ trên lá/bệ/giọt nước; không backdrop-filter từng vật thể.

Nền world có art thật, không một gradient thay môi trường. Không dùng glow che silhouette. Không tự sample màu mỗi frame để giả native Apple refraction.

### Acceptance

| ID | Loại | Điều kiện đạt | Bằng chứng |
| --- | --- | --- | --- |
| UI-01 | H1 | 100% feature inventory còn lối vào; tất cả route cũ/deep link đúng | Walkthrough + route tests |
| UI-02 | H1 | 0 CTA/name/HP bị che ở viewport bắt buộc và F09 | Screenshots + bounds assertions |
| UI-03 | H1 | Icon action có accessible name; keyboard tới được mọi thao tác chính | DOM audit + keyboard video |
| UI-04 | H1 | Sheet giữ focus, Escape chỉ đóng topmost, focus trả trigger | Automated focus tests |
| UI-05 | H1 | Text/numeric contrast đạt target AA trên nền xấu nhất; không chỉ màu | Contrast report, scene screenshots |
| UI-06 | H1 | 200% text zoom và bàn phím mobile không che primary action | Real-device/manual evidence |
| UI-07 | H1 | Route return giữ filter/selection/scroll; ID mất được xử lý | Before/after state tests |
| UI-08 | Q | 5/5 reviewer tìm hành động chính trong 5 giây ở Vườn/Lai/Đấu | Moderated task sheet |

## 4. Tạo hình cây: thông số và kiểm chứng

### 4.1 Silhouette grammar

Mỗi grammar có shape envelope, anchor gốc, tán chính, vùng bloom/fruit, pivot và LOD policy. Ví dụ spec đề xuất:

| Grammar | Primary mass | Nhịp bộ phận | Focal point |
| --- | --- | --- | --- |
| Rosette | Tán thấp rộng | 2–3 lớp lá lệch nhau | Lõi giữa |
| Bush | Khối tròn bất đối xứng nhẹ | 3 cụm tán, khe thở rõ | Hoa/quả nổi |
| Tall stem | Trục dọc + tán trên | Thân uốn, ít nhánh chính | Bông ngọn |
| Vine | Đường cong lớn | 2–3 điểm chuyển hướng, lá theo cuống | Đầu vine/bloom |
| Mushroom cluster | Một mũ lớn + mũ phụ | Cao thấp rõ, không chồng hết | Mũ chính |
| Thorn crown | Khối lõi + gai hướng ra | Gai thưa có nhịp, không lông nhím nét rối | Lõi/crown |
| Succulent | Lá dày/khối đặc | Ít leaf clusters, shading rõ | Tâm tán |
| Flowering fan | Cánh mở theo cung | Hoa trước, lá lùi phía sau | Cụm hoa |

Các tên trên là grammar art, không tự thêm combat archetype. Ánh xạ registry hiện có trước khi chốt.

### 4.2 Tỷ lệ và vật liệu

Với mature/awakened ở portrait 160px: chiều cao phần cây mục tiêu 65–82% vùng art; gốc chừa 8–12%; margin hoa/gai ít nhất 4px. Seed/sprout giữ tỷ lệ giai đoạn nhỏ, không phóng thành cây trưởng thành chỉ để lấp ô.

Mature primary mass chiếm khoảng 55–70% visible plant area là hướng art khởi điểm, không rule tính pixel cứng cho mọi grammar. Secondary parts hỗ trợ silhouette; tertiary details bỏ ở LOD nhỏ.

Lá có tối thiểu mặt trên/mặt dưới hoặc shading tương đương. Hoa có center, petal mass và contact/shadow. Highlights không cùng độ sáng ở mọi viền. Aura không được tính vào bounds dùng framing thân cây.

### 4.3 Gene-to-art contract

Lập mapping cho `hue/hueSpread/saturation/lightness/accentHue/scale/complexity/pattern/aura/size/eyeCount/seedShape` trong `VisualGenes`, cùng body genes. Mỗi field có ảnh before/after khi chỉ đổi một field; những field không thể thấy ở thumbnail phải có detail representation.

Không diễn giải field ngoài range hoặc phối gene gây geometry vỡ. Không biến đổi DNA để khiến asset đẹp hơn; renderer clamp presentation theo policy có tài liệu.

### 4.4 Animation rig

Gốc không trượt; stem group pivot ở root; leaf cluster pivot tại cuống; bloom/fruit follow stem với delay. Idle khởi điểm chu kỳ 3.5–6s, thân ±0.5–1.5 độ, lá ±1–3 độ; phase từ plant ID, không tất cả đồng bộ.

Attack pose riêng theo delivery. Hit hướng từ đối thủ, biên độ nhỏ; death không làm layout thay kích thước. Reduced motion bỏ sway/translate lớn nhưng giữ pose khác nhau cho trạng thái.

### Acceptance

| ID | Loại | Điều kiện đạt | Bằng chứng |
| --- | --- | --- | --- |
| ART-01 | H1 | 48 cây × 3 size × 3 nền: không NaN/clipping bộ phận chính | Render tests + contact sheets |
| ART-02 | H0 | Render/animation không mutate DNA/stats/save | Deep equality tests |
| ART-03 | H1 | Same ID/seed giữ identity qua garden/detail/battle | Side-by-side + snapshot tests |
| ART-04 | H1 | 20 instances SVG không collision defs/filter IDs | DOM + screenshot tests |
| ART-05 | Q | Reviewer nhận đúng grammar trong ≥85% của 40 silhouette 96px | Blind matching task, đáp án lưu |
| ART-06 | Q | Median điểm cây đẹp ≥8/10, không grammar nào <7/10 | 5 reviewer, rubric riêng |
| ART-07 | Q | ≥80% cặp biến thể được nhận là khác shape/parts, không chỉ hue | 20 cặp kiểm màu/grayscale |
| ART-08 | H1 | Mọi VisualGenes field có mapping hoặc deferred rõ | Mapping table + one-field evidence |

## 5. Chủng loài và chiến thuật

Mỗi loài cần dossier: ID/version, name, habitat fantasy, silhouette, body modules, element profile, archetype vector, stat role, skill motif, unlock, currency/price, lineage compatibility và QA fixtures.

Không yêu cầu mọi loài có asset độc quyền. Yêu cầu grammar/motif phối hợp có chủ đích và người chơi phân biệt nhóm/role. Species count không là chỉ số chất lượng.

Loài/skill mới chỉ merge khi:

1. Registry IDs unique, references hợp lệ và generated names không trùng theo policy.
2. Gene constraints/budget/validateGenome qua; save cũ vẫn tải.
3. Có matchup benchmark theo tier/level, cùng điều kiện, không chỉ chỉ số power tổng.
4. Báo win rate, sample size, confidence interval và counters. Không chốt “cân bằng” từ 10 trận.
5. Mục tiêu balance được duyệt trước chạy; không ép mọi cặp 50/50 vì vai trò/counter có chủ đích.
6. Art dossier có portrait 96/160/320 và attack motif tương ứng.

| ID | Loại | Ngưỡng đạt |
| --- | --- | --- |
| SPC-01 | H0 | 0 duplicate ID, dangling skill/trait/module refs hoặc invalid saved genome |
| SPC-02 | Q | 5 reviewer mô tả đúng vai trò của ≥80% nhóm tiêu biểu sau xem detail |
| SPC-03 | H1 | 100% loài mới có dossier, unlock/price thật và test fixture |
| SPC-04 | H0 | Không đổi rarity/economy/combat constraints chưa được duyệt |

## 6. Vườn: layout và micro-flow

390×844 trạng thái F02: header/dock không chiếm quá 25% viewport chưa tính safe-area bất thường; vùng world/cây mục tiêu ≥55%. Đây là budget, không cắt nhiệm vụ hoặc chữ để đủ số.

Scene có sky art, cảnh xa, bệ trồng và cây. Labels nằm ngoài tán; ô rỗng có affordance gieo rõ; selected/tool state không làm tile reflow. Hai cột mặc định khi vừa; desktop mở thêm cột theo art size tối thiểu đã chốt.

### Timeline gieo mục tiêu

| Mốc | Hình ảnh | Dữ liệu |
| --- | --- | --- |
| T0 | Press CTA, pending/disable submit | Domain validate/execute một lần |
| Success+0ms | Scene ritual bắt đầu | Plant ID đã có, result được giữ |
| +0–180ms | Đất mở nhẹ, hạt hiện | Không debit nữa |
| +180–420ms | Hạt rơi đúng ô | Anchor theo bounds thực |
| +420–650ms | Đất khép, dust nhỏ | Particle giới hạn |
| +650–1050ms | Mầm/cây mở theo stage thật | Không tự nâng stage |
| +1050–1500ms | Kết quả đứng yên, tên/stat | CTA xem/đóng truy cập được |

Skip từ đầu đưa thẳng tới kết quả đã settle. Nếu domain fail: không chạy success ritual. Nếu user rời route sau success: cây vẫn tồn tại, cleanup visual.

### Chăm

Chọn tool → eligible plots rõ → chạm cây → domain result → local cue/stat change → tool tiếp tục armed. Có cancel tool. Không một modal mỗi lần tưới. Advanced care có preview và hậu quả nếu cần.

| ID | Loại | Ngưỡng đạt |
| --- | --- | --- |
| GAR-01 | H1 | Một cây đã thấy được chăm trong ≤2 tap; không bắt mở detail |
| GAR-02 | H0 | Failed care không mất tài nguyên/progress; success đúng một settlement |
| GAR-03 | H1 | Double tap 100ms không trồng/chăm trái cooldown hoặc duplicate plant |
| GAR-04 | H1 | Thao tác feedback p95 ≤100ms trên thiết bị mục tiêu; không chờ animation mới biết success |
| GAR-05 | H1 | Tool/dock không overlap; hết cooldown button và domain đồng ý cùng thời điểm |
| GAR-06 | Q | ≥4/5 người mới gieo/chăm đúng không cần chỉ trực tiếp; task time lưu |
| GAR-07 | H1 | Skip, unmount, reduced motion không mất result và không orphan overlay |

## 7. Người làm vườn: spec đầy đủ

### 7.1 Asset và rig

Người làm vườn nhỏ là lựa chọn mặc định: áo xanh ngọc, tạp dề coral trầm, mũ sáng, bình tưới kính. Không tạo selector người/thú trước khi actor cơ bản đạt.

Manifest: asset/version/license, texture format/dimensions, frame rectangles hoặc rig layers, pivot chân, direction, duration, loop flag, tool attachment anchor. Sprite atlas không chứa baked UI/text.

Walk cần trái/phải/gần/xa; clip idle/water/fertilize/prune/music/inspect/acknowledge/arrive/leave. Mirror chỉ khi không khiến tool/chi tiết sai rõ. Sprite 36–48px mobile vẫn nhận ra tool chính.

### 7.2 State và chuyển tiếp

| State | Trigger vào | Hành vi | Trigger ra |
| --- | --- | --- | --- |
| hidden | Không buff/route unmount | Không RAF/audio | Vườn mount và buff còn |
| arrive | Buff bắt đầu | Đi vào lối scene, 400–700ms | Anchor hợp lệ |
| idle | Queue rỗng/cây cooldown | Nghỉ, không giả work | Event hợp lệ hoặc expiry |
| chooseTarget | Có live event | Dedupe/check ID/visibility | Chọn job hoặc summary |
| walk | Target có anchor | Đi waypoint, đổi direction | Tới work anchor |
| faceTarget | Tới cây | Chỉnh pose 80–120ms | Clip work |
| work | Event success đã có | Diễn action 450–800ms | Clip end/target mất |
| acknowledge | Work xong | Cue nhỏ 150–250ms | Job tiếp/idle |
| leave | Buff hết | Rời lối gần nhất 400–700ms | hidden |

Pause tab/route không freeze auto-care domain. Actor không quyết định cooldown, XP, tài nguyên hoặc tick rate.

### 7.3 Event contract

Event sau `res.ok` cần unique ID, plant ID, care action, occurredAt, live/catchup và sequence. ID được cấp một lần khi publish, không tính lại từ array index qua repaint. Sequence là presentation ordering, không thay simulation ordering.

Caller `autoCareTick()` cũ vẫn dùng được return count. Unsubscribe phải được test. Queue không giữ Plant reference đã tiêu thụ; lookup bằng ID. Event presentation không persist vào save mặc định.

Batch domain có thể hoàn tất nhiều cây tức thì; nhân vật diễn lượt đã làm. Không fake rằng mỗi bước chân mới cấp XP. UI có trạng thái “Đang diễn lượt chăm” nếu cần tránh hiểu nhầm; không thêm lời quảng cáo/tutorial dài vào scene.

### 7.4 Path và hàng đợi

Waypoint từ khoảng trống giữa các plot; coordinates trong scene-local. Speed mục tiêu 80–120 CSS px/s, thời gian visual một job không quá khoảng 3s; nếu route quá dài dùng transition ở mép hoặc summarize, không cho actor chạy xuyên cây.

Work anchor cách mép bệ 8–16px, không nằm trên label. Render layer: world back → plots/actor theo chiều sâu → VFX → labels → tools → modal. Actor pointer-events none.

Queue mục tiêu ≤4 job chi tiết và age ≤8s. Khi vượt, giữ job đang diễn, chọn một số job còn phù hợp và cộng số thật vào summary; không mất domain results. Catch-up chỉ summary + tối đa một minh họa được ghi rõ, không giả thực hiện action mới.

Resize/scroll dùng observer/coalesced update; không đọc layout từng frame cho từng cây. Target đổi/mất → cancel visual job, không rollback domain. Buff expired → không publish care mới; actor rời sau visual grace ≤800ms.

### Acceptance

| ID | Loại | Ngưỡng đạt | Bằng chứng |
| --- | --- | --- | --- |
| ACT-01 | H0 | Success N action → N event unique; fail → 0 event | Store event tests |
| ACT-02 | H0 | Actor work/skip/cancel không gọi care/reward/write save | Spies + state equality |
| ACT-03 | H1 | 24 plot resize/scroll: 0 teleport qua label/click blocker | Path video + bounds |
| ACT-04 | H1 | Job queue bounded theo count/age; catch-up không replay nhiều phút | Fake-clock stress |
| ACT-05 | H0 | Battle-locked/expired không được chăm trái policy | Domain boundary tests |
| ACT-06 | H1 | Rời/đổi Vườn 20 lần: listener/RAF/observer về baseline | Lifecycle instrumentation |
| ACT-07 | H1 | Reduced motion có actor/status đủ, không chạy vòng | Screenshot + task test |
| ACT-08 | Q | ≥4/5 reviewer nói đúng nhân vật đang làm gì trong 3 giây | Blind action recognition |
| ACT-09 | Q | Foot sliding/pose mismatch không thấy ở 5 lượt xem slow motion | Video review log |

## 8. Nhạc và âm thanh: composition tới runtime

### 8.1 Cấu trúc bản nhạc Garden Day

76 BPM, 4/4, 48 bars là template khoảng 2.5 phút; có thể đổi sau nghe prototype. Intro 4, A 12, A' 8, B 12, return/loop 12. Không viết một loop bốn nốt rồi chỉ tăng pad.

| Đoạn | Harmony/melody | Arrangement |
| --- | --- | --- |
| Intro | Gợi motif, chưa đầy bass | Pad mềm + một pluck |
| A | Theme 4–8 bars, có khoảng nghỉ | Felt piano + bass thưa |
| A' | Đổi register/response, giữ identity | Nylon/mallet đối đáp nhỏ |
| B | Mở màu harmony, không climax ồn | Thêm texture/pulse nhẹ |
| Return | Thu bớt lớp, chuẩn bị loop | Melody nghỉ trước boundary |

Melody không solo liên tục. Không hi-hat dày, chime chói, vinyl crackle lớn hoặc environmental cue lặp mỗi vài giây. Đừng mặc định nốt pentatonic bất kỳ nghe đều đẹp: phrase, voicing, velocity, envelope và mix phải được nghe.

Evening dùng cùng theme thưa hơn; Atelier có motif biến đổi; Battle tăng pulse và tension cùng tonal family, không đổi sang EDM. Cue sheet/BPM cụ thể ở doc 26.

### 8.2 Delivery nhạc

Mỗi track: WAV master, web delivery đã kiểm decoder, stems harmony/melody/bass/pulse phase-aligned, BPM/key/bars, loopStart/End, loudness/peak report, license/source và composer credits. Không bắt buộc một format duy nhất trước browser/device test.

Loop tail được thiết kế/render hoặc có intro/body/outro hợp lý; không tự crossfade hai bản full mix lệch nhịp. Stems có silence tương ứng khi layer nghỉ, không khác độ dài.

### 8.3 Runtime state machine

`locked → ready → loading → playing → transitioning → playing`, với `muted/suspended/fallback/unavailable` xử lý riêng. Mute là preference, không mood; scene đổi không mở mute.

Một AudioContext và buses music/SFX/ambience/master. Music manager giữ transport theo audio clock. Transition scene ở bar boundary khi hợp lý, crossfade 2–4s; đổi tab nhanh coalesce request, không để hai track full volume cùng chạy.

Pause battle và tab hidden dùng policy rõ: giữ phase hoặc resume theo transport mới; không schedule burst cũ. Decode fail timeout có fallback/silence, không promise pending vô hạn.

Limiter/headroom, gain ramps chống click. Jingle duck khoảng 2–3dB là target thử; restore envelope khoảng 0.5–1.5s. Slider SFX/music độc lập; ambience nếu có phải điều khiển thật.

### 8.4 Ngân sách âm thanh đề xuất

Mỗi loop web target ≤3MB, decode cache tối đa 2 track/stem-set đang cần; revise bằng memory profile thực. Không load soundtrack vào initial JS bundle. Full library có manifest size totals.

SFX simultaneous voices mục tiêu ≤12 trên mobile, cue priority cho combat/care quan trọng. Footstep tối đa một cue mỗi 250–400ms khi actor đang walk, mức nhỏ hơn care cue. Auto-care batch rate-limit; không 24 watering sounds chồng nhau.

Master target -18 đến -16 LUFS integrated và true peak ≤-1dBTP cho mix nghe thử; không coi con số này tự tạo nhạc hay. Đo bằng công cụ loudness thích hợp trên output đã render, không dùng slider gain thay phép đo.

### Acceptance

| ID | Loại | Ngưỡng đạt | Bằng chứng |
| --- | --- | --- | --- |
| AUD-01 | H0 | Không phát trước gesture, mute giữ qua mọi scene/reload | Browser tests |
| AUD-02 | H1 | 20 transition nhanh không duplicate transport/bus hoặc burst | Instrumented audio log |
| AUD-03 | H1 | 20 vòng loop không audible click/gap và stems không drift | Render capture + nghe |
| AUD-04 | H1 | Track error/offline/no-AudioContext không crash/chặn game | Fault injection |
| AUD-05 | H1 | Peak/headroom đạt spec đã chốt; 0 clipping trong battle stress | Loudness/peak report |
| AUD-06 | H1 | 15 phút playback + 20 scene change không tăng source count vô hạn | Node count/memory |
| AUD-07 | Q | Garden median dễ chịu ≥8/10; mệt tai ≤2/10 sau 15 phút | 5 reviewer trên loa/tai nghe |
| AUD-08 | Q | ≥4/5 reviewer nhớ một motif, nhưng không thấy lặp gây khó chịu | Listening survey |
| AUD-09 | Q | Battle đủ sinh động, vẫn đọc/ra quyết định; median ≥8/10 | 10 trận nghe thử mỗi reviewer |
| AUD-10 | H0 | 100% nhạc/sample có source/license hợp lệ | Asset manifest |

Không có audio preview/master + listening report thì phần nhạc chỉ là prototype kỹ thuật, chưa nghiệm thu “hay/chill”.

## 9. Lai: layout, preview và reveal

Mobile: A/B portrait ổn định, preview/cost gần CTA; protocol không tràn ngang. Desktop: hai bệ và vùng kết nối, inspector preview; không hai empty rectangles khổng lồ.

Preview hiển thị eligibility, fee, protocol ảnh hưởng, rarity distribution và hậu quả mất bố mẹ theo domain. Phân biệt chắc chắn/khoảng có thể/xác suất. Khi ID mất do cập nhật store, clear lựa chọn và giải thích; không crash hoặc lai sai cây.

### Reveal mục tiêu 1.6 giây

| Thời gian | Hành vi |
| --- | --- |
| 0–250ms | Bố mẹ highlight bộ phận/gene liên quan |
| 250–600ms | Hai motif đi vào tâm atelier |
| 600–1000ms | Khối chính/thân cây con hình thành |
| 1000–1350ms | Tán, hoa, quả, trait motif mở |
| 1350–1600ms | Settle pose, tên/rarity/lineage/action hiện |

Giữ skip từ đầu và result available ngay. Report kết quả lấy từ settled outcome; animation không tự chọn rarity. Reduced motion hiện cây/kết quả với fade ngắn.

| ID | Loại | Ngưỡng đạt |
| --- | --- | --- |
| BRD-01 | H0 | Confirmation ghi đúng hai bố mẹ, fee và hậu quả; pending không double spend |
| BRD-02 | H0 | Preview distribution và roll cùng nguồn; test normalization/boundaries/pity/protocol |
| BRD-03 | H0 | Skip/unmount/reopen không mất con hoặc settle lần hai |
| BRD-04 | H1 | A/B/protocol giữ qua picker/detail, invalid IDs xử lý được |
| BRD-05 | Q | ≥4/5 reviewer hiểu thay đổi con và việc mất bố mẹ trước xác nhận |
| BRD-06 | Q | Reveal median hấp dẫn ≥8/10 sau 5 lượt, không bắt chờ để thao tác tiếp |

Nếu kiểm phân phối bằng Monte Carlo: ghi sample size/seed/CI và tolerance được duyệt trước. Chưa sửa logic xác suất thì không dựa animation để “chứng minh” preview đúng.

## 10. Đấu: bố cục và animation contract

Portrait mobile 390×844: scene mục tiêu 45–55% viewport, skill/action zone gần thumb, HUD không bị effect phủ. Tỷ lệ được điều chỉnh nếu tên dài/safe area nhưng không dùng chữ nhỏ để ép vừa.

Sân có ground plane, back/mid/foreground, anchor hai cây và impact lane. Art không che silhouette; text nằm layer riêng. Cây đối mặt, attack pose theo bộ phận thật.

### VFX timing

Engine event time là nguồn sự thật. Anticipation chỉ được vẽ trước impact nếu có cast/windup event; không lấy damage event rồi giả lịch sử cast dài. Cosmetic residual không thay cooldown.

| Delivery/effect | Anticipation | Impact/residual |
| --- | --- | --- |
| Projectile | Bộ phận co theo windup thật | Projectile tới target; trail ngắn |
| Vine/root | Cuộn/đất phản ứng theo cast | Root hướng target, tránh HUD |
| Shield | Materialize từ anchor cây | Vòm kính, crack/hit theo event |
| Heal | Gốc/lá chuẩn bị nếu có cast | Sinh trưởng + số hồi + pose |
| Debuff | Motif theo skill thật | Status icon + dấu hiệu cục bộ |
| Morph | Đổi cấu trúc theo morph events | Pose/material mới; expiry trở lại |

Fast speed giảm cosmetic duration/particle, không để backlog kéo dài sau finish. Pause freeze visual timeline đúng, audio cue không nhầm unlock. Replay có label và không gọi settlement.

Skill button giữ DOM identity; cooldown number/sweep/cost/disabled reason đủ. Ready cue chỉ khi chuyển unavailable→available, không pulse liên tục. Damage số có lane; khi nhiều effect ưu tiên event chính và merge residual, không bỏ thông tin thay đổi HP.

| ID | Loại | Ngưỡng đạt |
| --- | --- | --- |
| BAT-01 | H0 | Cùng seed/snapshot/intents → full log equal trước/sau presentation upgrade |
| BAT-02 | H0 | Result/replay/close/next không duplicate reward hoặc mutate live fighter sai |
| BAT-03 | H1 | 0 HUD/skill/name overlap trong fixture nhiều statuses và F09 |
| BAT-04 | H1 | Button identity giữ trong 100 logical ticks; press không mất do repaint |
| BAT-05 | H1 | Fast/pause/reconnect không out-of-order visual settlement; cleanup 10 trận |
| BAT-06 | Q | ≥4/5 reviewer phân biệt attack/heal/shield/debuff ở clip không nhãn |
| BAT-07 | Q | Median scene/VFX ≥8/10; người chơi đọc HP/cooldown đúng ≥90% task |
| BAT-08 | H1 | Reduced motion và no-audio vẫn chơi và hiểu kết quả |

## 11. Chợ, bộ sưu tập, account và trạng thái biên

| ID | Loại | Tiêu chí |
| --- | --- | --- |
| AUX-01 | H1 | Owned và discovered tách; loài không còn cây vẫn mở detail |
| AUX-02 | H1 | Search/filter/pagination đúng toàn catalog và không DOM toàn registry |
| AUX-03 | H0 | Mua/quy đổi/giao hàng đúng cost/cap; fail không mất nửa giao dịch |
| AUX-04 | H1 | Quest pin và back-to-context không mất sau mua/detail |
| AUX-05 | H0 | Account A response muộn không ghi account B; guest được giữ theo policy |
| AUX-06 | H1 | Offline/error/retry/pending/empty có trạng thái riêng, không spinner vô hạn |
| AUX-07 | H0 | Save conflict nói rõ local/cloud; không success giả khi server giữ bản khác |
| AUX-08 | H1 | Mọi settings có tác dụng kiểm được; no placeholder controls |

## 12. Ngân sách runtime và release

Trên thiết bị mục tiêu đã chốt, với F03 + helper + audio: đo ít nhất 3 lượt 60 giây. Target ban đầu p95 frame ≤20ms ở garden/care, battle tương tự nhưng chốt lại sau P0; không cam kết 60fps mọi máy.

Target DOM garden F03 ≤5.000 nodes là ceiling khởi điểm cần profile, không lý do xóa chi tiết art tùy tiện. Nếu SVG vượt, dùng LOD/cache hoặc renderer phù hợp. Motion driver một scheduler; layout reads coalesced, không đọc bounds mọi lá mỗi frame.

20 sheet cycles và 10 fights: active listener/observer/RAF/audio counts về baseline. Memory sau cleanup + settle không tăng theo số vòng; báo actual curve, không dùng một heap snapshot để nói không leak.

Tối đa hai blur planes lớn trong trạng thái thường; modal mở giảm blur chrome sau. Không animate blur. Production asset loading không tải cả soundtrack/art library lúc boot.

| ID | Loại | Ngưỡng đạt |
| --- | --- | --- |
| REL-01 | H0 | Typecheck app/tools/Worker và build đạt; 0 lỗi data/authority/settlement |
| REL-02 | H1 | Core/PWA/browser suites không fail/timeout mới; baseline có issue/owner rõ |
| REL-03 | H1 | Performance/device report có actual, p50/p95, sample và build |
| REL-04 | H1 | Solid/reduced motion/keyboard/zoom qua các core journeys |
| REL-05 | H0 | Production PWA 500/offline/update không poison cache; bug doc 25 được xử lý |
| REL-06 | H1 | iPhone Safari thật được thử hoặc scope không được quảng cáo đã đạt native-level feel |
| REL-07 | H0 | Manifest/license/source đầy đủ; không lộ secrets hoặc dev handles trong prod |

## 13. Chấm điểm chất lượng cụ thể

Mỗi tiêu chí Q chấm 0–10 bởi ít nhất 5 người; tối thiểu 3 người chưa biết game. Không chỉ người triển khai tự chấm. Lưu từng điểm, median, comments và task errors; sample nhỏ là acceptance nội bộ, không nghiên cứu đại diện thị trường.

### Anchor điểm

| Điểm | Định nghĩa |
| --- | --- |
| 0–3 | Không đọc được/thiếu bản sắc, khó chịu, task thường thất bại |
| 4–5 | Dùng được nhưng lộn xộn hoặc đơn điệu, cần giải thích nhiều |
| 6–7 | Rõ và ổn, còn clipping/motif yếu/chuyển động hoặc nhạc lặp đáng chú ý |
| 8 | Đẹp, nhất quán, hiểu nhanh; không có lỗi gây phân tâm trong walkthrough |
| 9 | Bản sắc rõ, thích ngắm/nghe/chơi lâu, chi tiết tinh tế và các luồng liền mạch |
| 10 | Mức vượt kỳ vọng được cả panel đồng ý, có evidence; không tự mặc định |

### Tổng điểm 100

| Nhóm | Trọng số | Các thành phần tính điểm nhóm |
| --- | --- | --- |
| Cây/chủng loài | 20 | Silhouette 30%, material 25%, diversity 25%, identity/LOD 20% |
| Vườn/chăm | 15 | Layout 25%, action clarity 35%, world 20%, feedback 20% |
| Người làm vườn | 10 | Action recognition 30%, path/pose 30%, world integration 20%, clarity 20% |
| Nhạc/âm thanh | 15 | Pleasantness 35%, fatigue 25%, composition 20%, contextual mix 20% |
| Lai | 10 | Decision clarity 40%, parent/child identity 25%, reveal 25%, flow 10% |
| Đấu | 20 | Readability 35%, pose/VFX 30%, control ergonomics 25%, result 10% |
| Đồng bộ toàn app | 10 | Consistency 40%, navigation 30%, auxiliary flow 30% |

Mỗi thành phần dùng median 0–10. Điểm nhóm = tổng median × tỷ trọng; tổng 100 = tổng điểm nhóm × trọng số/10. Không làm tròn từng nhóm để tăng điểm.

**Ngưỡng nghiệm thu:** tổng ≥90/100, không nhóm <8/10, và 100% H0/H1 thuộc scope phải pass. Nếu còn H0/H1 fail thì kết quả là chưa đạt dù Q=100. Nếu một thiết bị bắt buộc chưa kiểm, gate đó blocked chứ không cộng điểm thay.

Sau cải tiến, chấm lại với cùng tasks/fixtures; thêm lượt người mới để hạn chế thuộc bài. Không chọn riêng screenshots đẹp nhất để panel chấm.

## 14. Work packages cụ thể

| WP | Deliverables | Gate trước khi tiếp |
| --- | --- | --- |
| WP00 | HEAD/dirty inventory, fixtures F01–F10, device list, baseline screenshots/tests/profile | Scope đủ, lỗi cũ phân loại |
| WP01 | 3 scene concepts riêng, 12 cây, actor sheet, tokens/components/states | Art direction và task wireflow được chốt |
| WP02 | Grammar/material/LOD/rig mapping, 48 cây benchmark, SVG tests | ART-01…08 |
| WP03 | Shell/routes và garden plant/care/detail/task/seedbag | UI + GAR gates |
| WP04 | Work event adapter, actor atlas/rig, state/path/queue | ACT-01…09 |
| WP05 | 3–4 original cues/stems, license/mix, music manager/fallback | AUD-01…10 |
| WP06 | Atelier, preview/protocol/confirmation/reveal/result | BRD-01…06 |
| WP07 | Battle scene/pose/VFX/HUD/room/ascent/replay/result | BAT-01…08 |
| WP08 | Collection/catalog/exchange/orders/account/social/settings | AUX-01…08 |
| WP09 | Performance/accessibility/PWA/real-device/regression/panel | REL gates + score ≥90 |

WP03–WP08 không được bỏ backend features đang có để giao screenshot đẹp. Mỗi WP có commit scoped khi được yêu cầu; Worker runtime thay đổi phải theo deploy instructions. Không tự deploy trong phase concept/spec.

## 15. Mẫu evidence và bug report

```text
Criterion: ACT-04
Build/hash + dirty changes:
Device/OS/browser + viewport:
Fixture/seed + clock:
Steps:
Expected: queue <=4 detailed jobs, age <=8s; domain results retained.
Actual: measured count/age/results.
Evidence: video, JSON trace, test command/log.
Result: pass/fail/blocked.
Reviewer/date:
Remaining risk:
```

Bug report phải có reproducible steps, expected/actual, severity, scope và evidence. “Nhìn chưa đẹp” chuyển thành điểm rubric: silhouette yếu, material thiếu khối, art crop, palette không rõ hoặc motion không đúng pivot.

## 16. Prompt điều hành AI

```text
Thực hiện WP được giao từ docs/27_DETAILED_PRODUCTION_ACCEPTANCE_SPEC.md.
Đọc docs 21–26, AGENTS.md và HEAD hiện tại; giữ thay đổi người khác.
Liệt kê criterion IDs của WP trước khi code.
Triển khai bằng pattern repo hiện có, không thêm tính năng giả.
Mọi domain change phải có proposal/test riêng, không lẫn vào polish.
Sau WP xuất bảng criterion -> actual -> evidence -> status.
Chạy tests liên quan và chụp app thật ở fixtures/viewports bắt buộc.
Nhạc cần audio deliverables và listening review, không chỉ oscillator code.
Actor animation không gọi auto-care/reward lần hai.
Không nói hoàn tất khi thiếu evidence hoặc có H0/H1 fail/blocked.
Nếu không đạt, sửa đúng tiêu chí và đo lại; không hạ ngưỡng để qua gate.
```
