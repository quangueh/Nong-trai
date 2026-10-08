# Đại Chiến Cây Đột Biến: Liquid Glass UX/UI Master Plan

Ngày: 08/10/2026. Trạng thái: đề xuất thiết kế và kế hoạch triển khai, chưa thay giao diện.

## 1. Quyết định thiết kế

**Một thế giới thực vật sống động, với lớp công cụ kính tinh tế nổi phía trên.**

Người chơi phải nhớ cây, quá trình đột biến và trận đấu, không phải nhớ các hộp kính. Sự cao cấp đến từ phân cấp rõ, hình ảnh có chủ đích, phản hồi nhanh và tính nhất quán. Không đánh đồng “xịn” với blur dày, chữ nhỏ hoặc mọi thứ trong suốt.

Tham chiếu iPhone/iOS 27 là định hướng cảm giác và tương tác, không phải sao chép màn hình Settings. Apple mô tả Liquid Glass như lớp điều khiển và điều hướng riêng phía trên nội dung. Bản web này sẽ diễn giải bằng CSS, không cam kết tái tạo cơ chế quang học native: [Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), [iOS 27](https://www.apple.com/os/ios/).

### Năm nguyên tắc không thương lượng

1. Cây và chiến trường là nhân vật chính; chrome giao diện là lớp phụ.
2. Mỗi thời điểm có một hành động chính dễ tìm, nhưng không che mất lựa chọn chiến thuật.
3. Nhìn thấy chi phí, hậu quả và trạng thái trước khi xác nhận.
4. Tất cả màn hình dùng chung ngôn ngữ thiết kế, không chỉ làm đẹp Vườn.
5. Chế độ giảm chuyển động/giảm trong suốt vẫn đẹp và đầy đủ chức năng.

### Không làm

- Không biến game thành landing page hoặc dashboard SaaS.
- Không thêm camera hole/Dynamic Island giả, logo Apple hay màn hình điện thoại giả bao quanh app.
- Không phủ kính lên từng ô cây, từng đoạn văn, từng thanh HP.
- Không dùng emoji thay bộ icon thao tác mới.
- Không đặt card trong card hoặc dùng các khối beige khổng lồ để lấp khoảng trống.
- Không thêm hiệu ứng khiến người chơi phải chờ sau mỗi thao tác lặp lại.
- Không đổi balance, giá, xác suất, cơ chế lai hoặc API tài khoản trong một PR thiết kế.

## 2. Cơ sở khảo sát và giới hạn

Đã đối chiếu cấu trúc hiện tại: `src/ui/app.ts`, `src/ui/screens/types.ts`, các màn hình trong `src/ui/screens`, thanh chăm sóc `gardenBar.ts`, `src/styles.css`, `package.json`, tài liệu logic 18–20 và ảnh trong `shots`.

Ảnh được khảo sát gồm `shots/ux/new-phone-garden.png`, `shots/final-desktop/breeding.png`, `shots/final-desktop/battle.png`. Đây là ảnh lưu trước đó, không phải chứng nhận giao diện của HEAD hiện tại. Một số ảnh có sáu tab trong khi mã hiện tại có bảy. Phiên thử mở localhost chưa tải được; trước triển khai phải chụp baseline trực tiếp từ build hiện tại.

| Quan sát | Tác động | Quyết định |
| --- | --- | --- |
| Bảy mục điều hướng: garden, collection, breeding, arena, ascent, lab, leaderboard | Mobile chia nhỏ vùng chạm, khó nhận biết ưu tiên | Năm mục chính; gom các trải nghiệm chiến đấu |
| Onboarding lớn và nhiều khối thông tin ở Vườn | Cây bị đẩy xuống; vào game chưa thấy ngay điều muốn chăm | Nhiệm vụ hiện tại gọn, hướng dẫn theo ngữ cảnh |
| Cây nhỏ trong chậu/khung lớn ở ảnh baseline | Nhân vật thiếu sức hút, khó phân biệt biến thể | Tăng diện tích hình cây; chuẩn hóa camera/bounding box |
| Trận đấu nằm trong khung với nhiều điều khiển phía dưới | Chiến trường yếu, mắt liên tục chuyển vùng | Sân đấu lớn, HUD theo biên, điều khiển gần ngón cái |
| Nhiều wallet pill và màu nền cùng họ xanh/beige | Header đông, thiếu phân cấp | Hai tài nguyên liên quan + ví đầy đủ trong sheet |
| `src/styles.css` dài, nhiều lớp override | Đổi một component dễ tác động toàn game | Token và component theo lớp; chuyển từng màn hình |
| Bộ sưu tập chứa cả lịch sử loài và cây còn sở hữu | Hai khái niệm có thể bị nhầm | Hai view rõ: Cây của tôi / Bách khoa |
| Các tính năng xã hội/tài khoản đang thay đổi | Dễ làm mất logic mới khi rewrite | Chụp inventory tại commit triển khai, giữ adapter/domain |

Tài liệu này là quyết định thiết kế đề xuất. Các con số về thời gian thao tác, FPS và kích thước bên dưới là mục tiêu cần đo, không phải kết quả đã đạt.

## 3. Mục tiêu trải nghiệm

| Tình huống | Mục tiêu nghiệm thu |
| --- | --- |
| Quay lại Vườn | Nhìn thấy cây và việc cần làm ngay trong viewport đầu |
| Chăm một cây | Tối đa 2 lần chạm sau khi đã thấy cây; không mở modal bắt buộc cho thao tác thường |
| Mua một hạt đã biết | Tìm → xem giá → mua; không phải đi qua trang giới thiệu |
| Lai cây | Chọn A/B, hiểu chi phí và việc mất cây bố mẹ trước xác nhận |
| Vào chiến đấu | Từ tab Đấu đến chọn cây trong tối đa 2 lần chạm |
| Đọc kết quả | Biết thắng/thua, thưởng, thay đổi và hành động tiếp theo trong một màn hình |
| Đổi tab rồi quay lại | Giữ bộ lọc, vị trí cuộn và lựa chọn chưa xác nhận |
| Mạng lỗi | Không báo thành công giả; có cách thử lại, không lặp giao dịch |

Đo bằng 5 người chơi chưa biết game: thời gian hoàn thành, thao tác sai, điểm bị mắc và khả năng giải thích hậu quả của lai/bán/quy đổi. Không coi screenshot đẹp là bằng chứng UX tốt.

## 4. Kiến trúc thông tin mới

### Mobile: năm tab

| Nhãn | Nội dung | Route cũ cần giữ tương thích |
| --- | --- | --- |
| Vườn | Ô trồng, chăm sóc; Hôm nay và Túi hạt là view phụ | garden |
| Cây | Cây của tôi, Bách khoa, chi tiết, bán | collection |
| Lai | Bố mẹ, protocol, preview, xác nhận, kết quả | breeding |
| Đấu | Vượt ải, Đấu trường, Phòng/Bạn bè, Xếp hạng | ascent, arena, leaderboard |
| Chợ | Hạt, Vật tư, Đất, Quy đổi, Đơn hàng | lab |

Không xóa route domain cũ chỉ để giảm tab. Dùng ánh xạ route → mục chính + view con. Deep link nhiệm vụ đến hạt cụ thể, phòng đấu, ải và bảng hạng vẫn hoạt động. Back trở về ngữ cảnh gốc, không luôn đẩy về Vườn.

### Chrome chung

- Header: avatar/cấp độ bên trái, tên/ngữ cảnh ở giữa khi đủ chỗ, tài nguyên liên quan và settings bên phải.
- Mobile dock: icon 22px + nhãn 12px, vùng chạm ít nhất 48×48 CSS px. Trạng thái chọn có hình dạng và nhãn, không chỉ đổi màu.
- Tab Đấu dùng segmented view bên trong; không tạo một hàng bốn tab phụ cộng một hàng filter dài trong viewport đầu.
- Trong trận: ẩn dock toàn cục; nút pause/thoát có xác nhận phù hợp. Không cho chuyển tab vô tình làm bỏ trận.
- Desktop: rail trái cố định, nội dung chơi rộng, inspector bên phải khi có đối tượng được chọn. Không phóng to một khung điện thoại ở giữa desktop.
- Tablet: rail thu gọn nếu không đủ chỗ; không ép layout ba cột trên 768px.
- Một scroll owner cho nội dung chính; sheet có scroll riêng chỉ khi mở. Sticky footer phải được tính vào padding nội dung.

### Trạng thái điều hướng

Lưu UI state theo route: subview, bộ lọc, sort, selected IDs, scroll offset. Dữ liệu cây được đọc lại từ store; ID không tồn tại thì bỏ lựa chọn và giải thích ngắn. Không lưu bản sao Plant làm nguồn sự thật. Đóng sheet trả focus về trigger và giữ vị trí cuộn.

## 5. Hành trình người chơi

### 5.1 Lần đầu

Vườn mở ngay, một ô trồng nổi bật và một bước nhiệm vụ ngắn. Chạm trồng → chọn hạt → thấy cây mọc → nhận thưởng đã thực sự ghi nhận → chăm → mở hành trình chiến đấu khi đủ điều kiện domain.

Không hiện tutorial dài che phần lớn vườn. Không bắt đăng nhập trước khi cần, trừ khi policy hiện hành bắt buộc. Nếu có guest, nói rõ lưu trên thiết bị và lựa chọn liên kết tài khoản; không hứa đồng bộ khi chưa có.

### 5.2 Phiên quay lại 30–90 giây

Hiển thị số cây cần chăm, nhiệm vụ gần hoàn thành và tiến độ thật. Chọn công cụ → chạm liên tiếp các cây hợp lệ → phản hồi tại cây. Thanh công cụ luôn có tên công cụ và lối thoát. Không tự chuyển ô/chế độ sau một lần dùng.

### 5.3 Phiên chiến thuật 5–15 phút

Từ Cây so sánh vai trò/chỉ số → chọn cho ải hoặc PvP → xem matchup và điều kiện → đấu → kết quả → tiếp tục hoặc quay lại nâng cây. Bộ lọc và lựa chọn vẫn còn sau trận.

### 5.4 Phiên khám phá lai tạo

Chọn A/B → xem preview hợp lệ → chọn protocol → xác nhận chi phí/hậu quả → reveal có thể bỏ qua → kiểm tra cây mới → trồng/đưa vào đội nếu domain cho phép. Không ngụy trang một preview không chắc chắn thành kết quả đảm bảo.

## 6. Đặc tả từng màn hình

### 6.1 Vườn

- Viewport đầu có vùng cây thật; header + nhiệm vụ gọn không chiếm quá khoảng 25% chiều cao ở 390×844 trong trạng thái thường.
- Ô trồng dùng scene chung với vị trí rõ, không mỗi ô một dashboard. Giữ trật tự ô ổn định giữa repaint.
- Cây trưởng thành chiếm khoảng 65–80% vùng minh họa ô, kiểm tra bounding box từng archetype; cây con vẫn biểu đạt đúng giai đoạn.
- Mobile mặc định hai cột nếu tên/vùng chạm đủ; máy 320px được phép một cột hoặc view compact đã kiểm tra, không cắt tên.
- Ô rỗng là thao tác trồng, không cạnh tranh với cây bằng minh họa quá lớn.
- Tại ô: tên, trạng thái cần hành động, tiến độ liên quan. DNA/chỉ số chiến đấu đầy đủ để trong detail.
- Thanh chăm sóc giữ hành vi armed-tool hiện có và vị trí theo cột nội dung của `gardenBar.ts`; tránh dock chồng dock.
- Hôm nay và Túi hạt là segmented view. Nhiệm vụ deep-link đến đúng hành động rồi trở về được.
- Không tự đổi thứ tự ô khi cây lên cấp, tránh người chơi chạm nhầm cây.

Trạng thái bắt buộc: vườn rỗng, ô khóa, đủ/thiếu hạt, cooldown, thiếu vật tư, cây không hợp lệ, reward queue, lên cấp, offline.

### 6.2 Chi tiết cây và chăm sóc

- Sheet mobile gần toàn chiều cao, desktop inspector hoặc dialog tùy ngữ cảnh.
- Phần đầu: portrait lớn, tên, rarity, cấp, vai trò; CTA theo đúng mục đích mở sheet.
- Ba nhóm: Tổng quan / Kỹ năng / Gene và phả hệ. Dùng section chia dòng, không nhiều card lồng nhau.
- Chỉ số có giá trị cơ bản và modifier khi cần; không cộng vào display khác công thức domain.
- Chăm sóc: preview trước/sau, vật tư, giới hạn, lý do disabled. Không hiển thị button có vẻ hoạt động khi thao tác chắc chắn thất bại.
- Bán ở vùng phụ tách biệt; xác nhận tên cây, giá và hậu quả. Không colocate nút Bán với CTA chăm cùng màu/kích thước.
- So sánh là nâng cấp UX có thể triển khai sau component detail: pin tối đa hai cây, chỉ số cùng thứ tự, nêu trade-off thay vì tự phong “tốt nhất”.

### 6.3 Cây và Bách khoa

- Hai view riêng: Cây của tôi / Bách khoa. Một loài đã khám phá nhưng không còn cây vẫn có trang xem thông tin, không chỉ toast cụt đường.
- Grid portrait đều khung nhưng không ép mọi thân cây cùng tỷ lệ giả. Rarity dùng icon/nhãn kết hợp màu.
- Filter nhanh cho mục đích: sẵn sàng đấu, đủ điều kiện lai, rarity; tiêu chí lấy từ domain, không chỉ một phép kiểm level riêng ở UI.
- Search/sort có trạng thái giữ lại; tổng cây và số đang hiển thị tách rõ.
- Không tải toàn bộ thư viện loài lên DOM. Render phân trang hoặc virtualization có kiểm chứng focus và chiều cao.
- Thẻ loài thể hiện “Đã khám phá / Đang sở hữu”, không dùng “đã lai mất” cho mọi trường hợp không còn sở hữu.

### 6.4 Lai tạo

- Hai cây bố mẹ là tâm điểm, protocol và preview nằm gần vùng quyết định.
- Mobile: hai portrait cạnh nhau nếu vừa; desktop: A → vùng kết nối → B, preview phía dưới/inspector, không hai khung trống khổng lồ.
- Chọn cây có filter hợp lệ, trạng thái đang dùng và lý do không chọn được. Không cho A=B nếu domain cấm.
- Protocol dùng segmented/menu tùy độ dài; mỗi lựa chọn có ảnh hưởng cụ thể và chi phí, không năm chip dài tràn ngang.
- Preview phải phân biệt: chắc chắn, khoảng có thể, xác suất. Chỉ công bố xác suất đã được xác minh theo doc 20.
- CTA sticky: chi phí + tên hành động. Trước thao tác mất bố mẹ có confirmation chứa cả hai tên/portrait và hậu quả.
- Reveal 1.2–1.8 giây, nút Bỏ qua dùng được ngay; animation không phải nơi quyết định giao dịch.
- Kết quả: cây mới lớn, biến đổi quan trọng, lineage, action tiếp. Reduced motion hiện đầy đủ kết quả ngay.
- Không thêm toggle “Lai / Hợp nhất” nếu cơ chế mới chưa có backend/domain và kiểm thử.

### 6.5 Đấu: Vượt ải

- Mặc định nhìn thấy ải hiện tại và hành động tiếp; bản đồ là tiến trình, không danh sách card vô tận.
- Ải khóa, đã thắng, frontier có hình dạng/nhãn khác nhau. Reward preview không gây hiểu nhầm thưởng đã nhận.
- Brief trước trận: đối thủ, đặc tính, cây đã chọn, lợi thế/bất lợi có căn cứ; cho đổi cây ngay.
- Giữ hành vi vòng đời trận, cleanup và settlement hiện có. Không rerender toàn app mỗi tick.
- Kết quả có Tiếp ải / Thử lại / Đổi cây tùy trạng thái; phần log là secondary.

### 6.6 Đấu trường, phòng và bạn bè

- Đấu nhanh, Phòng, Bạn bè là các lối vào rõ; không dàn tất cả khối lobby lên một màn hình dài.
- Lobby hiển thị selected plant, stance, ready, trạng thái đối thủ và kết nối.
- Mã phòng có copy button icon + thông báo ngắn; nhập mã có lỗi tại field.
- Loading, reconnect, đối thủ rời, room hết hạn, hủy ghép, invite hết hạn là trạng thái riêng, không một spinner chung.
- Chỉ dùng trạng thái server xác nhận để báo ready/match complete; pending không được giả success.
- Hành động async chặn submit trùng và giữ khả năng cancel nếu API hỗ trợ.
- Màn hình xã hội phải đối chiếu thay đổi mới trong `src/account/social.ts`, `worker/src/social.ts` và `arena.ts` tại lúc triển khai.

### 6.7 Sân đấu và replay

- Scene không nằm trong một card trang trí; nền thật, hai cây lớn, khoảng trung tâm cho tác động.
- HUD hai bên: tên, HP, trạng thái chính; timer/phase ở giữa. Damage number không phủ tên hoặc thanh HP.
- Mobile portrait: sân đấu mục tiêu tối thiểu khoảng 45% viewport ở 390×844; landscape/desktop ưu tiên scene rộng. Đây là điểm khởi đầu, phải kiểm tra cây không bị crop và controls không đẩy nhau.
- Kỹ năng gần vùng ngón cái; icon + cooldown số + tên rút gọn có tooltip/detail. Disabled có lý do, không chỉ opacity thấp.
- Stance và chế độ tự động tách khỏi skill; pause/speed/replay là toolbar icon có nhãn truy cập.
- Log mở theo nhu cầu, không chiếm một nửa màn hình mặc định.
- Replay ghi rõ là replay, không phát thưởng hay cập nhật tiến trình lần nữa; dùng snapshot trước trận theo contract hiện hành.
- Một hàng status cho mỗi cây; khi nhiều effect dùng overflow menu, không badge chồng vô hạn.

### 6.8 Chợ

- Các view Hạt / Vật tư / Đất / Quy đổi / Đơn hàng được giữ đủ; chọn bằng segmented nếu vừa hoặc menu nếu màn hình hẹp.
- Search luôn rõ; filter nâng cao trong sheet có số điều kiện đang dùng và Reset.
- Catalogue lớn tiếp tục phân trang; không render 12.005 loài cùng lúc. Không tìm kiếm chỉ trong trang đang nhìn nếu người chơi hiểu là toàn danh mục.
- Giá chính, loại tiền và đủ/thiếu được đọc trực tiếp. Alternative price hints không được trông như giá có thể thanh toán khi không hỗ trợ.
- Hạt được nhiệm vụ pin vẫn nổi bật, có bỏ pin và breadcrumb quay lại nhiệm vụ.
- Mua: preview số lượng/tổng tiền nếu API hỗ trợ lượng; không thêm giỏ hàng chỉ vì shop cần “hiện đại”.
- Quy đổi: chiều quy đổi, tỷ giá, phí, thực nhận, hạn mức còn lại, preview trước xác nhận. Khóa UI theo pending; success dùng kết quả giao dịch.
- Đất: đánh số ô mở thêm, điều kiện và giá; không cho hiểu nhầm đây là item tiêu hao.
- Đơn hàng: yêu cầu, số đang có, thưởng, hạn/thay mới nếu domain có; giao hàng là hành động mất vật phẩm cần rõ.

### 6.9 Xếp hạng

- Nằm trong Đấu, truy cập trực tiếp bằng deep link cũ.
- Bảng/list gọn: hạng, người chơi, giá trị được xếp hạng; đơn vị và tiêu chí sort rõ.
- Hàng của tôi dễ tìm; không dùng podium lớn đẩy dữ liệu xuống nhiều màn hình.
- Khi poll cập nhật không giật scroll/focus. Trạng thái dữ liệu cũ/mạng lỗi có retry.

### 6.10 Tài khoản, cài đặt và đồng bộ

- Tài khoản là sheet từ avatar; đăng nhập, liên kết, đăng xuất, trạng thái sync là các luồng đầy đủ.
- Xung đột save hiển thị bản local/cloud, thời điểm và dữ liệu đủ để quyết định; không dùng “Giữ” mơ hồ.
- Thiết lập: âm thanh, chuyển động, chất lượng hiệu ứng, độ trong suốt, theme nếu triển khai đủ. Không dùng switch cho lựa chọn ba giá trị.
- Form có label thật, lỗi field, trạng thái submit, focus hợp lý; password/token không lọt vào log hoặc screenshot fixtures.
- Luôn giữ gate xác thực hiện hành. Thiết kế không tự bỏ policy để làm onboarding ngắn.

## 7. Hệ thiết kế

### 7.1 Ba lớp vật liệu

| Lớp | Dùng ở đâu | Quy tắc |
| --- | --- | --- |
| World | Vườn, sân đấu, portrait | Hình ảnh rõ, không blur chủ thể; art có bản sắc thực vật |
| Content | Dữ liệu, bảng giá, stat, kết quả | Nền gần opaque, separator nhẹ, tương phản ổn định |
| Glass | Dock, header, toolbar, menu/sheet chrome | Tint + blur + edge highlight + shadow tiết chế |

Không glass-on-glass. Một sheet có chrome kính được phép chứa nhóm nội dung nền đặc, nhưng không nhiều card kính bên trong. Không lấy màu text trực tiếp từ element/rarity nếu contrast không đạt.

### 7.2 Token khởi điểm cần kiểm tra qua mockup

| Nhóm | Đề xuất |
| --- | --- |
| Neutral light | Canvas `#F3F6F7`, surface `#FFFFFF`, ink `#162024`, secondary `#526169` |
| Neutral dark | Canvas `#111719`, surface `#1C2529`, ink `#F2F6F7`, secondary `#B4C0C5` |
| Semantic | Emerald `#137C59` cho hành động sinh trưởng; cyan `#087D9D` cho thông tin; coral `#C44145` cho nguy hiểm; amber `#996500` cho cảnh báo |
| Glass light | Tint trắng alpha khoảng 0.72–0.88; blur 16–24px; viền sáng 1px và shadow mềm |
| Glass dark | Tint charcoal alpha khoảng 0.78–0.92; blur 16–24px; viền sáng mờ |
| Content | Opacity khoảng 0.96–1; không backdrop-filter |
| Typography | System UI ưu tiên, Be Vietnam Pro fallback đã kiểm tra tiếng Việt; không tải/bundle SF Pro tùy tiện |
| Cỡ chữ | Body 16px, secondary 14px, caption 12px, section 20px, screen title 24–28px; reveal 32px khi đủ không gian |
| Spacing | 4, 8, 12, 16, 24, 32, 48px; padding mobile 16px, desktop 24–32px |
| Shape | Repeated card 8px; sheet 24px; dialog 20px; segmented 16px; icon button/dock bo tròn theo hệ kính |
| Icons | Lucide; 20–24px, stroke nhất quán; chỉ import icon dùng thật |
| Touch | Tối thiểu 48×48 CSS px theo mục tiêu dự án, không coi 48 CSS px tương đương 44pt native |

Palette cần test tương phản theo vị trí dùng; màu token không tự đảm bảo mọi cặp đều đạt. Không dùng một gradient xanh/tím bao trùm app. Màu đa dạng đến từ cây, môi trường, trạng thái và element có ý nghĩa.

Letter-spacing bằng 0. Không dùng `vw` để scale font. Tên dài được wrap có giới hạn bố cục, không thu nhỏ đến không đọc được. Số dùng tabular numerals ở HP, currency, cooldown. Giá trị rút gọn có giá trị đầy đủ ở detail.

### 7.3 Component phải thiết kế trước màn hình

AppShell, NavigationDock/Rail, ContextHeader, WalletButton/Sheet, SegmentedControl, IconButton, PrimaryAction, FilterSheet, SearchField, PlantPortrait, PlantTile, StatRow, StatusBadge, CostSummary, BottomSheet, ConfirmDialog, Toast, InlineError, EmptyState, PendingState, BattleHUD, SkillButton, RewardSummary.

Mỗi component cần default/hover/focus/pressed/selected/disabled/pending/error/success nếu áp dụng. Không cho AI chỉ vẽ trạng thái happy path.

## 8. Layout và responsive

| Viewport | Chiến lược |
| --- | --- |
| 320–479px | Mobile dock, 1–2 cột có kiểm chứng, sheet gần toàn màn hình |
| 480–767px | Mobile rộng, không tự tạo sidebar |
| 768–1023px | Tablet, rail compact hoặc dock theo không gian, tối đa hai vùng nội dung |
| 1024–1439px | Rail + scene/content + inspector tùy màn hình |
| Từ 1440px | Tăng vùng chơi, giới hạn chiều dài dòng; không giãn button vô hạn |

Portrait có khung ổn định `aspect-ratio: 1`; render camera thích nghi với bounding box, không crop cành/hoa quan trọng. Battle scene có aspect-ratio/min-height phù hợp từng orientation; không khóa chiều cao khiến toolbar tràn ở 1366×768.

Dùng safe-area và `dvh` có fallback. Kiểm tra keyboard mở ở form/search; CTA không bị bàn phím che. Footer padding tính cả dock và inset. Không tắt pinch zoom. 200% text zoom vẫn thao tác được.

## 9. Chuyển động, âm thanh, phản hồi

| Tương tác | Mục tiêu |
| --- | --- |
| Press | Feedback bắt đầu dưới 80ms; transform 100–140ms |
| Đổi view | 160–220ms, không reset scroll ngoài ý muốn |
| Sheet | 240–300ms; translate/opacity, không animate blur |
| Tool áp vào cây | Phản hồi tại cây, số thay đổi và âm ngắn nếu bật |
| Lai reveal | 1.2–1.8s, skip ngay, không trì hoãn ghi nhận kết quả |
| Thắng/thua | 500–900ms mở đầu; phần kết quả luôn truy cập được |
| Reduced motion | Bỏ parallax/shake/fly-path; fade ngắn hoặc hiện ngay, giữ đủ thông tin |

Motion giải thích nguyên nhân: vật tư → cây, cây bố mẹ → cây mới, chiến thắng → thưởng. Không spring mọi dòng chữ. Không rung màn hình khi chăm thường. Âm thanh không phải cách duy nhất báo thành công/lỗi. Không hứa haptic trên mọi browser/iPhone; progressive enhancement nếu thực sự hỗ trợ.

Toast không che CTA; thông báo quan trọng như mất cây hoặc save conflict phải tồn tại trong UI, không chỉ biến mất sau 2 giây. Reward queue tránh nhiều modal bật cùng lúc.

## 10. Accessibility và khả năng đọc

- Mục tiêu WCAG 2.2 AA; text thường đạt 4.5:1, text lớn đạt 3:1 theo định nghĩa chuẩn; kiểm tra nền phía sau kính ở trường hợp xấu nhất. [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Control và trạng thái không chỉ dựa vào màu; HP thấp có số/nhãn, rarity có ký hiệu/nhãn.
- Nút icon có accessible name và tooltip ở pointer; không dùng `title` làm toàn bộ phương án mobile.
- Dialog trap focus, Escape/close đúng, background inert và restore focus. Sheet drag có button đóng thay thế.
- Tabs/segmented/toolbar dùng semantics phù hợp; mọi thao tác có keyboard path.
- Không announce từng tick cooldown bằng live region. Chỉ announce sự kiện có ý nghĩa với mức độ hợp lý.
- Settings có Giảm trong suốt độc lập với Giảm chuyển động; không chỉ phụ thuộc media query chưa hỗ trợ đồng đều.
- Solid mode là thiết kế hạng nhất, không một fallback trắng sơ sài.

## 11. Art direction và tài sản hình ảnh

Giữ procedural plant renderer làm nguồn nhân vật để DNA/rarity/giai đoạn vẫn nhất quán. Không thay mỗi cây bằng ảnh AI tĩnh làm mất biểu hiện gene.

| Tài sản | Yêu cầu |
| --- | --- |
| Garden environment | Vườn nổi/botanical world rõ chiều sâu; vùng trung tâm sạch cho cây; màu lạnh trung tính, greenery và điểm nhấn hoa |
| Breeding environment | Không gian nghiên cứu thực vật, bàn/thiết bị có chủ đích; không neon cyberpunk vô cớ |
| Battle environment | Địa hình thực vật có nền/tiền cảnh, vùng đấu không bị đồ vật che; tối thiểu một sân hoàn chỉnh |
| Empty/locked illustration | Nhỏ và đúng ngữ cảnh, không emoji khổng lồ |
| Element/rarity system | Nhãn + icon + màu; đồng bộ portrait, stat, skill và reward |

Trước code, tạo ba concept riêng kích thước lớn: Vườn mobile, Trận đấu mobile, Lai desktop. Sau đó tạo asset môi trường không có chữ/UI, không dùng screenshot concept làm background app. Kiểm tra giấy phép của asset ngoài và lưu nguồn/license. Responsive art direction có crop mobile riêng; không crop mất đối tượng cốt lõi.

Không tạo toàn bộ mockup nhiều màn hình thành một ảnh nhỏ khó đọc. Concept là reference thiết kế, không phải bằng chứng ứng dụng đã hoạt động. Chưa chọn asset provider trong tài liệu này.

## 12. Hợp đồng UI và logic

Đọc `docs/18_PROJECT_LOGIC_AUDIT.md` và `docs/20_GAME_LOGIC_BLUEPRINT.md` trước khi đưa số liệu lên UI mới. Các phép đo trong doc 19 là baseline nghiên cứu, cần chạy lại nếu domain đã thay đổi.

| Contract | Ràng buộc |
| --- | --- |
| Eligibility | Một nguồn domain cho điều kiện chăm/lai/đấu/bán; không định nghĩa lại ở chip filter |
| Preview | Chi phí, modifier, xác suất dùng cùng logic với execute; chưa xác minh thì không tuyên bố bảo đảm |
| Irreversible | Bán, mất bố mẹ, giao hàng, chọn save có confirmation phù hợp |
| Async | Pending rõ, chống submit trùng; retry không tạo giao dịch thứ hai |
| Rewards | Animation đọc kết quả đã settle; không tự cộng reward trong renderer |
| Replay | Chạy dữ liệu replay, không phát thưởng hoặc biến đổi live plant lần nữa |
| State | Store/server là nguồn sự thật; view chỉ giữ ID và preferences |
| Lifecycle | Unmount hủy listener, timer, observer và request nếu cần; không nhân đôi poll |

Tách backlog UI khỏi backlog logic. Nếu một tính năng đẹp cần logic mới, ghi dependency và feature flag; không vẽ nút chức năng giả. Không đổi công thức chiến đấu để làm animation “hợp mắt”.

## 13. Kiến trúc triển khai

Giữ Vite + vanilla TypeScript/DOM. Không migrate React/Tailwind chỉ vì đổi phong cách. Có thể thêm `lucide` package phù hợp DOM sau khi xem lockfile và giới hạn bundle.

Đề xuất các lớp CSS mới: tokens → base → primitives → shell → screen styles → effects → accessibility. Import theo thứ tự hoặc dùng `@layer` sau khi kiểm tra cascade hiện có; không trộn stylesheet unlayered cũ rồi kỳ vọng layered styles tự thắng.

Di chuyển từng nhóm selector theo component. Không tiếp tục nối vài nghìn dòng override vào cuối `src/styles.css`. Không xóa toàn bộ CSS cũ trước khi các màn hình đã có replacement. Nếu cần scope phiên bản mới, dùng một root attribute rõ và giới hạn thời gian chuyển đổi.

| Vùng nguồn | Trách nhiệm dự kiến |
| --- | --- |
| `src/ui/app.ts`, `screens/types.ts` | Shell, route mapping, UI state, nav compatibility |
| `src/ui/components.ts` và primitive modules nếu cần | Component contract, semantics, icons, sheets |
| `src/styles.css` và stylesheet tách mới | Tokens, vật liệu, responsive, states |
| `garden.ts`, `gardenBar.ts` | Vertical slice vườn/chăm, anchoring toolbar |
| `collection.ts`, `breeding.ts` | Inventory/dex, picker, preview, reveal |
| `arena.ts`, `ascent.ts`, battle UI, `duelResult.ts` | Lobby, scene, HUD, replay, result |
| `lab.ts`, `leaderboard.ts`, `accountSheet.ts` | Catalog, exchange/orders, ranking, account |
| `src/ui/fx`, render/audio modules | Motion và art adapters, không đổi domain |
| `tools/test-*.ts`, audit/screenshot tools | Regression, state fixtures, screenshots |

Tên module mới chỉ chốt sau audit import/coupling; không tạo một framework component tổng quát vượt nhu cầu. Giữ DOM identity cho input, button đang focus và các vùng realtime. Tránh `replaceChildren` toàn màn hình mỗi tick.

## 14. Ngân sách hiệu năng

- Mục tiêu 60fps trên thiết bị mục tiêu; p95 frame trong tương tác thường dưới 20ms là ngưỡng nội bộ ban đầu, đo trên thiết bị thật.
- Tối đa hai vùng blur lớn cùng hiển thị trong trạng thái thường; khi modal mở giảm/ẩn blur chrome phía sau nếu cần.
- Không animate `backdrop-filter`, blur radius hoặc shadow trên toàn scene. Motion chủ yếu transform/opacity.
- Không sample màu background mỗi frame để giả adaptive glass. Dùng context theme đã biết và nền đủ opaque khi không chắc contrast.
- Giảm chất lượng theo preference explicit; nếu auto-detect thì hysteresis, tránh đổi qua lại liên tục.
- Art tải theo route, có placeholder giữ kích thước. Bundle ban đầu không chứa toàn bộ môi trường/resolution lớn.
- Catalogue render theo trang; portrait cache có giới hạn. Không thêm polling vào card riêng.
- Theo dõi long task, memory qua 20 vòng mở/đóng sheet và 10 trận. Không leak timer/observer/audio.

CSS blur là xấp xỉ kính trên web. Playwright Chromium mobile emulation không xác nhận Safari compositing, touch feel hoặc nhiệt thiết bị. Bắt buộc thử Safari trên iPhone thật trước tuyên bố “mượt như iPhone”.

## 15. Kế hoạch thực thi theo cổng chất lượng

### P0 — Baseline và inventory

Đầu vào: HEAD hiện tại + thay đổi local được giữ nguyên. Đầu ra: commit/hash khảo sát, feature inventory, screenshots live, danh sách test pass/fail, các luồng domain không được đổi.

Chụp tất cả màn hình và sheet với fixture mới chơi/midgame/endgame. Chạy typecheck/build và các suite liên quan. Lỗi `test:expanim` từng xuất hiện ở audit trước phải chạy lại và phân loại, không mặc định vẫn tồn tại. Không ghi “all tests pass” nếu chưa chạy hết.

Cổng: đủ feature coverage và baseline lỗi trước khi chỉnh UI.

### P1 — Visual direction và prototype

Đầu ra: ba concept riêng, token sheet, component states, wireflow Vườn → chăm và chọn cây → đấu → kết quả; art manifest.

Cổng: thấy rõ cây, đọc được chữ ở viewport thật, glass không lấn nội dung, solid mode có thiết kế. Chốt direction trước khi polish bảy màn hình.

### P2 — Foundation

Đầu ra: tokens, icons, shell năm mục, route compatibility, sheet/dialog, buttons/inputs, settings giảm chuyển động/trong suốt, screenshot test harness.

Cổng: tất cả route cũ truy cập được; không mất deep link; keyboard/focus/safe-area đúng; không thay store schema chỉ để giữ UI state.

### P3 — Vertical slice Vườn hoàn chỉnh

Đầu ra: vườn + trồng + toolbar chăm + detail + Hôm nay/Túi hạt + reward/level-up.

Cổng: hoàn thành hành trình đầu và phiên quay lại; screenshot/mobile Safari; domain result trước/sau không đổi với cùng fixture. Đây là mốc chứng minh thiết kế trước mở rộng.

### P4 — Cây và Lai

Đầu ra: inventory/dex, picker, filters, protocol preview, confirmation, reveal/result; compare nếu đủ thời gian và contract.

Cổng: không mất bố mẹ bất ngờ; chọn cây không reset; không xuất bản xác suất sai; reduced motion đủ reward/result.

### P5 — Toàn bộ trải nghiệm Đấu

Đầu ra: vượt ải, PvP/room/friends, sân đấu/HUD, pause/auto/speed, kết quả/replay, xếp hạng.

Cổng: lifecycle/room/replay/settlement test; cảnh đấu không blank/crop/overlap; bàn phím và touch đều chơi được.

### P6 — Chợ, tài khoản và trạng thái biên

Đầu ra: catalogue, vật tư/đất, exchange/orders, login/link/sync/conflict, empty/loading/error/offline.

Cổng: đủ tính năng current HEAD; không mua/giao/quy đổi trùng; field error rõ; giữ quest pin và filter.

### P7 — Polish và release gate

Đầu ra: motion/audio hoàn chỉnh, art tối ưu, test coverage, trước/sau screenshots, báo cáo thiết bị thật, cleanup CSS obsolete trong phạm vi đã chuyển.

Cổng: không còn lỗi blocker; build/typecheck/regression; báo cáo giới hạn chưa kiểm chứng; production preview được chơi thử.

Không ước lượng số ngày chắc chắn trước P0/P1. Ưu tiên cổng chất lượng, không đốt thời gian trang trí screen chưa đúng luồng.

## 16. Ma trận nghiệm thu

Viewports: 320×740, 390×844, 430×932, 768×1024, 1366×768, 1920×1080; thêm landscape điện thoại. Test light, dark nếu hỗ trợ, solid, reduced motion. Không cần chụp mọi tích Descartes; chọn pairwise và full coverage cho màn hình rủi ro cao.

| Nhóm | Bài kiểm tra |
| --- | --- |
| Visual | Không blank/crop cây; text không overlap; drawer/dock không che CTA; long Vietnamese names |
| Navigation | Bảy route cũ, năm tab mới, deep link hạt/ải/phòng, Back, scroll/filter persistence |
| Garden | Plant/care fail/success, armed-tool, cooldown, mở detail, reward queue, lên cấp |
| Collection | Owned vs discovered, gone species detail, filter eligibility, sell confirm |
| Breeding | Invalid parents, same parent, costs, each protocol, submit double-click, skip/reduced motion |
| Combat | Every skill/stance mode, pause/speed, room disconnect, lifecycle, result once, replay no reward |
| Shop | Pagination/search/filter, pinned seed, affordability, exchange fee/cap, orders, plot unlock |
| Account | Guest policy, login failure, linking, sync offline/conflict, logout, cleanup |
| Accessibility | Keyboard-only, focus return, labels, contrast over worst background, 200% zoom |
| Performance | Scroll large catalog, 20 sheet cycles, 10 fights, blur fallback, iPhone Safari |

Automated screenshots cần deterministic seed, fixed viewport, frozen clock khi phù hợp và fixture riêng; không chụp lúc animation tùy ý rồi so pixel. Với scene canvas nếu có, kiểm tra pixel khác nền và screenshot; với plant SVG kiểm tra bounding boxes và nội dung render.

### Definition of Done

- 100% tính năng trong inventory có đường truy cập và state coverage hoặc được ghi rõ deferred với lý do.
- Không mất dữ liệu/ngữ nghĩa; không có giao dịch trùng hoặc reward replay.
- Không overlap ở toàn bộ viewport bắt buộc và chuỗi tiếng Việt dài.
- Chế độ solid/reduced motion hoàn thành được các luồng chính.
- Kiểm chứng thật: screenshots từ app, test outputs, profiling; concept không thay cho evidence.
- Tổng kết UI đã đổi, domain giữ nguyên, test đã chạy, test chưa chạy và device chưa thử.

Rubric nội bộ: UX 25, clarity/accessibility 20, visual/art 20, completeness 20, performance 15. Mục tiêu từ 90/100, nhưng bất kỳ blocker dữ liệu, thao tác hoặc accessibility trọng yếu nào đều chặn release dù tổng điểm cao.

## 17. Ưu tiên nâng cấp UX ngoài việc đổi skin

1. Giữ state theo route và return-to-context: tác động lớn, không cần cơ chế game mới.
2. Portrait lớn, camera chuẩn và scene battle: tạo bản sắc trực tiếp.
3. Action preview chung với domain: làm chi phí/hậu quả đáng tin.
4. Bách khoa xem được cả loài không còn sở hữu: tăng giá trị sưu tập.
5. Compare hai cây và quick filter đúng eligibility: hỗ trợ chiến thuật, phụ thuộc stat contract.
6. UI báo kết nối/retry/async rõ: nâng độ tin cậy PvP và tài khoản.
7. Solid mode, reduced motion, keyboard path: mở rộng khả năng sử dụng.

Các tính năng gameplay lớn trong doc 20 triển khai ở track riêng. Không đưa hết vào đợt redesign khiến phạm vi mất kiểm soát.

## 18. Tài liệu giao việc

Đọc cùng `docs/22_AI_UI_IMPLEMENTATION_BRIEF.md`. Mỗi lần giao AI một phase, yêu cầu bằng chứng và checkpoint. Không dùng một prompt “làm toàn app thật đẹp” rồi để AI tự phỏng đoán logic, bỏ màn hình ít nổi bật hoặc thêm chức năng giả.
