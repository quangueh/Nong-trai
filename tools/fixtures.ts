/**
 * Fixtures F01–F10 from docs/27_DETAILED_PRODUCTION_ACCEPTANCE_SPEC.md §2.
 *
 * Two kinds of fixture live here:
 *
 * - **State fixtures (F01–F05, F09)** — pure store-state seeds. Each is a
 *   self-contained browser function: `applyFixture` serializes the helper
 *   prelude + the SEEDS table into one program and runs it inside the page
 *   against `window.__game.store`, then saves.
 * - **Harness fixtures (F06–F10)** — conditions on the environment, not on
 *   store data: a seeded battle, a room failure, a sync conflict, offline
 *   PWA, quota failure. These cannot be expressed as state seeds; the entry
 *   records which existing suite covers the condition and what harness work
 *   remains.
 *
 * Usage:
 *   await page.goto(APP); // fresh profile → clean save
 *   await applyFixture(page, "F02");
 *
 * Every seed ends with `store.save()` so a reload reproduces the same state.
 */

import type { Page } from "playwright-core";

export type FixtureId = "F01" | "F02" | "F03" | "F04" | "F05" | "F06" | "F07" | "F08" | "F09" | "F10";

interface FixtureDef {
  /** One-line restatement of the spec row. */
  spec: string;
  /** Present for state fixtures; absent for harness fixtures. */
  seed?: keyof typeof SEEDS;
  /** What exists today that exercises this condition, and what is missing. */
  coverage?: string;
}

/* ---------------------------------------------------------------- helpers
 * These are serialized into the page program by `applyFixture`. They must stay
 * pure closures — no imports, no Node APIs, no outer references.
 */

const setStage = (p: any, stage: string) => {
  p.growth.stage = stage;
  p.growth.stageStartedAt = Date.now() - 86_400_000;
  p.growth.stageReadyAt = Date.now();
  p.growth.level = stage === "awakened" ? 40 : stage === "mature" ? 30 : stage === "young" ? 15 : stage === "sprout" ? 5 : 1;
  p.locks.manual = stage === "seed" || stage === "sprout";
};

const maturePlant = (p: any) => setStage(p, "mature");

/** Reset the care clock so the plant is immediately care-eligible. */
const makeCareReady = (p: any) => {
  p.careMemory.lastUse = {};
  p.careMemory.recent = [];
};

/* ------------------------------------------------------------------ seeds
 * Kept in one table so seeds may call each other (`SEEDS.F02(s)` inside F09)
 * after serialization — the whole table is emitted into the page program.
 */

const SEEDS: Record<string, (s: any) => void> = {
  /** Wipe live state so seeds are idempotent regardless of what ran before. */
  _reset(s: any) {
    s.state.plants = [];
    s.state.seeds = {};
    s.state.autoCareUntil = 0;
  },

  F01(s: any) {
    SEEDS._reset!(s);
    // First session: a couple of starter plants, basic seeds, no helper.
    s.state.leafCoin = 10_000;
    const starters = ["thornroot", "emberleaf"];
    for (const sp of starters) s.buySeed(sp, 2);
    for (const sp of starters) s.plantSeed(sp);
    s.state.leafCoin = 250;
    s.state.geneCrystal = 0;
    s.state.items = 20;
    s.state.breederLevel = 1;
    s.state.nurseryCap = 6;
  },

  F02(s: any) {
    SEEDS._reset!(s);
    s.state.leafCoin = 1_000_000;
    const species = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud"];
    for (const sp of species) s.buySeed(sp, 4);
    s.state.nurseryCap = 24;
    let i = 0;
    while (s.state.plants.length < 12 && i++ < 40) {
      const r = s.plantSeed(species[i % species.length]);
      if (!r.ok) break;
    }
    const stages = ["seed", "sprout", "young", "young", "mature", "mature", "mature", "mature", "mature", "awakened", "mature", "sprout"];
    s.state.plants.forEach((p: any, idx: number) => setStage(p, stages[idx % stages.length]));
    // Exactly two plants are care-eligible right now — the rest are on cooldown.
    const now = Date.now();
    s.state.plants.forEach((p: any, idx: number) => {
      if (idx < 2) {
        makeCareReady(p);
      } else {
        p.careMemory.lastUse = { water: now, fertilize: now, prune: now, sing: now };
        p.careMemory.recent = [{ action: "water", at: now }];
      }
    });
    // Hired gardener with ~10 minutes left — F02's actor-fixture state.
    s.state.autoCareUntil = now + 10 * 60 * 1000;
    s.state.leafCoin = 50_000;
    s.state.items = 300;
    s.state.breederLevel = 20;
  },

  F03(s: any) {
    SEEDS._reset!(s);
    s.state.leafCoin = 5_000_000;
    const species = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud"];
    for (const sp of species) s.buySeed(sp, 8);
    s.state.nurseryCap = 24;
    let i = 0;
    while (s.state.plants.length < 24 && i++ < 80) {
      if (!s.plantSeed(species[i % species.length]).ok) break;
    }
    // Variety through breeding rather than five starter clones: rarity/habit
    // spread comes from the genetics engine, like a real save would.
    for (let k = 0; k < 8 && s.state.plants.length >= 2; k++) {
      const a = s.state.plants[k % s.state.plants.length];
      const b = s.state.plants[(k + 3) % s.state.plants.length];
      s.breed(a.plantId, b.plantId);
    }
    for (const p of s.state.plants) maturePlant(p);
    // Exactly one plant is mid-battle — visually flagged, refuses care/sell.
    const locked = s.state.plants[0];
    if (locked) locked.locks.battle = true;
    s.state.leafCoin = 500_000;
    s.state.geneCrystal = 200;
    s.state.items = 900;
    s.state.breederLevel = 60;
  },

  F04(s: any) {
    SEEDS._reset!(s);
    s.state.leafCoin = 1_000_000;
    for (const sp of ["thornroot", "emberleaf"]) s.buySeed(sp, 2);
    s.state.nurseryCap = 12;
    for (const sp of ["thornroot", "emberleaf"]) s.plantSeed(sp);
    for (const p of s.state.plants) maturePlant(p);
    s.state.leafCoin = 200_000;
    s.state.geneCrystal = 300;
    s.state.items = 500;
    s.state.breederLevel = 60; // every protocol unlocked by level
  },

  F05(s: any) {
    SEEDS._reset!(s);
    // Every rejection reason the failure tests exercise: broke, one parent
    // immature, same parent selected twice, nursery full.
    s.state.leafCoin = 1_000_000;
    for (const sp of ["thornroot", "emberleaf"]) s.buySeed(sp, 4);
    s.state.nurseryCap = 6;
    let i = 0;
    while (s.state.plants.length < 6 && i++ < 20) {
      if (!s.plantSeed(["thornroot", "emberleaf"][i % 2]).ok) break;
    }
    s.state.plants.forEach((p: any, idx: number) => setStage(p, idx === 0 ? "mature" : "young"));
    s.state.leafCoin = 5;
    s.state.geneCrystal = 0;
    s.state.items = 0;
    s.state.breederLevel = 5;
  },

  F09(s: any) {
    SEEDS._reset!(s);
    SEEDS.F02!(s);
    s.state.leafCoin = 9_999_999_999;
    s.state.geneCrystal = 123_456;
    s.state.items = 88_888;
    const long1 = "Búp Sương Ngọc Lam Thánh Khiết Vĩnh Hằng Của Vùng Đất Mây Trắng";
    const long2 = "Rễ Gai Hắc Ám Từ Vực Sâu Không Đáy Thức Tỉnh Vào Đêm Không Trăng";
    s.state.plants.forEach((p: any, idx: number) => {
      p.name = idx % 2 === 0 ? `${long1} #${idx}` : `${long2} #${idx}`;
    });
  },
};

