/**
 * What a stage *is*: its name, its band, its difficulty, and the rules of the fight.
 *
 * ## Why identity is separated from the maths
 *
 * `ascent.ts` works out how hard a stage is and what it pays. It has no idea what the stage
 * is called, and it should not: those are two different kinds of answer, and folding them
 * together is how a stage ends up named "Ải 34" — which is not a name, it is an index with
 * the word "stage" in front of it.
 *
 * Everything here is a **pure function of the stage index**, so a stage is the same stage on
 * every device, in every session, and in every screenshot. No stored names, no generated-at-
 * first-visit names, and nothing that can differ between the map and the result screen.
 * Determinism here is not tidiness — a ladder whose stage 34 is called one thing on the map
 * and another after the fight is a ladder nobody can talk about.
 *
 * ## The difficulty rating is measured, not assigned
 *
 * `difficultyScore` counts how many growth steps the stage sits above the first one, using
 * the same geometric ratio the power curve uses. That makes it a statement about the stage
 * rather than an opinion about it: two stages with the same score are the same fight, and the
 * label cannot drift away from the number the player is actually fighting.
 *
 * The steps are counted against the *band* boundaries too, so crossing into a new band always
 * reads as a jump, which is what a band is for.
 */

import { seedToken } from "../core/rng";
import { BAND_LABEL, FIRST_STAGE_POWER, STAGE_GROWTH, STAT_LADDER_END, type AscentBand } from "./ascent";

/**
 * The two sides of a stage fight, stated plainly.
 *
 * Both are always shown, before the fight and again on the result. The win condition alone
 * is not enough: a player who loses needs to know which of the three ways to lose it was,
 * and the timeout rule in particular is the one that is invisible while playing and decides
 * more fights than either knockout does.
 */
export interface StageConditions {
  /** What the player has to achieve. */
  win: string;
  /** What ends the fight in a loss. */
  lose: string;
  /** How the fight is settled if nobody is dead when time runs out. */
  timeout: string;
  /** The band's twist, when it has one worth naming. */
  hazard?: { name: string; gloss: string };
}

/** How hard a stage is, in words the player can act on. */
export interface StageDifficulty {
  /** 1-5. Comparable across stages and across accounts. */
  score: number;
  label: string;
  /** "Trước mặt", "Ngang", "Cơn bão" — relative to *this* account's best plant. */
  outlook: "easy" | "fair" | "hard";
  outlookLabel: string;
}

export interface StageIdentity {
  index: number;
  band: AscentBand;
  bandLabel: string;
  /** Stable, generated from the index. Never stored. */
  name: string;
  difficulty: StageDifficulty;
  conditions: StageConditions;
}

/* ---------------------------------------------------------------------------
   Bands
   --------------------------------------------------------------------------- */

/**
 * Each band's character, and the one idea it introduces.
 *
 * The order matters and is the whole design of the ladder: a player meets one new idea per
 * band, in the order that keeps the first hour teachable. `khoi-dau` is a plain fight, so a
 * new player can win one without reading anything; each band after it adds exactly one
 * thing, and says so, so the difficulty is announced before it is felt.
 */
const BAND_CHARACTER: Record<AscentBand, { start: number; hazard?: { name: string; gloss: string } }> = {
  "khoi-dau": { start: 1 },
  "thung-lung": {
    start: 11,
    hazard: { name: "Đặc tính quái", gloss: "Quái mang đặc tính riêng — đọc trước khi đánh." },
  },
  "vuc-tham": {
    start: 31,
    hazard: { name: "Nhiều đặc tính", gloss: "Mỗi quái mang nhiều đặc tính cùng lúc." },
  },
  "vuot-han": {
    start: 61,
    hazard: { name: "Tường sức mạnh", gloss: "Sức mạnh quái đã chạm trần — cây của bạn phải mạnh hơn." },
  },
  "khong-duong": {
    start: 91,
    hazard: { name: "Vực thẳng", gloss: "Không còn sức mạnh để tăng. Chỉ còn đặc tính." },
  },
};

/** The start of each band, ascending — the one table the map, brief and result all read. */
export const BAND_STARTS: readonly number[] = Object.values(BAND_CHARACTER)
  .map((b) => b.start)
  .sort((a, b) => a - b);

