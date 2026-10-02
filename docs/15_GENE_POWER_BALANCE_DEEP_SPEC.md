# Gene Power Balance Deep Spec

## 1. Mục tiêu thiết kế

Hệ gene phải đồng thời đạt bốn mục tiêu:

- Mỗi cây có cách mạnh riêng, nhìn vào trận đấu có thể nhận ra cá tính của nó.
- Hai cây cùng cấp và cùng hạng có tổng sức mạnh kỳ vọng gần nhau.
- Không tồn tại bộ gene mạnh tuyệt đối trước mọi đối thủ.
- Có thể sinh gần như vô hạn biến thể mà server vẫn định giá và kiểm tra được.

Nguyên tắc cốt lõi:

> Gene không tạo thêm sức mạnh miễn phí. Gene quyết định ngân sách sức mạnh được tiêu vào đâu, hoạt động trong điều kiện nào và phải trả giá bằng điểm yếu gì.

## 2. Phân biệt bốn khái niệm

Không dùng một số `power` duy nhất cho mọi mục đích.

1. `Genome Budget`: tổng điểm mà thuật toán được phép dùng để sinh gene.
2. `Build Value`: giá trị lý thuyết của stat, skill, trait và synergy.
3. `Effective Combat Rating` hay `ECR`: sức mạnh thực nghiệm qua mô phỏng nhiều kèo.
4. `Matchmaking Rating` hay `MMR`: trình độ/ngưỡng thắng của người chơi, không phải sức mạnh cây.

Matchmaking dùng cả `ECR band` và `MMR`, không ghép chỉ theo level.

## 3. Gene tạo kiểu mạnh, không tạo thắng chắc

Mỗi cây được sinh với một `combatArchetypeVector`, tổng bằng 1:

```json
{
  "tank": 0.10,
  "burst": 0.45,
  "sustain": 0.05,
  "control": 0.20,
  "tempo": 0.15,
  "counter": 0.05
}
```

Không khóa cây vào class. Vector chỉ điều hướng việc chia ngân sách.

Các kiểu mạnh chính:

| Kiểu | Thắng bằng | Điểm mạnh | Điểm yếu bắt buộc |
|---|---|---|---|
| Tank | sống lâu, kéo hết tài nguyên địch | HP, giáp, khiên | chậm, damage thấp hoặc dễ bị xuyên giáp |
| Burst | kết liễu trong cửa sổ ngắn | damage đỉnh, crit | cooldown dài, mỏng hoặc thiếu ổn định |
| Sustain | hồi phục và bào mòn | heal, regen, hút máu | sợ anti-heal, burst hoặc giới hạn thời gian |
| Control | khóa nhịp đối thủ | slow, root, stun | damage thấp, hiệu ứng có kháng và diminishing return |
| Tempo | hành động nhanh, ép nhịp | speed, năng lượng | mỗi đòn yếu, dễ bị phản đòn hoặc giáp |
| Counter | trừng phạt hành động cụ thể | reflect, cleanse, retaliation | yếu khi không gặp đúng mục tiêu |
| Ramp | mạnh dần theo thời gian | stack, tiến hóa giữa trận | yếu đầu trận, có thể bị kết liễu sớm |
| Trickster | đánh lừa, đổi trạng thái | né, sao chép, đảo buff | xác suất được giới hạn, độ ổn định thấp |

## 4. Ngân sách gene chuẩn

### 4.1 Ngân sách theo hạng đấu

Mọi cây được chuẩn hóa về `combatTier` trước khi đấu xếp hạng.

| Tier | Genome Budget | Sai số Build Value cho phép |
|---|---:|---:|
| Seedling | 100 | +/- 3% |
| Sprout | 140 | +/- 3% |
| Bloom | 190 | +/- 2.5% |
| Ancient | 250 | +/- 2% |

Độ hiếm không tự tăng budget trong PvP cân bằng. Độ hiếm cho:

- module hiếm hơn;
- animation/ngoại hình;
- cách phối hợp lạ hơn;
- thêm lựa chọn tiến hóa;
- tăng độ khó sử dụng hoặc yêu cầu điều kiện.

Trong chế độ PvE hoặc `Open Power`, cây có thể dùng sức mạnh nguyên bản không chuẩn hóa.

### 4.2 Chia ngân sách

Mặc định ở tier Bloom 190 điểm:

| Nhóm | Khoảng điểm |
|---|---:|
| Base stats | 70-105 |
| Active skills | 45-75 |
| Passive/trait | 15-35 |
| Element package | 5-20 |
| Utility/AI personality | 0-10 |
| Điểm dự phòng synergy | 10-25 |

Khoảng được phép chồng lấn, nhưng tổng giá trị sau synergy phải nằm trong ngưỡng tier.

## 5. Định giá stat

Mọi stat được đổi sang `Stat Value` bằng mức tác động lên thời gian hạ gục chuẩn.

Giá khởi đầu để prototype, sau đó phải hiệu chỉnh bằng telemetry:

| Thay đổi | Chi phí |
|---|---:|
| +1% effective HP | 1.00 |
| +1% sustained damage | 1.00 |
| +1% tốc độ hành động | 1.15 |
| +1% hồi phục hiệu dụng | 1.10 |
| +1 điểm % crit | 0.70 |
| +1 điểm % né | 1.20 |
| +1 điểm % kháng status | 0.75 |
| +1% năng lượng nhận | 0.90 |

Không định giá HP, Attack, Defense bằng số thô. Luôn chuyển thành phần trăm hiệu dụng so với `referencePlant` của tier.

```text
effectiveHP = hp / (1 - damageReduction)
sustainedDPS = expectedDamageOver30s / 30
statValue = deltaAgainstReferenceInPercent * unitCost
```

Defense dùng đường cong giảm dần:

```text
damageReduction = defense / (defense + K_tier)
```

`K_tier` là config, không hard-code trong battle engine.

## 6. Gene trội, gene lặn và biểu hiện

Mỗi locus có hai allele: một từ mỗi cha mẹ.

```json
{
  "locus": "attack_pattern",
  "alleles": [
    {"id": "rapid_seed", "strength": 0.62, "dominance": 0.70},
    {"id": "heavy_thorn", "strength": 0.81, "dominance": 0.42}
  ],
  "expression": 0.58,
  "epigeneticBias": 0.08
}
```

Giá trị biểu hiện:

```text
expressionScore = strength
  * dominance
  * environmentCompatibility
  * careEpigeneticModifier
  * mutationModifier
```

Gene lặn không biến mất. Nó có thể:

- biểu hiện nhẹ thành modifier;
- truyền sang đời con;
- bật khi gặp môi trường/chăm sóc phù hợp;
- trở thành nguyên liệu cho mutation.

## 7. Quy tắc mạnh phải có giá

Mọi module có `benefitCost`, `conditionDiscount`, `drawbackRefund` và `synergyTax`.

```text
netCost = benefitCost
  * uptimeFactor
  * reliabilityFactor
  * targetAvailability
  - drawbackRefund
  + synergyTax
```

Ví dụ skill gây 80 damage:

- đánh chắc 100%, cooldown ngắn: giá cao;
- chỉ hoạt động dưới 30% HP: giảm giá vì uptime thấp;
- tự mất 10% HP: được hoàn budget;
- vừa stun vừa phối hợp với passive tăng damage lên mục tiêu stun: cộng synergy tax.

Giới hạn hoàn điểm do drawback:

- Một drawback không hoàn quá 40% giá module.
- Drawback mà người chơi dễ vô hiệu hóa chỉ được hoàn 0-15%.
- Hai drawback cùng bản chất không được hoàn hai lần.
- Drawback không đáng kể trong mode hiện tại được tính bằng 0.

## 8. Gene package và điểm yếu bắt buộc

