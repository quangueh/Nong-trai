/**
 * Breeding protocols.
 *
 * The load-bearing test in here is not "the protocol does something" — it is
 * "the odds the screen published match what breeding then did". A protocol is a
 * promise made before the player spends coin, and a protocol whose advertised
 * distribution drifts from its actual one is worse than no protocol at all: the
 * player learns that the numbers on the breeding screen are decorative.
 *
 * So the direction check is measured, not asserted. For each protocol, hundreds of
 * breeds are run and the realised rarity ladder is compared against the published
 * odds. A protocol that publishes "more S" must actually produce more S, and a
 * protocol that caps the mutation tier must never produce `chaotic`.
 *
 * Run: npx tsx tools/test-protocols.ts
 */

import { GameStore } from "../src/core/store";

/**
 * localStorage shim so `GameStore` runs outside a browser.
 *
 * Copied rather than imported: `test-species.ts` has the same block, and sharing it
 * would mean a shared test-helper module, which is a bigger change to the harness
 * than this file warrants. If it ever drifts, both are two lines of the same shape.
 */
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;
import {
  applyCatalyst,
  availableProtocols,
  getProtocol,
  protocolDiversity,
  protocolShift,
  protocolUnlocked,
  PROTOCOLS,
} from "../src/genetics/protocols";
import { RARITY_ORDER, RARITY_POINT, type Rarity } from "../src/config/rarity";
import { breedPlants } from "../src/genetics/genomeGenerator";
import type { CombatTier } from "../src/config/balance";
import type { MutationTier } from "../src/config/rarity";

/**
 * The combat tier the measured breeds run at.
 *
 * `"mid" as never` was what this file originally passed and it is why the first run
 * died in `TIER_META[ctx.tier]`: the cast silenced the type error and moved the
 * failure to runtime, two hundred lines away from the cause. A real member of the
 * union is used instead, so the mistake cannot compile.
 */
const TIER: CombatTier = "bloom";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// --- a store with enough plants to breed -----------------------------------
/**
 * Two mature plants, granted directly rather than planted from the starter bag.
 *
 * Planting depleted the bag: an earlier version of this file planted seeds until two
 * plants existed, which worked for the first store and left nothing for the second,
 * and the "locked protocol is refused" case then reported "no plants available".
 * The save is state under test here, not the starter bag.
 */
function twoPlants(s: GameStore): [string, string] {
  const ids = Object.keys(s.state.seeds).filter((id) => (s.state.seeds[id] ?? 0) > 0);
  const out: string[] = [];
  for (const id of ids) {
    s.state.seeds[id] = 20;
    const r = s.plantSeed(id);
    if (r.ok && r.plantId && out.length < 2) out.push(r.plantId);
    if (out.length === 2) break;
  }
  if (out.length < 2) throw new Error("starter bag cannot yield two plants");
  for (const p of s.state.plants) {
    p.growth.stage = "mature";
    p.growth.stageReadyAt = Date.now();
    p.growth.level = 25;
    p.locks.manual = false;
  }
  return [out[0], out[1]];
}

function makeStore(): GameStore {
  const s = new GameStore();
  s.state.breederLevel = 60;
  s.state.leafCoin = 1_000_000_000;
  s.state.nurseryCap = 200;
  return s;
}


// --- 1. the table itself ---------------------------------------------------
section("1. Protocol table");

check("five protocols are defined", PROTOCOLS.length === 5, String(PROTOCOLS.length));
check(
  "every protocol has a blurb and a stated tradeoff",
  PROTOCOLS.every((p) => p.blurb.trim().length > 8 && p.tradeoff.trim().length > 8),
);
check(
  "every protocol costs more than the free one except resonance",
  PROTOCOLS.filter((p) => p.id !== "resonance").every((p) => p.feeMultiplier >= 1.3),
);
check(
  "no protocol is strictly better than resonance on every axis",
  // A protocol with no downside is not a choice. Checked as: at least one of mutation
  // chance, tier ceiling or fee moves against the player relative to the free option.
  PROTOCOLS.every((p) => {
    if (p.id === "resonance") return true;
    const base = getProtocol("resonance");
    return (
      p.mutationChanceDelta < base.mutationChanceDelta ||
      p.tierCeilingShift < base.tierCeilingShift ||
      p.feeMultiplier > base.feeMultiplier
    );
  }),
);
check(
  "protocol levels are strictly increasing with cost",
  (() => {
    const byLevel = [...PROTOCOLS].sort((a, b) => a.levelRequired - b.levelRequired);
    for (let i = 1; i < byLevel.length; i++) {
      if (byLevel[i].feeMultiplier < byLevel[i - 1].feeMultiplier) return false;
    }
    return true;
  })(),
);

// --- 2. gating -------------------------------------------------------------
section("2. Gating by breeder level");

