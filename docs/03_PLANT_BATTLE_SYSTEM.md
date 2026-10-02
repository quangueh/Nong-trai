# Plant Battle System

## 1. Mục tiêu battle

Trận đấu phải làm người chơi thấy cây của mình “có cá tính”.

Không được chỉ là:

- So power ai cao hơn.
- Đánh thường qua lại đơn giản.

Trận phải có:

- Hệ khắc chế.
- Skill khác nhau.
- Trait bất ngờ.
- Tốc độ/cooldown.
- Status effect.
- Một chút may rủi có kiểm soát.

## 2. Battle format MVP

- 1v1.
- Mỗi người chọn 1 cây.
- Trận kéo dài tối đa 90 giây.
- Nếu hết giờ, cây còn nhiều %HP hơn thắng.
- Nếu cả hai chết cùng lúc, hòa hoặc xét sát thương gây ra.

## 3. Real-time hay turn-based?

Khuyến nghị MVP: **auto battle real-time có timeline server-side**.

Lý do:

- Mobile dễ xem.
- Cây có cá tính tự đánh.
- Multiplayer dễ chống gian lận hơn so với action realtime liên tục.
- Người chơi tập trung vào lai tạo/chăm cây trước trận.

Can thiệp nhẹ:

- Người chơi có thể kích hoạt `Focus Skill` một lần mỗi trận.
- Hoặc chọn stance trước trận: công, thủ, nhanh, kỹ năng.

MVP có thể chỉ auto battle để giảm phức tạp.

## 4. Chỉ số combat

Visible:

- HP.
- Attack.
- Defense.
- Speed.
- Skill Power.
- Crit.
- Resistance.

Derived:

- Action interval.
- Damage reduction.
- Status chance.
- Skill cooldown.
- Dodge chance.

Hidden:

- AI tendency.
- Combo preference.
- Panic behavior.

## 5. Hệ và khắc chế

MVP elements:

- Wood.
- Fire.
- Water.
- Earth.
- Electric.
- Poison.

Khắc chế đề xuất:

- Fire mạnh hơn Wood.
- Water mạnh hơn Fire.
- Electric mạnh hơn Water.
- Earth giảm Electric.
- Poison xuyên Defense nhưng yếu trước Earth.
- Wood hồi phục tốt, ổn định.

Không làm khắc chế quá cực đoan.

- Advantage: x1.2 damage hoặc +10% status chance.
- Disadvantage: x0.85 damage.

## 6. Skill structure

Mỗi cây có:

- Basic attack.
- 1 skill chính.
- 1 skill phụ nếu rare/generation cao.
- 0-1 passive trait combat.
- 0-1 ultimate nếu awakened.

Skill generated từ gene:

```json
{
  "skillId": "generated_uuid",
  "name": "Gai Sét Nảy",
  "delivery": "projectile",
  "element": ["wood", "electric"],
  "effect": ["damage", "chain"],
  "basePower": 42,
  "cooldown": 7.5,
  "accuracy": 0.88,
  "status": {
    "type": "stun",
    "chance": 0.12,
    "duration": 1.2
  },
  "modifiers": ["bounce_2", "thorn_bonus"]
}
```

## 7. Status effects

MVP:

- Poison: mất HP theo thời gian.
- Burn: mất HP, giảm heal.
- Slow: giảm speed.
- Stun: bỏ lỡ hành động ngắn.
- Shield: hấp thụ damage.
- Regen: hồi HP theo thời gian.
- Rooted: không né được.

## 8. Battle AI

Mỗi cây có `combatPersonality`:

- Aggressive.
- Defensive.
- Trickster.
- Healer.
- Burster.
- Controller.

Personality sinh từ gene và trait.

MVP AI:

1. Nếu HP thấp và có heal/shield, ưu tiên dùng.
2. Nếu enemy bị status yếu với skill, dùng skill.
3. Nếu skill chính hết cooldown, có xác suất dùng theo personality.
4. Nếu không, đánh thường.

## 9. Battle timeline

Server mô phỏng theo tick:

- Tick rate logical: 10 tick/giây.
- Client chỉ render animation.
- Server tạo event:
  - attack_started.
  - damage_applied.
  - skill_cast.
  - status_applied.
  - plant_defeated.
  - battle_finished.

## 10. Damage formula MVP

```text
raw = attacker.attack * skillPowerMultiplier
defenseReduction = defender.defense / (defender.defense + 100)
damage = raw * (1 - defenseReduction)
elementModifier = advantage/disadvantage
critModifier = crit ? critDamage : 1
randomVariance = 0.9 to 1.1
finalDamage = clamp(damage * elementModifier * critModifier * randomVariance, 1, maxHitCap)
```

Random variance dùng server seed để replay/đồng bộ.

## 11. Win/Lose

Win if:

- Opponent HP <= 0.

Timeout:

- Higher HP% wins.
- Nếu bằng HP%, higher total damage wins.
- Nếu vẫn bằng, draw.

## 12. Rewards

Sau battle:

- Cây nhận XP.
- Người chơi nhận coin/tài nguyên.
- Có xác suất nhận mutation catalyst.
- Cây có thể mở battle scar/trait nhỏ nếu đủ điều kiện.

Không làm thua mất cây.
