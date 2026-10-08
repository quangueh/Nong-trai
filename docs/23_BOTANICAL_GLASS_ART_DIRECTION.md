# Botanical Liquid Glass: nâng art, Vườn, Đấu và Lai

Ngày 08/10/2026. Bổ sung theo yêu cầu mới; ưu tiên hơn phần giới hạn kính chỉ ở chrome trong doc 21 khi có mâu thuẫn. Đây vẫn là kế hoạch thiết kế, chưa phải giao diện đã triển khai.

## 1. Điều chỉnh quan trọng

Ba trải nghiệm trung tâm là **Trồng/chăm — Đấu — Lai**. Chúng phải được thiết kế như ba cảnh game hoàn chỉnh, không như form nằm trong app quản lý. Liquid Glass phải hiện diện cả trong thế giới và thao tác, không chỉ ở header/dock.

Chốt phong cách: **vườn trên mây 2.5D, thực vật fantasy có khối, chất liệu botanical glass và animation có cá tính**. Không làm tất cả cây thành tượng thủy tinh trong suốt. Mỗi cây có thân, lá và hoa đọc được rõ; kính xuất hiện ở lớp cuticle, giọt nước, mép sáng, tinh thể hoặc bộ phận phù hợp gene.

Mục tiêu là nâng chất lượng hình ảnh trước, sau đó tăng mật độ chuyển động có kiểm soát. Animation không cứu được silhouette xấu.

## 2. Tham khảo có chọn lọc

Các nguồn dưới đây là trang nhà phát hành/developer hoặc listing chính thức. Những bài học và quyết định thiết kế là đề xuất của dự án, không phải khẳng định các game đó dùng Liquid Glass.