Thuật toán không sinh từng stat độc lập hoàn toàn. Nó sinh `genePackage` có ưu, nhược và counter tag.

```json
{
  "id": "glass_cannon_bloom",
  "grants": ["attack_high", "crit_medium", "burst_skill_affinity"],
  "requiresOneOf": ["hp_low", "defense_low", "cooldown_long"],
  "counterTags": ["shield", "dodge", "survive_burst"],
  "budgetCost": 34
}
```

Quy tắc validator:

- Cây có một stat ở top 10% phải có ít nhất một stat phòng thủ/ổn định dưới median, hoặc module phải có điều kiện rõ.
- Cây có hai stat top 15% không được có skill cùng khuếch đại cả hai mà không trả synergy tax.
- Hard control tổng cộng không vượt `controlCap` của tier.
- Hồi máu + shield + giảm damage cùng lúc bị đánh thuế phòng thủ cộng dồn.
- Speed cao làm tăng giá mọi hiệu ứng `onAction`.
- Multi-hit làm tăng giá mọi hiệu ứng `onHit`.
- Crit cao làm tăng giá mọi modifier `onCrit`.

## 9. Ma trận cấm và ma trận đánh thuế

Không thể dựa vào budget tuyến tính vì một số tổ hợp nhân nhau.

### 9.1 Tổ hợp bị cấm trong ranked

- Stun chain có thể khóa mục tiêu quá `maxLockSeconds`.
- Né 100% hoặc miễn nhiễm vĩnh viễn.
- Hồi máu hiệu dụng lớn hơn damage đối thủ chuẩn mà không có giới hạn stack/thời gian.
- Skill one-shot cây cùng tier từ full HP khi không có telegraph/counter window.
- Loop năng lượng tự nuôi khiến cooldown thực bằng 0.
- Reflect phản lại reflect.
- Summon kích hoạt summon vô hạn.

### 9.2 Tổ hợp bị synergy tax

```text
synergyTax = baseCost * interactionCoefficient * expectedProcRate
```

Ví dụ:

- Speed + poison on-hit.
- Multi-hit + lifesteal.
- Crit + reset cooldown.
- Shield + damage when shield breaks.
- Low-HP damage + self-damage có kiểm soát.
- Root + tăng damage lên mục tiêu rooted.

Tax được khai báo trong data để AI có thể thêm tương tác mà không sửa engine.

## 10. Sinh cây từng bước

```text
INPUT:
  parentA, parentB, generationContext, combatTier, careHistory, serverSeed

1. Chọn lineage và element mixture từ cha mẹ.
2. Sinh archetypeVector từ gene cha mẹ + nhiễu có giới hạn.
3. Tạo genomeBudget đúng combatTier.
4. Reserve 8-15% budget cho synergy tax và mutation.
5. Chọn gene packages phù hợp archetype.
6. Với mỗi package, bắt buộc chọn drawback/counter hợp lệ.
7. Sinh base stats rồi quy đổi sang Stat Value.
8. Sinh delivery, effect, status, condition và cost của skill.
9. Tính giá từng module và toàn build.
10. Tính synergy tax cho mọi cặp/chuỗi tương tác.
11. Nếu vượt budget: giảm expression, tăng cooldown/cost hoặc thay module.
12. Nếu thiếu budget: tăng gene phụ, utility hoặc tiềm năng phát triển.
13. Chạy static validator và forbidden-combo validator.
14. Chạy simulation nhanh với bộ đối thủ chuẩn.
15. Điều chỉnh trong biên độ gene cho phép, tối đa N vòng.
16. Nếu vẫn lỗi: reroll module gây lỗi, không reroll toàn bộ cây.
17. Lưu DNA gốc, Build Value, ECR, counterTags và balanceVersion.
```

Không được `clamp` tất cả cây về cùng bộ stat. Thuật toán chỉ cân tổng hiệu dụng, giữ nguyên khác biệt phân bổ.

