# Growth Power Deep Spec

## 1. Mục tiêu

Cơ chế trồng cây phải làm người chơi tin rằng:

- Cây mạnh lên vì mình chăm.
- Cây phát triển theo gene riêng, không giống cây khác.
- Chăm kiểu nào ảnh hưởng kiểu mạnh lên.
- Có yếu tố bất ngờ: đôi khi tăng thuộc tính lạ, mở trait, hoặc đột biến.
- Người chơi không thể spam một thao tác duy nhất để tạo cây hoàn hảo.

## 2. Các lớp sức mạnh của cây

Một cây có 5 lớp phát triển:

1. `Base DNA`  
   Nền gene sinh ra khi gieo/lai.

2. `Growth Potential`  
   Tiềm năng stat theo gene, giống “trần mềm” của từng chỉ số.

3. `Care Growth`  
   Điểm tăng từ chăm cây hằng ngày.

4. `Battle Growth`  
   XP, kinh nghiệm chiến đấu, scar/trait mở sau trận.

5. `Mutation Growth`  
   Đột biến mở trait, đổi skill, tăng trần, hoặc thêm trade-off.

Không nên chỉ có một level tổng. Cây cần nhiều hướng mạnh:

- Cây trâu.
- Cây tốc độ.
- Cây độc.
- Cây hồi máu.
- Cây khống chế.
- Cây crit.
- Cây skill spam.
- Cây phản đòn.

## 3. Growth stages và ý nghĩa chỉ số

| Stage | Thời lượng MVP | Chăm ảnh hưởng mạnh nhất | Có thể làm gì |
|---|---:|---|---|
| seed | 30s-2m | growthRate, gene reveal | gieo, đặt môi trường |
| sprout | 5m-20m | HP, defense, element affinity | chăm cơ bản |
| young | 30m-2h | attack, speed, skill genes | chăm nâng cao |
| mature | vĩnh viễn | combat mastery, breedingPower | đấu, lai, huấn luyện |
| awakened | hiếm | ultimate, trait hiếm | đấu cấp cao, lai gene mạnh |

MVP có thể rút ngắn timer để test:

- Seed: 15 giây.
- Sprout: 1 phút.
- Young: 3 phút.
- Mature: sau 5 phút.

Production mới kéo dài hơn.

## 4. Care action model

Mỗi hành động chăm có:

```json
{
  "careActionId": "water",
  "name": "Tưới nước",
  "cost": {
    "water": 1
  },
  "cooldownSeconds": 300,
  "primaryStatWeights": {
    "hp": 0.6,
    "resilience": 0.25,
    "waterAffinity": 0.15
  },
  "secondaryStatWeights": {
    "defense": 0.25,
    "careEfficiency": 0.15
  },
  "riskTags": ["overwater"],
  "mutationTags": ["water", "soft_growth"]
}
```

## 5. Care actions chi tiết

### 5.1 Tưới nước

Tăng thường gặp:

- HP.
- Resilience.
- Water affinity.
- Regen potential.

Có thể mở:

- `Dew Skin`: nhận shield nhỏ đầu trận.
- `Soft Root`: tăng hồi máu nhưng giảm defense vật lý.

Rủi ro:

- Cây hệ Fire bị giảm fire affinity nếu tưới quá nhiều liên tục.
- Overwater stress làm giảm growthEfficiency tạm thời.

### 5.2 Ánh sáng

Tăng thường gặp:

- Attack.
- ElementPower.
- GrowthRate.
- Fire/Light affinity.

Có thể mở:

- `Solar Hunger`: mạnh hơn trong arena nắng.
- `Photosurge`: nhận năng lượng nhanh hơn đầu trận.

Rủi ro:

- Heat stress làm giảm HP nếu lạm dụng.
- Cây hệ Water/Dew có thể mất regen một chút.

### 5.3 Bón phân

Tăng thường gặp:

- Một stat ngẫu nhiên có trọng số.
- GrowthPotential nhỏ.
- MutationChance nhỏ.

Có thể mở:

- `Rich Soil Core`: tăng stat gain từ chăm.
- `Overgrown`: attack cao nhưng accuracy thấp.

Rủi ro:

- Nếu bón quá nhiều: instability tăng, có thể sinh trait xấu.

### 5.4 Cắt tỉa

Tăng thường gặp:

- Speed.
- Accuracy.
- Evasion.
- CritChance.

Có thể mở:

- `Sharp Leaves`: đòn thường có bonus bleed/thorn.
- `Clean Form`: giảm cooldown skill.

Rủi ro:

- Giảm HP nhỏ.
- Cây defense có thể mất một phần thick growth.

### 5.5 Âm nhạc

Tăng thường gặp:

- SkillPower.
- Temperament.
- StatusPower.
- AI control.

Có thể mở:

- `Resonant Bloom`: skill có xác suất lặp lại hiệu ứng yếu hơn.
- `Sleepy Pollen`: có kỹ năng ru ngủ.

Rủi ro:

- Cây wildness cao có thể phản ứng ngược, tăng instability.

### 5.6 Ánh trăng

Tăng thường gặp:

- RareTraitChance.
- Shadow/Water affinity.
- LatentPower.

Có thể mở:

- `Moon Vein`: skill hồi máu theo damage gây ra.
- `Night Bloom`: mạnh hơn khi HP thấp.

Rủi ro:

- Chỉ dùng ở event/time window.
- Có thể sinh trait bí ẩn chưa reveal ngay.

### 5.7 Tinh chất gene

Tăng thường gặp:

- MutationChance.
- SkillGene variance.
- BreedingPower.

Có thể mở:

- Major mutation.
- Chaotic mutation.
- New skill module.

Rủi ro:

- MutationDebt tăng.
- Stability giảm.
- Có thể tạo unstable trait.

## 6. Care memory

Mỗi cây lưu `careMemory`:

```json
{
  "recentActions": [
    {"careActionId": "water", "at": 1790000000},
    {"careActionId": "sunlight", "at": 1790000300}
  ],
  "actionCounts24h": {
    "water": 3,
    "sunlight": 2,
    "fertilizer": 1
  },
  "dominantCareStyle": "balanced",
  "stress": {
    "overwater": 0.12,
    "heat": 0.05,
    "mutationDebt": 0.2
  }
}
```

Care memory dùng để:

- Tính diminishing return.
- Tạo mutation theo phong cách chăm.
- Ngăn spam.
- Làm mỗi người chơi nuôi ra cây khác nhau.

## 7. Công thức stat gain

Khi người chơi chăm cây:

```text
baseGain = careAction.baseGain
stageMultiplier = stage.gainMultiplier
geneAffinity = plant.dna.statGenes[stat] * 0.7 + elementAffinityBonus
careWeight = careAction.statWeights[stat]
potentialFactor = remainingPotential(stat)
memoryFactor = antiSpamMultiplier(careMemory, careAction)
stressFactor = 1 - relevantStress
moodFactor = plant.moodMultiplier
randomFactor = seededRandom(0.85, 1.15)

gain = baseGain
  * stageMultiplier
  * careWeight
  * (0.5 + geneAffinity)
  * potentialFactor
  * memoryFactor
  * stressFactor
  * moodFactor
  * randomFactor
```

Sau đó:

```text
finalGain = max(1, round(gain))
```

Nếu `potentialFactor` rất thấp, gain có thể chuyển thành:

- Skill XP.
- Mutation charge.
- Trait progress.
- Không nên báo “không được gì”.

## 8. Remaining potential

Mỗi stat có:

- `base`
- `current`
- `softCap`
- `hardCap`
- `breakthroughProgress`

```text
remainingPotential = clamp((softCap - current) / softCap, 0.15, 1.0)
```

Nếu current vượt softCap:

- Gain vẫn có nhưng giảm mạnh.
- Cần awaken, battle, hoặc mutation để tăng trần.

## 9. Thuộc tính tăng bất kỳ

Người dùng muốn trồng/chăm để tăng “sát thương hoặc thuộc tính bất kỳ”. Cơ chế nên là **weighted random có hướng**, không phải random mù.

Mỗi care action tạo 3 nhóm roll:

1. Primary roll: theo hành động chăm.
2. Gene roll: theo gene mạnh của cây.
3. Surprise roll: xác suất nhỏ tăng thuộc tính bất ngờ.

Ví dụ bón phân:

```text
Primary roll: random stat theo bảng fertilizer
Gene roll: stat gene cao nhất có 35% cơ hội được cộng thêm
Surprise roll: 8% cơ hội tăng stat ít liên quan hoặc mở mutation point
```

Kết quả có thể là:

```text
+2 Attack
+1 Poison Affinity
Đột biến nhỏ: gai non chuyển màu tím
```

## 10. Stress và rủi ro

Stress không phải hình phạt nặng, mà là cách tạo quyết định.

Stress types:

- `overwater`
- `heat`
- `overfeed`
- `mutationDebt`
- `battleFatigue`
- `neglect`

Stress effects:

- Giảm care gain.
- Tăng xác suất trait xấu.
- Tăng instability.
- Đổi AI personality.

Stress có thể giảm bằng:

- Nghỉ ngơi.
- Chăm cân bằng.
- Item thanh lọc.
- Thắng battle.

## 11. Mood

Mood:

- Calm.
- Excited.
- Wild.
- Tired.
- Unstable.

Mood ảnh hưởng:

- Stat gain.
- Mutation roll.
- Battle AI.
- Skill trigger preference.

Ví dụ:

- Calm: accuracy +, mutation -.
- Wild: crit +, accuracy -, mutation +.
- Tired: speed -, regen +.

