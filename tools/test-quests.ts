/**
 * Quest system tests — daily goals, streak, discovery milestones, rewards.
 */

import { GameStore } from "../src/core/store";
import { GOAL_POOL, MILESTONES, WEATHER_INFO, streakMultiplier, streakLabel, DAILY_GOAL_COUNT } from "../src/config/quests";
import { createGardenDay, type GardenDayState } from "../src/core/store";
import type { CareActionId } from "../src/config/careActions";
import type { SpeciesId } from "../src/config/species";
import { createSeedPlant } from "../src/genetics/genomeGenerator";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// --- storage shim ---------------------------------------------------------
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

section("1. Config sanity");
{
  check("weather covers all four states", Object.keys(WEATHER_INFO).length === 4);
  check("every weather has a name, icon and note", Object.values(WEATHER_INFO).every((w) => w.name && w.icon && w.note.length > 10));
  // Nine kinds, not four. Not a preference: the draw takes at most one goal per
  // kind, so the number of kinds is a hard ceiling on how alike a day can look.
  check("goal pool covers at least eight kinds", new Set(GOAL_POOL.map((g) => g.kind)).size >= 8, `${new Set(GOAL_POOL.map((g) => g.kind)).size} kinds`);
  check("enough templates to fill a full day several times over", GOAL_POOL.length >= DAILY_GOAL_COUNT * 3, `${GOAL_POOL.length} templates`);
  check("no two goals share a label", new Set(GOAL_POOL.map((g) => g.label)).size === GOAL_POOL.length);
  check("goal ids are unique", new Set(GOAL_POOL.map((g) => g.id)).size === GOAL_POOL.length);
  check("every goal has a target, reward and hint", GOAL_POOL.every((g) => g.target > 0 && g.hint.length > 10 && (g.reward.leafCoin || g.reward.geneCrystal || g.reward.items)));
  check("milestone ids are unique", new Set(MILESTONES.map((m) => m.id)).size === MILESTONES.length);
  check("at least 15 milestones exist", MILESTONES.length >= 15, `${MILESTONES.length}`);
  check("milestones cover collection and mastery", new Set(MILESTONES.map((m) => m.metric)).size >= 8);
  check("no milestone has a zero target", MILESTONES.every((m) => m.target > 0));
}

section("2. Streak rewards");
{
  check("day 1 has no multiplier", streakMultiplier(0) === 1 && streakMultiplier(1) === 1);
  check("streak grows the multiplier", streakMultiplier(7) > streakMultiplier(3));
  check("multiplier is capped at 2x", streakMultiplier(999) === 2);
  check("every streak has a label", [0, 1, 5, 10, 25, 100].every((s) => streakLabel(s).length > 0));
  check("label mentions the streak length", streakLabel(10).includes("10"));
}

section("3. Daily goals are generated");
const store = new GameStore();
{
  const day = store.state.gardenDay;
  check("a day is generated on first load", !!day && !!day.dayKey);
  check("goals are generated", day.goals.length > 0, `${day.goals.length} goals`);
  check("goals count matches the configured cap", day.goals.length === Math.min(DAILY_GOAL_COUNT, GOAL_POOL.length));
  check("goal ids are unique within the day", new Set(day.goals.map((g) => g.id)).size === day.goals.length);
  check("goals start at zero progress", day.goals.every((g) => g.progress === 0));
  check("goals are unclaimed initially", day.goals.every((g) => !g.claimed));
  check("every goal maps to a known template", day.goals.every((g) => GOAL_POOL.some((t) => g.id.endsWith(`-${t.id}`))));
  check("weather is one of the four", ["mist", "sun", "storm", "moon"].includes(day.weather));
}

section("4. Goals track progress from real actions");
{
  store.state.leafCoin = 50000;
  store.state.items = 300;
  store.state.geneCrystal = 50;
  for (const s of ["thornroot", "emberleaf"] as SpeciesId[]) store.buySeed(s, 4);

  // Planting advances plant goals.
  const plantGoal = store.state.gardenDay.goals.find((g) => g.kind === "plant");
  if (plantGoal) {
    store.plantSeed("thornroot");
    check("planting advances the plant goal", store.state.gardenDay.goals.find((g) => g.id === plantGoal.id)!.progress === 1);
  } else {
    check("planting advances the plant goal", true, "no plant goal today");
  }

  // Care advances care goals.
  const careGoal = store.state.gardenDay.goals.find((g) => g.kind === "care");
  if (careGoal) {
    const p = store.state.plants[0];
    for (const a of ["water", "sunlight", "fertilizer", "pruning", "music"] as CareActionId[]) {
      p.careMemory.lastAction = null;
      store.care(p.plantId, a);
    }
    const g = store.state.gardenDay.goals.find((x) => x.id === careGoal.id)!;
    check("caring advances the care goal", g.progress >= Math.min(3, g.target), `${g.progress}/${g.target}`);
  } else {
    check("caring advances the care goal", true, "no care goal today");
  }

  // Progress never exceeds the target.
  check("goal progress is capped at target", store.state.gardenDay.goals.every((g) => g.progress <= g.target));
}

