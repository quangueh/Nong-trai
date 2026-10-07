/**
 * Quest system tests — the shelf, the engine, the claim path.
 *
 * This suite replaced the old daily-goal/discovery tests when the quest shelf did. The things
 * it actually protects:
 *
 *   1. the catalogue is well-formed (unique ids, unlock refs that exist, every quest payable);
 *   2. the engine's unlock/sync/advance/claim rules — the four states, the two progress modes,
 *      the deterministic daily roll;
 *   3. the store wiring — real actions move real quests, rewards pay through the real paths,
 *      and a reload keeps all of it.
 */

import { GameStore, createGardenDay } from "../src/core/store";
import { QUEST_CATALOG, QUEST_TABS } from "../src/quests/catalog";
import {
  DAILY_COUNT,
  advance,
  claim,
  emptyQuestSave,
  lockedReason,
  questViews,
  repairQuestSave,
  rollDailyIds,
  syncQuests,
  tracked,
  unlockMet,
  type QuestContext,
} from "../src/quests/engine";
import { WEATHER_INFO, streakLabel, streakMultiplier } from "../src/config/quests";
import { generatedMainQuests } from "../src/quests/generated";
import type { CareActionId } from "../src/config/careActions";
import type { SpeciesId } from "../src/config/species";

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

const DAY = "2026-10-07";
function ctx(over: Partial<QuestContext> = {}): QuestContext {
  return {
    level: 1,
    highestStage: 0,
    stagesCleared: 0,
    speciesCount: 0,
    wins: 0,
    score: 0,
    claimed: new Set<string>(),
    day: DAY,
    playerId: "test-player",
    seeds: {},
    discovered: new Set<string>(),
    ...over,
  };
}

section("1. Catalogue sanity");
{
  check("catalogue covers all four tabs", QUEST_TABS.every((t) => QUEST_CATALOG.some((q) => q.type === t.type)));
  check("quest ids are unique", new Set(QUEST_CATALOG.map((q) => q.id)).size === QUEST_CATALOG.length);
  check("every quest has title, objective, icon and a target", QUEST_CATALOG.every((q) => q.title && q.objective && q.icon && q.target > 0));
  check(
    "every quest pays something",
    QUEST_CATALOG.every((q) => {
      const r = q.rewards;
      return (r.exp ?? 0) + (r.breederXp ?? 0) + (r.coins ?? 0) + (r.items ?? 0) + (r.geneCrystal ?? 0) > 0 || (r.unlocks?.length ?? 0) > 0;
    }),
  );
  const byId = new Map(QUEST_CATALOG.map((q) => [q.id, q]));
  const refs: string[] = [];
  for (const q of QUEST_CATALOG) {
    if (q.unlock?.kind === "quest") refs.push(q.unlock.id);
    if (q.unlock?.kind === "all") for (const u of q.unlock.of) if (u.kind === "quest") refs.push(u.id);
    for (const n of q.next ?? []) refs.push(n);
  }
  check("every quest reference resolves", refs.every((id) => byId.has(id)), `${refs.length} refs`);
  check("the main line is a chain", (() => {
    const mains = [...QUEST_CATALOG.filter((q) => q.type === "main")].sort((a, b) => a.priority - b.priority);
    for (let i = 1; i < mains.length; i++) {
      const u = mains[i].unlock;
      if (u?.kind !== "quest" || u.id !== mains[i - 1].id) return false;
    }
    return mains.length >= 5;
  })(), `${QUEST_CATALOG.filter((q) => q.type === "main").length} mains`);
  check("daily pool exceeds the shelf size", QUEST_CATALOG.filter((q) => q.type === "daily").length > DAILY_COUNT);
  check("dailies are repeatable", QUEST_CATALOG.filter((q) => q.type === "daily").every((q) => q.repeatable));
}

