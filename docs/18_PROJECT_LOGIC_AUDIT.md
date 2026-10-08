# Rà soát logic và đề xuất nâng cấp

Ngày: 08/10/2026. Phạm vi: các luồng chính của chăm cây, tăng trưởng, gene,
chiến đấu, kinh tế, nhiệm vụ, vượt ải, lưu/đồng bộ, phòng đấu và backend.
Đây là rà soát mã nguồn và kiểm thử, không phải chứng nhận từng dòng mã hoặc production.
Các file có thay đổi sẵn được đọc theo trạng thái hiện tại; mã gameplay không được sửa.

## Lỗi cần ưu tiên

### A01 - P1: Phản hồi đồng bộ của phiên cũ có thể ghi vào tài khoản mới

`src/account/sync.ts`, pull/takeServer/adoptSession: gọi fetch bằng token hiện tại,
chờ mạng rồi ghi qua bridge dùng chung. Nếu đổi tài khoản hoặc đăng xuất trong lúc
chờ, phản hồi A có thể ghi vào slot B; cloudRead/status cũng bị cập nhật sai phiên.
Sửa: chụp token/accountId/sessionRevision trước request, kiểm tra sau mỗi await;
hủy request khi đổi phiên. Test: trì hoãn pull A, chuyển B rồi trả response A.

### A02 - P1: Giữ bản trên máy báo thành công dù server từ chối

`src/account/sync.ts`, keepLocal: gửi local.savedAt + 1 và bỏ qua response.
Local=100, remote=200 thì gửi 101; server giữ remote nhưng UI vẫn báo đã giữ local.
Sửa: kiểm tra kept, resolve bằng revision server; backup trước khi thay bản.
Test: remote mới hơn nhiều và request khác ghi trong lúc resolve.

### A03 - P1: Save và bảng xếp hạng tin chỉ số từ client

`worker/src/index.ts:477`, `worker/src/leaderboard.ts:92`: state được nhận với
kiểm tra rất ít; leaderboard lấy trực tiếp powerRating/breederLevel từ save.
Sửa localStorage/request có thể tự đặt sức mạnh/cấp. Đấu bạn bè chạy trên server
nhưng vẫn đọc cây từ save này, nên chưa bảo đảm cây hợp lệ.
Sửa: schema, giới hạn payload, số hữu hạn và phạm vi; tách backup offline với
tiến trình cạnh tranh được server xác minh. Ranked/giao dịch cần server authority.

### A04 - P2: Né tránh dùng stance của bên tấn công

`src/battle/engine.ts:330`: defender.evasion nhân st.eva của attacker.
Sửa: lấy hệ số của defender. Test giữ attacker cố định, đổi stance defender.

### A05 - P2: Trait Phản Xạ Nhanh chưa hoạt động

`src/config/traits.ts:241`, `src/battle/engine.ts:331`: khai báo evadeFirst=0.45
nhưng handler là nhánh rỗng, kiểm tra trait của attacker; evadeFirstUsed chưa
được cập nhật. Sửa: thực thi trên defender, xác định lúc tiêu thụ và phát event.
Lập ma trận trait -> handler -> test cho toàn bộ registry.

### A06 - P2: Potential crit/evasion sai đơn vị

`src/genetics/genomeGenerator.ts:822`, `src/growth/care.ts:43,79,103,156`:
cap dùng phần trăm (ref * 100), statValue trả thập phân. Trần 20 so với 0.20;
remainingPotential/hardCap sai, apply lại dùng amount/200 và cap chung 0.6.
Sửa: chuẩn hóa đơn vị, dùng chung phép chuyển đổi cho preview/cap/apply.
Test sát soft cap, hard cap, đúng cap và luyện nhiều lần.

### A07 - P2: Phạt spam chăm cây không hết hạn

`src/growth/care.ts:69,140,196`: count24h thực chất là tổng lifetime, không expire.
Sau khoảng 5 lần một hành động, hệ số giảm về 0.4 và không hồi khi nghỉ lâu.
Sửa: tách lifetime counts (nhiệm vụ/giá bán) với cửa sổ chống spam có timestamp.
Không reset trực tiếp counts hiện tại vì kinh tế/nhiệm vụ cũng đọc nó.

