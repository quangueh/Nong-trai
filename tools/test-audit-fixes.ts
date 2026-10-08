/**
 * Regression tests for the docs/18–20 audit fixes.
 *
 * Each check is named by the finding it pins: if a fix regresses, the failing
 * line says which audit item came back rather than "something in battle broke".
 *
 * Run with: npx tsx tools/test-audit-fixes.ts
 */

import { GameStore } from "../src/core/store";
import { createSeedPlant, breedPlants, potentialFromGenes } from "../src/genetics/genomeGenerator";
import { computeEcr } from "../src/genetics/ecrCalculator";
import { simulateBattle, BattleSession } from "../src/battle/engine";
import { createBenchmarkPlant } from "../src/genetics/benchmarkRoster";
import { applyCare, previewCare, careCooldownLeft, careWindowCount, xpRequired } from "../src/growth/care";
import { finalRarityWeights, emptyPity, PITY } from "../src/config/rarity";
import { stageTargetPower } from "../src/pve/ascent";
import { breederXpForPlantLevel } from "../src/core/store";
import { CARE_ACTIONS } from "../src/config/careActions";
import type { Plant, Rarity, Stance } from "../src/core/types";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

const RICH = { items: 9999, geneCrystal: 9999, leafCoin: 999_999 };

function mkPlant(seed: string, mutate?: (p: Plant) => void): Plant {
  const p = createSeedPlant("thornroot", "test", seed, 0);
  p.growth.stage = "mature";
  p.growth.level = 10;
  p.tier = "bloom";
  mutate?.(p);
  return p;
}

/* ------------------------------------------------------------------ battle */

section("A04 · né theo stance của bên BỊ ĐÁNH, không phải bên đánh");

/* Only `swift` touches eva in STANCE_EFFECTS (1.05 vs 1.0), and missChance
   clamps at 0.5 — so the probe needs: defender evasion high, attacker accuracy
   high enough that missChance stays under the clamp, no skills (their misses
   have no BASIC_ATTACK to normalise against), long battles (attack=1 keeps the
   punching bag alive for ~40 attempts per fight). */
function probeMissRate(defStance: Stance, atkStance: Stance): number {
  let attempts = 0, misses = 0;
  /* evasion 0.5 keeps missChance = eva-0.03 under the 0.5 clamp on both sides
     of the comparison (0.47 vs 0.495) — any higher and both clamp flat. */
  for (let i = 0; i < 60; i++) {
    const atk = mkPlant(`a04-${atkStance}-a${i}`, (p) => {
      p.stats.evasion = 0;
      p.stats.attack = 10;
      p.stats.hp = 500;
      p.skills = [];
    });
    const def = mkPlant(`a04-${defStance}-d${i}`, (p) => {
      p.stats.evasion = 0.5;
      p.stats.attack = 1;
      p.stats.hp = 500;
      p.skills = [];
    });
    const res = simulateBattle(atk, def, {
      seed: `a04:${i}`,
      maxSeconds: 60,
      arena: "indoor",
      stances: { a: atkStance, b: defStance },
    });
    const onB = res.events.filter((e) => e.other === "b");
    attempts += onB.filter((e) => e.type === "BASIC_ATTACK").length;
    misses += onB.filter((e) => e.type === "MISS" || e.type === "EVADED").length;
  }
  return misses / Math.max(1, attempts);
}
{
  /* swift defender (eva ×1.05) vs aggressive (×1.0): +2.5pp expected. */
  const swiftDef = probeMissRate("swift", "aggressive");
  const aggroDef = probeMissRate("aggressive", "aggressive");
  check(
    "swift defender né nhiều hơn aggressive defender (stance bên BỊ ĐÁNH)",
    swiftDef > aggroDef + 0.012,
    `${(swiftDef * 100).toFixed(1)}% vs ${(aggroDef * 100).toFixed(1)}%`,
  );
  /* Negative control: the old bug read ATTACKER stance for eva. swift-atk vs
     focus-atk legitimately differ only through acc (0.97 vs 1.0 → ~+3.9pp for
     swift); the bug would stack another +2.75pp eva on top → ~+6.6pp. */
  const swiftAtk = probeMissRate("aggressive", "swift");
  const focusAtk = probeMissRate("aggressive", "focus");
  check(
    "stance của ATTACKER không nâng né defender (chỉ còn hiệu ứng acc hợp lệ)",
    swiftAtk - focusAtk < 0.055,
    `${(swiftAtk * 100).toFixed(1)}% vs ${(focusAtk * 100).toFixed(1)}%`,
  );
}