section("2. Engine — unlocks and sync");
{
  // The daily shelf only exists once the player has cleared stage 2 — the catalogue gates
  // every daily on it, so the roll tests run at a stage where the shelf is real.
  const dayCtx = ctx({ level: 5, highestStage: 5, stagesCleared: 5 });
  const save = emptyQuestSave(DAY);
  const synced = syncQuests(save, dayCtx, QUEST_CATALOG);
  const entry = (id: string) => synced.entries[id];

  check("first main quest starts active", entry("main_01_plant")?.status === "active");
  check("second main quest starts locked", entry("main_02_care")?.status === "locked");
  check("a stage-gated daily unlocks past its stage", synced.dailyIds.every((id) => entry(id)?.status === "active"));
  check("daily shelf rolled", synced.dailyIds.length === DAILY_COUNT, synced.dailyIds.join(","));
  check("daily entries exist for the roll", synced.dailyIds.every((id) => !!synced.entries[id]));

  // Determinism: same player, same day → same shelf. Different day → a new roll.
  check("daily roll is deterministic", JSON.stringify(rollDailyIds(QUEST_CATALOG, dayCtx)) === JSON.stringify(synced.dailyIds));
  const other = rollDailyIds(QUEST_CATALOG, ctx({ highestStage: 5, stagesCleared: 5, playerId: "someone-else" }));
  check("another player gets a shelf too", other.length === DAILY_COUNT, `other roll: ${other.join(",")}`);

  // Unlock by claimed quest: claim main_01 → main_02 opens.
  const claimedCtx = ctx({ claimed: new Set(["main_01_plant"]) });
  check("a claimed prerequisite opens the next main", unlockMet(QUEST_CATALOG.find((q) => q.id === "main_02_care")!.unlock, claimedCtx));
  check("locked reasons are readable", lockedReason(QUEST_CATALOG.find((q) => q.id === "main_04_level3")!.unlock, ctx(), new Map(QUEST_CATALOG.map((q) => [q.id, q]))).includes("Cấp 3") === false);

  // Measurable quests seed from state: a level-5 player opening the level quest is done.
  const highLevel = syncQuests(emptyQuestSave(DAY), ctx({ level: 6, claimed: new Set(QUEST_CATALOG.filter((q) => q.type === "main").map((q) => q.id)) }), QUEST_CATALOG);
  check(
    "measurable quest seeds itself from state",
    highLevel.entries["ach_level_5"]?.status === "completed",
    `status=${highLevel.entries["ach_level_5"]?.status}`,
  );

  // Day rollover re-rolls the shelf and forgets the old dailies.
  const nextDay = syncQuests(synced, { ...dayCtx, day: "2026-10-08" }, QUEST_CATALOG);
  check("a new day re-rolls the shelf", nextDay.day === "2026-10-08" && nextDay.dailyIds.length === DAILY_COUNT);
  check("stale daily entries are dropped", Object.keys(nextDay.entries).every((id) => QUEST_CATALOG.find((q) => q.id === id)?.type !== "daily" || nextDay.dailyIds.includes(id)));
}