export const FIXTURES: Record<FixtureId, FixtureDef> = {
  F01: { spec: "Lần đầu: ít cây, hạt cơ bản, chưa có helper.", seed: "F01" },
  F02: { spec: "12 cây nhiều giai đoạn, 2 cây cần chăm, helper còn 10 phút.", seed: "F02" },
  F03: { spec: "24 cây đa dạng, một cây battle-locked.", seed: "F03" },
  F04: { spec: "Hai bố mẹ hợp lệ, đủ tiền, mọi protocol đã mở.", seed: "F04" },
  F05: { spec: "Thiếu tiền, immature parent, cùng parent, hết capacity.", seed: "F05" },
  F09: { spec: "Tên tiếng Việt 40–60 ký tự, số tiền lớn, văn bản nhiều dòng.", seed: "F09" },
  F06: {
    spec: "Trận dài, inputs/seed cố định, statuses đa dạng.",
    coverage:
      "Battle engine is deterministic on (snapshot, intents, seed) — test-battle*.ts and the 24 seeded replay cases in test-technical-contracts cover determinism. Missing: a named long-fight fixture tuned for VFX measurement (WP07).",
  },
  F07: {
    spec: "Room connecting/reconnect/expired/opponent-left, API fail.",
    coverage: "test-room*.ts covers the room client state machine offline. Missing: network-fault injection harness (request interception) for the live-failure rows (WP07).",
  },
  F08: {
    spec: "Guest/local/cloud khác nhau, delayed requests, save conflict.",
    coverage: "test-sync*.ts + test-technical-contracts save-slot suites cover conflict resolution and account isolation. Missing: delayed-response injection against the real worker (WP08).",
  },
  F10: {
    spec: "Offline sau cài PWA, storage quota failure, audio unavailable.",
    coverage: "test-service-worker covers offline navigation/asset fallback + 500 non-poisoning; test-technical-contracts covers quota-failure visibility; test-ads-contracts covers script-blocked path. Missing: real installed-PWA device pass (REL-05).",
  },
};

/* --------------------------------------------------------------- plumbing */

/** Serialize helpers + the seed table into one page program. */
function program(id: FixtureId): string {
  const seedName = FIXTURES[id].seed;
  if (!seedName) throw new Error(`${id} is a harness fixture — see FIXTURES.${id}.coverage`);
  const helpers = [setStage, maturePlant, makeCareReady].map((f) => `const ${f.name} = ${f};`).join("\n");
  // SEEDS entries are object-method shorthand (`F01(s) {…}`), so they are
  // emitted verbatim — `SEEDS.F02(s)` inside F09 resolves against the table.
  const table = Object.values(SEEDS).join(",\n");
  return `${helpers}\nconst SEEDS = {\n${table}\n};\nSEEDS.${seedName}(s);`;
}

/**
 * Apply a state fixture inside a page that has already loaded the app on a
 * clean profile. Ends with `store.save()` inside the page.
 */
export async function applyFixture(page: Page, id: FixtureId): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), { timeout: 15000 });
  await page.evaluate((code) => {
    const g = (window as unknown as { __game: any }).__game;
    const s = g.store;
    new Function("s", code)(s);
    s.save();
  }, program(id));
}

/* CLI: `tsx tools/fixtures.ts` prints the fixture map for reports. */
if (/[\\/]fixtures\.[tj]s$/.test(process.argv[1] ?? "")) {
  for (const [id, d] of Object.entries(FIXTURES)) {
    console.log(`${id}  ${d.seed ? "state  " : "harness"}  ${d.spec}`);
    if (d.coverage) console.log(`     coverage: ${d.coverage}`);
  }
}