## 11. Mutation không phá ngân sách

Mutation có ba loại giá trị:

- `sidegrade`: đổi cách dùng, budget gần như không đổi;
- `conditionalUpgrade`: mạnh hơn khi đạt điều kiện, có counter rõ;
- `openPowerUpgrade`: tăng budget thật, chỉ dùng PvE/Open Power hoặc nâng cây sang tier mới.

Trong ranked:

```text
mutationAddedCost = mutationBenefitCost - mutationDrawbackRefund
```

Nếu `mutationAddedCost > reservedMutationBudget`, hệ thống phải:

1. giảm expression của gene khác;
2. tăng điều kiện/cooldown/energy cost;
3. gắn drawback có tác dụng thật;
4. hoặc đánh dấu mutation chỉ hoạt động đầy đủ trong Open Power.

Đột biến hiếm phải lạ hơn, không nhất thiết nhiều damage hơn.

## 12. Skill budget chi tiết

Giá skill gồm:

```text
skillCost = damageCost
  + healingCost
  + controlCost
  + utilityCost
  + targetingCost
  + reliabilityCost
  + synergyTax
  - cooldownDiscount
  - energyDiscount
  - conditionDiscount
  - drawbackRefund
```

Hệ số cần có trong config:

- Damage tức thời đắt hơn cùng lượng DoT.
- Heal chủ động đắt hơn regen có thể bị ngắt.
- Stun đắt hơn slow/root.
- AOE tính theo số mục tiêu kỳ vọng, không theo số tối đa lý thuyết.
- Homing/không thể né làm tăng reliability cost.
- Skill người chơi tự bấm đúng lúc có `manualExecutionFactor`; bonus thao tác tối đa 8-12%.
- Ultimate có thể mạnh nhưng phải trả bằng charge time, telegraph và một lần dùng.

## 13. Counter graph

Mỗi cây phải có:

- ít nhất hai `strengthTags`;
- ít nhất hai `weaknessTags`;
- ít nhất một `hardCounterTag` hoặc hai `softCounterTags`;
- không quá một matchup cực xấu trong bộ đối thủ chuẩn.

Ví dụ:

```json
{
  "strengthTags": ["burst", "anti_sustain"],
  "weaknessTags": ["fragile", "long_cooldown"],
  "counteredBy": ["shield_timing", "speed_pressure"],
  "counters": ["regen", "slow_ramp"]
}
```

Mục tiêu meta không phải vòng kéo-búa-bao cứng. Mỗi kèo nên nằm trong khoảng:

- soft advantage: 52-58%;
- hard but playable: 40-60%;
- ngoài 35-65% phải có lý do đặc biệt và bị cảnh báo.

## 14. Bộ đối thủ chuẩn để đo ECR

Mỗi balance version có 12-30 `benchmarkPlants` cố định:

- tank vật lý;
- tank kháng hiệu ứng;
- burst nhanh;
- burst chậm có telegraph;
- sustain/heal;
- poison/DoT;
- control;
- cleanse;
- tempo/on-hit;
- counter/reflect;
- ramp cuối trận;
- cây cân bằng trung tính.

Mỗi cây mới chạy ít nhất:

- 100 seed/trận với mỗi benchmark khi tạo cây;
- 1.000-10.000 trận trong balance pipeline offline;
- đổi bên, stance và AI personality;
- cùng level, cùng tier, cùng mode normalization.

```text
ECR = weightedAverage(
  winRateScore,
  damageScore,
  survivalScore,
  controlScore,
  matchupVariancePenalty
)
```

Không dùng win rate trung bình đơn lẻ: cây thắng 100% sáu kèo và thua 100% sáu kèo vẫn là thiết kế quá cực đoan.

## 15. Chỉ số kiểm định bắt buộc

Validator trả về:

```json
{
  "buildValue": 188.4,
  "tierBudget": 190,
  "ecr": 0.512,
  "medianWinRate": 0.506,
  "minMatchupWinRate": 0.411,
  "maxMatchupWinRate": 0.593,
  "matchupStdDev": 0.047,
  "timeToKillP50": 31.2,
  "controlLockP95": 2.4,
  "invalidCombos": [],
  "warnings": ["high_speed_on_hit_synergy"],
  "status": "ranked_legal"
}
```

Ngưỡng MVP đề xuất:

| Metric | Ngưỡng |
|---|---:|
| Build Value / budget | 0.97-1.03 |
| Win rate tổng với benchmark | 47-53% |
| Một matchup bất kỳ | 35-65% |
| Độ lệch chuẩn matchup | <= 0.09 |
| One-shot không telegraph | 0% |
| Hard-control liên tục | <= 3 giây |
| Battle timeout rate | < 8% |

Các số này là config khởi đầu, phải được hiệu chỉnh bằng playtest.

## 16. Cân bằng khi cây được chăm và tăng cấp

Chăm cây tăng `rawGrowthPower`, nhưng hướng tăng chịu ảnh hưởng gene.

Trong ranked dùng normalization:

```text
normalizedStat = tierReferenceStat
  * buildAllocationRatio
  * allowedGrowthModifier
```

`allowedGrowthModifier` chỉ cho chênh lệch nhỏ, ví dụ +/-5%. Phần sức mạnh vượt mức vẫn tồn tại trong PvE/Open Power.

Chăm tốt vẫn có ý nghĩa trong ranked vì nó:

- mở thêm hướng build;
- tăng mastery và độ ổn định;
- giúp người chơi chọn evolution node;
- thay đổi phân bổ, không cộng sức mạnh vô hạn;
- tạo cosmetic mutation và phả hệ giá trị.

Không để người chơi lâu năm thắng người mới chỉ bằng số giờ chờ.

## 17. Lai giống và chống power creep qua thế hệ

Generation không cộng budget thẳng.

Đời cao cho:

- nhiều gene lặn để khai thác;
- xác suất tổ hợp hiếm;
- thêm lựa chọn khi tiến hóa;
- độ chính xác lai cao hơn nếu phả hệ tốt.

Nhưng phải chịu:

- `inbreedingRisk` nếu họ hàng gần;
- instability khi chồng quá nhiều mutation;
- synergy tax đầy đủ;
- cùng tier budget trong ranked.

```text
childBudget = tierBudget
rareModuleAccess = f(generation, ancestry, mutation)
```

Không dùng:

```text
childBudget = parentBudgetA + parentBudgetB
```

## 18. Reveal sức mạnh cho người chơi

Không hiển thị một số “lực chiến” gây hiểu nhầm. UI hiển thị:

- vai trò nổi trội;
- biểu đồ sáu trục: Sinh tồn, Bùng nổ, Duy trì, Khống chế, Nhịp độ, Ổn định;
- hai điểm mạnh;
- hai điểm yếu;
- độ khó điều khiển;
- counter gợi ý bằng ngôn ngữ tự nhiên;
- nhãn `Cân bằng`, `Mạo hiểm`, `Chuyên trị`, `Không hợp Ranked`.

Ví dụ:

```text
Mạnh: dồn sát thương khi đối thủ bị Trói; kết liễu cây hồi phục.
Yếu: phòng thủ thấp; phụ thuộc kỹ năng 9 giây hồi.
Đối phó: dùng Khiên đúng lúc hoặc gây áp lực sớm.
```

## 19. Telemetry sau khi phát hành

Server ghi theo `balanceVersion`, không sửa DNA lịch sử âm thầm.

Theo dõi:

- pick rate và win rate theo ECR band;
- win rate theo từng cặp archetype;
- skill cast rate, hit rate, damage share;
- status uptime;
- heal/shield thực nhận;
- thời gian kết liễu;
- surrender/disconnect;
- manual input advantage;
- gene/module xuất hiện trong top 1%, 5%, 20%.

Cảnh báo tự động khi:

- một module có win-rate delta > 4% sau khi kiểm soát tier/MMR;
- một tổ hợp gene vượt 58% trong mẫu đủ lớn;
- một module được chọn > 35% ở cùng slot;
- một counter khiến đối thủ dưới 35%;
- battle timeout tăng bất thường.

## 20. Cách nerf/buff không phá cây người chơi

Mỗi cây lưu DNA bất biến và `balanceVersionCreated`.

Balance patch sửa bảng diễn giải gene:

- coeff damage;
- cooldown;
- proc cap;
- diminishing return;
- synergy tax;
- ranked normalization.

Không xóa gene hoặc đổi phả hệ. Nếu thay đổi lớn:

- hoàn tài nguyên nâng skill;
- cho một lần chọn lại evolution node;
- ghi changelog trong hồ sơ cây.

## 21. Data model

```json
{
  "balance": {
    "version": "genes-v1.0.0",
    "combatTier": "bloom",
    "genomeBudget": 190,
    "buildValue": 188.4,
    "reservedMutationBudget": 18,
    "synergyTax": 13.2,
    "ecr": 0.512,
    "rankedLegal": true
  },
  "archetypeVector": {
    "tank": 0.1,
    "burst": 0.45,
    "sustain": 0.05,
    "control": 0.2,
    "tempo": 0.15,
    "counter": 0.05
  },
  "strengthTags": ["burst", "anti_sustain"],
  "weaknessTags": ["fragile", "long_cooldown"],
  "genePackages": ["glass_cannon_bloom"],
  "validationReportId": "gvr_001"
}
```

## 22. Module code cần triển khai

```text
packages/game-sim/src/genetics/
  genome-generator.ts
  allele-expression.ts
  archetype-vector.ts
  gene-package-registry.ts
  mutation-budget.ts

packages/game-sim/src/balance/
  stat-valuator.ts
  skill-valuator.ts
  synergy-tax.ts
  forbidden-combos.ts
  genome-validator.ts
  benchmark-roster.ts
  battle-batch-runner.ts
  ecr-calculator.ts

packages/config/src/balance/
  tiers.json
  stat-costs.json
  skill-costs.json
  synergy-rules.json
  forbidden-combos.json
  benchmark-plants.json
```

Mọi công thức và hệ số nằm trong config có version. Battle engine chỉ đọc config đã được server ký/chọn.

## 23. Acceptance criteria

- Sinh 100.000 cây không có cây invalid hoặc vượt budget quá ngưỡng.
- Mỗi cây có ít nhất hai strength tag và hai weakness tag.
- Không module hoặc tổ hợp nào tạo vòng lặp vô hạn.
- 95% cây nằm trong win rate 47-53% với toàn bộ benchmark.
- 100% cây ranked nằm trong từng matchup 35-65%.
- Đời cây và rarity không làm budget ranked tăng tự động.
- Cây cùng ECR có thể khác hoàn toàn về stat, skill và cách thắng.
- Cùng cha mẹ sinh nhiều cây khác nhau nhưng phân phối ECR không lệch theo người chơi.
- Kết quả generation và validation deterministic theo server seed + balance version.
- Có replay report giải thích cây được cộng/trừ budget tại từng gene/module.

## 24. Thứ tự triển khai MVP

1. Tạo reference plant và 6 archetype cơ bản.
2. Xây stat valuator và skill valuator.
3. Tạo 20-30 gene package có trade-off rõ.
4. Viết synergy matrix và forbidden-combo validator.
5. Viết genome generator dùng budget.
6. Tạo 12 benchmark plants.
7. Viết batch battle simulator deterministic.
8. Tính ECR và tự động sửa/reroll module lỗi.
9. Kết nối breeding/mutation.
10. Thêm UI strength/weakness và ranked legality.
11. Chạy 100.000 cây trong CI nightly.
12. Sau playtest, hiệu chỉnh cost bằng telemetry thay vì cảm giác cá nhân.