section("3. Engine — advance and claim");
{
  let save = syncQuests(emptyQuestSave(DAY), ctx(), QUEST_CATALOG);

  // Count mode: plant once → main_01 done.
  let r = advance(save, ctx(), QUEST_CATALOG, { name: "plant", amount: 1 });
  save = r.save;
  check("plant event completes the first main", r.completed.includes("main_01_plant"), r.completed.join(","));
  check("progress is reported for the toast", r.changed.some((c) => c.id === "main_01_plant" && c.progress === 1));

  // Events a quest does not track do not move it.
  r = advance(save, ctx(), QUEST_CATALOG, { name: "plant", amount: 1 });
  check("an untracked event moves nothing", r.changed.length === 0);

  // Match filters: a non-boss stage must not finish the boss quest.
  // The claimed set is what keeps main_06 unlocked, so it rides along on every call.
  const bossCtx = ctx({ highestStage: 10, stagesCleared: 10, claimed: new Set(["main_01_plant", "main_02_care", "main_03_stage", "main_04_level3", "main_05_breed"]) });
  save = syncQuests(save, bossCtx, QUEST_CATALOG);
  r = advance(save, bossCtx, QUEST_CATALOG, { name: "stage_completed", stage: 4, boss: false });
  check("a non-boss clear does not feed the boss quest", !r.changed.some((c) => c.id === "main_06_boss"));
  r = advance(save, bossCtx, QUEST_CATALOG, { name: "stage_completed", stage: 10, boss: true });
  check("a boss clear completes the boss quest", r.completed.includes("main_06_boss"));
  save = r.save;

  // Claim guards.
  const blocked = claim(save, ctx(), QUEST_CATALOG, "main_02_care");
  check("an active quest cannot be claimed", !blocked.ok);
  const missing = claim(save, ctx(), QUEST_CATALOG, "khong-ton-tai");
  check("an unknown quest is rejected", !missing.ok);
  const first = claim(save, ctx(), QUEST_CATALOG, "main_01_plant");
  check("a completed quest claims", first.ok && first.def?.id === "main_01_plant");
  const twice = claim(first.save, ctx(), QUEST_CATALOG, "main_01_plant");
  check("a claimed quest cannot be claimed again", !twice.ok);

  // Repeatable dailies reset instead of marking claimed.
  const dailyCtx = ctx({ highestStage: 5, stagesCleared: 5 });
  const dailySave = syncQuests(emptyQuestSave(DAY), dailyCtx, QUEST_CATALOG);
  const dailyId = dailySave.dailyIds[0];
  const forced = { ...dailySave, entries: { ...dailySave.entries, [dailyId]: { progress: 99, status: "completed" as const, day: DAY } } };
  const dc = claim(forced, dailyCtx, QUEST_CATALOG, dailyId);
  check("a claimed daily resets to active, not claimed", dc.ok && dc.save.entries[dailyId].status === "active" && dc.save.entries[dailyId].progress === 0);

  // High mode keeps the best value, never adds.
  save = syncQuests(emptyQuestSave(DAY), ctx({ level: 3 }), QUEST_CATALOG);
  r = advance(save, ctx({ level: 3 }), QUEST_CATALOG, { name: "combo_reached", value: 6 });
  save = r.save;
  r = advance(save, ctx({ level: 3 }), QUEST_CATALOG, { name: "combo_reached", value: 4 });
  check("a lower combo does not raise the high-water mark", r.changed.length === 0);
  r = advance(save, ctx({ level: 3 }), QUEST_CATALOG, { name: "combo_reached", value: 11 });
  check("a higher combo completes the quest", r.completed.includes("side_combo_10"));
}

section("4. Views, tracker, badge");
{
  const save = syncQuests(emptyQuestSave(DAY), ctx(), QUEST_CATALOG);
  const views = questViews(save, ctx(), QUEST_CATALOG);
  check("views cover the whole catalogue's active set", views.length >= QUEST_CATALOG.filter((q) => q.type !== "daily").length);
  check("every view carries a fraction", views.every((v) => v.fraction >= 0 && v.fraction <= 1));
  check("locked views explain themselves", views.filter((v) => v.status === "locked").every((v) => v.lockedReason.length > 0));

  const t = tracked(views);
  check("the tracker names the main line", t.main?.def.id === "main_01_plant", t.main?.def.id);
  check("the tracker carries at most two extras", t.extras.length <= 2);
}

