/**
 * The endless main line.
 *
 * `catalog.ts` holds a fixed eight-quest tutorial chain, and when its last quest is
 * claimed the "main" tab would simply end — a finished quest line is a game that has
 * stopped suggesting anything. This module keeps the line going: every time a cycle
 * is claimed, a new one is generated around a species the player has not tamed yet.
 *
 * ## The shape of a cycle
 *
 * Each cycle is a four-quest arc about one species, and every step is a different
 * activity — the earlier "win N battles then clear N stages" pair collapsed into
 * one job because a stage win fires both `enemy_defeated` and `stage_completed`,
 * so working on the second completed the first for free. The arc now walks the
 * species' real life instead:
 *
 *   a. own the seed    — the shop card, pinned one tap away, with the price, the
 *      currency it is sold in and the gate printed in the hint.
 *   b. grow it         — plant a few of it, so the species is actually in the garden.
 *   c. raise it        — care for the bloodline; a fresh seedling cannot fight, so
 *      this is the step that makes d possible, and the gardener's work counts too.
 *   d. prove it        — a rotating finale: win fights anywhere, clear new ladder
 *      stages, or hunt a boss, all measured against the plant's *lineage* so a bred
 *      descendant still counts.
 *
 * Targets and rewards scale with the cycle index, so the work gets heavier the deeper
 * the chain runs instead of repeating the same four asks forever.
 *
 * ## Stability
 *
 * The catalogue is recomputed on every call, so a quest's identity cannot be allowed
 * to drift: `mx{c}{slot}_{species}` encodes its own target, and the species of a cycle
 * is pinned by the first entry the engine writes for it. Once `mx3a_emberleaf` exists,
 * every later render regenerates exactly that definition — the save is the memory,
 * not the generator.
 */

import { SPECIES, SPECIES_BY_ID, type SpeciesId } from "../config/species";
import { RULE_LABEL, type UnlockReq, type UnlockStatus } from "../config/unlocks";
import { currencyInfo, viNum } from "../core/currency";
import type { QuestContext, QuestDef, QuestSave, QuestUnlock } from "./types";

/** Generated ids look like `mx3b_emberleaf` — cycle 3, slot b, target emberleaf. */
const PREFIX = "mx";
const LAST_FIXED_MAIN = "main_08_level5";

/** The gated part of the registry, in catalogue order — the pool cycles pick from. */
const GATED: readonly { id: SpeciesId; name: string }[] = SPECIES.filter((s) => s.unlock !== undefined);

/** Tiny deterministic hash — same seed, same answer, no dependency. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return h >>> 0;
}

function speciesName(id: string): string {
  return SPECIES_BY_ID[id as SpeciesId]?.name ?? id;
}

/**
 * A gate requirement as the player reads it: "Vượt ải 3" or
 * "Cấp nhà lai tạo 6 và (Có hạt của 4 loài hoặc Có cây đạt cấp 10)".
 *
 * Static per species — it answers "kiếm ở đâu" without needing the player's
 * progress, which is exactly what the shop card shows under "Chưa mở khóa".
 */
function unlockText(req: UnlockReq | undefined): string {
  if (!req) return "";
  const { all, any } = "k" in req ? { all: [req], any: [] } : { all: req.all ?? [], any: req.any ?? [] };
  const parts = all.map((r) => RULE_LABEL[r.k](r.n));
  if (any.length) {
    const alt = any.map((r) => RULE_LABEL[r.k](r.n)).join(" hoặc ");
    parts.push(all.length ? `(${alt})` : alt);
  }
  return parts.join(" và ");
}

/**
 * How close a locked gate is to opening, 0..1 — the mean of each rule's progress.
 * Used only to *rank* locked species against each other, so a coarser measure than
 * the card's exact verdict is fine: the quest wants the species whose gate the
 * player will reach soonest, not a precision instrument.
 */
function gateCloseness(gate: UnlockStatus): number {
  if (gate.met) return 1;
  if (!gate.rules.length) return 0;
  let sum = 0;
  for (const r of gate.rules) sum += r.need > 0 ? Math.min(1, r.have / r.need) : r.met ? 1 : 0;
  return sum / gate.rules.length;
}

