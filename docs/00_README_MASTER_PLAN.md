# Đại Chiến Cây Đột Biến - Master Plan

Đây là bộ spec để nhiều AI/dev cùng tạo game mobile về **trồng, chăm, lai tạo cây đột biến và đem cây đi đại chiến qua mã phòng**.

Game có kinh tế trồng và bán cây, nhưng không chỉ là nông trại bán hàng truyền thống. Cốt lõi là:

- Mỗi cây là một cá thể sống có gene, chỉ số, ngoại hình, tính cách chiến đấu và bộ chiêu riêng.
- Người chơi trồng cây, chăm cây, huấn luyện cây để tăng thuộc tính bất kỳ.
- Cửa hàng bán hạt/cây giống cơ bản; người chơi tạo giá trị bằng chăm sóc và lai gene rồi bán cây trưởng thành theo độ hiếm, chất lượng và nhu cầu.
- Người chơi kết hợp 2 cây để sinh ra cây con đột biến bất ngờ.
- Kết quả lai tạo phải rất khó trùng nhau giữa các người chơi.
- Cây được đem vào phòng đấu online. Chủ phòng tạo mã, người khác nhập mã để 2 cây đánh nhau.
- Game phải có cảm giác biến thể liên tục, không có giới hạn cứng về “bộ cây cố định”.

## Tên tạm

`Đại Chiến Cây Đột Biến`

Tên khác:

- `Vườn Gene Đại Chiến`
- `Mầm Quái Chiến`
- `Mutant Sprout Arena`

## Fantasy chính

Người chơi là nhà lai tạo cây chiến binh. Mỗi mầm cây có tiềm năng kỳ lạ. Qua chăm sóc, môi trường, phân bón, ánh sáng, nước, âm nhạc, thuốc đột biến và lai ghép gene, cây tiến hóa thành chiến binh độc nhất: có cây phun gai độc, có cây tạo khiên lá, có cây hút máu bằng rễ, có cây bắn hạt lửa, có cây hát ru làm đối thủ ngủ, có cây tự hồi sinh một lần.

Không có “con mạnh nhất tuyệt đối”. Mỗi cây có điểm mạnh, điểm yếu, hệ, kỹ năng, tốc độ phát triển và độ hiếm đột biến khác nhau.

## Danh sách file

1. `01_CORE_GAME_DESIGN.md`  
   Vòng lặp chính, trồng cây, chăm cây, tăng thuộc tính, tiến hóa, bộ sưu tập.

2. `02_GENETICS_MUTATION_SYSTEM.md`  
   Gene, DNA, lai tạo 2 cây, đột biến, random có kiểm soát, độ hiếm, chống trùng lặp.

3. `03_PLANT_BATTLE_SYSTEM.md`  
   Đại chiến cây, chỉ số, hệ, kỹ năng, AI chiến đấu, arena, thắng thua.

4. `04_MULTIPLAYER_ROOM_BATTLE.md`  
   Tạo phòng bằng mã, vào phòng, chọn cây, ready, đồng bộ, server authority, reconnect.

5. `05_UI_UX_MOBILE_SPEC.md`  
   Giao diện mobile: vườn, chi tiết cây, phòng lai, phòng đấu, trận chiến.

6. `06_TECH_ARCHITECTURE_AND_DATA.md`  
   Kiến trúc kỹ thuật, data model, backend, deterministic random, lưu cây độc nhất.

7. `07_ART_AUDIO_ANIMATION.md`  
   Art direction cho cây đột biến, hệ thống ghép bộ phận, animation chiêu.

8. `08_IMPLEMENTATION_TASKS_BY_ROLE.md`  
   Chia việc theo AI/dev: gameplay, genetics, battle, backend, UI, art, QA.

9. `09_QA_TEST_PLAN.md`  
   Test lai tạo, đột biến, battle, mã phòng, desync, edge cases.

10. `10_AI_PROMPTS.md`  
    Prompt mẫu để giao từng phần cho AI khác.

11. `11_DEPLOYMENT_GITHUB_CLOUDFLARE_VERCEL.md`  
    Kiến trúc repo GitHub, triển khai Cloudflare Workers/Pages hoặc Vercel, môi trường, CI/CD, realtime backend.

12. `12_GROWTH_POWER_DEEP_SPEC.md`  
    Cơ chế cây tăng sức mạnh khi trồng/chăm, công thức stat gain, care memory, stress, tiềm năng gene, offline progress.

13. `13_BATTLE_CONTROL_DEEP_SPEC.md`  
    Cơ chế battle: người chơi điều khiển chiêu hay máy tự đánh, mode auto/hybrid/manual, tick server, latency, UI điều khiển.

14. `14_SKILL_LEVELING_DEEP_SPEC.md`  
    Cơ chế tăng cấp chiêu thức, skill XP, tiến hóa chiêu, kế thừa chiêu qua lai tạo, cân bằng power budget.