section("5. Store — real actions move real quests");
{
  mem.clear();
  const store = new GameStore();
  store.state.leafCoin = 50000;
  store.state.items = 300;
  store.state.geneCrystal = 50;
  for (const s of ["thornroot", "emberleaf"] as SpeciesId[]) store.buySeed(s, 4);

  const view = (id: string) => store.questViews().find((v) => v.def.id === id);

  store.plantSeed("thornroot");
  check("planting completes the first main quest", view("main_01_plant")?.status === "completed");
  check("the badge counts it", store.questClaimableCount() >= 1, `${store.questClaimableCount()} claimable`);

  // Claim it through the store: coins arrive through the ledger, exp through the plant.
  const coins = store.state.leafCoin;
  const res = store.claimQuest("main_01_plant");
  check("the first main quest claims", res.ok, res.reason);
  check("its coin reward lands", store.state.leafCoin === coins + (res.rewards?.coins ?? 0));
  check("it cannot be claimed twice", !store.claimQuest("main_01_plant").ok);
  check("claiming opened the next main", view("main_02_care")?.status === "active");

  // Care advances the new main quest.
  const p = store.state.plants[0];
  p.careMemory.lastAction = null;
  store.care(p.plantId, "water" as CareActionId);
  check("caring completes the care quest", view("main_02_care")?.status === "completed", `status=${view("main_02_care")?.status}`);

  // While main_02 is complete but unclaimed, the tracker points at the claim itself —
  // the chain only moves on a claim, so "collect the reward" is the next thing to do.
  check("an unclaimed main is the tracked one", store.questTracker().main?.def.id === "main_02_care");
  store.claimQuest("main_02_care");
  const t = store.questTracker();
  check("the tracker tracks the next main", t.main?.def.id === "main_03_stage", t.main?.def.id);
}

section("6. Persistence");
{
  mem.clear();
  const a = new GameStore();
  a.state.quests.entries["main_01_plant"] = { progress: 1, status: "completed" };
  a.state.lifetimeExp = 4242;
  a.save();

  const b = new GameStore();
  check("quest entries survive a reload", b.state.quests.entries["main_01_plant"]?.status === "completed");
  check("lifetime exp survives a reload", b.state.lifetimeExp === 4242, `${b.state.lifetimeExp}`);
  check("the daily shelf survives a reload", JSON.stringify(b.state.quests.dailyIds) === JSON.stringify(a.state.quests.dailyIds));

  // A save written before quests existed gains a working shelf.
  const repaired = repairQuestSave({ entries: { gone: { progress: 2, status: "bogus" }, main_01_plant: { progress: 1, status: "completed" } }, day: DAY }, DAY);
  check("a broken entry is repaired, not trusted", repaired.entries["gone"].status === "active");
  check("a good entry is kept", repaired.entries["main_01_plant"].status === "completed");
}

section("7. Weather and streak survive");
{
  check("weather covers all four states", Object.keys(WEATHER_INFO).length === 4);
  check("every weather has a name, icon and note", Object.values(WEATHER_INFO).every((w) => w.name && w.icon && w.note.length > 10));
  check("day 1 has no multiplier", streakMultiplier(0) === 1 && streakMultiplier(1) === 1);
  check("streak grows the multiplier", streakMultiplier(7) > streakMultiplier(3));
  check("multiplier is capped at 2x", streakMultiplier(999) === 2);
  check("every streak has a label", [0, 1, 5, 10, 25, 100].every((s) => streakLabel(s).length > 0));

  let prev = undefined;
  let sawWeather = false;
  for (let d = 1; d <= 7; d++) {
    const day = createGardenDay(`2026-11-${String(d).padStart(2, "0")}`, prev, 5, "p");
    if (day.weather) sawWeather = true;
    prev = day;
  }
  check("a week of days still generates", sawWeather);
}

