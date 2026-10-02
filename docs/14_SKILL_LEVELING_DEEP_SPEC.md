# Skill Leveling Deep Spec

## 1. Mục tiêu

Chiêu thức phải phát triển cùng cây.

Người chơi cần cảm thấy:

- Cây dùng chiêu nhiều thì chiêu thuần thục hơn.
- Chăm cây đúng hướng có thể làm chiêu tiến hóa.
- Lai tạo có thể truyền lại “dấu vết chiêu” sang đời con.
- Không có danh sách chiêu cố định hữu hạn; chiêu là tổ hợp module có thể lên cấp và biến thể.

## 2. Skill anatomy

Một skill gồm:

- Core module.
- Element module.
- Delivery module.
- Effect module.
- Modifier modules.
- Level.
- Mastery XP.
- Evolution nodes.
- Stability.

Ví dụ:

```json
{
  "skillId": "skill_001",
  "generatedName": "Gai Sét Nảy",
  "coreModule": "thorn_projectile",
  "delivery": "projectile",
  "elements": ["wood", "electric"],
  "effects": ["damage", "chain"],
  "modifiers": ["bounce_2", "minor_stun"],
  "level": 3,
  "masteryXp": 140,
  "stability": 0.82,
  "evolutionNodes": ["faster_cast"],
  "powerBudgetCost": 56
}
```

## 3. Skill types

### Basic attack

- Luôn có.
- Level theo cây.
- Có thể nhận element/status nhỏ từ gene.

### Active skill

- Người chơi/AI kích hoạt.
- Có cooldown.
- Gây damage, heal, shield, status, summon.

### Passive skill/trait skill

- Tự kích hoạt.
- Không có nút bấm.
- Ví dụ phản đòn gai, hồi máu khi dưới 30% HP.

### Ultimate/Awakened skill

- Chỉ cây awakened hoặc mutation hiếm.
- Cần energy.
- 1-2 lần/trận.

## 4. Skill XP sources

Skill nhận XP từ:

- Dùng trong battle.
- Gây hit thành công.
- Gây status thành công.
- Combo đúng điều kiện.
- Huấn luyện trong vườn.
- Chăm cây bằng action hợp tag skill.
- Awaken event.

Không nên cho XP vô hạn bằng spam:

- Mỗi trận có soft cap skill XP.
- Dùng hụt vẫn có ít XP, nhưng ít hơn.
- Đánh AI yếu hơn quá nhiều thì XP giảm.

## 5. Skill XP formula

```text
xp = baseUseXp
  + hitBonus
  + effectSuccessBonus
  + comboBonus
  + underdogBonus
  + manualTimingBonus
  + careSynergyBonus
  - farmWeakOpponentPenalty
```

Ví dụ:

- Dùng skill: +2 XP.
- Trúng: +3 XP.
- Gây stun thành công: +4 XP.
- Kích hoạt combo hệ: +5 XP.
- Manual timing tốt: +2 XP.

## 6. Skill level curve

MVP: 10 level.

| Level | XP cần | Mở khóa |
|---:|---:|---|
| 1 | 0 | skill cơ bản |
| 2 | 30 | power + nhỏ |
| 3 | 80 | chọn/mở node 1 |
| 4 | 150 | cooldown - nhỏ |
| 5 | 260 | modifier nhẹ |
| 6 | 420 | chọn/mở node 2 |
| 7 | 650 | status chance + |
| 8 | 950 | power + |
| 9 | 1350 | stability + hoặc chaos + |
| 10 | 1900 | evolution/awaken variant |

## 7. Level-up effects

Mỗi lần skill lên level, tăng một hoặc nhiều:

- Base power.
- Accuracy.
- Cooldown reduction.
- Energy cost reduction.
- Status chance.
- Status duration.
- Chain/bounce count.
- Shield amount.
- Heal amount.
- Cast speed.
- Stability.

Không tăng tất cả cùng lúc.

Mỗi skill module có `growthProfile`.

Ví dụ:

```json
{
  "growthProfile": {
    "powerPerLevel": 0.04,
    "cooldownReductionAt": [4, 8],
    "statusChancePerLevel": 0.01,
    "evolutionLevels": [3, 6, 10]
  }
}
```

## 8. Evolution nodes

Ở level 3/6/10, skill có thể mở node.

Node có 3 loại:

### Power node

- Damage +.
- Heal +.
- Shield +.

### Control node

- Slow/stun/root chance +.
- Duration +.
- Accuracy +.

### Mutation node

- Thêm element phụ.
- Đổi shape.
- Thêm bounce.
- Thêm lifesteal.
- Tăng instability.

Node có thể do:

- Người chơi chọn.
- Gene tự chọn.
- Random có kiểm soát.

Khuyến nghị MVP:

- Level 3 và 6 cho người chơi chọn 1 trong 2.
- Level 10 là mutation roll dựa trên gene.

## 9. Skill stability

Skill mạnh và đột biến cần stability.

Stability thấp:

- Damage variance cao.
- Có xác suất fail.
- Cooldown dao động.
- Có thể phản tác dụng nhỏ.

Stability cao:

- Ổn định hơn.
- Ít fail.
- Ít biến thể lạ.

Gene serum và chaotic mutation có thể tạo skill mạnh nhưng stability thấp.

## 10. Chăm cây để tăng cấp chiêu

Care action có tag.

Ví dụ:

- Music -> skill, resonance, control.
- Sunlight -> fire, burst, attack.
- Pruning -> speed, precision, projectile.
- Water -> heal, shield, regen.
- Gene serum -> mutation, hybrid, chaos.

Nếu skill có tag trùng care action:

```text
skillCareXp = careBaseXp * tagMatchMultiplier * plantSkillGeneAffinity
```

Ví dụ:

- Cây có skill `Poison Cloud`.
- Người chơi dùng fertilizer/gene serum.
- Skill nhận một ít mastery XP hoặc mutation progress.

## 11. Skill inheritance khi lai

Khi lai 2 cây, skill không copy nguyên xi. Nó truyền qua `skillGenes` và `ancestralEcho`.

Child có thể:

- Kế thừa core module từ cha/mẹ.
- Kế thừa element từ cha/mẹ.
- Kế thừa modifier yếu hơn.
- Sinh skill fusion nếu hai skill tương thích.
- Mất skill nhưng giữ latent gene.

Ví dụ:

Parent A:

- `Gai Độc`: thorn + poison + dot.

Parent B:

- `Hạt Sét`: projectile + electric + chain.

Child có thể ra:

- `Gai Sét Nhiễm Độc`: thorn projectile + electric + poison dot.
- `Hạt Độc Nảy`: projectile + poison + bounce.
- `Dây Gai Tĩnh Điện`: melee vine + electric stun + thorn counter.

## 12. Skill fusion compatibility

Compatibility dựa trên tags:

- Delivery compatible.
- Element compatible.
- Effect compatible.
- Gene bridge.

Ví dụ:

- Thorn + projectile: tốt.
- Poison + dot: rất tốt.
- Water + burn: xung đột.
- Electric + chain: rất tốt.
- Shield + lifesteal: trung bình.

Nếu xung đột:

- Skill có thể yếu hơn.
- Hoặc sinh chaotic mutation.

## 13. Skill naming

Tên skill sinh từ module:

```text
[Delivery flavor] + [Element flavor] + [Effect flavor]
```

Ví dụ:

- Gai + Sét + Nảy = `Gai Sét Nảy`
- Bào Tử + Độc + Ru Ngủ = `Bào Tử Độc Mê`
- Rễ + Đất + Giam = `Rễ Địa Lao`
- Lá + Nước + Hồi = `Lá Sương Hồi Sinh`

Tên phải ngắn, dễ nhớ.

## 14. Skill power budget

Mỗi skill có chi phí.

Power budget cost gồm:

- Damage.
- Cooldown thấp.
- Status mạnh.
- Accuracy cao.
- AoE.
- Chain.
- Heal/shield.
- Low energy cost.

Nếu skill vượt budget:

- Cooldown tăng.
- Accuracy giảm.
- Energy cost tăng.
- Stability giảm.
- Thêm self-risk.

## 15. Skill respec

Không nên cho respec tự do ngay MVP. Nhưng có thể:

- Dùng item hiếm để reset node.
- Giữ level, reset node lựa chọn.
- Không xóa gene gốc.

Điều này giảm cảm giác chọn sai phá cây.

## 16. UI skill leveling

Skill card hiển thị:

- Tên.
- Level.
- XP bar.
- Tags.
- Cooldown.
- Power estimate.
- Status.
- Evolution nodes.

Khi lên level:

```text
Gai Sét Nảy lên cấp 4!
Cooldown -0.4s
Stun chance +1%
```

Khi evolution:

```text
Chọn hướng tiến hóa:
1. Gai Nảy Thêm: bounce +1
2. Tĩnh Điện Sâu: stun chance +8%
```

## 17. Data model

```json
{
  "skillId": "skill_001",
  "plantId": "plant_001",
  "modules": {
    "core": "thorn_projectile",
    "delivery": "projectile",
    "elements": ["wood", "electric"],
    "effects": ["damage", "chain"],
    "modifiers": ["minor_stun"]
  },
  "level": 4,
  "masteryXp": 155,
  "stability": 0.82,
  "evolutionNodes": [
    {
      "nodeId": "bounce_plus_1",
      "unlockedAtLevel": 3
    }
  ],
  "lineage": {
    "inheritedFrom": ["plant_a", "plant_b"],
    "fusion": true
  }
}
```

## 18. Server validation

Server kiểm tra:

- Skill XP source hợp lệ.
- Skill dùng thật trong battle.
- Level-up không vượt XP.
- Node unlock đúng level.
- Không chọn node không thuộc skill.
- Không copy skill từ cây không liên quan.

## 19. Acceptance criteria

- Skill dùng trong battle nhận XP.
- Skill lên level thay đổi chỉ số thật.
- Skill có evolution node ở level mốc.
- Skill có thể truyền ảnh hưởng qua lai tạo.
- Skill mạnh bị ràng bằng cooldown/cost/stability.
- UI giải thích rõ skill vừa mạnh lên gì.
