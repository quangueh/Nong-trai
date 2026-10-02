# UI/UX Mobile Spec

## 1. Mục tiêu UX

Người chơi phải hiểu nhanh:

- Cây này là cá thể riêng.
- Chăm cây sẽ làm cây mạnh và lạ hơn.
- Lai 2 cây sẽ tạo bất ngờ.
- Cây có thể đem đi đại chiến.

## 2. Màn hình vườn

Top bar:

- Avatar.
- Level người chơi.
- Coin.
- Tinh chất gene.
- Nút settings.

Main area:

- Các chậu/ô trồng cây.
- Cây có animation idle.
- Icon trạng thái:
  - cần nước.
  - cần ánh sáng.
  - có thể chăm.
  - trưởng thành.
  - có thể lai.
  - sẵn sàng đấu.

Bottom nav:

- Vườn.
- Bộ sưu tập.
- Lai tạo.
- Đại chiến.
- Shop/lab.

## 3. Chi tiết cây

Mở khi tap cây.

Header:

- Tên cây.
- Generation.
- Rarity.
- Stage.
- Element badges.

Visual:

- Render cây lớn.
- Có thể preview animation.

Stats:

- HP.
- Attack.
- Defense.
- Speed.
- Skill.
- Mutation.

Tabs:

- Tổng quan.
- Chỉ số.
- Kỹ năng.
- Gene.
- Phả hệ.

Actions:

- Chăm.
- Đấu.
- Lai.
- Đổi tên.
- Khóa.

## 4. Chăm cây UI

Bottom sheet `Chăm cây`.

Các nút:

- Tưới nước.
- Ánh sáng.
- Bón phân.
- Cắt tỉa.
- Âm nhạc.
- Tinh chất gene.

Mỗi nút hiển thị:

- Tài nguyên cần.
- Xu hướng tăng stat.
- Rủi ro nếu có.

Sau chăm:

- Stat tăng nổi lên.
- Trait/mutation nếu có hiện popup nhỏ.
- Cây phản ứng bằng animation.

Ví dụ feedback:

```text
+3 HP
+1 Defense
Lá có ánh tím lạ...
```

## 5. Bộ sưu tập cây

List/grid cây.

Filter:

- Hệ.
- Generation.
- Rarity.
- Sẵn sàng đấu.
- Có thể lai.
- Power.

Card cây:

- Icon/render.
- Tên.
- Hệ.
- Power.
- Trait nổi bật.
- Lock icon nếu khóa.

## 6. Phòng lai tạo

Màn hình gồm 2 slot lớn:

- Parent A.
- Parent B.

Giữa:

- Nút `Lai tạo`.
- Dự đoán xác suất:
  - hệ có thể ra.
  - mutation chance.
  - độ ổn định.

Không show kết quả chắc chắn. Chỉ show xu hướng.

Sau lai:

- Animation ống gene/chậu sáng.
- Cây con xuất hiện.
- Mutation report.
- Nút đặt tên.
- Nút đưa vào vườn.

## 7. Màn hình đại chiến

Menu:

- Đấu với AI.
- Tạo phòng.
- Nhập mã.
- Lịch sử trận.

Tạo phòng:

- Chọn cây.
- Chọn mode 1v1.
- Tạo mã.

Nhập mã:

- Input 6 ký tự.
- Auto uppercase.
- Nút vào phòng.

## 8. Lobby đấu

Hiển thị:

- Mã phòng.
- Copy/share.
- Player 1 + cây đã chọn.
- Player 2 + cây đã chọn.
- So sánh hệ.
- Power rating.
- Ready button.

Nếu cây đối thủ có gene bí ẩn, chỉ show:

- Hệ.
- Power.
- 1-2 trait đã public.
- Không show toàn bộ hidden stat.

## 9. Battle screen

Portrait layout:

- Trên: cây đối thủ, HP bar.
- Giữa: arena.
- Dưới: cây mình, HP bar.
- Góc trên: timer.
- Cạnh dưới: nút bản năng/ultimate nếu có.
- Log ngắn bên cạnh hoặc dưới arena.

Battle log không dài:

- `Gai Sét gây 42 sát thương`
- `Đối thủ bị Độc`
- `Vỏ Cứng chặn đòn`

## 10. Result screen

Hiển thị:

- Thắng/Thua/Hòa.
- Cây của bạn vs cây đối thủ.
- Damage dealt.
- Damage taken.
- Trait triggered.
- XP cây.
- Reward người chơi.
- Nút đấu lại.
- Nút về vườn.

## 11. UI cho biến thể vô hạn

Vì cây nhiều biến thể, UI phải dùng template:

- Element badge sinh tự động.
- Skill card sinh tự động.
- Trait description sinh từ data.
- Visual render ghép part.
- Rarity color theo điểm mutation.

Không tạo UI riêng cho từng cây.