### A08 - P2: Thông báo tăng stat khi cap đã chặn tăng

`src/growth/care.ts:79,180,350`: statValue không đọc growthStats; growthRate và
mutationChance luôn được coi là 0 khi preview. Apply clamp 0.9/0.45 nhưng result
vẫn báo điểm đã roll. Surprise gain cũng bỏ qua kiểm tra potential hard cap.
Sửa: trả delta thực sau cap; surprise đi qua cùng bộ kiểm tra trần.
Test growthRate=0.9, mutationChance=0.45 và surprise vào stat đúng hard cap.

### A09 - P2: Thời gian lớn hiển thị không khớp engine

`src/config/species.ts:110`, `src/ui/screens/lab.ts:447`, `src/growth/stages.ts:16`:
giống có growMinutes (ví dụ 20 phút), nhưng engine dùng 15+60+180 giây chung,
điều chỉnh theo growthRate; growMinutes không quyết định lịch trưởng thành.
Sửa: engine và UI đọc một nguồn thời gian; hoặc dùng lịch theo giống hoặc hiển thị
ước lượng thật của engine. XP lên stage dùng Math.random, nên seed theo cây/stage
hoặc dùng lượng cố định để cùng save không cho XP khác nhau khi chạy lại.

### A10 - P2: Auto-sync và retry không phục hồi đúng

`src/account/sync.ts`, initAccount/startAuto/push: boot khôi phục token chỉ pull,
không startAuto; reload mất timer. Nếu pull đầu lỗi, timer gọi push nhưng push
từ chối khi cloudRead=false, không fetch lại để phục hồi.
Sửa: scheduler cho phiên restored, retry pull với backoff rồi push; chỉ ghi khi dirty.
Test reload phiên hợp lệ; mất mạng lúc boot rồi mạng trở lại.

### A11 - P2: Ghi cloud bằng timestamp chưa chống cạnh tranh

`worker/src/index.ts:478`, `src/core/store.ts:440`: client quyết định timestamp;
máy có đồng hồ tương lai có thể giữ ưu thế lâu. KV read-compare-write không nguyên tử:
hai request cùng đọc cũ, bản thấp có thể ghi sau bản cao.
Sửa: revision server + compare-and-swap trong Durable Object/database.

### A12 - P2: Lỗi lưu local bị bỏ qua

`src/core/store.ts:453`: localStorage catch bỏ qua quota/privacy lỗi. Người chơi
có thể chỉ còn dữ liệu trong memory rồi mất khi reload; sync chưa bảo đảm báo
trạng thái persistence này. Sửa: trạng thái lưu riêng, thông báo có kiểm soát,
backup/export; cân nhắc IndexedDB khi save lớn.

### A13 - P2: Repair save còn thiếu validation trường

`src/core/store.ts:1790`: đã lọc cây thiếu dna/stats/growth, nhưng chỉ kiểm tra
truthy. Gene thiếu được gán {} mà không mặc định từng gene; archetype chưa repair;
mood lạ dạng string vẫn giữ và có thể làm MOOD_EFFECTS undefined.
Sửa: schema + migration version, validate từng cây, cách ly cây hỏng và giữ raw backup.
Test mood lạ, archetype thiếu, gene thiếu/null, object sai kiểu.

### A14 - P2/P3: Event chiến đấu báo sai hành động

`src/battle/engine.ts:481,912,1111`, `src/battle/battleView.ts:705`:
Focus hồi energy nhưng phát HEAL_APPLIED=40, view hiện +40 heal. Bật regen cũng
báo lượng heal chưa xảy ra. Cleanse amount=0 bị bỏ log. STATUS_EXPIRED đặt side
bên đối thủ; regen source cố định a.
Sửa: tách ENERGY_GAINED/STATUS_APPLIED/CLEANSED; chuẩn actor/target/source;
heal event dùng lượng HP thật tăng. Test cả bên a/b và HP đã đầy.

### A15 - P2: Đổi hành động là bỏ qua cooldown chăm cây