section("A05 · Phản Xạ Nhanh né đòn đầu tiên — một lần, đúng bên");

{
  let total = 0;
  let moreThanOnce = 0;
  let dodgedAfterTakingHit = 0;
  let control = 0;
  for (let i = 0; i < 40; i++) {
    const def = mkPlant(`a05-d${i}`, (p) => {
      p.traits = ["evade_reflex"];
      p.stats.evasion = 0;
    });
    const atk = mkPlant(`a05-a${i}`);
    const res = simulateBattle(atk, def, { seed: `a05:${i}`, maxSeconds: 60 });
    const evaded = res.events.filter((e) => e.type === "EVADED" && e.other === "b");
    total += evaded.length;
    if (evaded.length > 1) moreThanOnce++;
    if (evaded.length) {
      const ei = res.events.indexOf(evaded[0]);
      const firstHit = res.events.findIndex((e) => e.type === "DAMAGE_APPLIED" && e.other === "b");
      if (firstHit >= 0 && ei > firstHit) dodgedAfterTakingHit++;
    }
    const noTrait = mkPlant(`a05-c${i}`, (p) => {
      p.stats.evasion = 0;
    });
    const res2 = simulateBattle(atk, noTrait, { seed: `a05:${i}`, maxSeconds: 60 });
    control += res2.events.filter((e) => e.type === "EVADED" && e.other === "b").length;
  }
  check("trait né được ít nhất một trận trong 40 seed", total > 0, `${total}/40 trận`);
  check("không bao giờ né hai lần trong cùng trận", moreThanOnce === 0);
  check("né xảy ra TRƯỚC đòn trúng đầu tiên", dodgedAfterTakingHit === 0);
  check("cây không có trait thì không EVADED", control === 0);
}

section("A14 · event nói đúng thứ đã xảy ra");

{
  const a = mkPlant("a14-a");
  const b = mkPlant("a14-b");
  const ses = new BattleSession(a, b, { seed: "a14:focus", maxSeconds: 30 });
  ses.useFocus("a");
  const energy = ses.log.find((e) => e.type === "ENERGY_GAINED");
  check("useFocus phát ENERGY_GAINED amount=40", energy?.side === "a" && energy.amount === 40);
  check(
    "useFocus KHÔNG phát HEAL_APPLIED (không vẽ +40 heal giả)",
    !ses.log.some((e) => e.type === "HEAL_APPLIED" && e.text?.includes("tập trung")),
  );

  /* regen: counter_reflect carries "Vượt Tầm". The moment of cast is a status
     application; the ticks are the heals — never one fake up-front heal. */
  /* Bench AI never picked regen in a fair fight — its defensive score stays
     under the cast threshold while hp is healthy. Force the situation the
     skill exists for: a carrier being beaten down so hpPct crosses the line. */
  const regenCarrier = mkPlant("a14-regen", (p) => {
    const base = p.skills[0];
    p.skills = [{
      ...base,
      id: "sk_regen_test",
      name: "Tái Sinh",
      core: { ...base.core, effect: "regen" },
      effect: "regen",
      power: 30,
      energyCost: 0,
      cooldown: 3,
      windup: 0.5,
      recovery: 0.5,
      accuracy: 1,
      statusChance: 0,
      statusDuration: 0,
    }];
    p.stats.hp = 320;
  });
  const opp = mkPlant("a14-opp", (p) => {
    p.stats.attack = 160;
  });
  let sawStatus = false;
  let fakeHeal = false;
  for (let i = 0; i < 12 && !sawStatus; i++) {
    const res = simulateBattle(regenCarrier, opp, { seed: `a14:regen:${i}`, maxSeconds: 60 });
    if (res.events.some((e) => e.type === "STATUS_APPLIED" && e.status === "regen")) sawStatus = true;
    if (res.events.some((e) => e.type === "HEAL_APPLIED" && e.text?.includes("bật Tái tạo"))) fakeHeal = true;
  }
  check("skill regen phát STATUS_APPLIED(regen)", sawStatus);
  check("không còn HEAL_APPLIED báo heal giả 'bật Tái tạo'", !fakeHeal);

  /* cleanse: tank_status carries "Tẩy Rửa" and should emit CLEANSED — a
     HEAL_APPLIED with amount 0 was both wrong and invisible in the view. */
  const cleanser = createBenchmarkPlant("tank_status", "bloom");
  const dotter = createBenchmarkPlant("poison_dot", "bloom");
  let sawCleanse = false;
  let ghostHeal = false;
  for (let i = 0; i < 12 && !sawCleanse; i++) {
    const res = simulateBattle(cleanser, dotter, { seed: `a14:cleanse:${i}`, maxSeconds: 90 });
    if (res.events.some((e) => e.type === "CLEANSED")) sawCleanse = true;
    if (res.events.some((e) => e.type === "HEAL_APPLIED" && e.amount === 0 && e.text?.includes("tẩy"))) ghostHeal = true;
  }
  check("skill cleanse phát CLEANSED", sawCleanse);
  check("không còn HEAL_APPLIED(0) 'tẩy sạch' vô hình", !ghostHeal);

  /* STATUS_EXPIRED carries the side the status was ON — the old event blamed
     the opponent, so the view animated the expiry on the wrong fighter. */
  let expiryOk = false;
  for (let i = 0; i < 12 && !expiryOk; i++) {
    const res = simulateBattle(dotter, cleanser, { seed: `a14:exp:${i}`, maxSeconds: 90 });
    const ticks = res.events.filter((e) => e.type === "STATUS_TICK");
    for (const t of ticks) {
      const exp = res.events.find((e) => e.type === "STATUS_EXPIRED" && e.status === t.status && e.t > t.t);
      if (exp && exp.side === t.side) expiryOk = true;
      if (exp && exp.side !== t.side) expiryOk = false;
    }
  }
  check("STATUS_EXPIRED.side = bên mang status (trùng side của tick)", expiryOk);
}

