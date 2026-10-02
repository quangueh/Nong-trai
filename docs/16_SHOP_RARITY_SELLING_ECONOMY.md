# Shop, Rarity, Selling And Economy Deep Spec

## 1. Mục tiêu hệ thống

Vòng lặp kinh tế chính:

```text
Mua hạt giống cơ bản
-> gieo và chăm cây
-> cây trưởng thành
-> giữ để chiến đấu / giữ làm giống / lai tạo
-> đánh giá độ hiếm và chất lượng
-> bán cây không cần dùng
-> nhận tiền
-> mua thêm hạt, ô đất, vật tư và nâng cấp
-> tạo thế hệ cây mới hiếm và thú vị hơn
```

Người chơi luôn phải có lựa chọn:

- bán ngay để lấy vốn;
- chăm thêm để tăng chất lượng và giá;
- giữ cây mạnh để chiến đấu;
- giữ cây có gene tốt để lai;
- dùng cây hiếm làm cha/mẹ với hy vọng tạo biến thể mới;
- khóa cây quý để không bán nhầm.

## 2. Ba khái niệm không được trộn lẫn

### 2.1 Độ hiếm `rarity`

Phản ánh độ khó xuất hiện của tổ hợp gene, mutation, ngoại hình và module kỹ năng.

### 2.2 Sức mạnh `combatPower/ECR`

Phản ánh hiệu quả chiến đấu. Trong Ranked, cây cùng tier vẫn được cân bằng theo `15_GENE_POWER_BALANCE_DEEP_SPEC.md`.

### 2.3 Giá trị kinh tế `marketValue`

Phản ánh số tiền NPC trả khi mua cây. Giá chịu ảnh hưởng bởi rarity, chất lượng chăm, tuổi trưởng thành, gene mới, nhu cầu thị trường và phả hệ.

Cây SSS có thể cực hiếm và bán rất đắt nhưng không được mặc định thắng cây A trong Ranked.

## 3. Tiền tệ

### 3.1 `LeafCoin`

Tiền mềm chính, kiếm bằng:

- bán cây;
- nhiệm vụ;
- battle reward;
- đơn hàng NPC;
- thành tựu bộ sưu tập.

Dùng để:

- mua hạt cơ bản;
- mua nước, phân, chậu;
- trả phí lai;
- mở ô đất;
- nâng nhà kính;
- trả phí thẩm định nâng cao.

### 3.2 `GeneCrystal`

Tài nguyên hiếm, không dùng làm tiền bán cây chính.

Kiếm giới hạn từ:

- sự kiện;
- thành tựu;
- battle season;
- phân giải mutation item hiếm.

Dùng cho:

- gene serum;
- bảo tồn một allele khi lai;
- reroll một lựa chọn mutation có giới hạn;
- cosmetic hoặc tiện ích.

Không cho mua thẳng cây SSS bằng tiền thật. Nếu có monetization, không được làm pay-to-win.

## 4. Cửa hàng hạt giống cơ bản

Cửa hàng chỉ bán `baseSeed`, không bán cây lai hoàn chỉnh và không bán trực tiếp rarity cao.

MVP có 5 hạt:

| Hạt | Giá gốc | Thời gian trưởng thành | Gene nền | Vai trò |
|---|---:|---:|---|---|
| Rễ Gai | 100 | 20 phút | Mộc/Đất | thủ, phản đòn |
| Lá Lửa | 120 | 18 phút | Mộc/Lửa | burst |
| Búp Sương | 110 | 22 phút | Mộc/Nước | heal, slow |
| Dây Sét | 140 | 16 phút | Mộc/Sét | speed, crit |
| Nấm U Ám | 130 | 24 phút | Mộc/Độc | DoT, debuff |

Giá trên là giá prototype và nằm trong config.

Mỗi hạt shop luôn có:

- rarity ban đầu `C`;
- lineage thuần;
- 1 gene role chính;
- 1-2 allele ẩn ngẫu nhiên mức thấp;
- seed riêng để cây cùng loại vẫn có sai khác nhỏ;
- không có S/SS/SSS trực tiếp.