/**
 * Which species a cycle is about.
 *
 * Pinned once the cycle's first entry exists; before that — i.e. the moment a new
 * cycle is being offered — it probes forward from a seeded offset for a species the
 * player has not discovered, preferring one whose shop gate is already open so the
 * quest is "go do it" rather than "come back when stronger". If no open undiscovered
 * species exists it takes the one whose gate is *closest* to met — pointing the
 * player at the nearest goal rather than an arbitrary far-off lock.
 *
 * The pool is the whole registry, not only gated species: gated quests are the best
 * content push, but a player who has tamed every gated species still has untamed
 * ones to point at — and a cycle must never settle on a species the player already
 * owns, because its `current` measures (owns the seed, has planted it, has raised
 * the bloodline) would all read complete the moment the quest appeared and the chain
 * would pay out for nothing. A discovered species is the true last resort, for the
 * day the whole registry is tamed.
 */
function cycleSpecies(
  cycle: number,
  save: QuestSave,
  ctx: QuestContext,
  gateInfo?: (id: SpeciesId) => UnlockStatus,
): SpeciesId {
  const ap = `${PREFIX}${cycle}a_`;
  for (const id of Object.keys(save.entries)) {
    if (id.startsWith(ap)) return id.slice(ap.length) as SpeciesId;
  }
  const untamed = SPECIES.filter((s) => !ctx.discovered.has(s.id));
  if (untamed.length === 0) {
    // Everything is tamed — a discovered species is unavoidable here, so at least it is
    // the deterministic one the chain has always pointed at.
    return GATED.length ? GATED[hash(`${ctx.playerId}:${PREFIX}:${cycle}`) % GATED.length].id : SPECIES[0].id;
  }
  const start = hash(`${ctx.playerId}:${PREFIX}:${cycle}`) % untamed.length;
  let bestLocked: { id: SpeciesId; score: number } | null = null;
  for (let k = 0; k < untamed.length; k++) {
    const cand = untamed[(start + k) % untamed.length];
    if (!gateInfo) return cand.id;
    const gate = gateInfo(cand.id);
    if (gate.met) return cand.id;
    const score = gateCloseness(gate);
    if (!bestLocked || score > bestLocked.score) bestLocked = { id: cand.id, score };
  }
  return bestLocked!.id;
}

/** How many cycles have been fully claimed — the chain's depth counter. */
function claimedCycles(save: QuestSave): number {
  let n = 0;
  for (const [id, e] of Object.entries(save.entries)) {
    if (e.status === "claimed" && /^mx\d+d_/.test(id)) n++;
  }
  return n;
}

type Slot = "a" | "b" | "c" | "d";

/** The purchase hint for slot a — price, currency and gate in the player's words. */
function acquireHow(name: string, sp: SpeciesId): string {
  const def = SPECIES_BY_ID[sp];
  if (!def) return `Chạm thẻ này → Chợ mở sẵn thẻ ${name} → mua hạt.`;
  const cur = currencyInfo(def.currency);
  const parts = [`Chạm thẻ này → Chợ mở sẵn thẻ ${name} → mua hạt (giá ${viNum(def.seedPrice)}${cur.icon})`];
  // Where the money comes from — the card charges the species' own currency, so
  // "I cannot afford it" needs the earning loop of *that* currency, not coins.
  if (def.currency === "ember") {
    parts.push(`${cur.icon} ${cur.name} chỉ rớt khi thắng trận — không đổi được ở Quy đổi`);
  } else if (def.currency !== "leafCoin") {
    parts.push(`${cur.icon} ${cur.name} kiếm từ: ${cur.source.toLowerCase()} — thiếu thì đổi xu ở tab Quy đổi`);
  }
  if (def.unlock) {
    parts.push(`Nếu thẻ còn khoá, mở bán cần: ${unlockText(def.unlock)} — thẻ chợ ghi tiến độ từng điều kiện`);
  }
  parts.push(`con lai mang dòng ${name} cũng tính là đã sở hữu`);
  return parts.join(". ") + ".";
}

