# Art Audio Animation

## 1. Art direction

Phong cách:

- Cây vừa dễ thương vừa quái.
- Có cảm giác sinh vật sống.
- Đột biến nhìn thấy rõ.
- Không cần quá kinh dị.

## 2. Modular visual system

Vì cây biến thể gần vô hạn, art phải ghép module:

- Body/stem.
- Leaf.
- Root.
- Flower.
- Thorn.
- Fruit.
- Mushroom cap.
- Aura.
- Eye/face optional.
- Element effect.

Mỗi part có:

- sprite base.
- tint mask.
- scale.
- rotation offset.
- rarity variant.

## 3. Visual gene mapping

Ví dụ:

- Defense cao -> thân dày hơn, vỏ cứng.
- Speed cao -> thân mảnh, dây leo dài.
- Poison cao -> màu tím/xanh độc, bào tử.
- Fire cao -> mép lá đỏ/cam, than sáng.
- Electric cao -> gân lá phát sáng.
- Water cao -> giọt sương, thân trong hơn.

## 4. Animation MVP

Mỗi cây cần:

- Idle.
- Happy/care reaction.
- Hurt.
- Basic attack.
- Skill cast.
- Defeated.

Animation có thể dùng:

- skeletal 2D.
- sprite parts tween.
- shader/VFX cho element.

## 5. Battle VFX

Module VFX:

- Thorn slash.
- Seed projectile.
- Poison cloud.
- Fire burst.
- Water splash.
- Electric chain.
- Root trap.
- Shield leaf.
- Heal pulse.

VFX cũng nên modular để skill sinh ra từ gene dùng lại được.

## 6. Audio

Farm:

- Nhạc nhẹ, tò mò, phòng thí nghiệm thiên nhiên.

Breeding:

- Âm gene bubbling.
- Pop khi mutation xuất hiện.

Battle:

- Nhạc nhanh hơn.
- SFX skill theo hệ.
- Hit, shield, poison tick, stun.

UI:

- Tap.
- Confirm.
- Error soft.
- Room created.
- Player joined.
- Match start.
- Victory/defeat.