## 5. Chu kỳ và số lượng cửa hàng

Shop cơ bản không nên khóa người chơi bằng năng lượng hoặc thiếu hạt.

- 5 loại hạt cơ bản luôn có sẵn.
- Giá cơ bản ổn định trong ngày.
- Có gói 5/10 hạt giảm tối đa 5%, không lớn hơn để tránh phá kinh tế.
- Mỗi ngày có 1-2 `environmental seed` chỉ thay đổi latent gene nhỏ, vẫn rarity C.
- Không dùng loot box trả tiền để bán rarity.
- Shop refresh theo server time.

Có thể thêm giới hạn mềm theo kho, nhưng hạt thiết yếu không được hết hoàn toàn.

## 6. Khi nào cây được bán

Cây được bán khi đạt `mature`.

Không bán được nếu:

- đang khóa;
- đang trong battle room;
- đang làm cha/mẹ trong breeding job;
- đang nằm trong market/order transaction;
- chưa đồng bộ server;
- là cây cuối cùng có thể dùng của người chơi trong tutorial bảo vệ.

Cây `seed`, `sprout`, `young` có thể hủy nhưng chỉ hoàn rất ít nguyên liệu, không tính là bán cây.

## 7. Các bậc độ hiếm

| Rarity | Ý nghĩa | Màu UI gợi ý | Đặc điểm |
|---|---|---|---|
| C | Phổ thông | xám/xanh lá | gene cơ bản, ít mutation |
| B | Không thường | xanh dương | một tổ hợp gene tốt hoặc mutation nhỏ |
| A | Hiếm | tím | phối hợp gene rõ, ngoại hình khác biệt |
| S | Cực hiếm | vàng | module hiếm hoặc mutation lớn |
| SS | Huyền dị | đỏ/hồng | tổ hợp rất khó, cơ chế đặc biệt |
| SSS | Độc bản | trắng ánh sắc | signature mutation cực hiếm, visual/skill identity đặc biệt |

Rarity không chỉ dựa vào một lần random. Nó được tính từ `rarityScore` của kết quả gene.

## 8. Tỷ lệ rarity cơ bản khi lai

Bảng mặc định cho người chơi cấp Nhà Lai Tạo 1, cha mẹ phổ thông, không vật phẩm:

| Rarity | Tỷ lệ |
|---|---:|
| C | 55.00% |
| B | 27.00% |
| A | 12.00% |
| S | 4.50% |
| SS | 1.40% |
| SSS | 0.10% |
| Tổng | 100.00% |

Nghĩa là xác suất SSS trung bình khoảng 1 trên 1.000 lần lai ở điều kiện cơ bản.

Đây là `rarityBandRoll`; sau đó nội dung gene trong band vẫn được sinh và validator kiểm tra.

## 9. Cấp cây tăng dần tỷ lệ rarity

Mỗi cây có `cultivationLevel` riêng từ 1 đến 100. Trồng, chăm và sử dụng cây làm cây tăng cấp dần. Khi hai cây nhân giống, cấp của chính hai cây này làm tăng tỷ lệ sinh con hiếm.

```text
effectiveParentLevel = floor((levelA + levelB) / 2)
```

Không dùng level cao nhất. Nếu ghép cây level 100 với cây level 1 thì effective level chỉ là 50. Điều này buộc người chơi chăm cả hai dòng giống.

Bảng tỷ lệ prototype, trước rarity cha mẹ/catalyst/pity:

| Cấp trung bình cha mẹ | C | B | A | S | SS | SSS |
|---:|---:|---:|---:|---:|---:|---:|
| 1-9 | 55.00% | 27.00% | 12.00% | 4.50% | 1.40% | 0.10% |
| 10-19 | 52.00% | 28.00% | 13.00% | 5.10% | 1.77% | 0.13% |
| 20-29 | 49.00% | 28.50% | 14.20% | 5.80% | 2.34% | 0.16% |
| 30-39 | 46.00% | 29.00% | 15.50% | 6.60% | 2.70% | 0.20% |
| 40-49 | 43.00% | 29.00% | 17.00% | 7.40% | 3.35% | 0.25% |
| 50-59 | 40.00% | 29.00% | 18.50% | 8.50% | 3.65% | 0.35% |
| 60-69 | 37.00% | 28.50% | 20.00% | 9.50% | 4.55% | 0.45% |
| 70-79 | 34.00% | 28.00% | 21.50% | 10.50% | 5.40% | 0.60% |
| 80-89 | 31.00% | 27.00% | 23.00% | 12.00% | 6.20% | 0.80% |
| 90-99 | 28.00% | 26.00% | 24.00% | 14.00% | 6.90% | 1.10% |
| 100 | 25.00% | 25.00% | 25.00% | 15.00% | 8.50% | 1.50% |

Mỗi hàng phải được lưu bằng integer basis points và có tổng chính xác 10.000. Ví dụ `0,10% = 10 basis points`.

### 9.1 XP và đường cong cấp cây

```text
xpRequired(level) = round(40 * level^1.45 + 60)
```

Nguồn XP cây:

| Hành động | XP prototype | Giới hạn |
|---|---:|---|
| Chăm hợp lý | 8-15 | từng care cooldown |
| Hoàn thành stage | 30-120 | một lần/stage |
| Battle hợp lệ | 15 thắng, 10 thua | tối đa 10 trận có XP/ngày |
| Làm cha/mẹ tạo cây con | 25 | tối đa 5 lần có XP/ngày |
| Training | 5-20 | tốn tài nguyên, có daily cap |
| Khám phá trait mới | 40 | một lần/trait/cây |

Không cho XP khi spam vào phòng riêng, hủy trận hoặc chăm sai cooldown.

### 9.2 Tăng tỷ lệ từng cấp, không nhảy đột ngột

Bảng trên là mốc công khai cho UI. Server có thể nội suy tuyến tính bằng basis points giữa đầu và cuối mỗi band để mỗi level đều có tiến bộ nhỏ.

```text
t = (effectiveParentLevel - bandMinLevel) / (bandMaxLevel - bandMinLevel + 1)
weight[r] = round(lerp(startWeight[r], nextBandWeight[r], t))
```

Sau nội suy, phần sai số làm tròn được cộng/trừ ở rarity C để tổng luôn là 10.000 basis points.

### 9.3 Mốc cấp cây

| Cấp | Mở khóa |
|---:|---|
| 1 | trồng và chăm |
| 5 | xem thiên hướng gene |
| 10 | được làm cha/mẹ |
| 20 | slot care memory thứ hai |
| 30 | xem preview tỷ lệ chi tiết |
| 40 | có thể truyền latent allele |
| 50 | evolution node thứ hai |
| 60 | mở major mutation training |
| 70 | tăng giới hạn ổn định skill |
| 80 | có thể biểu hiện signature visual |
| 90 | mở ancestral echo |
| 100 | danh hiệu Perfect Cultivation và bảng tỷ lệ cao nhất |

### 9.4 Cấp Nhà Lai Tạo

`BreederLevel` là cấp tài khoản, tăng từ trồng, lai, khám phá gene và bộ sưu tập. Nó mở shop, số ô đất, công cụ xem gene và catalyst; không dùng một bảng tỷ lệ lớn riêng nữa.

Bonus trực tiếp tối đa từ BreederLevel:

- +0% ở cấp 1;
- tăng đều đến tối đa +5% trọng số A-S-SS ở cấp 50;
- SSS chỉ được tối đa +0,05 điểm phần trăm;
- bonus lấy trọng số từ C rồi normalize;
- không cộng damage và không thay thế việc nuôi cây cha mẹ.

### 9.5 Rarity hiện tại của cây có tự tăng không?

Level up không tự đổi nhãn một cây C thành SSS. Level làm ba việc:

- tăng tiềm năng stat/skill theo growth spec;
- tăng giá bán nhờ chất lượng nuôi;
- tăng xác suất rarity của cây con khi cây này được đem nhân giống.

