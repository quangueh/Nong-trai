# Multiplayer Room Battle

## 1. Mục tiêu

Người chơi tạo phòng, gửi mã cho bạn, hai người chọn cây đột biến của mình và xem/điều khiển nhẹ trận đại chiến cây.

## 2. Luồng chính

1. Người A bấm `Đại chiến`.
2. Chọn `Tạo phòng`.
3. Server tạo mã 6 ký tự.
4. Người A gửi mã.
5. Người B bấm `Nhập mã`.
6. Người B vào lobby.
7. Mỗi người chọn 1 cây trưởng thành.
8. Cả hai bấm `Sẵn sàng`.
9. Chủ phòng bấm `Bắt đầu`.
10. Server snapshot cây, tạo battle seed, bắt đầu trận.
11. Server mô phỏng trận.
12. Client hiển thị animation.
13. Server chốt kết quả và thưởng.

## 3. Room code

- 6 ký tự.
- Chữ in hoa và số dễ đọc.
- Không dùng `0 O 1 I L`.
- Alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.

TTL:

- Lobby hết hạn sau 15 phút nếu chưa bắt đầu.
- Result đọc được 10 phút sau trận.

## 4. Room states

- `waiting`
- `selecting_plants`
- `ready_check`
- `countdown`
- `in_battle`
- `finalizing`
- `completed`
- `cancelled`
- `expired`

## 5. Lobby UI

Hiển thị:

- Mã phòng lớn.
- Nút copy.
- Nút share.
- Danh sách 2 người chơi.
- Slot cây đã chọn.
- Power rating cây.
- Hệ cây.
- 3 trait nổi bật.
- Ready status.
- Nút chọn cây.
- Nút sẵn sàng.
- Nút bắt đầu cho host.

Không cho bắt đầu nếu:

- Chưa đủ 2 người.
- Có người chưa chọn cây.
- Có người chưa ready.
- Cây chưa đủ điều kiện.

## 6. Điều kiện cây được chọn

Cây phải:

- Thuộc owner.
- Stage `mature` hoặc `awakened`.
- Không đang trong hoạt động khác.
- Không bị khóa do đang sync.
- Không vượt rule của phòng nếu có giới hạn power.

MVP có thể không giới hạn power, nhưng UI nên cảnh báo nếu chênh quá lớn.

## 7. Battle snapshot

Khi bắt đầu, server chụp cây thành battle snapshot:

- Stats hiện tại.
- Skills hiện tại.
- Traits hiện tại.
- Element.
- Visual ID/parts.
- Level.
- Power rating.

Sau khi snapshot:

- Thay đổi cây ngoài vườn không ảnh hưởng trận đang chạy.

## 8. Server authority

Server quyết định:

- Battle start time.
- Battle seed.
- Damage.
- Skill trigger.
- Status.
- Winner.
- Reward.

Client chỉ gửi:

- Ready/unready.
- Select plant.
- Optional focus skill input nếu có.

## 9. Optional player input

MVP có thể auto battle hoàn toàn.

Nếu thêm input nhẹ:

- Mỗi người có 1 nút `Kích hoạt bản năng`.
- Dùng tối đa 1 lần/trận.
- Tác dụng phụ thuộc cây:
  - tăng crit.
  - dùng ultimate sớm.
  - tạo shield.
  - hồi HP.

Server validate input:

- Chỉ dùng trong battle.
- Chỉ dùng một lần.
- Không dùng khi cây đã chết.

## 10. Reconnect

Nếu mất mạng:

- Trận vẫn chạy trên server.
- Client reconnect nhận snapshot hoặc event log.
- Nếu trận xong, vào result.

UI:

- Banner `Đang kết nối lại...`
- Không hiện popup che trận.

## 11. Result

Màn hình kết quả:

- Thắng/Thua/Hòa.
- Tên hai cây.
- HP còn lại.
- Damage gây ra.
- Skill gây nhiều damage nhất.
- Trait kích hoạt quan trọng.
- Reward.
- Nút đấu lại.
- Nút về vườn.

## 12. Anti-cheat

Server kiểm tra:

- Player có sở hữu cây không.
- Cây có hợp lệ không.
- Plant snapshot không do client gửi tự do.
- Input không spam.
- Reward không grant hai lần.

Không bao giờ tin:

- Client power.
- Client damage.
- Client winner.
- Client skill list nếu không lấy từ DB/server.
