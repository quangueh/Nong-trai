/**
 * Check-in (điểm danh) + the hired gardener — the daily-habit mechanics.
 *
 * What is covered, and why it matters:
 *  - the cycle math (day 7/14/21/30 are the milestone chests, day 31 wraps);
 *  - the streak rules (claim → +1, miss a day → back to 1, never twice a day);
 *  - the gifts (deterministic per player-day, bands scale with the streak,
 *    milestones pay seeds and the rarer currencies);
 *  - the gardener (tends for free while the buff runs, respects cooldowns and
 *    battle locks, stops at expiry, stacks, and works retroactively after an
 *    app close — the whole point of paying for fifteen minutes).
 */

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

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 10, 9); // a fixed morning — far from any day edge

import { GameStore, dayKey } from "../src/core/store";
import { dayInCycle, isMilestone, nextMilestone, giftFor, AUTO_CARE_MS, AUTO_CARE_MINUTES } from "../src/core/checkin";
import { SPECIES_BY_ID } from "../src/config/species";
import { careCooldownLeft } from "../src/growth/care";
import { applyCare } from "../src/growth/care";

/* --- 1. the cycle math ---------------------------------------------------- */

check("day 1 of a streak is cycle day 1", dayInCycle(1) === 1);
check("day 30 is cycle day 30", dayInCycle(30) === 30);
check("day 31 starts the next cycle over", dayInCycle(31) === 1);
check("day 45 is cycle day 15", dayInCycle(45) === 15);
check("milestones are 7/14/21/30", isMilestone(7) && isMilestone(14) && isMilestone(21) && isMilestone(30) && !isMilestone(8) && !isMilestone(1));
check("next milestone after 7 is 14", nextMilestone(7) === 14);
check("nothing comes after 30 inside the cycle", nextMilestone(30) === null);

/* --- 2. the gift is deterministic and scales ------------------------------- */

{
  const g1 = giftFor("pl_a", "2026-06-10", 3);
  const g2 = giftFor("pl_a", "2026-06-10", 3);
  check("the same player-day rolls the same gift", JSON.stringify(g1.lines) === JSON.stringify(g2.lines));
  check("every gift opens with the gardener", g1.lines[0].kind === "autocare" && g1.lines[0].amount === AUTO_CARE_MINUTES);
  const g7 = giftFor("pl_a", "2026-06-16", 7);
  check("day 7 is a milestone", g7.milestone === true);
  check("day 7 pays seeds", g7.lines.some((l) => l.kind === "seed" && l.species && SPECIES_BY_ID[l.species]));
  const g30 = giftFor("pl_a", "2026-07-09", 30);
  check("day 30 pays the most of the cycle", g30.milestone === true && g30.lines.filter((l) => l.kind === "seed").length === 3);
  const leaf3 = g1.lines.find((l) => l.currency === "leafCoin")!.amount;
  const leaf30 = g30.lines.find((l) => l.currency === "leafCoin")!.amount;
  check("the day-30 chest dwarfs an early day", leaf30 > leaf3 * 10, `${leaf3} vs ${leaf30}`);
  check("seed gifts reference real species", g7.lines.filter((l) => l.kind === "seed").every((l) => SPECIES_BY_ID[l.species!]));
}

/* --- 3. the streak -------------------------------------------------------- */

{
  mem.clear(); // GameStore reads the same slot — isolate the streak section
  const store = new GameStore();
  const s1 = store.checkInStatus(T0);
  check("a fresh book is unclaimed", !s1.claimed && s1.claimStreak === 1);

  const c1 = store.claimCheckIn(T0);
  check("the first claim lands", c1.ok && c1.gift?.streak === 1);
  check("claiming twice in a day is refused", !store.claimCheckIn(T0 + 60_000).ok);
  check("the buff arrives with the claim", store.autoCareLeft(T0 + 60_000) >= AUTO_CARE_MS - 60_000, `${store.autoCareLeft(T0 + 60_000)}ms left`);

  const c2 = store.claimCheckIn(T0 + DAY);
  check("the next day continues the streak", c2.ok && c2.gift?.streak === 2);
  const c7pre = store.claimCheckIn(T0 + 2 * DAY);
  store.state.checkIn.streak = 6; // fast-forward: pretend six days ran
  store.state.checkIn.lastDay = ""; // and today is open
  const c7 = store.claimCheckIn(T0 + 3 * DAY);
  // lastDay was wiped to "" with streak 6 → yesterday-chain broken → streak resets to 1, not 7.
  check("a broken lastDay restarts the streak at 1", c7.gift?.streak === 1, `streak=${c7.gift?.streak}`);

  // Walk six consecutive days to reach a real day-7 milestone.
  mem.clear();
  const store2 = new GameStore();
  let milestoneGift = null as null | { milestone: boolean; streak: number };
  for (let d = 0; d < 7; d++) {
    const r = store2.claimCheckIn(T0 + d * DAY);
    if (d === 6) milestoneGift = r.gift ?? null;
  }
  check("seven consecutive days reach the milestone", milestoneGift?.milestone === true && milestoneGift.streak === 7, JSON.stringify(milestoneGift));
  check("best streak is remembered", store2.state.checkIn.best === 7);
  store2.claimCheckIn(T0 + 7 * DAY + DAY + DAY); // skip a day: two days later
  check("a missed day resets the streak", store2.state.checkIn.streak === 1, `streak=${store2.state.checkIn.streak}`);
  check("the total count survives the reset", store2.state.checkIn.total === 8);
}

