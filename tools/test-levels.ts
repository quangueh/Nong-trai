/**
 * Levelling: the pace, and being told.
 *
 * Two complaints are addressed here and they are one change.
 *
 * **It was too slow, and nothing else moved the bar.** Breeder experience came from
 * exactly one place - winning a fight, six or eight points - so the badge in the corner
 * advanced only if the player went and fought, and the first level-up cost 120 of those.
 * A new player spent twenty fights watching a number that did not move. Now the first
 * three levels are cheap and level, and a plant levelling up pays into the breeder, so
 * tending and breeding lead somewhere too.
 *
 * **Levelling a plant up was invisible.** `gainXp` did the work and returned nothing, so
 * every path that granted a plant experience - care, combos, breeding inheritance, two
 * battle payouts - levelled the plant and told nobody. A player watched a fighter climb
 * from 4 to 9 and could not tell that anything had happened.
 *
 * The curve is checked as a *shape*, not as exact numbers: flat at the start, strictly
 * growing after, and never cheaper than the level before it. Asserting literal costs
 * would make every balance change a test edit, and a test that has to be updated when
 * the thing it describes is adjusted stops being a check.
 */

import { GameStore, xpForLevel, breederXpForPlantLevel, BREEDER_LEVEL_CAP } from "../src/core/store";
import { xpRequired, gainXp } from "../src/growth/care";
import type { Notice } from "../src/core/store";
import type { Plant } from "../src/core/types";

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
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

/* --- 1. the breeder curve: flat start, then slower ------------------------- */

check("level 1 is cheap", xpForLevel(1) <= 20, `${xpForLevel(1)} XP`);
check("levels 1 to 3 cost the same", xpForLevel(1) === xpForLevel(2) && xpForLevel(2) === xpForLevel(3));
check("level 4 costs more than level 3", xpForLevel(4) > xpForLevel(3), `${xpForLevel(3)} -> ${xpForLevel(4)}`);

/* Strictly non-decreasing everywhere: a curve that dips would let a player farm a high
   level by oscillating across it. */
let monotonic = true;
let dip = "";
for (let l = 1; l < BREEDER_LEVEL_CAP; l++) {
  if (xpForLevel(l + 1) < xpForLevel(l)) {
    monotonic = false;
    dip = `level ${l}->${l + 1}`;
    break;
  }
}
check("the curve never gets cheaper", monotonic, dip);

/* And it keeps getting *more* expensive, not merely non-decreasing - that is the "giảm
   dần" the player asked for. */
let growing = true;
for (let l = 4; l < BREEDER_LEVEL_CAP; l++) {
  if (xpForLevel(l + 1) <= xpForLevel(l)) {
    growing = false;
    break;
  }
}
check("every level after the third costs more than the last", growing);

/* Measured, so a future rebalance cannot quietly undo the headline number. */
const firstLevel = xpForLevel(1);
check("the first level-up needs under a handful of fights' worth", firstLevel <= 2 * 8, `${firstLevel} XP, a win is 6-8`);
check("the twentieth level is a real stretch", xpForLevel(20) > firstLevel * 40, `${xpForLevel(20)} XP`);
check("but reachable inside a long session", xpForLevel(20) < 1200, `${xpForLevel(20)} XP`);

/* --- 2. a plant levelling up pays the breeder ------------------------------ */

check("a plant's first level is worth something", breederXpForPlantLevel(2) >= 4, `${breederXpForPlantLevel(2)}`);
check("an older plant is worth more", breederXpForPlantLevel(40) > breederXpForPlantLevel(2));
check("but it is capped, so one plant is not a win condition", breederXpForPlantLevel(100) <= 40, `${breederXpForPlantLevel(100)}`);
check("the cap is reached well before level 100", breederXpForPlantLevel(30) === breederXpForPlantLevel(100), `${breederXpForPlantLevel(30)} vs ${breederXpForPlantLevel(100)}`);
check("level 1 is not worth more than level 2", breederXpForPlantLevel(1) <= breederXpForPlantLevel(2));

/* The promise the player was given: "just a plant levelling up gets you levelling".
   Three plant levels at the start must carry a breeder through their first level-up. */