section("5. Claiming rewards");
{
  const store2 = new GameStore();
  store2.state.leafCoin = 50000;
  store2.state.items = 200;
  store2.state.geneCrystal = 20;

  // Force a goal to completion, then claim it.
  const goal = store2.state.gardenDay.goals[0];
  goal.progress = goal.target;
  const coins = store2.state.leafCoin;
  const items = store2.state.items;
  const crystals = store2.state.geneCrystal;

  const res = store2.claimGoal(goal.id);
  check("an unfinished-then-finished goal can be claimed", res.ok, res.reason);
  check("coin reward is credited", goal.reward.leafCoin ? store2.state.leafCoin === coins + goal.reward.leafCoin : true);
  check("item reward is credited", goal.reward.items ? store2.state.items === items + goal.reward.items : true);
  check("crystal reward is credited", goal.reward.geneCrystal ? store2.state.geneCrystal === crystals + goal.reward.geneCrystal : true);
  check("the goal is marked claimed", store2.state.gardenDay.goals.find((g) => g.id === goal.id)!.claimed);

  const again = store2.claimGoal(goal.id);
  check("a goal cannot be claimed twice", !again.ok, again.reason);
  check("no duplicate coin on re-claim", store2.state.leafCoin === coins + (goal.reward.leafCoin ?? 0));

  // Claiming an unknown goal is rejected.
  check("unknown goal is rejected", !store2.claimGoal("nope").ok);
}

section("6. Discovery milestones");
{
  const store3 = new GameStore();
  const milestones = store3.discoveryMilestones();
  check("milestones are exposed", milestones.length >= 15, `${milestones.length}`);
  check("milestones have progress and target", milestones.every((m) => m.progress >= 0 && m.target > 0));
  check("no milestone is claimed at start", milestones.every((m) => !m.claimed));
  check("plants-owned metric reflects the nursery", (() => {
    const m = milestones.find((x) => x.id === "plants-10");
    return m ? m.progress === store3.state.plants.length : false;
  })(), `${store3.state.plants.length} plants`);

  // Force completion and claim.
  const target = milestones.find((m) => m.id === "plant-1")!;
  check("plant-1 is complete with one plant in the nursery", target.progress >= 1, `${target.progress}/${target.target}`);
  const coins = store3.state.leafCoin;
  const res = store3.claimDiscovery("plant-1");
  check("a completed milestone can be claimed", res.ok, res.reason);
  check("milestone reward is credited", store3.state.leafCoin === coins + (target.reward.leafCoin ?? 0));
  check("a milestone cannot be claimed twice", !store3.claimDiscovery("plant-1").ok);
  check("an incomplete milestone is rejected", !store3.claimDiscovery("rarity-s").ok);
  check("an unknown milestone is rejected", !store3.claimDiscovery("khong-ton-tai").ok);
}

