# Genetics Và Mutation System

## 1. Mục tiêu

Hệ thống lai tạo phải tạo cảm giác:

- Bất ngờ.
- Gần như không trùng lặp.
- Có logic di truyền đủ để người chơi học và tối ưu.
- Vẫn có kiểm soát balance.

Không được là random hoàn toàn vô nghĩa. Người chơi phải cảm thấy: “Nếu mình chọn cha mẹ này thì có hướng kết quả, nhưng vẫn có bất ngờ.”

## 2. DNA structure

Mỗi cây có `dna`.

```json
{
  "baseLineage": ["thornroot", "emberleaf"],
  "elementGenes": {
    "wood": 0.55,
    "fire": 0.25,
    "water": 0.05,
    "earth": 0.15,
    "electric": 0,
    "poison": 0
  },
  "bodyGenes": {
    "stem": "thick",
    "leaf": "serrated",
    "root": "deep",
    "flower": "ember_core",
    "fruit": "none",
    "aura": "warm_glow"
  },
  "statGenes": {
    "hp": 0.75,
    "attack": 0.55,
    "defense": 0.8,
    "speed": 0.25,
    "skill": 0.4
  },
  "skillGenes": {
    "projectile": 0.2,
    "rootControl": 0.7,
    "poison": 0.1,
    "heal": 0.05,
    "shield": 0.6,
    "burst": 0.3
  },
  "mutationGenes": {
    "instability": 0.18,
    "rarityLuck": 0.07,
    "wildness": 0.22,
    "purity": 0.61
  },
  "seed": "stable_random_seed"
}
```

## 3. Gene categories

Element genes:

- Wood.
- Fire.
- Water.
- Earth.
- Electric.
- Poison.
- Light.
- Shadow.

Body genes:

- Thân.
- Lá.
- Rễ.
- Hoa.
- Quả.
- Gai.
- Nấm.
- Ánh sáng/aura.
- Màu chủ đạo.
- Kích thước.

Stat genes:

- HP.
- Attack.
- Defense.
- Speed.
- Skill power.
- Crit.
- Evasion.

Skill genes:

- Projectile.
- Melee vine.
- Root trap.
- Poison cloud.
- Heal pulse.
- Shield bark.
- Seed bomb.
- Thorn counter.
- Weather call.
- Summon sprout.

Mutation genes:

- Cơ hội trait hiếm.
- Cơ hội skill lai.
- Cơ hội ngoại hình dị.
- Cơ hội trade-off xấu.

## 4. Lai 2 cây

Input:

- Parent A.
- Parent B.
- Breeding item nếu có.
- Environment.
- Player care style gần đây.
- Server random seed.

Output:

- Child plant.
- Mutation report.
- Inherited traits.
- New traits.
- Visual composition.
- Initial stats.
- Potential curve.

## 5. Thuật toán lai MVP

```text
1. Tạo childSeed = hash(parentA.id + parentB.id + playerId + serverNonce + breedingAttempt)
2. Với mỗi gene numeric:
   childGene = weightedMix(parentA.gene, parentB.gene, dominance, randomVariance)
3. Với mỗi body gene:
   chọn từ A hoặc B theo dominance
   có xác suất blend hoặc mutate sang part lân cận
4. Tính mutationChance:
   base + parentInstability + breedingItemBonus + environmentBonus - stabilityPenalty
5. Roll mutation tiers:
   micro, minor, major, chaotic
6. Tạo stat potential từ stat genes
7. Tạo skill modules từ skill genes + mutation
8. Tạo traits từ inherited pool + mutation pool
9. Tính rarity và power budget
10. Clamp balance để cây không vượt trần theo generation/rarity
```

## 6. Mutation tiers

Micro mutation:

- Màu lá lệch nhẹ.
- +1-3% một stat.
- Skill có modifier nhỏ.

Minor mutation:

- Thêm gai.
- Đổi hiệu ứng skill.
- Mở trait thường.
- Hệ phụ tăng rõ.

Major mutation:

- Sinh skill mới.
- Đổi body part đặc biệt.
- Mở trait hiếm.
- Cây có vai trò chiến đấu mới.

Chaotic mutation:

- Cây có skill lạ độc nhất.
- Có trade-off lớn.
- Có ngoại hình rất khác.
- Có thể sinh legendary quirk.

## 7. Không trùng lặp

Để mỗi người chơi gần như không ra cây giống nhau:

- `serverNonce` riêng cho mỗi lần lai.
- `playerId` tham gia seed.
- Care history tham gia mutation roll.
- Parent history tham gia dominance.
- Gene values là số float, không chỉ enum.
- Visual part có tint, scale, pattern, aura.
- Skill có modifier sinh ra theo gene.

Hai cây có cùng cha mẹ vẫn khác nhau vì:

- serverNonce khác.
- timing bucket khác.
- care context khác.
- breeding item khác.

## 8. Skill generation

Kỹ năng được tạo từ module:

- Delivery: projectile, beam, aura, trap, melee vine, summon.
- Element: fire, water, poison, electric, earth, wood.
- Effect: damage, dot, slow, stun, shield, heal, leech.
- Shape: single, cone, line, area, random bounce.
- Modifier: crit, pierce, chain, delayed, lifesteal.
- Cost/cooldown.

Ví dụ:

`Dây Gai Nhiễm Độc`

- Delivery: melee vine.
- Element: poison/wood.
- Effect: damage + poison.
- Modifier: phản đòn nếu bị đánh cận chiến.

`Hạt Sét Nảy`

- Delivery: projectile.
- Element: electric.
- Effect: damage.
- Shape: bounce.
- Modifier: có xác suất stun.

## 9. Balance bằng power budget

Mỗi cây có `powerBudget`.

Power budget phụ thuộc:

- Generation.
- Rarity.
- Growth quality.
- Mutation tier.
- Level cây.

Khi skill quá mạnh:

- Cooldown tăng.
- Accuracy giảm.
- HP giảm.
- Energy cost tăng.
- Trait xấu đi kèm.

Điều này cho phép “biến thể vô hạn” mà không phá game.

Đây chỉ là tóm tắt. Công thức định giá stat/skill, gene package có đánh đổi, synergy tax, ECR, counter graph và pipeline mô phỏng được quy định tại `15_GENE_POWER_BALANCE_DEEP_SPEC.md`. Khi hai file khác nhau, file 15 là nguồn chuẩn cho cân bằng gene.

## 10. Mutation report

Sau khi lai, hiện màn hình:

- Tên tạm cây con.
- Hệ chính/phụ.
- Độ hiếm.
- Trait mới.
- Kỹ năng chính.
- Dòng “Đột biến bất ngờ”.

Ví dụ:

```text
Sinh ra: Mầm Gai Chớp Độc
Hệ: Mộc/Sét/Độc
Đột biến: Lá dẫn điện
Trait mới: Tĩnh Điện Gai
Kỹ năng: Phóng Gai Nảy Sét
```