Ở mốc 20/40/60/80/100 có thể roll `cultivationMutation`, nhưng nếu mutation làm rarity score vượt band thì đó là tiến hóa thực sự có animation, log và validator; không phải tự đổi nhãn âm thầm.

### 9.6 Giảm lợi ích khi dùng một cây quá nhiều

Để một cây level 100 không trở thành máy in cây hiếm:

- mỗi cây có 3 lần breeding hiệu quả cao mỗi ngày;
- lần 4-5: XP và care quality bonus giảm 25%;
- từ lần 6: rarity bonus từ level giảm 50% cho đến reset ngày;
- breeding fatigue không giảm base odds dưới bảng level 1;
- nghỉ theo server time, không theo giờ thiết bị;
- phí lai tăng nhẹ theo số lần dùng cùng cây trong ngày.

SSS vẫn hiếm ở cấp tối đa. Tỷ lệ production phải được hiệu chỉnh bằng telemetry kinh tế.

## 10. Ảnh hưởng của rarity cha mẹ

Rarity cha mẹ không truyền thẳng cho con. Nó tạo `parentRarityInfluence` nhỏ.

Quy đổi điểm:

| Rarity cha/mẹ | Điểm |
|---|---:|
| C | 0 |
| B | 1 |
| A | 2 |
| S | 3 |
| SS | 4 |
| SSS | 5 |

```text
parentInfluence = floor((rarityPointA + rarityPointB) / 2)
```

Mỗi điểm influence:

- lấy 1,5% xác suất từ C;
- chuyển 0,7% sang B;
- chuyển 0,45% sang A;
- chuyển 0,25% sang S;
- chuyển 0,09% sang SS;
- chuyển 0,01% sang SSS.

Giới hạn bonus SSS từ cha mẹ: tối đa +0,05 điểm phần trăm. Hai cây SSS không được đảm bảo con SSS.

Lý do: nếu rarity di truyền quá mạnh, nền kinh tế sẽ lạm phát theo cấp số nhân.

## 11. Các modifier rarity khác

Xác suất cuối được tạo bằng trọng số, sau đó normalize về 100%.

```text
finalWeight[r] = baseWeightByParentCultivationLevel[r]
  * breederSkillModifier[r]
  * parentModifier[r]
  * geneDiversityModifier[r]
  * careQualityModifier[r]
  * catalystModifier[r]
  * pityModifier[r]
  * eventModifier[r]
```

### Gene diversity

- Cha mẹ khác lineage/hệ: tăng khả năng A-S, nhưng tăng instability.
- Cha mẹ quá giống/họ hàng gần: giảm rare band và tăng gene defect.
- Gene mới chưa từng có trong phả hệ: cộng nhỏ cho `rarityScore`, không cộng chắc chắn cho roll.

### Care quality

- Chăm cân bằng, stress thấp: tăng ổn định và cơ hội biểu hiện gene đẹp.
- Gene serum: tăng S/SS/SSS nhưng tăng mutation debt và trait xấu.
- Care quality chỉ dịch chuyển tối đa 10% tổng trọng số, không biến hành động chăm thành công thức chắc chắn.

### Catalyst

Catalyst phải công khai chính xác tác động. Ví dụ:

```text
Moon Catalyst:
- S weight x1.10
- SS weight x1.08
- SSS weight x1.03
- tăng 5% mutationDebt
```

Không hiển thị “tăng mạnh” mơ hồ.

## 12. Cơ chế pity chống chuỗi quá đen

Pity áp dụng theo tài khoản và loại breeding banner/config, lưu server-side.

- Sau 20 lần không ra A trở lên: tăng nhẹ A.
- Sau 60 lần không ra S trở lên: tăng S weight mỗi lần.
- Sau 250 lần không ra SS: tăng SS weight dần.
- SSS không hard pity quá thấp; đề xuất soft pity từ lần 500 và hard pity ở lần 1.000 cho hệ thân thiện người chơi.

Hard pity SSS cần quyết định sản phẩm. Nếu bật:

- lần 1.000 chắc chắn tối thiểu SSS;
- nhận SSS reset bộ đếm SSS;
- S/SS có bộ đếm riêng;
- pity không chuyển thành tiền thật hoặc trade để chống farm bot.

Pity tăng rarity band, không đảm bảo build mạnh hay skill mong muốn.

## 13. Thuật toán xác định rarity thực tế

Rarity được tạo theo hai pha để tránh cây mang nhãn SSS nhưng không có gì đặc biệt.

### Pha A: roll band mục tiêu

Server roll `targetRarityBand` từ bảng xác suất đã normalize.

### Pha B: sinh và xác minh nội dung

Mỗi band có yêu cầu:

| Band | Yêu cầu tối thiểu |
|---|---|
| C | gene hợp lệ |
| B | 1 mutation nhỏ hoặc tổ hợp allele không phổ biến |
| A | 1 rare module hoặc 2 gene synergy hợp lệ |
| S | major mutation + visual signature hoặc rare skill module |
| SS | 2 rare modules tương thích + identity rõ + drawback hợp lệ |
| SSS | signature mutation độc đáo + visual signature + mechanic hiếm + validator đạt chuẩn |

Nếu generator không tạo được nội dung đúng band sau N lần:

- không âm thầm hạ rarity;
- dùng module bảo chứng của band;
- vẫn áp dụng power budget và drawback;
- ghi `generationFallbackUsed` để QA theo dõi.

## 14. Rarity score

`rarityScore` dùng cho bộ sưu tập và định giá, không dùng trực tiếp làm damage.

```text
rarityScore =
  geneNovelty * 0.25
  + mutationTierScore * 0.25
  + moduleScarcity * 0.20
  + visualUniqueness * 0.10
  + ancestryDepth * 0.05
  + skillComplexity * 0.10
  + stableExpression * 0.05
```

Ngưỡng prototype:

| Rarity | Score |
|---|---:|
| C | 0-19.99 |
| B | 20-39.99 |
| A | 40-59.99 |
| S | 60-74.99 |
| SS | 75-89.99 |
| SSS | 90-100 |

Khi band roll và score lệch nhau, generator phải sửa nội dung để đạt score band; không đổi kết quả random sau khi người chơi đã thấy animation.

## 15. Giá bán cơ sở theo rarity

Giá bán NPC dùng multiplier:

| Rarity | Multiplier | Ví dụ với baseValue 100 |
|---|---:|---:|
| C | x1.0 | 100 |
| B | x1.8 | 180 |
| A | x3.5 | 350 |
| S | x8.0 | 800 |
| SS | x20.0 | 2.000 |
| SSS | x60.0 | 6.000 |

Không đặt multiplier SSS quá cao ở bản đầu vì pity/farm nhiều tài khoản có thể gây lạm phát.

## 16. Công thức định giá cây

```text
sellPriceRaw = speciesBaseValue
  * rarityMultiplier
  * maturityMultiplier
  * careQualityMultiplier
  * noveltyMultiplier
  * ancestryMultiplier
  * demandMultiplier
  * stabilityMultiplier
  + investedMaterialRefund
```

Sau đó:

```text
sellPrice = floor(clamp(sellPriceRaw, minimumSellPrice, priceCapByRarity))
```

### Maturity multiplier

| Trạng thái | Multiplier |
|---|---:|
| Mature vừa đạt | 1.00 |
| Được chăm đủ chu kỳ | 1.05-1.20 |
| Awakened | 1.15-1.35 |
| Stress cao | 0.80-0.95 |

### Care quality multiplier

```text
careQuality = 0.45 * consistency
  + 0.25 * diversity
  + 0.20 * stressControl
  + 0.10 * stageTiming
```

Quy đổi multiplier từ 0,85 đến 1,25.

### Novelty multiplier

- Gene đã sở hữu nhiều lần: x1.00.
- Gene mới với người chơi: tối đa x1.10.
- Gene mới toàn server không cộng trực tiếp quá lớn; tối đa x1.20 và chỉ một lần/ngày để chống jackpot kinh tế.

### Stability multiplier

