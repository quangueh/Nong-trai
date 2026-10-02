# Core Game Design

## 1. Trải nghiệm chính

Game là nông trại lai tạo cây chiến binh.

Người chơi có thể bán cây trưởng thành để lấy tiền, nhưng mỗi cây vẫn là một cá thể có gene riêng chứ không phải nông sản đồng nhất. Người chơi **nuôi từng cá thể cây** như thú cưng/chiến binh hoặc tài sản lai tạo:

- Gieo mầm.
- Chăm sóc.
- Kích thích phát triển chỉ số.
- Tạo đột biến.
- Lai giống.
- Chọn cây đi đánh.
- Tạo thế hệ mới mạnh hơn, lạ hơn, khó đoán hơn.
- Định giá và bán cây không còn cần dùng để tái đầu tư vào hạt, vật tư và ô đất.

Chi tiết shop, rarity và bán cây nằm tại `16_SHOP_RARITY_SELLING_ECONOMY.md`.

## 2. Giống nền

MVP có 5 giống nền. Đây không phải cây cố định cuối cùng, mà là nền gene:

| baseId | Tên | Hệ chính | Thiên hướng |
|---|---|---|---|
| thornroot | Rễ Gai | Mộc/Đất | thủ, phản đòn |
| emberleaf | Lá Lửa | Mộc/Lửa | sát thương bùng nổ |
| dewbud | Búp Sương | Mộc/Nước | hồi phục, làm chậm |
| voltvine | Dây Sét | Mộc/Sét | tốc độ, chí mạng |
| gloomcap | Nấm U Ám | Mộc/Độc | độc, debuff |

Từ 5 giống nền này, lai tạo có thể sinh ra hàng nghìn biến thể.

### 2.1 Kho loài (species registry)

Registry gồm **1005 loài**: 5 loài nền viết tay ở trên, cộng 1000 loài sinh tự
động. Loài sinh được sinh từ một seed cố định nên **ổn định vĩnh viễn** — loài
`sp0042` là cùng một cây với mọi người chơi, ở mọi phiên — chứ không phải nhiễu
ngẫu nhiên mỗi lần tải trang.