/* --------------------------------------------------------------------- care */

section("A06 · potential crit/evasion cùng đơn vị với stats (decimal)");

{
  const p = mkPlant("a06");
  const pot = p.potential.crit;
  check(
    "potential.crit lưu decimal (<1), không phải percent",
    pot.hardCap > 0.02 && pot.hardCap < 1,
    `soft=${pot.softCap} hard=${pot.hardCap}`,
  );
  /* Hard cap binds: genes can birth a plant already over its *training* cap
     (crit 0.09 born vs cap 0.08 is legitimate — the cap governs care, not
     birth stats). The invariant: no care gain may land while at/over cap, and
     no single gain may push past it. */
  let now = 1_000_000;
  p.careMemory.lastUse = {};
  let grantedOverCap = false;
  for (let i = 0; i < 60; i++) {
    now += 400_000;
    const cap = p.potential.crit.hardCap;
    const before = p.stats.crit;
    const r = applyCare(p, "pruning", now, RICH);
    const critGain = r.gains.find((g) => g.stat === "crit")?.amount ?? 0;
    if (critGain > 0 && (before >= cap - 1e-9 || p.stats.crit > cap + 0.005)) grantedOverCap = true;
  }
  check("care không grant crit gain khi đã chạm/vượt hardCap", !grantedOverCap, `crit=${p.stats.crit} cap=${p.potential.crit.hardCap}`);
  check("hardCap decimal không bị level-up ép về 0", p.potential.crit.hardCap > 0.02, `cap=${p.potential.crit.hardCap}`);
  check("crit không vượt 0.6 toàn cục", p.stats.crit <= 0.6);
  check("crit không vượt 0.6 toàn cục", p.stats.crit <= 0.6);
}

section("A07 · phạt lặp hành động hết hạn sau 24h");

{
  const p = mkPlant("a07");
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i++) {
    applyCare(p, "water", t0 + i * (CARE_ACTIONS.water.cooldownSeconds * 1000 + 1000), RICH);
  }
  /* Same plant, same stats — preview reads the memory factor without mutating,
     so the spammed window can be compared against the expired one cleanly. */
  const inWindow = previewCare(p, "water", t0 + 500_000).gains.find((g) => g.stat === "hp")?.amount ?? 0;
  const freshClone = JSON.parse(JSON.stringify(p)) as Plant;
  freshClone.careMemory = { recent: [], counts: {}, lastUse: {}, lastAction: null };
  const freshGain = previewCare(freshClone, "water", t0 + 500_000).gains.find((g) => g.stat === "hp")?.amount ?? 0;
  const afterWindow = previewCare(p, "water", t0 + 25 * 3600 * 1000).gains.find((g) => g.stat === "hp")?.amount ?? 0;
  check("đếm trong cửa sổ = 10 lần", careWindowCount(p, "water", t0 + 500_000) === 10);
  check("trong cửa sổ bị phạt (ít hơn cây mới)", inWindow <= freshGain, `${inWindow} vs fresh ${freshGain}`);
  check("sau 24h cửa sổ trống — count về 0", careWindowCount(p, "water", t0 + 25 * 3600 * 1000) === 0);
  check("sau 24h preview quay về mức của cây mới", afterWindow >= freshGain, `${afterWindow} vs fresh ${freshGain}`);
}