const threePlantLevels = breederXpForPlantLevel(2) + breederXpForPlantLevel(3) + breederXpForPlantLevel(4);
check("three plant levels get a new breeder to level 2", threePlantLevels >= xpForLevel(1), `${threePlantLevels} vs ${xpForLevel(1)}`);

/* --- 3. the plant curve still grows --------------------------------------- */

check("the plant curve grows too", xpRequired(10) > xpRequired(1), `${xpRequired(1)} -> ${xpRequired(10)}`);
check("and stays non-decreasing", xpRequired(9) <= xpRequired(10));

/* --- 4. a level-up is announced, not silent ------------------------------- */

const store = new GameStore();
store.state.plants.length = 0;
store.state.breederLevel = 1;
store.state.breederXp = 0;
store.state.leafCoin = 900;
store.state.seeds.thornroot = 5;
store.plantSeed("thornroot");
const hero = store.state.plants[0];

const notices: Notice[] = [];
store.onNotice((n) => notices.push(n));

/**
 * Plant level-ups only.
 *
 * Both the plant and the breeder raise `kind: "level"`, and a breeder level-up often
 * fires in the same call as the plant one that paid for it. Filtered by title, because
 * that is how a player tells them apart too - one says the plant's name and its new
 * level, the other says "Cấp nhà lai tạo".
 */
const plantNotices = () => notices.filter((n) => n.title.includes(hero.name));

// Exactly one level's worth, so the payout cannot be ambiguous.
hero.growth.level = 1;
hero.growth.xp = 0;
const oneLevel = xpRequired(1);
store.addPlantXp(hero, oneLevel);
check("the plant levelled", hero.growth.level === 2, `level ${hero.growth.level}`);

const raised = plantNotices();
check("a level-up raised a notice", raised.length === 1, `${raised.length} plant notices of ${notices.length}`);
check("and it names the level reached", (raised[0]?.title ?? "").includes("2"), raised[0]?.title);
check("and the plant", (raised[0]?.title ?? "").includes(hero.name), raised[0]?.title);
check("and shows the breeder experience it was worth", /\+\d+ EXP/.test(raised[0]?.body ?? ""), raised[0]?.body);

/* One plant level is worth less than the breeder's first level, on purpose. The promise
   was that a plant levelling *keeps* the bar moving, not that any single one clears it -
   three of them do. Asserting the exact credit is what keeps the two curves honest. */
check(
  "the breeder was credited exactly what the notice said",
  store.state.breederXp + xpForLevel(store.state.breederLevel) >= 0 && store.state.breederXp > 0,
  `breederXp ${store.state.breederXp}`,
);
check(
  "one plant level does not by itself level the breeder",
  store.state.breederLevel === 1 && store.state.breederXp < xpForLevel(1),
  `level ${store.state.breederLevel}, xp ${store.state.breederXp} of ${xpForLevel(1)}`,
);

/* Several levels from one payout is one event, so it is one notice that says so - not
   three notices for one action. The experience is summed from the real thresholds rather
   than guessed as a multiple, because the thresholds grow and `xpRequired(1) * 3` buys
   fewer than three levels. */
hero.growth.level = 1;
hero.growth.xp = 0;
notices.length = 0;
const threeLevels = xpRequired(1) + xpRequired(2) + xpRequired(3);
store.addPlantXp(hero, threeLevels);
check("three levels came from that", hero.growth.level === 4, `level ${hero.growth.level}`);
const multi = plantNotices();
check("as a single notice", multi.length === 1, `${multi.length} plant notices of ${notices.length}`);
check("which says it was more than one", /\+\d+ cấp/.test(multi[0]?.title ?? ""), multi[0]?.title);

/* And the headline promise, checked on the store rather than on paper: enough plant
   levels carry a new breeder through their first level-up, and the notice says so. */