| Tham khảo | Vai trò nghiên cứu | Cách chuyển hóa cho game này |
| --- | --- | --- |
| [Khu Vườn Trên Mây — ZingPlay](https://apps.apple.com/vn/app/khu-v%C6%B0%E1%BB%9Dn-tr%C3%AAn-m%C3%A2y-sky-garden/id1588009371) | Cảm giác trồng, chăm và trang trí vườn như không gian cá nhân | Ô trồng thành vật thể đẹp; từng cây có giá trị trưng bày; cloud world là scene chứ không nền CSS đơn giản |
| [Plants vs. Zombies 2 — EA](https://www.ea.com/games/plants-vs-zombies/plants-vs-zombies-2/features) | Danh tính cây và vai trò chiến đấu | Silhouette, bộ phận tấn công và skill phải liên hệ nhau; không đổi skin nhưng mọi cây bắn cùng một projectile |
| [Slime Rancher 2 — media chính thức](https://www.slimerancher.com/media/) | Không gian fantasy nhiều màu và thiết kế sinh vật | Dùng nghiên cứu value, vật liệu và nhịp chuyển động để tạo world dễ chịu; không chuyển cả app sang 3D chỉ để giống reference |
| [Merge Magic! — Zynga](https://www.zynga.com/games/merge-magic/) | Vườn fantasy và cảm giác biến đổi/sưu tập | Lai tạo có chuỗi biến đổi dễ theo dõi, hình dạng mới có ý nghĩa; không sao chép luật merge hoặc asset |
| [Apple — Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/) | Chất liệu và phản hồi điều khiển | Kính của UI khác kính minh họa trong world; thích nghi để đọc được, không kỳ vọng CSS mô phỏng quang học native |

Không lấy screenshot, nhân vật, âm thanh, icon hoặc texture từ các game này làm asset sản phẩm. Trước concept phải xem screenshot/trailer thật ở các nguồn trên và lập reference board có chú thích. Tra cứu metadata/trang giới thiệu chưa thay thế được phân tích từng frame gameplay.

## 3. Hệ chất liệu xuyên suốt

| Đối tượng | Vật liệu | Chuyển động/phản hồi |
| --- | --- | --- |
| Ô đất | Mặt đất hữu cơ, mép cỏ, bệ đảo có rim kính/polished mineral | Nén nhẹ khi gieo; hạt đất nhỏ; nước ngấm đổi sắc có thời hạn |
| Chậu/bệ | Kính màu dày hoặc gốm men, chân tiếp xúc rõ | Highlight thay đổi nhẹ khi chọn, không quay liên tục |
| Thân cây | Hữu cơ có khối, không ống trong suốt mặc định | Thân uốn từ gốc, tán trễ pha |
| Lá | Mặt trên satin, underside tối, mép sáng trong vừa phải | Xoay theo cuống, không scale cả cây như sticker |
| Hoa | Cánh có độ dày, phần lõi rõ, tint theo gene | Mở cánh, flutter nhỏ, pollen theo event |
| Quả | Bề mặt căng bóng, khối và cuống rõ | Dao động nhẹ; không float tách thân |
| Tinh thể/đột biến | Botanical glass rõ nhất | Lensing minh họa, rim sáng, xuất hiện theo biến thể |
| Skill slot | Control kính với icon skill có hình vật thể | Press, charge, cooldown sweep, ready cue một lần |
| Khiên/buff | Lớp kính minh họa quanh chủ thể | Materialize, va chạm, vết nứt khi mất shield |

Kính trên cây/đảo là hình ảnh đã vẽ hoặc shader/gradient cục bộ cho vật thể, không một `backdrop-filter` trên từng lá. Blur thật chỉ dùng cho vài mặt điều khiển lớn. Cách này cho phong cách kính sâu mà không tạo hàng trăm compositing layers.

## 4. Ô trồng phải là một vật thể game

### Cấu trúc hình ảnh

1. Bóng/độ cao làm rõ bệ nằm trong scene.
2. Thân đảo/chậu có mặt trước, mặt bên và mép, không rectangle phẳng.
3. Mặt đất hữu cơ có texture nhẹ, vùng trồng rõ.
4. Cỏ viền/chi tiết nhỏ giới hạn, không che gốc.
5. Cây tiếp xúc với đất, shadow đúng scale.
6. Viền chọn dạng lens sáng và tool indicator riêng.
7. Tên/trạng thái ở vùng đọc ổn định ngoài tán cây.

Hai chế độ bố cục: scene garden cho trồng/chăm và compact grid cho chọn cây. Cùng art nhưng không ép scene art lớn vào mọi picker. Góc nhìn 2.5D nhẹ; không tilt toàn màn bằng CSS khiến chữ cũng xiên.

### State và animation

- Rỗng: vùng gieo rõ, ánh sáng nhỏ khi focus; không tự pulse tất cả ô.
- Gieo: hạt rơi → đất nén → sprout mở; giao dịch thành công là nguồn event.
- Tưới: dòng nước/giọt có điểm chạm → đất đổi sắc → lá bật nhẹ.
- Bón: hạt dưỡng chất theo gốc → đường sáng ngắn trong thân → cập nhật chỉ số.
- Thiếu điều kiện: lý do cạnh CTA/tool, không rung toàn vườn.
- Cooldown: vòng/progress gọn, không vẽ overlay xám phủ cây đẹp.
- Lên giai đoạn: giữ anchor gốc, morph bộ phận hoặc crossfade có kiểm soát; không đổi kích thước tile.
- Selected: edge highlight + tăng độ nổi tối đa vài pixel, không đẩy các ô khác.

Các trạng thái soil-wet, grow, selected là view state, không tự thêm cơ chế tưới/thời tiết vào save.

## 5. Nâng renderer cây: không chỉ thay palette

`src/render/plantRenderer.ts` hiện đã có palette theo value, hình học lá/thân/hoa và RNG riêng. Do đó không nên quy mọi vấn đề cho màu nhạt. Cần đo render ở kích thước thật: hình khối, mật độ, framing, tổ hợp gene và sự nhất quán phong cách.

### 5.1 Grammar tạo hình

Trước mắt xây 8–12 silhouette mẫu có chủ đích, ánh xạ vào các habit/body hiện hành: rosette thấp, bush tròn, cây thân cao, vine cong, mushroom cluster, thorn crown, succulent dày, flowering fan. Danh sách là hướng art, không tự thêm species/combat archetype mới.

Mỗi silhouette phải có:

- Primary mass chiếm phần lớn diện tích: tán/bông/thân chính.
- Secondary mass làm rõ nhánh, quả, lá phụ.
- Tertiary detail như veins, pollen chỉ khi đủ pixel.
- Một focal point: bông, mắt nếu gene đã có, trái hoặc lõi năng lượng.
- Negative space giữa các khối; không mọi cây là một bó nét mảnh.

Gene tạo biến thể trong envelope thẩm mỹ, không perturb ngẫu nhiên mọi tham số cùng lúc. Dùng bộ mẫu cân đối rồi biến thiên leaf shape, posture, bloom và accent trong giới hạn; bảo toàn dữ liệu gene gốc.

### 5.2 Ánh sáng và chất liệu

Nguồn sáng chính cố định phía trên-trái; underside tối, rim nhẹ ở cạnh sáng. Gân lá không tối hơn silhouette quá mức. Flower center và cánh có phân lớp để đọc ở 96px. Loại bỏ chi tiết dưới pixel ở thumbnail.

Botanical glass không chỉ là màu trắng alpha: cần edge highlight, tint trong vùng dày, shadow tiếp xúc và phản xạ tiết chế. Không vẽ mọi viền cùng cường độ hoặc thêm glow che silhouette.

### 5.3 LOD và camera

| Ngữ cảnh | Yêu cầu |
| --- | --- |
| 64–96px | Nhận biết silhouette/rarity/element; bỏ veins nhỏ |
| 120–180px | Lá/hoa có khối và nhịp, ít particle |
| 240–360px | Chi tiết vật liệu, animation bộ phận |
| Battle | Pose có hướng, anchor gốc ổn định, vùng va chạm đọc được |

Framing theo visual bounds, không scale duy nhất theo stem. Thorns/bloom/fruit không bị cắt. Một cây phải nhận ra được giữa garden/detail/battle; không RNG theo route hoặc kích thước render.

### 5.4 Animation rig

Phân nhóm root/stem/leaf clusters/bloom/fruit/accessories có pivot. Idle thân 0.5–1.5 độ và leaf phase lệch nhau là điểm khởi đầu cần test. Không tất cả cây lắc đồng bộ. Attack kéo bộ phận tấn công về sau → phát lực → recoil → settle; hit tác động theo hướng, không chỉ flash đỏ cả SVG.

Giữ seed quyết định geometry, còn motion phase được derive ổn định từ plant ID. Không thay RNG draw order vô tình làm mọi cây đổi ngoại hình; nếu cần visual version mới phải có quyết định migration và snapshot trước/sau rõ.

## 6. Vườn như một cảnh sống

Scene gồm bầu trời/đám mây dạng asset, cảnh xa, đảo trồng và cây. Clouds không phải bokeh/orb trang trí. Parallax chỉ khi camera/người chơi tương tác và đủ performance; không nền tự trôi mạnh gây mỏi.

Trạng thái thường có chuyển động nền chậm, một số lá nhẹ và focal event. Cây ngoài viewport ngừng animation; thumbnail trong catalogue tĩnh. Chăm liên tiếp có âm/particle ngắn khác nhau nhưng không spam popup.

Không thêm pan/zoom bắt buộc cho tác vụ cơ bản. Nếu có garden camera, vẫn có Fit garden và lựa chọn bằng bàn phím; đừng làm người chơi phải tìm cây ngoài màn để hoàn thành nhiệm vụ.

## 7. Đấu trường: cây thực sự thi triển chiêu

Thiết kế battlefield bằng scene riêng, cây có pose đối mặt. Controls kính và skill portrait liên kết đúng element/ability. HUD nổi nhưng có backing đủ opaque để số đọc được.

### Ngữ pháp VFX

Mỗi skill cần anticipation → cast → travel/area → impact → residual → recovery. Thời gian event không làm chậm simulation; animation tiêu thụ timeline engine hiện hành. Ở speed nhanh có bản rút gọn, không queue trễ nhiều giây sau damage đã xảy ra.

| Nhóm chiêu minh họa | Hình ảnh đề xuất | Điều phải giữ |
| --- | --- | --- |
| Projectile | Hạt/quả/gai từ bộ phận tương ứng, trail gọn | Điểm phát đúng cây, impact đúng target |
| Vine/root | Dây/rễ chạy sát mặt đất, mọc quanh target | Không phủ HP/names, biến mất đúng lifetime |
| Shield | Vòm kính màu có rim và phản ứng va chạm | Phân biệt shield với HP/regen |
| Heal | Dòng sáng từ gốc, lá mở và số hồi rõ | Không giống damage xanh chỉ vì đổi màu |
| Poison/debuff | Dấu hiệu quanh vùng cơ thể và status icon | Không che pose; số tick không spam |
| Area/ultimate | Motif lớn riêng, background tối nhẹ có giới hạn | Không white flash mạnh, không rung liên tục |

Đây là mapping template, chỉ áp vào skill thật đang có. Không tạo spell mới chỉ để lấp bảng.

Skill button có vật thể/icon riêng, cooldown sweep có số, cost, pressed state và ready cue. Không từng button chứa backdrop blur độc lập. Thứ tự skill ổn định; tên dài không làm toolbar nhảy.

Damage dùng lane/offset có quy tắc tránh overlap. Text quan trọng luôn trên VFX. Khi animation nhiều, ưu tiên cast/impact của hành động chính và giảm residual thay vì bỏ phản hồi cần đọc.

## 8. Lai tạo: một nghi thức biến đổi thực vật

Scene là botanical atelier: hai bệ kính chứa bố mẹ, vùng kết nối ở giữa, protocol control gần preview. Hai cây đẹp ngay trước khi chọn xong, không chỉ empty box với dấu cộng.

Chuỗi reveal:

1. Giữ portrait bố mẹ và highlight đặc tính liên quan.
2. Hai dòng gene có motif lá/cánh/tinh thể đi vào vùng trung tâm.
3. Hình cây mới hình thành từ khối chính → lá → hoa/phụ kiện.
4. Kết quả đứng yên đủ để ngắm; chỉ ra biến đổi thật, rarity/element/stats theo kết quả domain.
5. CTA tiếp theo rõ: xem cây, trở về, trồng nếu hợp lệ.

Không nổ một ánh sáng trắng rồi cây mới xuất hiện mà không hiểu quan hệ. Không giả silhouette preview như dự đoán chính xác nếu outcome chưa quyết định. Animation chỉ bắt đầu sau settlement hợp lệ; skip/reduced motion vẫn hiển thị kết quả và lineage.

Protocol đổi tint/motif bệ và giải thích ảnh hưởng thật; không chỉ đổi nền. Confirmation mất bố mẹ vẫn có dù scene đang đẹp; vẻ đẹp không được che tính không thể đảo ngược.

## 9. Mật độ chuyển động: thêm nhiều nhưng có phân cấp

| Lớp | Ví dụ | Chính sách |
| --- | --- | --- |
| Ambient | Mây chậm, lá idle, giọt nước | Nhẹ; offscreen pause; bật/tắt theo quality |
| Interaction | Hover/press/chọn tool/chọn cây | Luôn phản hồi nhanh, không kéo dài |
| Action | Gieo/tưới/bón/cast/hit | Gắn event thật, không duplicate |
| Celebration | Lên cấp/lai/chiến thắng | Có skip, queue rõ, ít hơn hành động thường |

Motion scheduler chia ngân sách theo số đối tượng nhìn thấy. Mặc định chỉ 3–5 cây có rig chi tiết cùng lúc trên mobile là giả thuyết khởi đầu, cần profiling; cây còn lại idle đơn giản hoặc tĩnh. Không gắn một RAF loop riêng cho mỗi lá.

Ba quality preset: Đẹp / Cân bằng / Nhẹ. Reduced motion tách riêng; không biến Nhẹ thành accessibility mode. Người giảm chuyển động vẫn có cây/art chất lượng cao.

## 10. Pipeline chứng minh cây đẹp

Trước full app, tạo **art benchmark trong dev/test**, không một tab mới trong sản phẩm:

- 48 cây deterministic đại diện habits, elements, rarity, giai đoạn và gene extremes.
- Render 96/160/320px trên garden/battle/neutral backgrounds.
- Cùng seed hiện ở garden/detail/battle để so identity.
- Contact sheet riêng cho hình tĩnh; video/preview riêng cho rig và skill.
- Kiểm tra bounds, clipping, silhouette ở grayscale, palette và LOD.
- Chọn 12 cây tiêu biểu để human review trước khi nhân ra toàn danh mục.

Tiêu chí: không cây thành nét rối, không mất hoa, không pose vô lý, không cùng silhouette chỉ đổi hue. Rarity cao có điểm nhấn có chủ đích chứ không mặc định nhiều glow hơn.

## 11. Thứ tự triển khai điều chỉnh

1. Reference board chính thức + baseline live + art benchmark hiện tại.
2. Ba concept lớn cho Vườn/Đấu/Lai và một sheet 12 cây + chất liệu ô đất.
3. Nâng plant geometry/palette/material/LOD/framing; giữ domain nguyên trạng.
4. Dựng ô đất/bệ kính + Vườn và thao tác chăm hoàn chỉnh.
5. Rig cây + ngữ pháp skill/VFX + battlefield/HUD.
6. Atelier lai + protocol + preview/confirmation/reveal.
7. Đồng bộ catalogue/detail/picker với cùng plant renderer và materials.
8. Accessibility, quality presets, Safari thật và regression toàn bộ.

Nếu concept chưa đạt cảm giác muốn ngắm cây, không bắt đầu polish toàn bộ menu. Ưu tiên renderer và ba scene chính trước phần trang trí màn hình phụ.

## 12. Prompt bổ sung cho AI

```text
Đọc docs/23_BOTANICAL_GLASS_ART_DIRECTION.md cùng docs 21–22.
Yêu cầu mới: Liquid Glass đi sâu vào ô đất, cây và skill,
không chỉ chrome. Phân biệt UI glass và botanical glass trong art.
Thiết kế ba core scenes: Trồng/chăm, Đấu, Lai.
Nghiên cứu screenshot/trailer chính thức của Sky Garden ZingPlay,
Plants vs. Zombies 2, Slime Rancher 2 và Merge Magic!.
Rút ra nguyên tắc, không sao chép asset hoặc cơ chế.
Nâng silhouette/khối/LOD/framing cây trước khi tăng glow/particle.
Giữ DNA, identity, gameplay, economy, probabilities và save contracts.
Tạo art benchmark deterministic 48 cây ở 96/160/320px.
Cho cây rig theo bộ phận và skill theo timeline event thật.
Mọi scene phải đẹp ở trạng thái đứng yên và reduced motion.
Không backdrop-filter từng lá/từng ô/từng skill.
Không concept-only: phase implementation phải có screenshot app thật,
tests, profiling và ghi rõ những thiết bị chưa kiểm chứng.
```