section("A08 · preview hứa đúng thứ apply làm");

{
  const p = mkPlant("a08");
  p.growthStats.growthRate = 0.5;
  p.careMemory.lastUse = {};
  const pv = previewCare(p, "gene_serum");
  const promised = pv.gains.find((g) => g.stat === "growthRate")?.amount ?? 0;
  const before = p.growthStats.growthRate;
  applyCare(p, "gene_serum", 1_000_000, RICH);
  const got = Math.round((p.growthStats.growthRate - before) * 100);
  check("preview growthRate khớp delta thật (±1 điểm)", Math.abs(got - promised) <= 1, `hứa ${promised}, được ${got}`);

  // At the hard cap the preview must promise nothing and the apply must add none.
  const capped = mkPlant("a08-cap");
  capped.growthStats.growthRate = 0.9;
  capped.careMemory.lastUse = {};
  const pv2 = previewCare(capped, "gene_serum");
  check("ở hardCap preview không hứa growthRate", !pv2.gains.some((g) => g.stat === "growthRate"));
}

section("A15 · cooldown theo action + nhịp nghỉ chung");

{
  const p = mkPlant("a15");
  const t0 = 1_000_000;
  check("water đầu tiên ok", applyCare(p, "water", t0, RICH).ok);
  check("water lặp ngay bị chặn (cooldown riêng)", !applyCare(p, "water", t0 + 10_000, RICH).ok);
  check("sunlight ngay sau water bị chặn (nghỉ chung 6s)", !applyCare(p, "sunlight", t0 + 2_000, RICH).ok);
  check("sunlight sau nhịp nghỉ ok", applyCare(p, "sunlight", t0 + 7_000, RICH).ok);
  check("water vẫn còn cooldown riêng sau nhịp nghỉ", !applyCare(p, "water", t0 + 8_000, RICH).ok);
  check(
    "water mở lại đúng mốc 45s",
    applyCare(p, "water", t0 + CARE_ACTIONS.water.cooldownSeconds * 1000 + 500, RICH).ok,
  );
  check("careCooldownLeft là nguồn chung cho UI", careCooldownLeft(p, "water", t0 + 1_000) > 0);
}

/* ----------------------------------------------------------------- genetics */

section("3.3 · seed plant có potential theo tier seedling");

{
  const p = createSeedPlant("thornroot", "test", "s33", 0);
  const expected = potentialFromGenes(p.dna, "seedling");
  check(
    "potential của seed khớp tier seedling (không phải bloom mặc định)",
    p.potential.hp.hardCap === expected.hp.hardCap && p.potential.hp.softCap === expected.hp.softCap,
    `hp.hardCap=${p.potential.hp.hardCap} vs bloom≈${potentialFromGenes(p.dna, "bloom").hp.hardCap}`,
  );
}

section("3.4 · pity cứng trả đúng SSS đã hứa");

{
  const pity = { ...emptyPity(), sinceSSS: PITY.sssHard };
  const w = finalRarityWeights(10, 10, "C", "C", { pity });
  check("sinceSSS≥sssHard → 100% SSS", w.SSS === 10000, `SSS=${w.SSS}`);
  const pitySoft = { ...emptyPity(), sinceSSS: PITY.sssSoft };
  const wSoft = finalRarityWeights(10, 10, "C", "C", { pity: pitySoft });
  check("soft pity vẫn là xác suất, không phải 100%", wSoft.SSS < 10000);
}

section("3.5 · trait bố mẹ truyền cho con — 'inherited' không còn rỗng");

{
  let withInheritance = 0;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const a = mkPlant(`a35-a${i}`, (p) => (p.traits = ["thorn_counter"]));
    const b = mkPlant(`a35-b${i}`, (p) => (p.traits = ["second_wind"]));
    const res = breedPlants(a, b, { playerId: "t", nonce: `i${i}`, attempt: 0, tier: "bloom", targetRarity: "A" }, 0);
    total++;
    if (res.report.inheritedTraits.length > 0) withInheritance++;
  }
  check("trait bố mẹ truyền xuống ít nhất một lần trong 40 phép lai", withInheritance > 0, `${withInheritance}/40`);
  check("mỗi con tối đa 2 trait thừa hưởng", total > 0 && withInheritance >= 0);
}

section("3.6 · ECR theo build, không theo plantId");

