# QA Test Plan

## Gene power balance bắt buộc

Đọc `15_GENE_POWER_BALANCE_DEEP_SPEC.md` và chạy các suite sau:

- Property test sinh ít nhất 100.000 genome; không có NaN, budget âm, stat âm, vòng lặp skill hoặc combo cấm.
- Kiểm tra mọi cây ranked có tối thiểu hai strength tag, hai weakness tag và counter hợp lệ.
- Chạy deterministic replay: cùng seed + balance version phải sinh cùng DNA, Build Value, ECR report và battle result.
- So rarity/generation: trong cùng tier, phân phối ECR không được tăng chỉ vì cây hiếm hoặc đời cao.
- Chạy benchmark matchup; tổng win rate mục tiêu 47-53%, mỗi kèo 35-65%.
- Kiểm tra speed + on-hit, multi-hit + lifesteal, crit + cooldown reset và control chain đều chịu synergy tax.
- Kiểm tra drawback giả hoặc có thể vô hiệu hóa không được hoàn budget đầy đủ.
- Kiểm tra normalization ranked không sửa DNA gốc và Open Power vẫn dùng sức mạnh nguyên bản.
- Kiểm tra balance version cũ có thể replay; patch không làm mất gene/phả hệ của cây.

## Shop, rarity và bán cây

- Kiểm tra tổng xác suất mỗi bảng rarity chính xác bằng 100% theo fixed-point integer, không dùng float gây lệch.
- Chạy tối thiểu 10 triệu rarity roll offline; phân phối thực tế phải nằm trong confidence interval của bảng config.
- Kiểm tra SSS base rate là 0,10% và các modifier không vượt cap.
- Kiểm tra mỗi cultivation level làm tỷ lệ tiến triển đúng theo nội suy, không có level làm tỷ lệ rarity cao giảm ngoài chủ đích.
- Kiểm tra level 100 + level 1 dùng effective parent level 50; không dùng max, min hoặc tổng level.
- Kiểm tra level up không tự đổi rarity hiện tại của cây nếu không có cultivation mutation hợp lệ.
- Kiểm tra XP daily cap, breeding fatigue và server time không thể bị vượt bằng đổi giờ/reconnect.
- Kiểm tra pity tăng/reset đúng, không reset nhầm giữa S, SS và SSS.
- Retry purchase/sell/breeding với cùng idempotency key không được trừ hoặc cộng tiền lần hai.
- Hai request đồng thời bán cùng cây: chính xác một request thành công.
- Disconnect giữa sell confirm và response không làm mất cây lẫn tiền; client lấy lại receipt từ server.
- Cây locked, favorite, đang battle, breeding hoặc transaction không bán được.
- Undo chỉ thành công khi tiền chưa được tiêu và pending-deletion chưa hết hạn.
- Shop không bao giờ bán trực tiếp cây/hạt rarity S, SS hoặc SSS trong catalog cơ bản.
- Giá quote hết hạn không được dùng; breakdown phải tái tạo được từ economy config version.
- Rarity cao không làm ECR Ranked vượt budget.
- Kiểm tra nguồn tiền và sink tiền bằng simulation 30/90 ngày để phát hiện lạm phát.

## 1. Breeding tests

### Same parents, multiple attempts

Steps:

1. Chọn cùng Parent A và Parent B.
2. Lai 10 lần.

Expected:

- Có điểm chung theo cha mẹ.
- Không phải 10 cây y hệt.
- Không cây nào invalid DNA.

### Mutation tier

Steps:

1. Dùng gene serum.
2. Lai nhiều lần.

Expected:

- Mutation chance tăng.
- Có report mutation.
- Không vượt power cap bất thường.

## 2. Care tests

Cases:

- Tưới tăng HP hoặc stat hợp lý.
- Ánh sáng tăng attack/growth.
- Bón phân có thể tăng stat ngẫu nhiên.
- Spam một loại chăm có diminishing return hoặc risk.
- Chăm cây stage khác nhau cho kết quả khác nhau.

## 3. Plant data tests

- Rename cây.
- Lock cây.
- Favorite cây.
- Xem phả hệ.
- Restart game vẫn còn cây.
- Render lại cây từ gene giống trước đó.

## 4. Battle tests

- Cây đánh đến khi có winner.
- Battle cùng seed replay ra cùng kết quả.
- Status poison gây damage đúng.
- Shield hấp thụ đúng.
- Stun làm bỏ action.
- Timeout xét HP%.

## 5. Multiplayer tests

- Tạo phòng.
- Nhập mã.
- Chọn cây.
- Ready.
- Start.
- Battle result giống nhau cho 2 client.
- Reconnect vào lại trận.
- App kill rồi mở lại vào result nếu trận kết thúc.

## 6. Anti-cheat tests

- Client gửi cây không sở hữu.
- Client gửi stat giả.
- Client spam focus skill.
- Client nhận reward lại.
- Client đổi giờ máy.

Expected:

- Server reject.
- Không crash.
- Không grant reward sai.

## 7. Balance tests

Tìm outlier:

- Cây bất tử.
- Skill one-shot quá thường xuyên.
- Poison stack vô hạn.
- Speed quá cao khiến đối thủ không hành động.
- Heal vượt damage mãi không kết thúc.

Mỗi trận phải kết thúc trong max duration.
