# Thiết kế logic sâu cho Đại Chiến Cây Đột Biến

Ngày nghiên cứu: 08/10/2026.

Hướng thiết kế giả định: lai tạo chiến thuật là trung tâm; trận tự động có một số
quyết định quan trọng; nông trại tạo nguồn lực và kiến thức để xây cây.
Các hệ số đề xuất dưới đây là điểm bắt đầu cho prototype, chưa phải cân bằng cuối.

## 1. Kết luận thiết kế

Vấn đề lớn nhất hiện tại là mô hình định giá không mô tả đúng sức mạnh thực,
và phần thưởng không luôn giữ lời hứa về xác suất, kế thừa và thời gian đầu tư.
Thêm giống hoặc chế độ trước khi sửa các quan hệ này sẽ làm cân bằng khó hơn.

Vòng chơi đề nghị:

1. Quan sát thử thách và xác định mình đang thiếu gì.
2. Chọn cha mẹ để tạo cơ chế/gene trả lời thử thách đó.
3. Luyện trong giới hạn và chọn bộ trait/kỹ năng phù hợp.
4. Đấu, đọc nguyên nhân thắng/thua, đổi kế hoạch khi cần.
5. Dùng phần thưởng mở thêm lựa chọn và hoàn thiện bộ sưu tập.