Mỗi loài có hệ trội + hệ phụ, ngôi chiến, thiên hướng chỉ số/thân/chiêu, tên
riêng và mô tả riêng. Tên và mô tả được khử trùng lặp lúc sinh, nên **không có
hai loài nào trùng tên**, và không tên nào lặp lại một từ ("Lá Lá", "Mầm Thạch
Thạch" đều bị loại).

Phân bố cân bằng có chủ ý: ngôi và hệ trội luân phiên thay vì tung đồng xu, nên
mỗi hệ chiếm ~125 loài thay vì lệch như earth 96 / light 149 trước đây.

**Bậc hiển thị (tier).** Loài chia 5 bậc, mỗi bậc 200 loài. Bậc là cổng tiến trình
mở khoá theo cấp Nhà Lai Tạo (bậc I: cấp 1, II: 8, III: 18, IV: 30, V: 45) —
không có cổng này thì 1000 loài đều mua được ngày đầu và bậc cao chỉ là mắc
tiền. Giá hạt bám theo sức mạnh thật của bộ gene chứ không chỉ theo bậc, để
quầy hàng thể hiện được dải giá trị thay vì 205 loài bậc I cùng giá 100.

Quầy hàng không liệt kê toàn bộ registry. Nó dựng từ ba cách nhìn: **nổi bật
hôm nay** (luân phiên theo người chơi + ngày, luôn có 5 loài nền để save mới có
hàng mua được), **danh mục** (tìm theo tên không phân biệt dấu, lọc theo bậc /
hệ / ngôi, chia trang 24 loài), và **hạt đang có** trong túi.

### 2.2 Mỗi lần lai tạo ra một cây khác

Đây là cam kết ở tầng store, không phải ở tầng sinh cây — vì thứ người chơi
nhận ra không phải "trùng gene" mà là **"cây mới lại trùng tên cây cũ"**. Nên cả
hai đều được kiểm:

1. **Trùng genome.** Chữ ký toàn bộ gene + hình dạng + bộ chiêu được so với mọi
   cây trong vườn và với cả hai cây cha mẹ. Trùng thì tăng `attempt` để sinh lại
   (giới hạn 8 lần). 400 lần lai liên tiếp cho 400 genome khác nhau, nên đây là
   lưới an toàn chứ không phải đường đi thường.
2. **Trùng tên.** Tên là **hàm thuần của genome** (`plantName(dna, traits, salt)`),
   nên store dựng lại tên bất kỳ cho cùng cây đó trong O(1) và tăng `salt` cho
   tới khi gặp tên chưa dùng. Không cần sinh lại cả cây.

Tên được so khớp **không phân biệt dấu và hoa thường** — vì "Lá Gai" và "La Gai"
là cùng một cái tên trong mắt người chơi.

Quy mô thật của kho tên nhỏ hơn vẻ ngoài: tích của các bảng từ là ~5,8 × 10^4,
nhưng ba phần trong sáu phần là tuỳ chọn (chỉ xuất hiện với xác suất), nên không
gian hiệu dụng thực tế chỉ khoảng **4 × 10^3**. Đo thật: 400 lần lai qua bộ sinh
cho **400 genome khác nhau** nhưng **392 tên khác nhau** — tức khoảng **2% cây
trùng tên** nếu không có bước 2. Vì vậy bước đi salt **không phải để trang trí**:
nếu thiếu nó, người chơi vẫn gặp đúng cái lỗi "lại cây cũ" mỗi vài chục lần lai.

## 3. Vòng đời cây

Growth stages:

- `seed`
- `sprout`
- `young`
- `mature`
- `awakened`

Ý nghĩa:

- `seed`: mới gieo, chưa có kỹ năng rõ.
- `sprout`: bắt đầu lộ hình dáng.
- `young`: có thể tăng thuộc tính nhanh.
- `mature`: có thể chiến đấu và lai tạo.
- `awakened`: mở trait/skill đặc biệt sau chăm sóc hoặc chiến đấu.

## 4. Trồng cây

Người chơi có ô đất hoặc chậu gene.

Thao tác:

1. Chọn `Gieo mầm`.
2. Chọn giống nền hoặc hạt lai.
3. Đặt vào ô/chậu.
4. Cây bắt đầu timer phát triển.
5. Trong lúc lớn, người chơi chăm để hướng chỉ số.

Mỗi cây có `growthPotential`:

- HP potential.
- Attack potential.
- Defense potential.
- Speed potential.
- Skill potential.
- Mutation potential.

Chăm cây trong từng stage ảnh hưởng cây trưởng thành.

## 5. Chăm cây

Chăm cây là nguồn tăng chỉ số chính.

| careAction | Tác dụng chính | Tác dụng phụ có thể xảy ra |
|---|---|---|
| water | tăng HP, hồi phục | giảm nhẹ lửa nếu lạm dụng |
| sunlight | tăng attack, growth | tăng nguy cơ stress nếu quá mức |
| fertilizer | tăng stat ngẫu nhiên | có xác suất mutation nhỏ |
| music | tăng spirit, skill trigger | mở trait cảm xúc |
| pruning | tăng speed/accuracy | giảm HP nhỏ |
| moonlight | tăng magic/rare trait | chỉ dùng ban đêm/event |
| gene_serum | tăng mutation chance | có rủi ro trait xấu |

## 6. Cách tăng thuộc tính

Mỗi lần chăm cây, game tính:

1. Cây đang ở stage nào.
2. Gene cây thiên hướng gì.
3. Care action là gì.
4. Cây đã được chăm kiểu này bao nhiêu lần gần đây.
5. Có bonus môi trường không.
6. Random seed cá thể.

Kết quả:

- Tăng 1 thuộc tính chính.
- Có xác suất tăng thêm thuộc tính phụ.
- Có xác suất mở micro-mutation.
- Có xác suất tạo quirk xấu nếu spam một kiểu chăm quá nhiều.

Ví dụ:

- Tưới cây Rễ Gai có thể tăng HP +3, Defense +1.
- Cho Lá Lửa quá nhiều nước có thể giảm Fire Affinity 1%.
- Bón gene serum cho Nấm U Ám có thể mở trait `Toxic Spores`.

## 7. Thuộc tính cây

Combat stats:

- `hp`
- `attack`
- `defense`
- `speed`
- `critChance`
- `critDamage`
- `accuracy`
- `evasion`
- `elementPower`
- `statusPower`
- `resilience`

Growth stats:

- `growthRate`
- `careEfficiency`
- `mutationChance`
- `breedingPower`
- `stability`

Hidden stats:

- `temperament`
- `wildness`
- `genePurity`
- `latentPower`
- `mutationDebt`

Hidden stats không cần hiển thị đầy đủ, nhưng ảnh hưởng kết quả.

## 8. Trait

Trait là đặc điểm đặc biệt.

Trait tốt:

- `Thick Bark`: giảm sát thương vật lý.
- `Quick Sprout`: tăng speed.
- `Venom Veins`: đòn thường có độc.
- `Solar Hunger`: mạnh hơn khi đấu arena nắng.
- `Rooted Will`: miễn stun lần đầu.

Trait xấu hoặc trade-off:

- `Fragile Stem`: HP thấp hơn nhưng speed cao.
- `Overgrown`: attack cao nhưng accuracy thấp.
- `Unstable Gene`: kỹ năng mạnh nhưng cooldown ngẫu nhiên.

Một cây có:

- 1-3 trait thường.
- 0-2 trait hiếm.
- 0-1 unstable trait.

## 9. Tiến hóa/Awaken

Cây có thể awaken khi:

- Đạt level cây nhất định.
- Thắng số trận nhất định.
- Có mutation threshold.
- Được chăm bằng combo hiếm.
- Lai từ cha mẹ có trait đặc biệt.

Awaken có thể:

- Đổi ngoại hình.
- Mở kỹ năng ultimate.
- Tăng giới hạn stat.
- Biến hệ phụ thành hệ chính.

## 10. Bộ sưu tập cây

Người chơi có `Plant Nursery`.

Mỗi cây trong list hiển thị:

- Tên cây.
- Đời/generation.
- Power rating.
- Hệ.
- 3 chỉ số nổi bật.
- Rarity/mutation level.
- Icon kỹ năng chính.

Người chơi có thể:

- Đổi tên cây.
- Khóa cây để không lỡ dùng lai/hủy.
- Đặt cây yêu thích.
- Xem phả hệ.
- Xem lịch sử mutation.

## 11. Không giới hạn biến thể

Game không lưu bảng tất cả cây có thể có. Thay vào đó:

- Gene tạo ngoại hình.
- Gene tạo chỉ số.
- Gene tạo kỹ năng.
- Seed cá thể tạo random ổn định.
- Trait và mutation tạo danh tính.

Vì vậy content mở rộng bằng cách thêm:

- gene mới.
- trait mới.
- skill module mới.
- visual part mới.
- environment mới.