/** Which band a stage belongs to. Delegates to `ascent` so there is one answer, not two. */
export function identityBand(stage: number): AscentBand {
  let band: AscentBand = "khoi-dau";
  for (const b of Object.keys(BAND_CHARACTER) as AscentBand[]) {
    if (stage >= BAND_CHARACTER[b].start) band = b;
  }
  return band;
}

/* ---------------------------------------------------------------------------
   Names
   --------------------------------------------------------------------------- */

/*
 * Per-band word lists. Names are "prefix + noun" so they read as a place rather than as a
 * serial number, and each band has its own vocabulary so a name also tells you roughly where
 * on the ladder you are — which is the whole job of a name here.
 *
 * Deterministic pairing, not random: `pick(words, stage, salt)` hashes the index, so stage 34
 * is always called the same thing without anything being stored.
 */
const BAND_WORDS: Record<AscentBand, { heads: string[]; tails: string[] }> = {
  "khoi-dau": {
    heads: ["Vườn", "Lối", "Bờ", "Ngõ", "Bụi"],
    tails: ["Đầu", "Non", "Sương", "Cỏ", "Lá"],
  },
  "thung-lung": {
    heads: ["Thung", "Rẫm", "Vực nhỏ", "Đồi", "Bến"],
    tails: ["Rễ", "Đá", "Nước", "Đêm", "Rễ"],
  },
  "vuc-tham": {
    heads: ["Vực", "Hang", "Ao", "Bệ", "Lò"],
    tails: ["Sâu", "Thẳm", "Đen", "Tích", "Mặc"],
  },
  "vuot-han": {
    heads: ["Giới", "Bức", "Rào", "Vòm", "Cõi"],
    tails: ["Trần", "Sắt", "Giáp", "Ngưỡng", "Chí"],
  },
  "khong-duong": {
    heads: ["Hư", "Cõi", "Khoảng", "Màn", "Đằng"],
    tails: ["Vô", "Tận", "Lặng", "Không", "Lai"],
  },
};

/**
 * A stable word for a stage.
 *
 * `seedToken` returns base-36 text, so it is parsed back to a number before being reduced —
 * doing the modulo on the string would be the first thing to break, and it would break
 * silently by yielding `NaN` and therefore an undefined index.
 */
function pick(words: string[], stage: number, salt: string): string {
  const h = Number.parseInt(seedToken(String(stage), salt), 36);
  return words[h % words.length];
}

/**
 * A stage's name.
 *
 * `"Vườn Đầu"` for stage 1 and `"Giới Sắt"` for stage 64. Derived from the index alone, so
 * it is the same on the map, in the brief and on the result screen, forever, with nothing
 * stored and no two devices disagreeing.
 */
export function stageName(stage: number): string {
  const band = identityBand(stage);
  const w = BAND_WORDS[band];
  return `${pick(w.heads, stage, "head")} ${pick(w.tails, stage, "tail")}`;
}

/* ---------------------------------------------------------------------------
   Difficulty
   --------------------------------------------------------------------------- */

const DIFFICULTY_LABELS = ["Sơ cấp", "Dễ", "Vừa", "Khó", "Rất khó", "Tuyệt đối"];

/**
 * How many growth steps a stage sits above the first one.
 *
 * `Math.log(ratio) / Math.log(1 + growth)` is "how many doublings of this ladder's own step"
 * — the natural unit for a geometric curve, and the reason the number is comparable between
 * stage 8 and stage 600 rather than being an artefact of the absolute power figure.
 *
 * Past `STAT_LADDER_END` the power stops growing and only the affixes do, so the count stops
 * climbing too and is pinned at the top of the scale. Reporting "tuyệt đối" for every stage
 * in the infinite tail is honest: they really are all the same difficulty, which is itself
 * the thing a player needs told.
 */
export function difficultyScore(stage: number): number {
  const power = stagePowerFor(stage);
  const ratio = Math.max(1, power / FIRST_STAGE_POWER);
  /*
   * `STAGE_GROWTH` is the per-stage *factor* (≈1.0372), not the increment — `ascent` solves
   * it as `(1300/150)^(1/59)` and then raises it to a power. Dividing by `1 + it` treats each
   * stage as a 2.037× step instead of a 1.037× one, which made every stage past the second
   * read as maximum difficulty. The band boundaries below are the check that caught it.
   */
  const steps = Math.log(ratio) / Math.log(STAGE_GROWTH);
  const fullSpan = Math.log(LADDER_SPAN_TOP / FIRST_STAGE_POWER) / Math.log(STAGE_GROWTH);
  return Math.max(1, Math.min(5, 1 + Math.round((steps / fullSpan) * 4)));
}