15. `15_GENE_POWER_BALANCE_DEEP_SPEC.md`  
    Cơ chế gene để mỗi cây mạnh theo một kiểu nhưng vẫn cân bằng: archetype vector, ngân sách sức mạnh, trade-off, synergy tax, counter graph, ECR và mô phỏng kiểm định tự động.

16. `16_SHOP_RARITY_SELLING_ECONOMY.md`  
    Cửa hàng hạt cơ bản, trồng và bán cây, cấp cây 1-100 tăng dần tỷ lệ nhân giống, bảng C-B-A-S-SS-SSS, pity, công thức giá, giao dịch và chống lạm phát.

## MVP cần làm

### Solo

- Vườn trồng cây.
- 5 giống nền ban đầu.
- Mỗi cây có gene và chỉ số riêng.
- Chăm cây làm tăng ngẫu nhiên hoặc bán ngẫu nhiên thuộc tính.
- Cây trưởng thành có thể chiến đấu.
- Lai 2 cây sinh ra cây con mới.
- Cây con có ngoại hình và kỹ năng biến thể theo gene cha mẹ + mutation.
- Có bộ sưu tập cây của người chơi.

### Battle

- Chọn 1 cây của mình.
- Đánh với AI hoặc người chơi khác.
- Trận 1v1 tự động có can thiệp nhẹ bằng 1-2 nút kỹ năng nếu cần.
- Kỹ năng của cây sinh ra từ gene, không chỉ chọn từ danh sách cố định.

### Online room

- Người chơi tạo phòng.
- Sinh mã phòng 6 ký tự.
- Người khác nhập mã vào.
- Hai người chọn cây.
- Cả hai ready.
- Server bắt đầu trận.
- Hai cây đánh nhau.
- Server chốt kết quả.

## Nguyên tắc cực quan trọng

- Không tạo danh sách cây cố định kiểu “cây A, cây B, cây C” rồi hết.
- Cây phải được tạo từ gene và seed để có biến thể gần vô hạn.
- Random phải có kiểm soát để không phá balance.
- Gene mạnh phải đổi cách phân bổ sức mạnh, không được tạo sức mạnh miễn phí; mọi ưu điểm lớn phải có điều kiện, điểm yếu hoặc chi phí tương ứng.
- Độ hiếm và đời cây mở cơ chế lạ hơn nhưng không tự động tăng ngân sách sức mạnh trong PvP xếp hạng.
- Hai cây cùng cha mẹ vẫn có thể ra con khác nhau.
- Mỗi người chơi chăm cây khác nhau thì cây phát triển khác nhau.
- Battle không được chỉ so chỉ số thô; kỹ năng, hệ, tốc độ, khắc chế và đột biến phải tạo bất ngờ.
- Server là nguồn sự thật trong đấu online.
- Game phải deploy được từ GitHub lên Cloudflare hoặc Vercel.
- Realtime battle room phải có một nguồn state authoritative duy nhất.
- Frontend mobile web/PWA là MVP triển khai nhanh nhất; native app có thể làm sau bằng wrapper hoặc build riêng.

## Định nghĩa cây

Một cây là entity riêng:

- `plantId`
- `ownerId`
- `speciesBase`
- `generation`
- `dna`
- `visualGenes`
- `combatStats`
- `skills`
- `traits`
- `mutationHistory`
- `growthStage`
- `careHistory`
- `battleRecord`

## Core loop mới

1. Trồng mầm cây.
2. Chăm cây bằng nước, ánh sáng, phân, nhạc, thuốc gene, môi trường.
3. Cây tăng thuộc tính hoặc mở trait.
4. Cây trưởng thành.
5. Chọn bán lấy tiền, dùng để chiến đấu hoặc giữ lại lai tạo.
6. Lai 2 cây sinh ra cây con đột biến.
7. Cây con có ngoại hình, chỉ số, kỹ năng bất ngờ.
8. Người chơi nuôi tiếp, chọn cây mạnh/độc/lạ.
9. Tạo phòng đấu bằng mã và đem cây đi đại chiến.
10. Nhận thưởng để tiếp tục chăm và lai tạo.
11. Bán cây dư/hiếm để mua hạt, vật tư, ô đất và tiếp tục mở rộng vòng lai.

## Definition of Done

- Người chơi tạo được ít nhất 20 cây khác biệt rõ bằng lai tạo.
- Hai lần lai cùng cặp cha mẹ vẫn có khả năng ra cây con khác.
- Cây có kỹ năng khác nhau dựa trên gene.
- Chăm cây làm thay đổi chỉ số thật, không chỉ là animation.
- Tạo phòng và nhập mã hoạt động trên 2 client.
- Trận đấu server chốt kết quả giống nhau cho cả hai người.
- UI cho người chơi hiểu cây của mình mạnh ở đâu, lạ ở đâu, đột biến gì.