- Stable: x1.05.
- Normal: x1.00.
- Unstable: x0.90 nhưng có thể được NPC chuyên mutation trả thêm qua đơn hàng riêng.

## 17. Hoàn chi phí vật tư

Không hoàn 100% vật tư đã chăm, nếu không người chơi có thể mua vật tư rồi biến thành tiền không rủi ro.

```text
investedMaterialRefund = eligibleMaterialCost * refundRate
```

- refundRate mặc định 10-25%;
- vật phẩm premium/catalyst không hoàn bằng LeafCoin đầy đủ;
- phần giá chính phải đến từ cây trưởng thành và rarity;
- chi phí cơ hội thời gian/ô đất tạo sink tự nhiên.

## 18. Đảm bảo vòng lặp có lời nhưng không in tiền vô hạn

Một cây C được chăm bình thường phải bán cao hơn giá hạt, nhưng lợi nhuận nhỏ.

Ví dụ Rễ Gai:

```text
Hạt: 100
Vật tư trung bình: 25
Tổng chi: 125
Giá bán C chăm đủ: 145-165
Lãi: 20-40
```

Lai giống cần hai cây cha mẹ nhưng không tiêu hủy cha mẹ trong MVP; phí lai và cooldown là cost:

```text
breedingFee = 0.20 * (estimatedValueParentA + estimatedValueParentB)
```

Có min/max theo tier để tránh phí bằng 0 hoặc quá cao.

Mục tiêu kinh tế:

- cây C tạo dòng tiền ổn định;
- B/A tạo khoảnh khắc lời tốt;
- S/SS/SSS là jackpot hiếm nhưng không làm người chơi hết nhu cầu chơi;
- nâng cấp, breeding fee và vật tư hút tiền khỏi hệ thống.

## 19. Giá bán tức thời và đơn hàng NPC

### Bán tức thời

- luôn có;
- giá ổn định;
- server tính;
- không cần chờ người mua;
- là nền kinh tế MVP.

### Đơn hàng NPC

NPC yêu cầu tag cụ thể:

```text
Cần cây Water + Heal, rarity tối thiểu A
Thưởng: giá NPC cơ bản x1.35
```

Quy tắc:

- 3-5 đơn/ngày;
- bonus tối đa x1.5;
- không yêu cầu SSS trong nhiệm vụ thường;
- đơn hàng dựa trên tag, không đòi đúng seed/gene bất khả thi;
- người chơi thấy thời gian hết hạn.

### Chợ người chơi

Không làm trong MVP. Nếu thêm sau:

- cần escrow server-side;
- phí niêm yết và thuế giao dịch;
- giới hạn giá;
- chống chuyển tiền giữa tài khoản;
- khóa giao dịch cây mới tạo;
- audit log và chống bot/RMT.

## 20. Nút bán và quy trình xác nhận

Từ màn hình cây:

1. Người chơi bấm biểu tượng bán.
2. Server trả `sellQuote` có hạn 30-60 giây.
3. UI hiển thị giá, rarity, gene hiếm sẽ mất và lý do định giá.
4. Với A trở lên, yêu cầu giữ nút xác nhận 1 giây.
5. Với S trở lên, yêu cầu xác nhận lần hai.
6. Cây đang favorite/locked không hiện nút bán hoạt động.
7. Server kiểm tra quote, ownership và lock lần cuối.
8. Transaction xóa cây khỏi nursery và cộng tiền trong cùng một giao dịch.
9. Trả receipt có transaction ID.
10. Undo 10 giây chỉ được làm nếu cây được giữ ở trạng thái `pendingDeletion`; tiền chưa được tiêu.

Khuyến nghị an toàn: cây A trở lên tự động khóa khi mới sinh; người chơi phải chủ động mở khóa.

## 21. UI cửa hàng

Màn hình Shop mobile portrait:

- Header: LeafCoin, GeneCrystal, nút đóng.
- Tab `Hạt cơ bản`.
- Tab `Vật tư`.
- Tab `Chậu & ô đất`.
- Tab `Đơn hàng`.

Mỗi dòng hạt hiển thị:

- ảnh hạt;
- tên;
- hệ;
- thiên hướng;
- thời gian lớn;
- giá;
- số đang có;
- nút mua.

Không hiện SSS trên card hạt shop vì shop không bán rarity cao.

## 22. UI kết quả lai

Trình tự reveal:

1. Hai cây cha mẹ và các gene nổi bật.
2. Animation ghép gene.
3. Ánh sáng theo rarity band.
4. Reveal silhouette.
5. Hiện rarity.
6. Hiện mutation, skill, strength/weakness.
7. Hiện giá bán ước tính nhưng không đặt nút bán quá gần nút tiếp tục.
8. Tự khóa nếu rarity A trở lên.

UI luôn hiển thị tỷ lệ trước khi người chơi xác nhận lai:

```text
C 48% | B 29% | A 15% | S 6% | SS 1,85% | SSS 0,15%
```

Tỷ lệ phải là tỷ lệ cuối sau mọi modifier, không chỉ base rate.

## 23. Data model

```json
{
  "economy": {
    "purchaseCost": 100,
    "investedMaterialValue": 25,
    "estimatedSellPrice": 158,
    "lastSellQuoteId": null
  },
  "rarity": {
    "band": "A",
    "score": 54.7,
    "rollTableVersion": "rarity-v1.0.0",
    "rollContextHash": "...",
    "generationFallbackUsed": false
  },
  "locks": {
    "favorite": false,
    "manual": true,
    "battle": false,
    "breeding": false,
    "transaction": false
  }
}
```

`sellQuote`:

```json
{
  "quoteId": "quote_001",
  "plantId": "plant_001",
  "price": 425,
  "currency": "LeafCoin",
  "breakdown": {
    "base": 100,
    "rarityMultiplier": 3.5,
    "careMultiplier": 1.08,
    "demandMultiplier": 1.03,
    "refund": 22
  },
  "expiresAt": 1790000060
}
```

## 24. API và transaction

```text
GET  /v1/shop/catalog
POST /v1/shop/purchase
GET  /v1/economy/balance
POST /v1/plants/:plantId/sell-quote
POST /v1/plants/:plantId/sell-confirm
POST /v1/plants/:plantId/sell-undo
GET  /v1/breeding/rarity-preview
POST /v1/breeding/start
GET  /v1/orders
POST /v1/orders/:orderId/fulfill
```

Purchase, breeding và selling phải có `idempotencyKey`.

Server transaction khi bán:

```text
BEGIN
  lock plant row
  verify owner and sellable state
  verify quote not expired/used
  mark plant pendingDeletion
  append economy ledger credit
  update player balance
  mark quote consumed
COMMIT
```

Mọi thay đổi tiền phải có immutable ledger, không chỉ sửa số dư.

## 25. Chống gian lận và exploit

- Rarity roll hoàn toàn server-side.
- Client không gửi kết quả rarity, price hoặc coin delta.
- Server seed + nonce chỉ reveal sau khi kết quả đã commit nếu cần verify fairness.
- Không tin giờ thiết bị cho grow timer hoặc shop refresh.
- Chặn replay request bằng idempotency key.
- Bán và breeding lock cây ở database.
- Quote có thời hạn và chỉ dùng một lần.
- Phát hiện nhiều tài khoản/device farm rồi chuyển giá trị.
- Giới hạn đơn NPC bonus theo ngày.
- Không cho undo nếu tiền từ giao dịch đã được tiêu.
- Audit mọi SSS creation và sale.

## 26. Economic sinks

Để tiền không mất giá:

- mua hạt;
- breeding fee;
- nâng ô đất/nhà kính;
- vật tư chăm cây;
- phí thẩm định phả hệ nâng cao;
- đổi tên nhiều lần;
- cosmetic chậu/vườn;
- training fee;
- phí market nếu có;
- bảo tồn allele khi lai.

Không dùng repair cost gây khó chịu sau mỗi trận. Cây thua không bị mất.

## 27. Telemetry kinh tế

Theo dõi theo ngày và cohort:

- tiền sinh ra từ bán cây;
- tiền bị hút bởi hạt, lai, vật tư, nâng cấp;
- giá trị trung vị kho người chơi;
- số lần lai mỗi ngày;
- rarity thực tế so với bảng công bố;
- số SSS trên 1.000 lượt lai;
- lợi nhuận/giờ theo loại cây;
- tỷ lệ người chơi bán nhầm rồi undo;
- % cây giữ, bán, dùng lai, dùng battle;
- lạm phát LeafCoin;
- thời gian từ tài khoản mới đến lần lai đầu tiên.

Cảnh báo:

- rarity lệch quá 10% tương đối so với xác suất kỳ vọng ở mẫu đủ lớn;
- nguồn tiền > sink tiền kéo dài 7 ngày;
- một loại hạt có lợi nhuận/giờ vượt loại khác >25% mà không có rủi ro tương ứng;
- SSS được tạo bất thường theo account/device/IP;
- đơn NPC trở thành nguồn in tiền tối ưu duy nhất.

## 28. Ví dụ hoàn chỉnh

Người chơi cấp 12 mua:

- Hạt Lá Lửa: 120;
- Hạt Dây Sét: 140.

Sau khi trưởng thành, người chơi giữ cả hai để lai. Phí lai là 70.

Tỷ lệ hiển thị trước khi lai:

```text
C 47,4%
B 28,8%
A 15,4%
S 6,2%
SS 2,0%
SSS 0,2%
```

Kết quả roll A. Generator tạo cây `Dây Lá Tia Lửa`:

- gene speed từ Dây Sét;
- projectile fire từ Lá Lửa;
- trait mỏng nhưng đánh nhanh;
- rarityScore 52;
- ranked Build Value vẫn nằm trong budget;
- giá bán 472 LeafCoin.

Người chơi có thể:

- bán 472 để tái đầu tư;
- giữ làm cây chiến đấu tốc độ;
- tiếp tục chăm để tăng care quality và giá;
- dùng làm cha/mẹ để truyền gene fire projectile + speed.

## 29. Acceptance criteria

- Shop chỉ bán hạt cơ bản rarity C.
- Tỷ lệ rarity cuối được hiển thị trước khi xác nhận lai.
- Bảng cơ bản có SSS đúng 0,10% và tổng đúng 100%.
- Cấp trung bình của hai cây cha mẹ tăng dần tỷ lệ; ghép level 100 với level 1 chỉ dùng effective level 50.
- Cấp cây không tự đổi rarity hiện tại; nó chủ yếu tăng tỷ lệ rarity cho đời con.
- BreederLevel chỉ có bonus nhỏ có cap; SSS vẫn hiếm.
- Rarity cha mẹ không tạo vòng lặp đảm bảo SSS.
- Mọi cây rarity cao đạt yêu cầu nội dung tương ứng và qua gene power validator.
- SSS không tự động có ECR cao hơn trong Ranked.
- Bán cây là transaction server-side, không duplicate coin hoặc mất cây mà không nhận tiền.
- Cây A trở lên tự khóa; cây locked/favorite không thể bán.
- Giá bán có breakdown để QA và người chơi hiểu.
- Cây C chăm bình thường có lợi nhuận dương nhỏ.
- Economy có sink đủ để không lạm phát mất kiểm soát.
- Rarity roll và giá bán deterministic/auditable theo version, nhưng seed bí mật trước khi commit.

## 30. Thứ tự triển khai

1. LeafCoin ledger và balance transaction.
2. Catalog 5 hạt cơ bản.
3. Purchase flow và inventory seed.
4. Mature plant sell quote/confirm/undo.
5. Rarity table versioned và probability preview.
6. Rarity roll server-side.
7. Band content validator nối với gene generator.
8. Cultivation level 1-100, XP curve và rarity interpolation.
9. BreederLevel unlocks và bonus nhỏ có cap.
10. Parent/care/catalyst modifiers.
11. Pity counters.
12. NPC orders.
13. Economy telemetry và anomaly alerts.
14. Chợ người chơi chỉ sau khi MVP ổn định.