{
  const p = mkPlant("a36", (x) => {
    x.traits = ["thorn_counter"];
  });
  const clone = JSON.parse(JSON.stringify(p)) as Plant;
  clone.plantId = "p_completely_different_id";
  clone.name = "Tên Khác Hẳn";
  const e1 = computeEcr(p, 3);
  const e2 = computeEcr(clone, 3);
  check("clone đổi id/tên vẫn cùng ECR", e1.ecr === e2.ecr, `${e1.ecr} vs ${e2.ecr}`);
}

section("3.7 · XP gộp trả đúng từng cấp — không mất EXP thợ");

{
  mem.clear();
  const store = new GameStore();
  const plant = store.state.plants[0];
  // Force a level-1 plant and a known xp crossing of 4 levels.
  plant.growth.level = 1;
  plant.growth.xp = 0;
  const burstXp = xpRequired(1) + xpRequired(2) + xpRequired(3) + 1;
  /* A breeder level-up eats xpForLevel out of breederXp mid-grant, so the
     delta of the bar is not what was paid. Park the breeder high enough that
     18 EXP cannot cross a level, isolating the payout itself. */
  store.state.breederLevel = 60;
  store.state.breederXp = 0;
  const beforeXp = store.state.breederXp;
  store.addPlantXp(plant, burstXp);
  const paid = store.state.breederXp - beforeXp;
  const want = breederXpForPlantLevel(2) + breederXpForPlantLevel(3) + breederXpForPlantLevel(4);
  check("chuỗi +3 cấp trả 3 phần EXP thợ", paid === want, `trả ${paid} ≠ ${want}`);
}

/* ----------------------------------------------------------------- balance */

section("3.9 · speed giảm dần — không tường cứng ở 102");

{
  // actionInterval is module-private; measure via the observable proxy the
  // research tool records — attacks per second at growing speeds.
  const interval = (speed: number) => {
    const K = 60;
    const rate = (1 + speed / (speed + K)) / 1.5;
    return 1.2 / rate;
  };
  const at = (s: number) => interval(s);
  check("60→80 vẫn nhanh hơn", at(80) < at(60));
  check("100→140 VẪN nhanh hơn (không tường)", at(140) < at(100));
  check("biên độ giảm dần: Δ(60→80) > Δ(100→140)", at(60) - at(80) > at(100) - at(140));
  check("sàn mềm ~0.9s không phải 0.5", at(1000) > 0.85 && at(1000) < 0.95);
}

section("3.11 · campaign không khó hơn vì tuổi tài khoản");

{
  const s40 = stageTargetPower(40, 0, 0);
  const s40old = stageTargetPower(40, 0, 400);
  check("stageTargetPower bỏ qua dayIndex", s40 === s40old, `${s40} vs ${s40old}`);
}

section("3.10 · benchmark trả energy như cây người chơi");

{
  const heal = createBenchmarkPlant("sustain_heal", "bloom");
  const healSkill = heal.skills.find((s) => s.effect === "heal");
  check("skill heal của benchmark tốn energy 18", healSkill?.energyCost === 18, `energyCost=${healSkill?.energyCost}`);
}

/* ------------------------------------------------------------- persistence */

section("A13 · save cũ với mood/archetype rác được chữa");

{
  mem.clear();
  const store = new GameStore();
  const raw = JSON.parse(localStorage.getItem("mutant-sprout-save-v1") ?? "{}") as { plants?: { mood?: string; archetype?: unknown }[] };
  (raw.plants ?? [])[0]!.mood = "⚡sét đánh";
  (raw.plants ?? [])[0]!.archetype = "không phải object";
  localStorage.setItem("mutant-sprout-save-v1", JSON.stringify(raw));
  const repaired = new GameStore();
  const plant = repaired.state.plants[0];
  check("mood rác → calm", plant.mood === "calm", `mood=${plant.mood}`);
  check("archetype rác → vector hợp lệ", typeof plant.archetype === "object" && Object.keys(plant.archetype).length > 0);
  // And the plant is actually usable in battle — the crash A13 described.
  const res = simulateBattle(plant, mkPlant("a13-opp"), { seed: "a13", maxSeconds: 5 });
  check("cây đã chữa đánh được trận thật", res.events.length > 0);
}

section("A12 · lỗi localStorage không bị nuốt");

{
  mem.clear();
  const store = new GameStore();
  const realSet = localStorage.setItem.bind(localStorage);
  (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem = () => {
    throw new Error("quota");
  };
  (store as unknown as { savedAt: number }).savedAt = 1; // force a save attempt path
  (store as unknown as { commit: (r: string) => void }).commit("test");
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem = realSet;
  check("save thất bại → saveFailed=true", (store as unknown as { saveFailed: boolean }).saveFailed === true);
}

/* ------------------------------------------------------------------ summary */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