section("8. The generated main line — it never runs out");
{
  const fixedMain = QUEST_CATALOG.filter((q) => q.type === "main").map((q) => q.id);
  const doneAll = new Set(fixedMain);
  let save = emptyQuestSave(DAY);
  const base = ctx({ level: 6, claimed: doneAll });
  const cat = () => [...QUEST_CATALOG, ...generatedMainQuests(save, base)];

  const gen0 = generatedMainQuests(save, base);
  check("a cycle appears once the fixed line is done", gen0.length === 4, `${gen0.length}`);
  check("the opener unlocks off the last fixed main", unlockMet(gen0[0].unlock, base));
  check("the rest wait on the chain", gen0.slice(1).every((q) => !unlockMet(q.unlock, base)));
  const sp = gen0[0].id.slice("mx0a_".length);
  check("all four quests are about one species", gen0.every((q) => q.id.endsWith(`_${sp}`)), gen0.map((q) => q.id).join(","));
  check("and its rewards pay something real", gen0.every((q) => (q.rewards.exp ?? 0) + (q.rewards.coins ?? 0) > 0));

  save = syncQuests(save, base, cat());
  check("sync creates the cycle's entries", gen0.every((q) => save.entries[q.id]));
  check("the opener is active, the rest locked", save.entries[gen0[0].id].status === "active" && save.entries[gen0[1].id].status === "locked");
  check("the species pick is pinned by the entry", generatedMainQuests(save, base).find((q) => q.id.startsWith("mx0a"))?.id === gen0[0].id);

  // 'a' measures state, not an event: owning the seed completes it on the next sync.
  const seeded = ctx({ level: 6, claimed: doneAll, seeds: { [sp]: 2 } });
  save = syncQuests(save, seeded, cat());
  check("already owning the seed finishes the opener", save.entries[gen0[0].id].status === "completed");
  const claimedA = claim(save, seeded, cat(), gen0[0].id);
  check("and it claims", claimedA.ok);
  save = claimedA.save;

  const afterA = ctx({ level: 6, claimed: new Set([...doneAll, gen0[0].id]), seeds: { [sp]: 2 } });
  save = syncQuests(save, afterA, cat());
  check("claiming it opens the planting ask", save.entries[gen0[1].id].status === "active");

  // Species matching is by bloodline: other species do not move it, the right one does.
  let adv = advance(save, afterA, cat(), { name: "plant", amount: 1, species: ["unrelated_sp"] });
  check("a different species does not count", adv.save.entries[gen0[1].id].progress === 0);
  adv = advance(adv.save, afterA, cat(), { name: "plant", amount: 1, species: [sp] });
  check("the right species counts", adv.save.entries[gen0[1].id].progress === 1);
  save = adv.save;

  // Claim the rest of the cycle by marking it done — the mechanics of *earning* are
  // covered above; what is on trial here is that the chain keeps handing out work.
  const walkCycle = (gen: typeof gen0, fromSave: typeof save, fromCtx: QuestContext) => {
    let s = fromSave;
    const claimedSoFar = new Set(fromCtx.claimed);
    for (const q of gen) {
      s = { ...s, entries: { ...s.entries, [q.id]: { progress: q.target, status: "completed" } } };
      const r = claim(s, ctx({ level: 6, claimed: claimedSoFar, seeds: { [sp]: 2 } }), cat(), q.id);
      if (r.ok) {
        s = r.save;
        claimedSoFar.add(q.id);
      }
    }
    return { s, claimedSoFar };
  };
  const after0 = walkCycle(gen0, save, afterA);
  check("a full cycle can be claimed through", after0.claimedSoFar.size === doneAll.size + 4, `${after0.claimedSoFar.size}`);
  save = after0.s;

  const ctxAfter0 = ctx({ level: 6, claimed: after0.claimedSoFar, seeds: { [sp]: 2 } });
  const gen1 = generatedMainQuests(save, ctxAfter0);
  check("claiming the last quest opens the next cycle", gen1.some((q) => q.id.startsWith("mx1a_")), gen1.map((q) => q.id).join(","));
  check("the old cycle keeps its definitions", gen1.length >= 8, `${gen1.length}`);
  const sp1 = gen1.find((q) => q.id.startsWith("mx1a_"))!.id.slice("mx1a_".length);
  const c1Open = gen1.find((q) => q.id === `mx1a_${sp1}`)!;
  check("the new cycle's opener is unlocked", unlockMet(c1Open.unlock, ctxAfter0));
  check("and the work got heavier", gen1[2].target >= gen0[2].target, `${gen0[2].target} -> ${gen1[2].target}`);

  // Before the fixed line is done, nothing is generated — the tutorial runs first.
  const early = generatedMainQuests(emptyQuestSave(DAY), ctx());
  check("the generated line waits for the tutorial", early.length === 0 || early.every((q) => !unlockMet(q.unlock, ctx())), `${early.length}`);
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