/** One quest of a cycle, regenerated from its coordinates — nothing else is needed. */
function chainDef(cycle: number, slot: Slot, sp: SpeciesId, unlock: QuestUnlock | null, ctx?: QuestContext): QuestDef {
  const name = speciesName(sp);
  const id = `${PREFIX}${cycle}${slot}_${sp}`;
  const base = 90 + cycle * 10;
  const scale = (lo: number, hi: number) => Math.round(lo + Math.min(1, cycle / 10) * (hi - lo));

  switch (slot) {
    case "a":
      return {
        id,
        type: "main",
        title: `Mở giống ${name}`,
        description: `Cửa hàng còn nhiều loài chưa thuộc về vườn. Mở hoặc sở hữu hạt ${name} — thẻ cửa hàng ghi rõ loài đó cần gì.`,
        objective: `Sở hữu hạt ${name}`,
        how: acquireHow(name, sp),
        target: 1,
        icon: "🌰",
        priority: base,
        rewards: { exp: scale(120, 400), coins: scale(90, 320), items: scale(4, 12) },
        unlock,
        next: [`${PREFIX}${cycle}b_${sp}`],
        track: { event: "item_collected", mode: "count", match: { species: sp } },
        // Reading the state rather than the purchase: a player who already owns the
        // seed — or has grown the species before — finishes this the moment it opens.
        current: (ctx) => ((ctx.seeds[sp] ?? 0) > 0 || ctx.discovered.has(sp) ? 1 : 0),
      };
    case "b": {
      const n = 2 + Math.min(4, cycle);
      return {
        id,
        type: "main",
        title: `Ươm ${name}`,
        description: `Hạt chỉ là tiềm năng. Trồng ${n} cây ${name} để dòng máu này thật sự có mặt trong vườn.`,
        objective: `Trồng ${n} cây ${name}`,
        how: `Tab Vườn → chạm ô đất trống → chọn hạt ${name} → gieo. Thiếu hạt thì vào Chợ → gõ "${name}" vào ô tìm kiếm → mua thêm.`,
        target: n,
        icon: "🌱",
        priority: base + 1,
        rewards: { exp: scale(140, 460), coins: scale(110, 380) },
        unlock,
        next: [`${PREFIX}${cycle}c_${sp}`],
        track: { event: "plant", mode: "count", match: { species: sp } },
        // The chain only opens this quest when `a` is claimed, and a player who
        // buys the seed for `a` naturally plants it before claiming — without a
        // measure, those plantings are events fired at a locked quest and are
        // gone forever. Counting what was ever planted makes the quest right the
        // moment it opens, however the garden got that way.
        current: (ctx) => ctx.planted[sp] ?? 0,
      };
    }
    case "c": {
      const n = Math.min(24, 6 + cycle * 2);
      return {
        id,
        type: "main",
        title: `Nuôi dưỡng ${name}`,
        description: `Cây mới gieo chưa thể ra trận — chăm dòng ${name} để nó lớn lên. Người làm vườn thuê được cũng tính.`,
        objective: `Chăm cây dòng ${name} ${n} lần`,
        how: `Tab Vườn → chạm cây ${name} → Chăm → bấm hành động bất kỳ (tưới, nắng, phân…), mỗi lần tính 1 — cây con lai mang dòng ${name} cũng được. Thuê người làm vườn (điểm danh / xem quảng cáo) tự chăm cũng tính.`,
        target: n,
        icon: "💧",
        priority: base + 2,
        rewards: { exp: scale(160, 520), coins: scale(130, 420), items: scale(6, 16) },
        unlock,
        next: [`${PREFIX}${cycle}d_${sp}`],
        track: { event: "care", mode: "count", match: { species: sp } },
        // Every care action a living plant of this bloodline ever received counts,
        // read from the plants rather than the stream — the same self-healing
        // measure `lineageWins` gives the combat slots.
        current: (ctx) => ctx.lineageCares[sp] ?? 0,
      };
    }
    case "d": {
      // The finale rotates so two cycles never end the same way: open fighting,
      // ladder progress, then a boss. Only the stage variants are forward-only —
      // a cleared stage can never be re-fought, so the text says "ải mới" plainly
      // instead of the old line that promised replays counted.
      const kind = cycle % 3;
      const nextBoss = Math.floor((ctx?.highestStage ?? 0) / 10) * 10 + 10;
      if (kind === 2) {
        return {
          id,
          type: "main",
          title: `${name} săn boss`,
          description: `Bài kiểm tra cuối của dòng ${name}: hạ một boss ải bằng cây mang dòng máu này.`,
          objective: `Hạ 1 boss bằng dòng ${name}`,
          how: `Boss nằm ở mỗi ải thứ 10 — boss tiếp theo của bạn ở ải ${nextBoss}. Đấu → Vượt ải → chọn cây dòng ${name} làm đấu sĩ → leo tới ải đó rồi hạ boss. Con lai mang dòng ${name} cũng tính.`,
          target: 1,
          icon: "👑",
          priority: base + 3,
          rewards: { exp: scale(220, 700), coins: scale(160, 560), geneCrystal: 1 + Math.floor(cycle / 4), unlocks: ["Chuỗi nhiệm vụ mới"] },
          unlock,
          track: { event: "stage_completed", mode: "count", match: { species: sp, boss: true } },
        };
      }
      if (kind === 1) {
        const n = 1 + Math.min(3, Math.floor(cycle / 2));
        return {
          id,
          type: "main",
          title: `${name} vượt ải`,
          description: `Đưa dòng ${name} lên thang ải — vượt ${n} ải mới bằng cây mang dòng máu này.`,
          objective: `Vượt ${n} ải mới bằng dòng ${name}`,
          how: `Đấu → Vượt ải → chọn cây dòng ${name} làm đấu sĩ → đánh từ ải ${(ctx?.highestStage ?? 0) + 1} trở đi. Lưu ý: thang chỉ đi lên, ải đã vượt không đánh lại được — chỉ ải chưa qua mới tính.`,
          target: n,
          icon: "🏔️",
          priority: base + 3,
          rewards: { exp: scale(220, 700), coins: scale(160, 560), geneCrystal: 1 + Math.floor(cycle / 4), unlocks: ["Chuỗi nhiệm vụ mới"] },
          unlock,
          track: { event: "stage_completed", mode: "count", match: { species: sp } },
        };
      }
      const n = Math.min(12, 3 + cycle * 2);
      return {
        id,
        type: "main",
        title: `${name} ra trận`,
        description: `Cây trồng xong, chăm xong thì phải ra trận. Thắng ${n} trận bằng cây dòng ${name} — con lai mang dòng máu này cũng tính.`,
        objective: `Thắng ${n} trận bằng dòng ${name}`,
        how: `Đưa cây dòng ${name} ra trận — thắng ở đâu cũng tính: Vượt ải, Đấu AI, đấu bạn. Nhanh nhất: tab Đấu → Đấu với AI. Con lai mang dòng ${name} cũng được.`,
        target: n,
        icon: "⚔️",
        priority: base + 3,
        rewards: { exp: scale(220, 700), coins: scale(160, 560), geneCrystal: 1 + Math.floor(cycle / 4), unlocks: ["Chuỗi nhiệm vụ mới"] },
        unlock,
        track: { event: "enemy_defeated", mode: "count", match: { species: sp } },
        // Wins a living plant already earned for this bloodline count — the same
        // lineage the event match counts, read from the save instead of the stream.
        current: (ctx) => ctx.lineageWins[sp] ?? 0,
      };
    }
  }
}