Một quyết định tốt phải có ít nhất hai phương án đáng chọn trong những tình huống
khác nhau. Nếu một hành động vừa rẻ hơn, vừa mạnh hơn, vừa ít rủi ro hơn trong mọi
tình huống thì đó là phương án lấn át, cần đổi quan hệ chi phí/lợi ích.
Sức mạnh lớn cần một cách đối phó dễ hiểu; đây cũng là nguyên tắc counterplay
được Riot trình bày trong [tài liệu thiết kế gốc](https://www.leagueoflegends.com/en-gb/news/dev/quick-gameplay-thoughts-may-14/).

## 2. Phương pháp và giới hạn

- `tools/research-game-logic.ts`: seed cố định, không chạm save người chơi/API.
- `docs/19_LOGIC_MEASUREMENTS.json`: kết quả có sourceRevision để đối chiếu.
- Mỗi lần chạy diagnostics: 1.200 phép lai ép target rarity, 360 mẫu giá bán,
  90 cây được chăm tổng 14.400 lần, 4.800 trận mô phỏng.
- Balance pipeline riêng: 360 cây, 120 cây được đánh với 9 benchmark x 12 lượt;
  thêm 120 trận đo timeout, tổng 13.080 trận. Hai bộ đo cộng lại 17.880 trận.
- Bộ benchmark/mẫu nhân tạo không phải phân bố người chơi thực. Chăm cây dùng
  tài nguyên dư dả để đo giới hạn, có ghi chi phí; không chứng minh mọi người sẽ
  đạt các trạng thái đó trong một phiên.
- Engine còn các lỗi đã ghi trong báo cáo 18; cần đo lại sau khi sửa.
- Số mẫu 24 trận cho một ô matchup chỉ để phát hiện vấn đề lớn, chưa đủ để chốt
  thay đổi nhỏ vài điểm phần trăm. Tỷ lệ thắng bao gồm nửa điểm cho hòa.

## 3. Các vấn đề sâu đã đo được

### 3.1. Phòng thủ có tác dụng lớn nhưng không được tính vào ngân sách

`genomeGenerator.ts`, buildValueOf/validateGenome có HP, attack, speed, skillPower,
crit, evasion nhưng thiếu defense.

| Defense của cùng build | Build value | Điểm thắng trước đối thủ cố định, 160 trận |
| --- | --- | --- |
| 51 | 191,01 | 50,63% |
| 102 | 191,01 | 96,25% |
| 204 | 191,01 | 100% |

Đây là phép can thiệp vào một biến, không phải tỷ lệ thắng chung của mọi cây.
Nó chứng minh kiểm tra "đúng ngân sách" hiện tại có thể bỏ qua sức mạnh thực.

Thêm nữa, synergyTax dương đang bị TRỪ khỏi giá trị build. Với fitter tìm đúng
ngân sách, một combo được đánh thuế lại có thể được cấp thêm stat bù vào phần trừ.
Nếu mục tiêu là combo mạnh phải trả giá, chi phí synergy phải cộng hoặc được thu
qua một drawback thực thi trong trận, không chỉ giảm điểm định giá.

### 3.2. Traits được công bố nhiều hơn những gì engine thực thi

Registry có 35 trait và 16 loại effect. Không có consumer đọc `.effects` trong src;
engine triển khai một số trait bằng tên id, phần còn lại không có handler tương ứng.

Phép thử cùng build, cùng seed: thêm thick_bark/stone_heart/rooted_will tạo event
stream giống hệt trước khi thêm; HP cuối vẫn 29,94%, damageTaken vẫn 254.
Riêng immuneFirst cần phép thử kích hoạt stun để đánh giá độc lập, nhưng các
statMult HP và damageReduction đã không xuất hiện trong phép thử này.

Hệ quả: fitter có thể giảm stat để trả điểm cho trait không có hiệu ứng thật;
người chơi đọc một build mạnh nhưng nhận một build khác khi vào trận.

### 3.3. Ngân sách sinh cây không kiểm soát tiến trình chăm cây

Seed plant dùng stats seedling nhưng gọi potentialFromGenes với default bloom.
Trait đột biến được append không có số slot hoạt động tối đa.
Validation chỉ coi invalidCombos là điều kiện rankedLegal; over_budget là warning.

| Kế hoạch chăm, 160 lượt/cây | Budget trước/trần tier | Budget sau/trần tier | Trait trung vị | RankedLegal |
| --- | --- | --- | --- | --- |
| Water + fertilizer | 0,44 | 16,18 | 17,5 | 30/30 |
| Sunlight + pruning | 0,38 | 16,74 | 15 | 30/30 |
| Music + moonlight | 0,51 | 5,94 | 22 | 30/30 |

Đây là tỷ lệ điểm định giá hiện tại, không phải "mạnh gấp 16 lần".
90 cây được chăm đều thắng 100% trước balanced_neutral trong mẫu thử sau luyện.
Budget model và số trait cần giới hạn trước khi thiết kế ranked.

### 3.4. Xác suất roll không phải xác suất kết quả

Gen chỉ lấy target rarity làm một thành phần của rarityScore, rồi đổi band theo score.
UI lại dùng phân bố target làm xác suất công bố.

| Target ép vào generator | Kết quả mẫu seedling, 100 cây |
| --- | --- |
| C | 93 B, 7 A, không có C |
| S | 83 A, 16 S, 1 SS |
| SSS | 85 S, 15 SS, không có SSS |

Ancient cũng có 100 target SSS không cho SSS trong mẫu. Đây không phải bằng chứng
SSS không bao giờ xuất hiện ở mọi thế hệ, nhưng đủ để bác bỏ việc dùng xác suất
target như xác suất kết quả cuối.

Base table ở level 100 ghi SSS 1,5%; final pipeline cắt xuống khoảng 0,2% do cap
raw.SSS tuyệt đối. PITY.sssHard=1000 được khai báo nhưng không được dùng để guarantee;
ngay tại counter 1000, probe vẫn chỉ cho 27 basis points target SSS, tức 0,27%.

### 3.5. Hy sinh hai cây không bảo toàn hợp lý công sức luyện

Hiện XP truyền là averageLevel * 6 + 50, trong khi tổng XP để đạt cấp tăng phi tuyến.

| Hai cha mẹ cùng cấp | XP cho con | Cấp con hiện tại | XP tích lũy của một cha mẹ |
| --- | --- | --- | --- |
| 15 | 140 | 2 | 12.266 |
| 30 | 230 | 2 | 66.885 |
| 60 | 410 | 3 | 366.990 |
| 100 | 650 | 4 | 1.286.955 |

Tier chiến đấu của con lấy theo cấp cha mẹ nên không thể suy ra con yếu chỉ từ cấp 2.
Tuy nhiên phần "công sức luyện được truyền" hiện càng lên cao càng mất gần hết XP;
trait inheritance report cũng luôn rỗng trong 1.200 phép lai. assignTraits không
nhận trait của cha mẹ nên không có đường kế thừa trực tiếp các trait đã luyện ra.

### 3.6. ECR có nhiễu từ định danh và dùng proxy chưa đúng tên

Cùng benchmark build, chỉ đổi plantId: ECR chạy 12 sessions/matchup dao động 0,15-0,33.
Nguyên nhân gồm seed đánh phụ thuộc plantId và mẫu nhỏ. Không nên dùng một giá trị
như vậy để định giá/gating như thể là sức mạnh chính xác.

Balance pipeline đo ECR median 0,305; 118/120 cây bị phạt variance tới trần 0,2.
Median win rate trước roster là 0,58, độ lệch matchup trung vị 0,38.
DamageScore suy từ win rate; timeToKill là proxy HP cuối trận; controlScore từ gene.
Cần tách sức mạnh, mức chuyên môn hóa và độ chắc chắn của phép đo.

### 3.7. XP trả cho nhà lai tạo phụ thuộc cách chia phần thưởng

Lên cấp cây theo từng bước 1 -> 30 trả tổng 818 breeder XP theo hàm hiện tại.
Lên thẳng 1 -> 30 trong một grant chỉ trả 40 vì announcePlantLevelUp chỉ trả cho
cấp cuối. 1 -> 15 tương ứng 238 so với 30.
Đây là lỗi bất biến thưởng: cùng tiến trình không nên đổi thưởng do batching UI.

### 3.8. Chi phí hiếm vượt xa vòng đời chơi hợp lý

Catalogue hiện có 1.060 giống trả bằng Ember. Giá nhỏ nhất 2.669, trung vị 3.670,5.
Nguồn Ember hiện là drop capped 3/ngày, không có đường đổi vào.
Mua hạt rẻ nhất cần ít nhất 890 ngày, hạt trung vị cần 1.224 ngày nếu luôn đạt cap.
Đây là quyết định có chủ đích trong comment PRICE_BAND; mình đề nghị thay vì nó
khóa nội dung nhiều năm thay vì tạo mục tiêu dài hạn vừa sức.

Giá đang bị yêu cầu duy nhất theo từng giống. Độ hiếm sinh học không cần một giá
tiền không trùng: nhiều giống cùng mức giá giúp lựa chọn dựa trên build, không
phải khác nhau một vài đơn vị ngẫu nhiên.

### 3.9. Tốc độ đang có lợi ích tăng dần rồi đụng vách cap

Interval = clamp(2.2 - speed/60, 0.5, 2.2).
Speed 40 -> 60 tăng attacks/second 0,652 -> 0,833; 80 -> 100 tăng 1,154 -> 1,875.
Lợi ích một điểm speed tăng khi tới cap, ngược comment nói giảm dần.
Sau cap, nhiều điểm speed mất tác dụng. Giá speed tuyến tính không phản ánh hai miền này.

### 3.10. Bộ đo skill không có cùng luật năng lượng với cây người chơi

Benchmark skill luôn energyCost=0; skill sinh ra heal/shield thường có chi phí.
Probe cùng kit sustain trước balanced_neutral, chỉ đổi energyCost của toàn kit:
0 -> điểm thắng 48,33%; 18 -> 21,67%; 26 -> 0%, mỗi trường hợp 120 trận.
Đây là thử nghiệm nhạy cảm toàn kit, không phải hệ số để áp nguyên vào heal/shield.
Nó cho thấy benchmark cần cùng cost/regen/start-energy/recovery như build được đo.

### 3.11. Campaign tăng khó theo tuổi tài khoản dù người chơi nghỉ

ascentDayIndex lấy Date.now - createdAt, không phải số ngày đã chơi.
Stage power cộng 2%/ngày tới +35%; affix cũng đọc dayIndex. Cây giữ nguyên còn
đối thủ đổi mạnh khi người chơi quay lại. Cần tách campaign khỏi challenge theo lịch.

## 4. Mô hình logic đề nghị

### 4.1. Một mô hình sức mạnh, nhiều hồ sơ matchup

Pipeline phenotype:

`gene gốc -> biểu hiện + phân bổ luyện -> trait đang trang bị -> stance -> hiệu ứng tạm -> combat`

- Gene gốc không bị ghi lại bằng buff chiến đấu. Derived stats không lưu đè vào base stats.
- Tất cả effect phải có handler có kiểu và test kích hoạt. Registry thêm effect chưa
  được triển khai phải gây lỗi kiểm tra, thay vì bị bỏ qua.
- Cost gồm survival, DPS, utility, skill throughput và synergy cost dương.
- Survival vật lý dùng EHP = HP * (1 + defense/K), theo đúng công thức giảm damage.
  Thêm hệ số kháng/chống xuyên giáp theo các miền damage thực sự tồn tại.
- DPS dùng attack * actualAttackRate * (1 + critChance * (critMultiplier - 1));
  multiplier engine hiện là 1,6, không dùng 1,8 ở mô hình budget.
- Định giá active trait và năng lực thật. Trait chỉ sưu tầm không tiêu budget combat.
- ECR chỉ là ước lượng cùng tier/training band, có matchup vector và confidence.
  Không gộp specialization vào cùng scalar rồi phạt mọi cây counter.
- Ranked matchmaking tách MMR người chơi với sức mạnh cây; PvE dùng hồ sơ counter
  và mục tiêu tiến trình, không chỉ một con số power.

### 4.2. Chăm cây là phân bổ có giới hạn

- Potential tạo theo đúng tier; crit/evasion dùng fraction thống nhất trong toàn engine.
  Không Math.round cap sau từng level: các cap nhỏ hiện có thể không tăng qua nhiều
  level, và khi đổi về fraction sẽ dễ bị làm tròn về 0. Tính cap từ base + level,
  giữ precision trong model, chỉ làm tròn khi hiển thị.
- Training pool chung cho cây. Mức thử ban đầu: trần tổng luyện +20% budget sinh
  ra; hiệu quả giảm khi gần cap. Đây là hệ số thử, phải retune PvE cùng lúc.
- Mỗi hành động có trọng tâm và rủi ro riêng. Không ép mọi trọng số nhỏ thành +1;
  tích lũy phần lẻ, apply delta thực, thu phí và giải thích rõ khi không có lợi ích.
- Cooldown theo action + nhịp nghỉ chung, thời gian được inject. Một hành động khác
  không được xóa cooldown cũ. History chống spam riêng với lifetime counts.
- Stress hồi theo thời gian; chăm đúng môi trường giảm stress, không thưởng tối đa
  cho vòng bấm luân phiên. Offline progression bảo toàn thời gian đã trôi qua.
- Có thể học nhiều trait nhưng chỉ trang bị tối đa 3 trait thường + 1 signature;
  đây là giới hạn prototype để buộc chọn synergy và giữ khả năng đọc build.
- Một action chọn thiên hướng HP/defense hoặc attack/crit hoặc skill/control;
  cây không thể chỉ nhờ chăm lâu mà giỏi mọi mặt.
- Trait mới mở có thể đổi trang bị ở lab. Đổi phân bổ trả chi phí vừa phải,
  không làm người chơi mất cây quý chỉ để sửa một lựa chọn ban đầu.

### 4.3. Tách lai tạo với dung hợp

| Luật | Lai giữ cha mẹ | Dung hợp |
| --- | --- | --- |
| Mục tiêu | Tạo dòng gene và thử hướng build | Cô đặc hai cây thành build mới |
| Cha mẹ | Giữ lại, hồi phục sau lai | Bị tiêu thụ có xác nhận và preview |
| XP con | Bắt đầu thấp, không sao chép XP farm | Giữ một phần XP đầu tư đã tích lũy |
| Trait | Chọn một trait ứng viên có xác suất rõ | Bảo đảm một trait được chọn nếu tương thích |
| Chi phí | Vật liệu lai, năng lực sinh sản hồi phục | Phí, hai cây, vật liệu bảo toàn |
| Chống farm | Sản lượng hữu hạn, cost/sink thật | Bảo toàn ledger, không đếm lại XP đã chuyển |

Candidate đã thử về mặt đường XP: giữ 30% tổng XP của hai cha mẹ cùng cấp
cho con ở cấp 12/24/48/81 khi cha mẹ cấp 15/30/60/100. So với hiện tại cấp 2/2/3/4,
nó bảo toàn tỷ lệ đầu tư. Chưa chốt 30% cho production; đo 20/30/40% theo session
và quy mô tài nguyên trước khi chọn. Không cộng lại breeder XP từ XP chuyển giao.

Trait inheritance thực sự đọc active/archive traits cha mẹ, có điều kiện tương thích;
preview liệt kê gì được bảo đảm, gì ngẫu nhiên, gì mất. Favorite/manual lock được
store bảo vệ; chỉ một lệnh dung hợp explicit mới được tiêu thụ cây khóa.

### 4.4. Một lần quyết định rarity, nội dung đáp ứng rarity

- Roll outcome band một lần từ odds cuối đã công bố.
- Generator xây nội dung đáp ứng band đó; rarityScore là điểm novelty/quality phụ,
  không được tự downgrade band sau khi roll.
- Nếu cần fallback, fallback giữ bảo đảm tối thiểu hoặc hoàn tài nguyên; không reroll
  qua một phân bố mới mà UI chưa công bố.
- SSS cap phải giới hạn phần bonus so với base theo level, không cắt base table về
  một số cố định trái bảng. Hard pity được áp trước normalization và thực thi outcome.
- RNG có các stream độc lập cho rarity, gene, trait, skill, visual, loot;
  đổi hiệu ứng hình không được đổi xác suất ra cây hiếm.
- Rarity mở khả năng/nhận diện và mức linh hoạt build. Không mặc định "hiếm hơn luôn
  thắng": một cây thường chuyên dụng vẫn có vai trò trước build cao cấp khác.
- Khi roll xấu, nhận nghiên cứu hoặc vật liệu hữu ích có hạn mức; không bù toàn bộ
  bằng tiền khiến cách chơi tối ưu thành quay rồi bán.

Thiết kế randomness phải có mục tiêu và khả năng người chơi quản lý rủi ro, thay vì
chồng nhiều random không thể dự đoán. [Tổng quan GDC của Randy Smith](https://www.gdcvault.com/play/1028984/Cards-Dice-and-RNGs-Using)
ủng hộ cách tiếp cận này; nguồn được đọc là abstract, không phải toàn video.

### 4.5. Trận tự động có điểm quyết định và cách đối phó

- Auto dùng cùng luật với manual: energy, cooldown, cast, recovery, CC.
- Telegraph đòn mạnh đủ để phản ứng. Prototype: 0,8-1,2 giây cho đòn quyết định,
  trận ngang sức trung vị 20-35 giây; đây là mục tiêu cảm giác cần playtest.
- Stance thay đổi có cost/cooldown thật; guard chống burst, focus mở cửa sổ ra chiêu,
  swift tránh một đòn đã báo, aggressive kết liễu nhưng dễ bị trừng phạt.
- Năng lượng chung cho cả damage/support, hoặc định giá kỹ năng đúng theo nguồn lực
  mà nó tiêu. Cho heal/shield cửa sổ sử dụng trước khi trận đã kết thúc.
- Giới hạn hard CC và kháng tích lũy theo cửa sổ; không perma-lock.
- Phản damage không tạo phản damage mới/energy/crit; shield và DoT có quy tắc rõ.
- Shield có expiry/cap; heal dùng lượng thật phục hồi; cleanse xử lý tập status được
  định nghĩa. Poison, burst, sustain đều có counter dễ nhìn thấy.
- Speed candidate có lợi ích giảm dần: attackRate = referenceRate *
  `(1 + alpha * speed/(speed+K)) / (1 + alpha * refSpeed/(refSpeed+K))`.
  Thử alpha=1, K=refSpeed rồi đo lại DPS/matchup; không thay công thức mà giữ cost cũ.
- Tick hai bên đọc state đầu tick, resolve theo luật xác định và cho phép kết liễu
  đồng thời. Đo side bias với mẫu lớn trước khi quy kết 120 mirror trận hiện tại.
- Result giải thích damage thật, shield hấp thụ, heal hiệu quả, thời gian mất quyền
  hành động và một hành động có thể đổi kết quả; không chỉ báo power thấp hơn.

### 4.6. Kinh tế theo thời gian đạt mục tiêu

- Công thức giá: giá = earningRate của hoạt động ở tier đó * thời gian mục tiêu,
  sau đó điều chỉnh chất lượng trong khoảng hữu hạn. Giá nhiều giống được phép trùng.
- Prototype mục tiêu: hạt phổ thông 1-3 hoạt động; lựa chọn build mới 1-3 phiên;
  giống endgame đầu tiên 7-21 ngày chơi; cosmetic uy tín có thể dài hơn.
- Ember có thu nhập nền chắc chắn qua thử thách; random là thưởng thêm.
  Nếu cap 3/ngày còn giữ, hạt 7-21 ngày phải thuộc khoảng 21-63 Ember theo thu nhập
  tối đa, và thấp hơn nếu trung bình người chơi không đạt cap. Không giữ giá 2.669.
- Giới hạn theo tuần có thể thay daily cap để người nghỉ vài ngày vẫn chơi bù.
- Coin/Nectar/Pollen có nơi tiêu: sinh sản, nghiên cứu, hồi phục, nâng tiện ích;
  sức mạnh trực tiếp luôn bounded. Cây không dùng có giá trị NPC/recycle/archive.
- Exchange hiện có fee và không đổi vào Ember: giữ bất biến vòng đổi không sinh lời,
  nhưng đo earningRate thật; bảng quy đổi không tự sửa được giá cửa hàng phi thực tế.
- Reward nhận từ fightId/actionId một lần, cần settlement idempotent trước ranked.
- Theo dõi nguồn/đích tài nguyên, số dư, chi phí mỗi build và thời gian tới lần mở
  khóa tiếp theo; không điều chỉnh mọi giá chỉ từ số dư của vài account mạnh.

### 4.7. Progression công bằng và campaign ổn định

- Tổng thưởng cho các cấp vượt qua phải giống nhau dù grant lớn hay nhiều grant nhỏ.
  Tách thông báo gộp khỏi phép cộng phần thưởng.
- XP chuyển giao/luyện thật/breeder XP là các nguồn ledger khác nhau;
  lifetimeExp có định nghĩa rõ, không vô tình cộng kép cùng tiến trình.
- Campaign giữ độ khó theo stage, không tăng vì tuổi account hoặc vắng mặt.
- Thử thách theo tuần/season là trục khác, có seed luật và rewards riêng.
- Đo tường progression bằng tỷ lệ vượt sau khi đổi chiến thuật; thất bại phải mở
  được một đường tiếp tục qua cây khác, vật liệu/quest phù hợp, không bắt farm vô hạn.

## 5. Đo lường để chọn hệ số

Mô phỏng tìm bất biến và phương án lấn át; playtest kiểm tra hiểu luật và cảm giác.
Riot mô tả kết hợp win/pick rate, matchup, cách dùng đòn và trải nghiệm người chơi
trong [Live Balance Philosophy](https://2xko.riotgames.com/en-us/news/dev/2xko-live-balance-philosophy/).
Không áp một mục tiêu 50% lên mọi cặp: counter vừa phải vẫn tạo chiến thuật.

| Kiểm tra | Điều kiện prototype chấp nhận |
| --- | --- |
| Rarity contract | Band cuối đúng band roll, hard pity đạt bảo đảm |
| Traits | Mỗi effect có tình huống kích hoạt và thay đổi state/event thật |
| Budget | Defense/speed/skill/CC/synergy đều có cost cùng semantic |
| Training | Không vượt training budget; learned khác equipped |
| XP conservation | Batch và incremental nhận thưởng bằng nhau |
| Reroll identity | Cùng build có cùng ECR với bộ seed cố định |
| Counterplay | Build mạnh có điểm yếu và ít nhất một đường đối phó |
| Matchup | Không một archetype thắng trên 70% trước tất cả archetype còn lại |
| Duration | Ngang sức hướng tới median 20-35s, timeout <5%, đo riêng từng tier |
| RNG | Không đổi outcome khi đổi visual/name/UI; đo xác suất đúng confidence |
| Economy | Nội dung cốt lõi tiếp cận trong thời gian mục tiêu, không cần nhiều năm |
| Returning player | Cùng campaign không khó hơn chỉ do vắng mặt |
| Persistence | Replay/settlement/save version nhất quán, retry không nhân thưởng |

Threshold duration/matchup/economy là mục tiêu thử cho game này, không phải chuẩn
phổ quát hay kết luận rút ra từ game khác.

## 6. Lộ trình triển khai cụ thể

1. Sửa hợp đồng cơ bản: trait resolver, cap/units/cooldown, rarity outcome/pity,
   XP batching, seed potential đúng tier. Thêm regression test riêng từng lỗi.
2. Viết một computeBuildCost dùng chung fitter/validator; thêm EHP/attackRate,
   synergy cost; benchmark dùng cost thật. Mỗi thay đổi có snapshot trước/sau.
3. Thêm training pool và loadout traits; giữ archive trait cũ. Cây cũ vượt budget
   được giữ dữ liệu và tách mode legacy/casual cho tới khi có migration có preview.
4. Prototype lai giữ cha mẹ và dung hợp có kế thừa thật; ledger chống thưởng kép.
   Đo ba mức inheritance và nguồn/sink của vật liệu trước khi chọn mức production.
5. Retune campaign và giá currency theo vòng chơi mới, bỏ age escalation campaign;
   thêm thử thách tuần, phòng tập và báo cáo trận để người chơi tự cải thiện.
6. Playtest 5-10 người qua các tình huống cụ thể, ghi hiểu luật/quyết định/điểm nghẽn;
   sau đó mở telemetry nhỏ. Đây là bước cần người chơi thật, mô phỏng không thay thế.
7. Chỉ mở ranked/trading sau khi server xác minh tiến trình và settlement/save đáng tin.

Kiến trúc giữ TypeScript hiện tại: config luật có version, các hàm pure nhận clock/RNG,
GameStore điều phối transaction, UI đọc preview cùng evaluator với action. Có thể dùng
Web Worker cho batch ECR; không cần đổi framework để thực hiện thiết kế này.
Unified clock giúp replay và kiểm thử không lệch theo máy; tham khảo
[Riot Unified Clock](https://www.riotgames.com/en/news/determinism-league-legends-unified-clock).

## 7. Chạy lại nghiên cứu

```powershell
npx tsx tools/research-game-logic.ts docs/19_LOGIC_MEASUREMENTS.json
npm run balance -- 360 12
npm run typecheck
```

Không sửa gameplay trong lượt nghiên cứu này. Candidate inheritance và các hệ số
training/speed/cost là đề xuất cần prototype và playtest, không tuyên bố đã tối ưu.

Kiểm chứng: diagnostics chạy thành công; chạy lại cho JSON có SHA-256 giống nhau.
Typecheck src/tools thành công. Balance pipeline hiện exit 1 do ECR median 0,305
không đạt khoảng kiểm tra 0,35-0,65; không sửa threshold để che kết quả này.