section("7. Milestones react to gameplay");
{
  const store4 = new GameStore();
  store4.state.leafCoin = 200000;
  store4.state.items = 300;
  for (const s of ["thornroot", "emberleaf", "voltvine"] as SpeciesId[]) store4.buySeed(s, 2);
  for (let i = 0; i < 4; i++) store4.plantSeed(["thornroot", "emberleaf", "voltvine"][i % 3] as SpeciesId);
  for (const p of store4.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
  }
  const ms = () => store4.discoveryMilestones();
  check("species milestone tracks distinct species", (ms().find((m) => m.id === "species-3")?.progress ?? 0) >= 3, `${ms().find((m) => m.id === "species-3")?.progress}`);
  check("element milestone tracks discovered elements", (ms().find((m) => m.id === "element-4")?.progress ?? 0) >= 1);

  // Breeding needs nursery space; capacity is enforced by design.
  store4.state.nurseryCap = 24;
store4.state.leafCoin = 10_000_000;
  const br = store4.breed(store4.state.plants[0].plantId, store4.state.plants[1].plantId);
  check("breeding succeeds once there is room", br.ok, br.reason);
  check("breed milestone counts a breed", (ms().find((m) => m.id === "breed-1")?.progress ?? 0) >= 1);
  check("generation milestone reacts to breeding", (ms().find((m) => m.id === "gen-3")?.progress ?? 0) >= 2, `đời ${ms().find((m) => m.id === "gen-3")?.progress}`);

  // A full nursery must refuse breeding rather than silently overflow.
  const tight = new GameStore();
  tight.state.leafCoin = 500000;
  tight.state.nurseryCap = 2;
  const extra = createSeedPlant("emberleaf", tight.state.playerId, "cap-test", Date.now());
  extra.growth.stage = "mature";
  extra.growth.stageReadyAt = Date.now();
  tight.state.plants = [tight.state.plants[0], extra];
  check("a full nursery blocks breeding", !tight.breed(tight.state.plants[0].plantId, extra.plantId).ok);
}

section("8. Persistence");
{
  const store5 = new GameStore();
  store5.state.leafCoin = 7777;
  store5.save();
  const reloaded = new GameStore();
  check("day state survives a reload", reloaded.state.gardenDay.dayKey === store5.state.gardenDay.dayKey);
  check("goal progress survives a reload", JSON.stringify(reloaded.state.gardenDay.goals) === JSON.stringify(store5.state.gardenDay.goals));
  check("claimed milestones survive a reload", JSON.stringify(reloaded.state.discovery.claimed) === JSON.stringify(store5.state.discovery.claimed));
}

section("8. Goals are never alike");
{
  // The original defect: "Gieo một hạt mới" and "Gieo ba hạt" on the same day.
  // Two rows differing by a digit. Checked by walking a month of real day
  // transitions rather than by counting the pool, because the failure was in the
  // draw and no pool-shape assertion could have caught it.
  const LEVEL = 20;
  const DAYS = 60;
  let previous: GardenDayState | undefined;
  let repeatedKinds = 0;
  let shortDays = 0;
  let backToBack = 0;
  const templateSeen = new Map<string, number>();

  for (let d = 0; d < DAYS; d++) {
    const day = createGardenDay(`2026-01-${String(d + 1).padStart(2, "0")}`, previous, LEVEL, "player-1");
    const kinds = day.goals.map((g) => g.kind);
    if (new Set(kinds).size !== kinds.length) repeatedKinds++;
    if (day.goals.length < DAILY_GOAL_COUNT) shortDays++;

    const templates = day.goals.map((g) => g.id.split("-").slice(1).join("-"));
    const prevTemplates = previous?.goals.map((g) => g.id.split("-").slice(1).join("-")) ?? [];
    if (templates.some((t) => prevTemplates.includes(t))) backToBack++;
    for (const t of templates) templateSeen.set(t, (templateSeen.get(t) ?? 0) + 1);

    previous = day;
  }

  check("no day deals two goals of the same kind", repeatedKinds === 0, `${repeatedKinds}/${DAYS} days`);
  check("every day offers the full set", shortDays === 0, `${shortDays} short days`);
  check("nothing repeats the next day", backToBack === 0, `${backToBack} back-to-back`);
  // Rotation health: a cooldown bug that bars too much would leave most of the
  // pool unused, which shows up as far fewer distinct templates than could fit.
  check(
    "the rotation reaches past the first few templates",
    templateSeen.size >= 12,
    `${templateSeen.size} distinct over ${DAYS} days`,
  );
  check(
    "no template dominates",
    Math.max(...templateSeen.values()) <= DAYS / 3,
    `most-seen ${Math.max(...templateSeen.values())} of ${DAYS}`,
  );

  // Low level: the pool must thin out without collapsing to a single goal.
  let lowDay: GardenDayState | undefined;
  for (let d = 0; d < 14; d++) {
    lowDay = createGardenDay(`2026-02-${String(d + 1).padStart(2, "0")}`, lowDay, 1, "player-1");
  }
  check("a level-1 player still gets a full day", (lowDay?.goals.length ?? 0) >= DAILY_GOAL_COUNT, `${lowDay?.goals.length}`);
  const lowKinds = lowDay?.goals.map((g) => g.kind) ?? [];
  check("and the goals are still distinct kinds", new Set(lowKinds).size === lowKinds.length);
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