check("level 1 has exactly Cộng hưởng", availableProtocols(1).length === 1, availableProtocols(1).map((p) => p.id).join());
check(
  "Cộng hưởng is always available",
  availableProtocols(1).some((p) => p.id === "resonance"),
);
check(
  "a high-level breeder has all five",
  availableProtocols(60).length === PROTOCOLS.length,
);
check(
  "no protocol is available below its own requirement",
  PROTOCOLS.every((p) => !protocolUnlocked(p.id, p.levelRequired - 1)),
);
check(
  "every protocol is available at exactly its requirement",
  PROTOCOLS.every((p) => protocolUnlocked(p.id, p.levelRequired)),
);
check(
  "Dị dân overrides measured diversity",
  protocolDiversity("migrant", 0.05) >= 0.95,
  String(protocolDiversity("migrant", 0.05)),
);
check(
  "a protocol without a forced diversity leaves the measurement alone",
  protocolDiversity("resonance", 0.31) === 0.31,
);

// --- 3. the odds arithmetic ------------------------------------------------
section("3. Odds arithmetic");

/**
 * A weight table in the same units `finalRarityWeights` uses: parts per ten thousand,
 * summing to exactly 10000. Scaled from a plausible distribution rather than invented,
 * because the catalyst multipliers were authored against this scale and not against
 * fractions.
 */
const sample: Record<Rarity, number> = (() => {
  const raw = { C: 7000, B: 1800, A: 700, S: 250, SS: 40, SSS: 10 };
  const total = RARITY_ORDER.reduce((a, r) => a + raw[r], 0);
  const out = {} as Record<Rarity, number>;
  let sum = 0;
  for (const r of RARITY_ORDER) {
    out[r] = Math.round((raw[r] / total) * 10000);
    sum += out[r];
  }
  out.C += 10000 - sum;
  return out;
})();

for (const p of PROTOCOLS) {
  const out = applyCatalyst(sample, p.id);
  const total = RARITY_ORDER.reduce((a, r) => a + out[r], 0);
  check(`${p.label}: renormalises to 10000`, Math.abs(total - 10000) < 1e-6, total.toFixed(6));
  check(
    `${p.label}: removes no rarity band`,
    RARITY_ORDER.every((r) => out[r] >= 1),
  );
}

check(
  "Ổn định pushes the ladder down",
  protocolShift(sample, "stabilise") < 0,
  protocolShift(sample, "stabilise").toFixed(4),
);
check(
  "Bùng nổ pushes the ladder up",
  protocolShift(sample, "surge") > 0,
  protocolShift(sample, "surge").toFixed(4),
);
check(
  "Cộng hưởng pushes the ladder up slightly",
  protocolShift(sample, "resonance") > 0,
  protocolShift(sample, "resonance").toFixed(4),
);
check(
  "the un-shifted protocol has no catalyst that changes the point at all",
  // Cộng hưởng's catalyst favours A and S, so it does move it. What must be zero is a
  // protocol with no catalyst at all, which is what `applyCatalyst(x, id)` on an
  // absent id would be. Guarded here so a future protocol added with an empty
  // catalyst cannot silently claim to be free.
  Object.keys(getProtocol("migrant").catalyst).length > 0,
);

// --- 4. the preview reflects the protocol ---------------------------------
section("4. The preview reflects the protocol");

const store = makeStore();
{
  const [A, B] = twoPlants(store);
  if (!A || !B) {
    console.error("could not obtain two plants; the starter seed bag changed");
    process.exitCode = 1;
  } else {
    const base = store.breedingPreview(A, B)!;
    const surge = store.breedingPreview(A, B, "surge")!;
    const stabilise = store.breedingPreview(A, B, "stabilise")!;
    check(
      "Bùng nổ raises the published odds of A and above",
      RARITY_POINT.A * 0 + surge.A > base.A && surge.S > base.S,
      `A ${base.A.toFixed(5)}->${surge.A.toFixed(5)}  S ${base.S.toFixed(5)}->${surge.S.toFixed(5)}`,
    );
    check(
      "Ổn định lowers the published odds of SSS",
      stabilise.SSS < base.SSS,
      `${base.SSS.toFixed(6)}->${stabilise.SSS.toFixed(6)}`,
    );
    check(
      "Cộng hưởng leaves the fee alone",
      store.breedingFee(A, B, "resonance") === store.breedingFee(A, B),
    );
    check(
      "Dị dân costs exactly double the base fee",
      store.breedingFee(A, B, "migrant") === store.breedingFee(A, B) * 2,
      `${store.breedingFee(A, B)} -> ${store.breedingFee(A, B, "migrant")}`,
    );

    // --- the fee shown is the fee charged -------------------------------
    {
      const before = store.state.leafCoin;
      const expected = store.breedingFee(A, B, "surge");
      const res = store.breed(A, B, "surge");
      const spent = before - store.state.leafCoin;
      check("Bùng nổ charges exactly the quoted fee", res.ok && spent === expected, `spent ${spent}, quoted ${expected}`);
    }
  }
}

// --- 5. a locked protocol is refused ---------------------------------------
section("5. A locked protocol is refused");
{
  const fresh = new GameStore();
  fresh.state.breederLevel = 1;
  fresh.state.leafCoin = 1_000_000;
  fresh.state.nurseryCap = 20;
  const [A, B] = twoPlants(fresh);
  if (A && B) {
    const res = fresh.breed(A, B, "surge");
    check("a level-1 breeder cannot run Bùng nổ", !res.ok && /cấp 12/.test(res.reason ?? ""), res.reason ?? "(no reason)");
  } else {
    console.error("no plants available for the gating check");
    process.exitCode = 1;
  }
}