`src/growth/care.ts:112`: cooldown chỉ kiểm tra lastAction khi cùng id.
Water -> sunlight -> water trong cùng timestamp đều thành công dù water có
cooldown 45 giây. Có thể luân phiên liên tục để lấy stat/XP/Nectar miễn còn tài nguyên.
Sửa: lưu lastAppliedAt theo từng action; chọn rõ cooldown riêng hay cooldown chung;
UI và engine dùng cùng phép kiểm tra. Test A -> B -> A ngay lập tức phải từ chối
nếu cooldown A chưa hết; đúng thời điểm hết mới cho phép.

## Điểm thiết kế cần nâng cấp

1. ECR: damageScore suy từ win rate, controlScore từ gene, timeToKillP50 là proxy
   HP cuối trận, không phải thời gian hạ đối thủ (`ecrCalculator.ts`). Đo DPS,
   heal thật, thời gian CC, kill time; tăng mẫu khi cần, cache theo build/balanceVersion.
2. 12.005 giống chưa đồng nghĩa 12.005 cách chơi. Đo trùng build/skill/visual,
   nhóm theo cơ chế khác biệt, ưu tiên vài giống tiêu biểu và lựa chọn chiến thuật.
3. Chăm cây tối thiểu +1 ở nhiều trọng số nhỏ khiến các hành động dễ giống nhau.
   Dùng tích lũy phần lẻ hoặc mục tiêu luyện rõ; đo giá trị trên chi phí.
4. Stress giảm chủ yếu bằng hành động khác, dễ tạo vòng bấm luân phiên.
   Neglect dùng Date.now thay vì now đầu vào. Cần nghỉ/hồi theo thời gian và clock chung.
5. Bón phân mô tả tăng ngẫu nhiên một stat nhưng tăng toàn bộ primary/secondary;
   cắt tỉa mô tả giảm HP nhưng chưa thấy nhánh trừ HP. Đồng bộ lời mô tả với hành vi.
6. Budget ghi theo thiết bị không kiểm soát tổng namespace; mỗi sync ghi nhiều key.
   Gom ghi, dirty tracking, server quota/telemetry và backoff.
7. Leaderboard đọc/sort toàn bộ mỗi request, giới hạn 10 trang nhưng trả rank/total
   như đầy đủ. Dùng index/snapshot cache; tie-break nên là lúc đạt mốc, không lúc sync.
8. Leaderboard trả email. Dùng handle công khai và tùy chọn tìm kiếm bằng email.
9. Mã phòng là quyền gửi/reset. Ranked cần quyền host/guest, message validation
   và kết quả đáng tin; casual prototype hiện tại có giới hạn này.
10. GameStore nhiều trách nhiệm. Tách dần persistence/economy/care/breeding/ascent
    khi sửa, giữ API để hạn chế regression; không cần đổi framework.
11. Nhiều test browser gắn cứng localhost:5173 và phụ thuộc dev server đang chạy.
    Cần test runner tự khởi động server riêng, cấu hình base URL, mock API ngoài,
    dọn browser/server trong finally và có timeout toàn suite. Thêm typecheck worker
    riêng để lỗi Durable Object/router không lọt qua typecheck frontend/tools.

## Tính năng đề xuất