/**
 * The generated tail of the main line.
 *
 * Emits every cycle that exists (so claimed quests keep their definitions and stay
 * readable) plus the one cycle currently in play. The engine unlocks quest `a` of a
 * cycle off the claim of the previous cycle's `d`, so the chain is continuous the way
 * the fixed line is — it just never runs out.
 *
 * `gateInfo` lets the picker prefer species the player can already buy, and among
 * species that are still gated it prefers the gate nearest to met. Optional: without
 * it the chain still works, it just sometimes points at a species whose shop gate is
 * not met yet — which is itself a goal, since the quest hint names the requirement.
 */
export function generatedMainQuests(
  save: QuestSave,
  ctx: QuestContext,
  gateInfo?: (id: SpeciesId) => UnlockStatus,
): QuestDef[] {
  const depth = claimedCycles(save);
  const out: QuestDef[] = [];
  const seen = new Set<string>();

  for (let c = 0; c <= depth; c++) {
    const sp = cycleSpecies(c, save, ctx, gateInfo);
    /*
     * The previous cycle's `d` id is recovered from the claimed set rather than
     * regenerated: its species is pinned in that id, and asking `cycleSpecies` for
     * it again would silently pick a different one if the entries were ever lost.
     */
    const prevD = c === 0 ? LAST_FIXED_MAIN : [...ctx.claimed].find((id) => id.startsWith(`${PREFIX}${c - 1}d_`));
    if (c > 0 && !prevD) continue; // no honest predecessor — do not emit a free-floating cycle
    const unlock: QuestUnlock = { kind: "quest", id: prevD! };
    let prev: QuestUnlock = unlock;
    for (const slot of ["a", "b", "c", "d"] as const) {
      const def = chainDef(c, slot, sp, prev, ctx);
      prev = { kind: "quest", id: def.id };
      seen.add(def.id);
      out.push(def);
    }
  }

  /*
   * Entries outlive definitions. If a save somehow holds a generated id this pass did
   * not emit — a species picked before a patch renamed the pool — the quest is
   * rebuilt from the id itself, so a claimed chain never renders as a hole.
   */
  for (const id of Object.keys(save.entries)) {
    if (!id.startsWith(PREFIX) || seen.has(id)) continue;
    const m = /^mx(\d+)([abcd])_(.+)$/.exec(id);
    if (!m) continue;
    const def = chainDef(Number(m[1]), m[2] as Slot, m[3] as SpeciesId, null, ctx);
    seen.add(def.id);
    out.push(def);
  }

  return out;
}
