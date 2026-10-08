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
 * Each cycle is a four-quest arc about one species, chosen deterministically:
 *
 *   a. own the seed   — "mở {loài} trong cửa hàng" sends the player to the shop;
 *      because the gate is a real unlock, the card there tells them what is missing.
 *   b. grow it        — plant a few of it, so the species is actually in the garden.
 *   c. fight with it  — wins counted against the plant's *lineage*, so a bred
 *      descendant still counts: the quest is about the bloodline, not the individual.
 *   d. take it up the ladder — clear stages with it; every third cycle demands a boss.
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
 * Which species a cycle is about.
 *
 * Pinned once the cycle's first entry exists; before that — i.e. the moment a new
 * cycle is being offered — it probes forward from a seeded offset for a species the
 * player has not discovered, preferring one whose shop gate is already open so the
 * quest is "go do it" rather than "come back when stronger". If every gated species
 * is somehow tamed, the hashed pick stands and the quest self-completes.
 */
function cycleSpecies(cycle: number, save: QuestSave, ctx: QuestContext, isOpen?: (id: SpeciesId) => boolean): SpeciesId {
  const ap = `${PREFIX}${cycle}a_`;
  for (const id of Object.keys(save.entries)) {
    if (id.startsWith(ap)) return id.slice(ap.length) as SpeciesId;
  }
  if (GATED.length === 0) return SPECIES[0].id;
  const start = hash(`${ctx.playerId}:${PREFIX}:${cycle}`) % GATED.length;
  let undiscovered: SpeciesId | null = null;
  for (let k = 0; k < GATED.length; k++) {
    const cand = GATED[(start + k) % GATED.length];
    if (ctx.discovered.has(cand.id)) continue;
    if (!isOpen || isOpen(cand.id)) return cand.id;
    if (undiscovered === null && k > 400) undiscovered = cand.id;
  }
  return undiscovered ?? GATED[start].id;
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

/** One quest of a cycle, regenerated from its coordinates — nothing else is needed. */
function chainDef(cycle: number, slot: Slot, sp: SpeciesId, unlock: QuestUnlock | null): QuestDef {
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
      const n = Math.min(12, 3 + cycle * 2);
      return {
        id,
        type: "main",
        title: `${name} ra trận`,
        description: `Cây trồng xong thì phải ra trận. Thắng ${n} trận bằng cây dòng ${name} — con lai mang dòng máu này cũng tính.`,
        objective: `Thắng ${n} trận bằng dòng ${name}`,
        target: n,
        icon: "⚔️",
        priority: base + 2,
        rewards: { exp: scale(160, 520), coins: scale(130, 420), items: scale(6, 16) },
        unlock,
        next: [`${PREFIX}${cycle}d_${sp}`],
        track: { event: "enemy_defeated", mode: "count", match: { species: sp } },
        // Wins a living plant already earned for this bloodline count — the same
        // lineage the event match counts, read from the save instead of the stream.
        current: (ctx) => ctx.lineageWins[sp] ?? 0,
      };
    }
    case "d": {
      const boss = cycle % 3 === 2;
      const n = boss ? 1 : 1 + Math.min(3, Math.floor(cycle / 2));
      return {
        id,
        type: "main",
        title: boss ? `${name} săn boss` : `${name} vượt ải`,
        description: boss
          ? `Bài kiểm tra cuối của dòng ${name}: hạ một boss ải bằng cây mang dòng máu này.`
          : `Đưa dòng ${name} lên thang ải — vượt ${n} ải bằng cây mang dòng máu này. Ải đã vượt cũng tính.`,
        objective: boss ? `Hạ 1 boss bằng dòng ${name}` : `Vượt ${n} ải bằng dòng ${name}`,
        target: n,
        icon: boss ? "👑" : "🏔️",
        priority: base + 3,
        rewards: {
          exp: scale(220, 700),
          coins: scale(160, 560),
          geneCrystal: 1 + Math.floor(cycle / 4),
          unlocks: [`Chuỗi nhiệm vụ mới`],
        },
        unlock,
        // `next` is filled by the caller — it is the *next* cycle's a, and that
        // species is only chosen once this d is claimed.
        track: { event: "stage_completed", mode: "count", match: { species: sp, ...(boss ? { boss: true } : {}) } },
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
 * `isOpen` lets the picker prefer species the player can already buy. Optional, and
 * only a preference: without it the chain still works, it just sometimes points at a
 * species whose shop gate is not met yet — which is itself a goal, since the shop card
 * prints the requirement.
 */
export function generatedMainQuests(
  save: QuestSave,
  ctx: QuestContext,
  isOpen?: (id: SpeciesId) => boolean,
): QuestDef[] {
  const depth = claimedCycles(save);
  const out: QuestDef[] = [];
  const seen = new Set<string>();

  for (let c = 0; c <= depth; c++) {
    const sp = cycleSpecies(c, save, ctx, isOpen);
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
      const def = chainDef(c, slot, sp, prev);
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
    const def = chainDef(Number(m[1]), m[2] as Slot, m[3] as SpeciesId, null);
    seen.add(def.id);
    out.push(def);
  }

  return out;
}
