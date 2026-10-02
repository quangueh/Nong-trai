# Battle Control Deep Spec

## 1. Câu hỏi chính

Battle nên để người chơi điều khiển chiêu hay máy tự làm?

Khuyến nghị:

- MVP: **Hybrid auto battle**.
- Cây tự đánh thường và tự quyết một phần theo personality.
- Người chơi điều khiển các khoảnh khắc quan trọng: chọn stance, kích hoạt skill, dùng ultimate/focus.

Lý do:

- Game cốt lõi là nuôi/lai cây, không phải game hành động twitch.
- Mobile dễ chơi hơn.
- Multiplayer online ít bị ảnh hưởng bởi lag hơn.
- Vẫn có cảm giác người chơi tham gia trận.

## 2. Ba mode battle

### 2.1 Auto Mode

Máy tự làm toàn bộ:

- Basic attack.
- Skill cast.
- Heal/shield timing.
- Ultimate nếu có.

Người chơi chỉ xem.

Dùng cho:

- Battle AI nhanh.
- Người chơi AFK.
- Reconnect/disconnect.
- Test balance.

### 2.2 Hybrid Mode

Máy tự làm nền, người chơi can thiệp:

- Chọn stance trước hoặc trong trận.
- Bấm skill khi cooldown xong.
- Bấm ultimate/focus một lần hoặc theo energy.
- Có thể bật auto-skill.

Dùng cho:

- PvP mã phòng MVP.
- Trận quan trọng.

### 2.3 Manual Tactical Mode

Người chơi điều khiển nhiều hơn:

- Chọn skill 1/2/3.
- Chọn timing.
- Chọn phản ứng phòng thủ.

Không khuyến nghị MVP vì:

- Phức tạp realtime.
- Dễ bị lag.
- Cần nhiều UI.
- Dễ biến game thành PvP thao tác tay thay vì lai tạo cây.

## 3. Battle recommendation MVP

MVP nên dùng:

```text
Auto basic attack
Auto passive traits
Player can trigger active skill
Player can change stance every 10 seconds
If player does nothing, AI auto-casts based on personality
Ultimate/focus max 1-2 times per battle
```

## 4. Battle screen controls

Portrait controls:

- Skill button 1: kỹ năng chính.
- Skill button 2: kỹ năng phụ nếu có.
- Focus/Ultimate button.
- Stance toggle:
  - Công.
  - Thủ.
  - Nhanh.
  - Kỹ năng.
- Auto toggle:
  - Auto skill on/off.

MVP có thể chỉ dùng:

- Skill chính.
- Focus.
- Auto toggle.

## 5. Stance system

Stance là cách người chơi định hướng AI.

### Aggressive

Effects:

- Attack +8%.
- Skill cast chance +10%.
- Defense -5%.

AI behavior:

- Dùng skill sớm.
- Ưu tiên damage.

### Guard

Effects:

- Defense +10%.
- Shield/heal cast priority +20%.
- Attack -5%.

AI behavior:

- Giữ skill phòng thủ cho lúc HP thấp.

### Swift

Effects:

- Speed +8%.
- Evasion +5%.
- Accuracy -3%.

AI behavior:

- Ưu tiên interrupt, slow, stun nếu có.

### Focus

Effects:

- SkillPower +8%.
- Basic attack -5%.
- Status chance +5%.

AI behavior:

- Chờ combo/status trước khi tung skill lớn.

Stance cooldown:

- Đổi stance tối đa mỗi 10 giây.
- Server validate.

## 6. Skill control

Mỗi active skill có state:

- `locked`
- `ready`
- `cooldown`
- `casting`
- `disabled`

Khi người chơi bấm skill:

1. Client gửi `CAST_SKILL_INTENT`.
2. Server kiểm tra:
   - skill ready.
   - cây còn sống.
   - không bị stun/silence.
   - đủ energy nếu cần.
3. Server đưa skill vào cast queue.
4. Skill resolve theo tick.
5. Server broadcast event.

Nếu không bấm:

- AI có thể auto cast nếu `autoSkill = true`.
- Nếu `autoSkill = false`, skill giữ đến khi người chơi bấm.

## 7. Energy system

Không nên để skill chỉ cooldown khô khan. Dùng thêm energy nhẹ:

Tên resource: `Sap Energy` hoặc `Nhựa Chiến`.

Tăng khi:

- Thời gian trôi.
- Đánh thường trúng.
- Nhận damage.
- Trait kích hoạt.
- Stance phù hợp.

Dùng cho:

- Skill mạnh.
- Ultimate.

MVP:

- Skill thường dùng cooldown.
- Ultimate dùng energy.

## 8. Cast timing

Skill có:

- Wind-up: chuẩn bị.
- Resolve: gây hiệu ứng.
- Recovery: hồi động tác.

Ví dụ:

```json
{
  "skillId": "thorn_burst",
  "windupSeconds": 0.6,
  "resolveAt": 0.6,
  "recoverySeconds": 0.4,
  "canBeInterrupted": true
}
```

Điều này tạo chỗ cho:

- Stun interrupt.
- Shield phản ứng.
- Dodge.

MVP có thể đơn giản hóa nhưng vẫn nên lưu field.

## 9. Server tick model

Server battle chạy theo tick:

- 10 tick/giây logical.
- Mỗi tick xử lý:
  - input queue.
  - cooldown.
  - energy.
  - status.
  - AI decisions.
  - damage/effects.
  - win check.

Client render mượt ở 30/60 FPS dựa trên event.

## 10. Input latency

Game không phải twitch, nên chấp nhận latency:

- Client bấm skill.
- UI hiện pending ring.
- Server ack trong 100-500ms tùy mạng.
- Skill cast tại tick hợp lệ gần nhất.

Nếu lag:

- Không rollback lớn.
- Server event là sự thật.
- UI có thể hiển thị “Đang ra chiêu...”.

## 11. Disconnect behavior

Nếu người chơi mất kết nối:

- Cây chuyển sang AI auto control.
- Stance giữ nguyên.
- Auto-skill bật an toàn.
- Khi reconnect, người chơi lấy lại control.

Không pause trận PvP vì sẽ bị abuse.

## 12. Battle AI chi tiết

AI score mỗi skill:

```text
score = baseDesire
  + damageOpportunity
  + statusOpportunity
  + defensiveNeed
  + comboBonus
  + personalityBias
  + stanceBias
  - wastePenalty
```

AI dùng skill có score cao nhất nếu:

- skill ready.
- score vượt threshold.
- cây không bị disable.

Personality bias:

- Aggressive: damageOpportunity mạnh hơn.
- Defensive: defensiveNeed mạnh hơn.
- Trickster: statusOpportunity mạnh hơn.
- Healer: heal threshold cao.
- Burster: giữ skill chờ crit/combo.

## 13. Auto skill threshold

Mỗi cây có `autoSkillThreshold`.

Wild cây:

- Dùng skill sớm, threshold thấp.

Calm cây:

- Chờ đúng lúc, threshold cao.

Unstable cây:

- Có xác suất dùng sai thời điểm nhưng skill mạnh hơn.

## 14. Manual skill reward

Người chơi bấm đúng thời điểm có thể có bonus nhỏ:

- Nếu dùng shield trong 1.5s trước hit lớn: shield efficiency +10%.
- Nếu dùng poison khi đối thủ đang rooted: poison chance +10%.
- Nếu dùng burst khi đối thủ đang burn: damage +8%.

Không nên quá mạnh, tránh người chơi thao tác giỏi áp đảo hoàn toàn gene/build.

## 15. Skill target

MVP 1v1:

- Target tự động là đối thủ.

Tương lai 2v2/3v3:

- Tap target.
- Auto target theo AI.
- Skill area chọn lane/zone.

## 16. Battle phases

Trận có phase:

1. Intro: 3 giây.
2. Opening: 0-15 giây, skill nhẹ.
3. Mid battle: combo/status.
4. Rage phase: sau 60 giây, energy gain tăng.
5. Overtime: nếu gần hết giờ, healing giảm 20% để tránh kéo dài.

## 17. Battle event examples

```json
{
  "seq": 42,
  "type": "SKILL_CAST_STARTED",
  "battleTime": 18.4,
  "actorPlantId": "plant_a",
  "skillId": "gai_set_nay"
}
```

```json
{
  "seq": 43,
  "type": "DAMAGE_APPLIED",
  "battleTime": 19.0,
  "sourcePlantId": "plant_a",
  "targetPlantId": "plant_b",
  "amount": 38,
  "isCrit": true,
  "hpAfter": 122
}
```

## 18. Client UI states

Skill button:

- Ready: sáng.
- Cooldown: vòng cooldown.
- Not enough energy: xanh mờ.
- Disabled: xám, có icon status.
- Pending: pulse.

Stance:

- Selected stance highlighted.
- Cooldown đổi stance hiện vòng nhỏ.

Auto:

- Toggle rõ.
- Nếu reconnect/disconnect, auto icon hiện.

## 19. Anti-cheat

Client không gửi:

- Damage.
- Crit.
- Hit/miss.
- Winner.

Client chỉ gửi:

- `CAST_SKILL_INTENT`.
- `CHANGE_STANCE`.
- `TOGGLE_AUTO`.
- `USE_FOCUS`.

Server kiểm tra mọi thứ.

## 20. Acceptance criteria

- Trận vẫn chạy nếu người chơi không bấm gì.
- Người chơi bấm skill có tác động thật.
- Nếu người chơi mất mạng, cây vẫn auto đánh.
- Skill không thể dùng khi cooldown.
- Stance không thể spam.
- Kết quả giống nhau cho cả hai client.
- Battle không phụ thuộc FPS client.