## 12. Growth events

Trong quá trình lớn, cây có thể gặp event:

- `new_leaf`: mở body part.
- `root_split`: tăng defense hoặc root skill.
- `strange_color`: tăng mutation chance.
- `first_flower`: mở skill gene.
- `thorn_birth`: mở phản đòn.
- `aura_flash`: mở element phụ.

Event triggered bởi:

- Stage up.
- Care combo.
- Mutation roll.
- Battle scar.

## 13. Care combo

Một số chuỗi chăm tạo hiệu ứng:

| Combo | Điều kiện | Kết quả |
|---|---|---|
| Dew Guard | water -> music -> water trong 12h | mở shield/regen progress |
| Solar Blade | sunlight -> pruning -> sunlight | attack + speed, mở sharp leaf |
| Toxic Bloom | fertilizer -> gene_serum trên cây poison | tăng poison skill gene |
| Storm Vine | pruning -> moonlight trên electric | tăng chain skill chance |
| Ancient Root | water -> fertilizer -> rest | tăng HP/defense softCap |

UI không nên spoil hết. Có thể gợi ý bằng nhật ký cây.

## 14. Offline progress

Growth timer chạy offline.

Nhưng care action không nên tự động spam offline. Khi quay lại:

- Cây có thể stage up.
- Tích lũy tối đa 1-3 `careOpportunity`.
- Hiện “Cây đã lớn thêm khi bạn vắng mặt”.

Không cho:

- Người chơi đổi giờ máy để tăng vô hạn.
- Care opportunity tích vô hạn.

Server time là nguồn chuẩn nếu online.

## 15. Plant level và stat growth

Cây có `cultivationLevel` riêng từ 1 đến 100. Đây cũng là level dùng để tính đóng góp rarity khi cây làm cha/mẹ theo `16_SHOP_RARITY_SELLING_ECONOMY.md`.

Nguồn XP:

- Chăm cây.
- Stage up.
- Battle.
- Training.
- Lai tạo thành công.

Level up không chỉ cộng stat thẳng. Level up cho:

- Growth points.
- Skill mastery cap.
- Trait reveal chance.
- BreedingPower.
- Tăng dần trọng số sinh con hiếm khi nhân giống.

Hai cây nhân giống dùng cấp trung bình:

```text
effectiveParentLevel = floor((levelA + levelB) / 2)
```

Level cây không tự động đổi rarity hiện tại. Nó tăng sức phát triển, giá trị chăm và xác suất rarity của đời con. Chỉ cultivation mutation ở mốc đặc biệt mới có thể nâng rarity của chính cây đó.

Growth points có thể tự phân bổ theo gene hoặc cho người chơi chọn ở mức nhẹ.

MVP recommendation:

- Người chơi không phân bổ điểm thủ công quá sâu.
- Game tự phân bổ, nhưng có “chăm theo hướng” để định hình.

## 16. UI feedback

Sau mỗi chăm:

- Cây animate.
- Stat pop-up.
- Mood icon đổi nếu cần.
- Nhật ký ngắn.

Ví dụ:

```text
Tưới nước
+4 HP
+1 Resilience
Rễ cây có vẻ sâu hơn.
```

Nếu có mutation:

```text
Đột biến nhỏ!
Gân lá chuyển xanh lam.
Water Affinity +3%
```

Nếu có risk:

```text
Cây hơi úng nước.
Overwater stress +6%
```

## 17. Data model bổ sung

```json
{
  "plantId": "plant_001",
  "growth": {
    "stage": "young",
    "stageStartedAt": 1790000000,
    "stageReadyAt": 1790003600,
    "careOpportunities": 2,
    "level": 4,
    "xp": 72
  },
  "potential": {
    "hp": {"softCap": 280, "hardCap": 360},
    "attack": {"softCap": 55, "hardCap": 80},
    "defense": {"softCap": 48, "hardCap": 70},
    "speed": {"softCap": 42, "hardCap": 64}
  },
  "careMemory": {},
  "stress": {},
  "mood": "calm"
}
```

## 18. Server validation

Server kiểm tra:

- Care action có cooldown không.
- Player có đủ resource không.
- Cây thuộc player không.
- Cây có đang locked trong battle/breeding không.
- Timestamp theo server.
- Result stat gain do server tính.

Client có thể preview nhưng server trả kết quả thật.

## 19. Acceptance criteria

- Chăm cùng một cây nhiều kiểu cho build khác nhau.
- Chăm cùng kiểu quá nhiều có diminishing return/risk.
- Cây khác gene phản ứng khác nhau với cùng care action.
- Có xác suất tăng thuộc tính bất kỳ nhưng vẫn theo logic.
- Có log rõ để người chơi hiểu cây vừa mạnh lên ở đâu.
- Restart app không mất care history.
- Server không cho spam care vượt cooldown.