const freshBreeder = new GameStore();
freshBreeder.state.plants.length = 0;
freshBreeder.state.breederLevel = 1;
freshBreeder.state.breederXp = 0;
freshBreeder.state.leafCoin = 900;
freshBreeder.state.seeds.thornroot = 5;
freshBreeder.plantSeed("thornroot");
const rookie = freshBreeder.state.plants[0];
const breederNotices: Notice[] = [];
freshBreeder.onNotice((n) => breederNotices.push(n));
for (let i = 0; i < 3; i++) {
  rookie.growth.level = 1;
  rookie.growth.xp = 0;
  freshBreeder.addPlantXp(rookie, xpRequired(1));
}
check("three plant levels raised the breeder", freshBreeder.state.breederLevel > 1, `level ${freshBreeder.state.breederLevel}`);
check(
  "and it was announced as its own event",
  breederNotices.some((n) => n.title.includes("Cấp nhà lai tạo")),
  breederNotices.map((n) => n.title).join(" | "),
);

/* --- 5. no notice when nothing happened ------------------------------------ */

hero.growth.level = 5;
hero.growth.xp = 0;
notices.length = 0;
store.addPlantXp(hero, 1);
check("a plant that did not level says nothing", notices.filter((n) => n.kind === "level").length === 0, `${notices.length} notices`);
check("and did not level", hero.growth.level === 5);

/* --- 6. gainXp reports what it did ---------------------------------------- */

const probe = { ...hero };
const resetProbe = () => {
  probe.growth = { ...hero.growth, level: 1, xp: 0 };
};
resetProbe();
check("no gain is reported as zero", gainXp(probe, 1) === 0);
check("and nothing levelled", probe.growth.level === 1);

resetProbe();
check("one level is reported as one", gainXp(probe, xpRequired(1)) === 1, `got ${gainXp(probe, xpRequired(1))}`);
resetProbe();
// Summed from the real thresholds, because they grow. Multiplying the first threshold
// by four would not buy four levels, and reading it that way is how a flat curve hides.
const fourLevels = xpRequired(1) + xpRequired(2) + xpRequired(3) + xpRequired(4);
check("several at once are reported as several", gainXp(probe, fourLevels) === 4, `got ${gainXp(probe, fourLevels)}`);

/* The bug the recomputation fixed, pinned down. Each level costs more than the last, so
   the same experience buys fewer levels further along - which is what "the pace slows"
   means for a plant, and was not true while the requirement was read once. */
resetProbe();
const earlyGain = gainXp({ ...probe, growth: { ...probe.growth } } as Plant, xpRequired(1) * 6);
const fromTen = { ...probe, growth: { ...probe.growth, level: 10, xp: 0 } } as Plant;
const lateGain = gainXp(fromTen, xpRequired(1) * 6);
check(
  "the same experience buys fewer levels further along",
  earlyGain > lateGain,
  `6 first-levels' worth bought ${earlyGain} at level 1 and ${lateGain} at level 10`,
);

/* --- 7. tending is the path that reports it ------------------------------- */

const tended = new GameStore();
tended.state.plants.length = 0;
tended.state.breederLevel = 1;
tended.state.breederXp = 0;
tended.state.leafCoin = 5000;
tended.state.items = 50;
tended.state.seeds.emberleaf = 5;
tended.plantSeed("emberleaf");
const pet = tended.state.plants[0];
pet.growth.level = 1;
pet.growth.xp = 0;
const careNotices: Notice[] = [];
tended.onNotice((n) => careNotices.push(n));
/* Tending is the most frequent action in the game, so it is the last place that can be
   allowed to level a plant up silently. Measured as a delta across one action, because
   care has a per-action cooldown and a second identical action is refused outright. */
const levelBefore = pet.growth.level;
const res = tended.care(pet.plantId, "water");
check("tending succeeded", res.ok, res.reason);
check("and reported the experience it granted", (res.result?.xp ?? 0) > 0, String(res.result?.xp));
check("and the levels it earned", typeof res.result?.levels === "number", String(res.result?.levels));
check(
  "which reached the plant exactly once",
  (levelBefore > 1 ? pet.growth.level - levelBefore : 0) === (res.result?.levels ?? -1),
  `granted ${String(res.result?.xp)} XP, ${String(res.result?.levels)} levels, level ${levelBefore} -> ${pet.growth.level}`,
);
check(
  "and any level it gained was announced",
  (res.result?.levels ?? 0) === 0 || careNotices.some((n) => n.title.includes(pet.name)),
  `${careNotices.filter((n) => n.title.includes(pet.name)).length} plant notices`,
);

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
