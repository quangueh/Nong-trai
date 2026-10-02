/**
 * Registry and unlock capacity report.
 *
 * Both questions here were answered wrong by guessing once already.
 *
 * "Will 6005 species still have unique names?" — yes, 485k of name space. But
 * "will they have unique blurbs?" — **no**: the pools combined to 2,640 against a
 * 6,005 target, so the generator would have fallen back to a numbered sentence
 * for most of the registry and nobody would have noticed, because a fallback is
 * not an error.
 *
 * "Is the unlock ladder a ladder?" — the old gate released 200 species on one
 * level-up. At 6005 that would be 1200. So what matters is not "is it locked" but
 * how much opens per level, and whether a player who only levels ever gets past
 * the first slice.
 *
 * Run: npm run diag:registry
 */

import { SPECIES, GENERATED_SPECIES_COUNT, blurbFallbackCount } from "../src/config/species";
import { checkUnlock, contextFrom, plotStatuses, PLOT_DEFS, STARTING_PLOTS, MAX_PLOTS } from "../src/config/unlocks";
import type { Plant } from "../src/core/types";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "[32mPASS[0m" : "[31mFAIL[0m"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

console.log("\n[1mRegistry[0m");
console.log(`  species: ${SPECIES.length} (${GENERATED_SPECIES_COUNT} generated + 5 starters)`);
check("ids are unique", new Set(SPECIES.map((s) => s.id)).size === SPECIES.length);
check("names are unique", new Set(SPECIES.map((s) => s.name)).size === SPECIES.length);
check(
  "names are unique ignoring accents",
  new Set(SPECIES.map((s) => s.name.normalize("NFD").replace(/[̀-ͯ]/g, ""))).size === SPECIES.length,
);
check("blurbs are unique", new Set(SPECIES.map((s) => s.blurb)).size === SPECIES.length);
// The one that would have caught the real problem: a numbered blurb is still a
// valid string, so only an explicit count notices it.
check("no blurb fell back to a numbered form", blurbFallbackCount === 0, `${blurbFallbackCount} fallbacks`);
check("no name carries a number", !SPECIES.some((s) => s.name.includes("#")));

console.log("\n[1mUnlock ladder[0m");
const filler = (): Plant =>
  ({ growth: { level: 30, stage: "mature" }, generation: 1 }) as unknown as Plant;

const openAt = (level: number, plants: Plant[], seedCount: number): number => {
  const seeds: Record<string, number> = {};
  for (let i = 0; i < seedCount; i++) seeds[`s${i}`] = 1;
  const ctx = contextFrom(plants, level, seeds, 500_000);
  let open = 0;
  for (const sp of SPECIES) if (checkUnlock(ctx, sp.unlock).met) open++;
  return open;
};

const idle: Plant[] = [];
const active = Array.from({ length: 12 }, () => filler());

console.log("  level   idle   +/step    active   +/step");
let pidle = 0;
let pactive = 0;
for (const lvl of [1, 5, 10, 15, 20, 25, 30, 35, 40, 46, 60]) {
  const o = openAt(lvl, idle, 0);
  const a = openAt(lvl, active, 20);
  console.log(`  ${String(lvl).padStart(5)}  ${String(o).padStart(6)}  ${String(o - pidle).padStart(7)}  ${String(a).padStart(8)}  ${String(a - pactive).padStart(7)}`);
  pidle = o;
  pactive = a;
}

// The design intent, stated as assertions: levelling alone must not open the
// registry, and playing must open most of it.
const idleEnd = openAt(60, idle, 0);
const activeEnd = openAt(60, active, 20);
check("levelling alone leaves most of the registry shut", idleEnd < SPECIES.length * 0.2, `${idleEnd}/${SPECIES.length} (${((idleEnd / SPECIES.length) * 100).toFixed(0)}%)`);
check("playing opens most of it", activeEnd > SPECIES.length * 0.85, `${activeEnd}/${SPECIES.length} (${((activeEnd / SPECIES.length) * 100).toFixed(0)}%)`);
check("something is open from the start", openAt(1, idle, 0) > 50, `${openAt(1, idle, 0)} open at level 1`);

console.log("\n[1mGarden plots[0m");
console.log(`  ${STARTING_PLOTS} free, ${MAX_PLOTS} total`);
console.log(`  costs: ${PLOT_DEFS.filter((p) => p.cost > 0).map((p) => p.cost).join(", ")}`);
// A genuinely fresh player: level 1, nothing planted, no coins.
const freshCtx = contextFrom([], 1, {}, 0);
const freshRows = plotStatuses(freshCtx, STARTING_PLOTS);
check("a fresh player can open nothing yet", freshRows.every((r) => !r.canBuy), `${freshRows.filter((r) => r.canBuy).length} buyable`);
check("and every one of them says why", freshRows.filter((r) => !r.open).every((r) => r.blocked.length > 0));

// A mid-game player should be able to open a whole block, and the later blocks
// should still be gated rather than merely expensive.
const midRows = plotStatuses(contextFrom(active, 9, {}, 4200), STARTING_PLOTS);
check(
  "a mid-game player can open the first block",
  midRows.filter((r) => r.canBuy).length >= 6,
  `${midRows.filter((r) => r.canBuy).length} buyable`,
);
check(
  "but the last block is still out of reach",
  midRows.filter((r) => r.index > 12).every((r) => !r.canBuy),
);

console.log(`\n[1mResult: ${failed === 0 ? "[32mall checks passed" : `[31m${failed} failed`}[0m\n`);
process.exit(failed === 0 ? 0 : 1);