| Ưu tiên | Tính năng | Giá trị |
| --- | --- | --- |
| P0 | Lịch sử save và khôi phục phiên bản | Giảm mất tiến trình |
| P0 | Trạng thái lưu local/cloud rõ ràng | Biết dữ liệu đã được lưu ở đâu |
| P1 | So sánh hai cây và bộ kỹ năng | Delta, tiềm năng, vai trò, khắc chế |
| P1 | Sổ phả hệ và gene nổi bật | Lai có mục tiêu |
| P1 | Preview lai đầy đủ chi phí/rủi ro/kế thừa | Quyết định có thông tin |
| P1 | Kế hoạch luyện tank/burst/control | Hành động phù hợp mục tiêu |
| P1 | Replay và nguyên nhân thắng/thua | Học cách cải thiện build |
| P1 | Phòng tập với đối thủ cố định | Thử build không mất tài nguyên |
| P1 | Preset cây/stance/kỹ năng | Giảm thao tác khi đổi chiến thuật |
| P1 | Thời tiết tác động thật và preview | Chăm cây có lựa chọn theo môi trường |
| P1 | Nghỉ dưỡng và hồi stress | Tạo nhịp chăm hợp lý |
| P1 | Thu hoạch theo chu kỳ | Cây trưởng thành có giá trị giữ lại |
| P1 | Đơn NPC yêu cầu build, có hạn thực | Đầu ra cho cây không dùng đấu |
| P1 | Lọc/sort vườn, thao tác nhóm có preview | Quản lý bộ sưu tập lớn |
| P2 | Biome và đất phù hợp giống | Bố trí vườn có chiến thuật |
| P2 | Expedition chọn đường/buff/phần thưởng | Vòng chơi khác vượt ải tuyến tính |
| P2 | Boss có cơ chế và dấu hiệu | Giải bằng build và quyết định |
| P2 | Thử thách tuần với bộ luật cố định | Khuyến khích đổi đội hình |
| P2 | Nghiên cứu gene, khám phá công thức | Collection tạo kiến thức/công cụ |
| P2 | Bộ sưu tập theo họ gene/cơ chế | Mục tiêu vừa sức, thưởng cosmetic |
| P2 | Nâng lab/nhà kính/kho | Đầu ra tài nguyên lâu dài |
| P2 | Trang trí vườn/skin | Tiêu tài nguyên không lệch sức mạnh |
| P2 | Thăm vườn/chia sẻ build/replay | Social ngoài gửi lời đấu |
| P3 | Co-op boss | Sau khi giao thức server ổn định |
| P3 | Ranked mùa và ghép trận sức mạnh thật | Sau A01/A03/A11 và đo cân bằng |
| P3 | Chợ/trao đổi cây | Cần escrow, chống double-spend, dữ liệu đáng tin |

## Lộ trình

1. Save/đổi phiên/retry + backup và migration.
2. Stance/trait/event + đơn vị/cap/care memory.
3. Thời gian lớn/preview + đo kinh tế và cân bằng.
4. So sánh/phả hệ/phòng tập/replay.
5. Thời tiết/biome/thu hoạch/NPC/boss/expedition.
6. Ranked/co-op/giao dịch sau khi có server authority.

Tiêu chí: regression test cho lỗi; không mất save khi reload/đổi tài khoản/mất mạng;
preview khớp delta; trait có tác dụng; cân bằng theo tier/matchup;
UI kiểm tra mobile/keyboard/reduced motion.

## Kiểm chứng

- npm run typecheck: thành công. Cấu hình src/tools chưa kiểm tra đầy đủ toàn worker.
- npm run build: thành công; bundle JS khoảng 439 kB, gzip khoảng 144 kB.
- Tái hiện trực tiếp A06 bằng cây seed: crit ở hard cap 16% được chăm pruning
  lên 17%, vượt trần. Tái hiện A08: growthRate=0.9, mutationChance=0.45;
  gene_serum báo +1/+2 tương ứng nhưng hai giá trị thực vẫn giữ nguyên.
- Tái hiện A09: Rễ Gai được ghi 20 phút; lịch seed/sprout/young của cây mẫu
  tính ra khoảng 4.21 phút.
- Tái hiện A15: water -> sunlight -> water với cùng now, cả ba đều trả ok=true.
- npm test: kết thúc exit code 1 tại test:expanim với 5 kiểm tra thất bại.
  Mobile: không tìm thấy panel để kiểm tra vừa màn hình/cuộn.
  Reduced motion: không có panel/thông tin; kiểm tra phần tử vô hình cũng thất bại
  vì panel không tồn tại. Đây có thể là một nguyên nhân chung, không nhất thiết
  là 5 lỗi độc lập. Cần chạy riêng và kiểm tra fixture, queue và thời điểm render.
  Các nhóm phía sau test:expanim trong chuỗi npm test chưa được chạy bởi lần này.
  Các nhóm trước đó đã hoàn tất mà không làm chuỗi dừng.
- test:feel ghi FINDING: không có manual skill khả dụng trong 12 giây và probe
  không thao tác được auto-cast. Cần tái hiện riêng, chưa kết luận lỗi engine:
  trận có thể kết thúc sớm hoặc probe không tìm đúng control.
- Chưa kiểm chứng production hay kiểm tra trực quan tất cả màn hình trên thiết bị thật.