/* ------------------------------------------------------------------ */
/* The day boundary                                                     */
/* ------------------------------------------------------------------ */
{
  // "Hôm nay" means the LOCAL calendar day. The regression this guards:
  // dayKey used to read the UTC date, so a VN player (UTC+7) watched the day
  // flip at 7am — two claims ten minutes apart counted as consecutive days,
  // and a UI computing local midnight previewed a different gift than the
  // claim paid. Both are impossible once the key is the local date.
  const late = new Date(2026, 5, 10, 23, 58).getTime();
  const early = new Date(2026, 5, 11, 0, 2).getTime();
  check("local midnight flips the day", dayKey(late) !== dayKey(early), `${dayKey(late)} vs ${dayKey(early)}`);
  // 06:58 and 07:02 the same morning: UTC would split these into two days.
  const before7 = new Date(2026, 5, 11, 6, 58).getTime();
  const after7 = new Date(2026, 5, 11, 7, 2).getTime();
  check("7am is not a day boundary", dayKey(before7) === dayKey(after7));
}

/* --- 4. the gardener ------------------------------------------------------ */

{
  mem.clear(); // every GameStore loads the same slot — isolate the gardener cases
  const store = new GameStore();
  const plant = store.state.plants[0];
  check("no buff means no tending", store.autoCareTick(T0) === 0);

  store.grantAutoCare(AUTO_CARE_MS, T0);
  check("the buff is on the clock", store.autoCareLeft(T0) === AUTO_CARE_MS);

  // Water is tried first on a fresh plant — one tick, one action.
  const did1 = store.autoCareTick(T0 + 1000);
  check("a tick tends one action per plant", did1 === 1, `${did1}`);
  check("the plant remembers the action", !!plant.careMemory.lastAction);

  // Immediate re-tick: every action is on cooldown or shared rest → nothing.
  const did2 = store.autoCareTick(T0 + 1001);
  check("cooldowns still bind the gardener", did2 === 0, `${did2}`);

  // Twenty seconds later the rotation finds the next ready action.
  const did3 = store.autoCareTick(T0 + 20_000);
  check("the rotation finds the next ready action", did3 === 1, `${did3}`);

  // The wallet is untouched: the gardener brings their own supplies.
  check("auto-care is free of resources", store.state.items === 30 && store.state.leafCoin === 1200, `items=${store.state.items} leaf=${store.state.leafCoin}`);

  // Past the expiry the gardener goes home.
  check("expiry stops the gardener", store.autoCareTick(T0 + AUTO_CARE_MS + 1) === 0);

  // Battle-locked plants are untouchable.
  mem.clear();
  const store3 = new GameStore();
  store3.state.plants[0].locks.battle = true;
  store3.grantAutoCare(AUTO_CARE_MS, T0);
  check("a fighter mid-battle is skipped", store3.autoCareTick(T0 + 1000) === 0);

  // Stacking: a second grant extends, never truncates.
  mem.clear();
  const store4 = new GameStore();
  store4.grantAutoCare(10 * 60 * 1000, T0);
  store4.grantAutoCare(10 * 60 * 1000, T0 + 5 * 60 * 1000);
  check("grants stack on the remaining time", store4.autoCareLeft(T0 + 5 * 60 * 1000) === 15 * 60 * 1000, `${store4.autoCareLeft(T0 + 5 * 60 * 1000)}`);
}

/* --- 5. offline catch-up -------------------------------------------------- */

{
  mem.clear();
  const store = new GameStore();
  const plant = store.state.plants[0];
  store.grantAutoCare(AUTO_CARE_MS, T0);
  // The app was closed for ten minutes of the buff — replay the missed rounds.
  const did = store.autoCareCatchUp(T0, T0 + 10 * 60 * 1000);
  check("the gardener worked while the app was closed", did >= 3, `${did} actions`);
  check("catch-up left a real care memory", plant.careMemory.recent.length >= 3, `${plant.careMemory.recent.length}`);
  // Once the buff has fully expired there is genuinely nothing left to replay.
  const did2 = store.autoCareCatchUp(T0 + AUTO_CARE_MS + 60_000, T0 + 20 * 60 * 1000);
  check("past the expiry there is nothing to catch up", did2 === 0, `${did2}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