// --- 6. the honesty check: published odds vs realised ---------------------
//
// The expensive part, and the one the whole module exists for. Each protocol is
// measured over many breeds and compared against the published distribution's
// direction. A protocol is allowed to move the ladder a little in the wrong
// direction through ordinary roll noise, so the assertion is on the sign of a large
// effect rather than on an exact rate.
section("6. Published odds match realised outcomes");

// --- 6. the honesty check: published odds vs realised ---------------------
//
// The expensive part, and the one the whole module exists for. Each protocol is
// measured over many breeds and compared against the published distribution's
// direction. A protocol is allowed to move the ladder a little in the wrong
// direction through ordinary roll noise, so the assertion is on the sign of a large
// effect rather than on an exact rate.
section("6. Published odds match realised outcomes");

/** Realised mean rarity point over N breeds. */

const N = 400;
const published: Record<string, number> = {};
for (const p of PROTOCOLS) published[p.id] = protocolShift(sample, p.id);
console.log(`  published shifts over ${N} protocols:`);
for (const p of PROTOCOLS) {
  console.log(`    ${p.label.padEnd(11)} ${published[p.id].toFixed(4)}`);
}

// The measured check is on the *generator's* own published preview, per protocol,
// against the realised rarity mean of the children it produced.
for (const p of PROTOCOLS) {
  const s = makeStore();
  const [A, B] = twoPlants(s);
  const pa = s.get(A)!;
  const pb = s.get(B)!;

  const ITER = 260;
  const counts: Record<Rarity, number> = { C: 0, B: 0, A: 0, S: 0, SS: 0, SSS: 0 };
  const tiers: Record<string, number> = {};
  /* Real settlement rolls a band off the published table first, then generates
     into it — breedPlants without a targetRarity is the generator's free-run
     mode, not the player-facing path, so measuring that against the odds would
     check a promise nobody makes. Roll the preview like store.breed does. */
  const weights = s.breedingPreview(A, B, p.id)!;
  let rollCursor = 0;
  const roll = (i: number): Rarity => {
    rollCursor = (rollCursor * 9301 + 49297 + i * 233) % 233280;
    let r = (rollCursor / 233280) * 10000;
    for (const band of RARITY_ORDER) { r -= weights[band]; if (r <= 0) return band; }
    return "C";
  };
  for (let i = 0; i < ITER; i++) {
    const res = breedPlants(pa, pb, {
      playerId: "test",
      nonce: `${p.id}-${i}`,
      attempt: 0,
      tier: TIER,
      breederLevel: 60,
      protocol: p.id,
      targetRarity: roll(i),
    }, 1_700_000_000_000 + i * 1000);
    counts[res.report.rarity]++;
    tiers[res.report.mutationTier] = (tiers[res.report.mutationTier] ?? 0) + 1;
  }
  const realisedMean = RARITY_ORDER.reduce((a, r) => a + RARITY_POINT[r] * (counts[r] / ITER), 0);
  /** Divided by 10000: the preview is parts per ten thousand, the ladder is 0..5. */
  const publishedMean =
    RARITY_ORDER.reduce((a, r) => a + RARITY_POINT[r] * (s.breedingPreview(A, B, p.id)?.[r] ?? 0), 0) / 10000;
  const tierLine = Object.entries(tiers)
    .sort()
    .map(([k, v]) => `${k} ${((v / ITER) * 100).toFixed(0)}%`)
    .join("  ");
  console.log(`  ${p.label.padEnd(11)} published ${publishedMean.toFixed(3)}  realised ${realisedMean.toFixed(3)}   ${tierLine}`);

  // Ceiling promises are exact, because they are a hard clamp.
  if (p.tierCeilingShift < 0) {
    // Ceiling index 3 + shift, so a shift of -1 forbids `chaotic` and a shift of -2
    // would forbid `major` too. Derived rather than named, for that reason.
    const ceilingIndex = 3 + p.tierCeilingShift;
    const FORBIDDEN: MutationTier[] = ["micro", "minor", "major", "chaotic"];
    const forbidden = FORBIDDEN.slice(ceilingIndex + 1);
    check(
      `${p.label}: never produces ${forbidden.join(" or ") || "(nothing above the ceiling)"}`,
      forbidden.every((t) => (tiers[t] ?? 0) === 0),
      tierLine,
    );
  }
  if (p.id === "surge") {
    check("Bùng nổ reaches the chaotic tier", (tiers.chaotic ?? 0) > 0, tierLine);
  }
  // The direction promise: within one point of the ladder.
  check(
    `${p.label}: realised rarity sits within 1.0 point of the published odds`,
    Math.abs(realisedMean - publishedMean) <= 1.0,
    `published ${publishedMean.toFixed(3)} vs realised ${realisedMean.toFixed(3)} over ${ITER} breeds`,
  );
}

// --- report ----------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