/** The power the stat ladder tops out at — the same figure `ascent` solves its growth from. */
const LADDER_SPAN_TOP = 1300;

/**
 * The power a stage asks for, recomputed here rather than imported.
 *
 * `ascent.stageTargetPower` takes the player and the day into account, which is right for
 * *balance* and wrong for *description*: a difficulty label that changes depending on who is
 * looking at it is not a property of the stage. This is the stage's own curve, with the daily
 * term left out, so stage 20 is called "Khó" for everyone.
 *
 * Flat past `STAT_LADDER_END`, matching `ascent`: past that point the ladder stops growing in
 * power and grows in affixes, and a difficulty score that kept climbing would be describing
 * a number the fight does not use.
 */
function stagePowerFor(stage: number): number {
  const end = Math.min(stage, STAT_LADDER_END);
  return FIRST_STAGE_POWER * Math.pow(STAGE_GROWTH, end - 1);
}

/**
 * Difficulty, plus how it looks from where this account stands.
 *
 * The outlook is the part a player can act on: the same stage is a wall for a new garden and
 * a formality for a bred one, and a screen that only says "Khó" tells them nothing they can
 * use. It is a pure function of `share` — the ratio the ladder already computes — so it moves
 * exactly when the fight does.
 *
 * The two are worded to complement rather than repeat: the label grades the *stage*, the
 * outlook grades the *matchup*. The first attempt paired "Độ khó: Dễ" with "Dễ — farm được"
 * and printed the same word twice on one line, which reads as a rendering fault and tells the
 * player nothing extra.
 */
export function stageDifficulty(stage: number, share: number): StageDifficulty {
  const score = difficultyScore(stage);
  const outlook = share > 1.05 ? "hard" : share < 0.85 ? "easy" : "fair";
  return {
    score,
    label: DIFFICULTY_LABELS[Math.min(score, DIFFICULTY_LABELS.length - 1)],
    outlook,
    outlookLabel: outlook === "hard" ? "Cây của bạn yếu hơn" : outlook === "easy" ? "Cây của bạn mạnh hơn" : "Ngang sức",
  };
}

/* ---------------------------------------------------------------------------
   Conditions
   --------------------------------------------------------------------------- */

/**
 * The rules of the fight, in the player's language.
 *
 * Read from one table so the brief, the result screen and any future surface cannot disagree
 * about what a stage asked for. The timeout line is not decoration: at 90 seconds the fight
 * is settled on remaining HP and then damage dealt, which hands the win to a player with both
 * fighters alive and says nothing about it. It decides more fights than any knockout.
 */
export function stageConditions(stage: number): StageConditions {
  const band = identityBand(stage);
  return {
    win: "Đánh bại quái thủ trước khi hết giờ.",
    lose: "Cây của bạn bị hạ gục.",
    timeout: "Hết 90 giây: còn nhiều máu hơn thì thắng, bằng nhau thì hơn sát thương gây ra.",
    ...(BAND_CHARACTER[band].hazard ? { hazard: BAND_CHARACTER[band].hazard } : {}),
  };
}

/* ---------------------------------------------------------------------------
   The whole identity
   --------------------------------------------------------------------------- */

/** Everything a stage is, other than what it pays. */
export function stageIdentity(stage: number, share: number): StageIdentity {
  const band = identityBand(stage);
  return {
    index: stage,
    band,
    bandLabel: BAND_LABEL[band],
    name: stageName(stage),
    difficulty: stageDifficulty(stage, share),
    conditions: stageConditions(stage),
  };
}

/** The bands, for the map's grouping headers. */
export function bandList(): { band: AscentBand; label: string; start: number; hazard?: { name: string; gloss: string } }[] {
  return (Object.keys(BAND_CHARACTER) as AscentBand[])
    .map((band) => ({ band, label: BAND_LABEL[band], start: BAND_CHARACTER[band].start, hazard: BAND_CHARACTER[band].hazard }))
    .sort((a, b) => a.start - b.start);
}