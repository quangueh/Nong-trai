/**
 * Watching a duel that has already been fought.
 *
 * The Worker simulated the fight and handed back one event log. Both players replay that
 * same log, which is the whole reason a duel between two people who are not online at the
 * same time works at all - and it is also why neither side can influence the outcome from
 * here. There are no inputs on this screen. You watch.
 *
 * The log is played through the arena's own battle view rather than a second viewer, so a
 * duel looks and sounds exactly like a fight against the AI. Two code paths for one thing
 * the player experiences as one thing would eventually disagree about what a fight is.
 */

import { el } from "../components";
import { sfx } from "../../audio/audio";
import type { BattleEvent } from "../../battle/engine";
import type { DuelResult } from "../../account/social";

export interface DuelOutcome {
  won: boolean;
  draw: boolean;
  /** Coins paid, using the same figures as a PvE win so the two modes feel alike. */
  coins: number;
  items: number;
}

/**
 * A readable summary, for the caller that wants the numbers without the screen.
 *
 * Kept here rather than in the caller so the reward and the receipt cannot disagree, which
 * is the same reason the PvE payout is computed in one place.
 */
export function summarise(result: DuelResult, iAm: "a" | "b"): DuelOutcome {
  const draw = result.winner === "draw";
  const won = !draw && result.winner === iAm;
  return { won, draw, coins: won ? 60 : draw ? 25 : 18, items: won ? 5 : draw ? 3 : 2 };
}

/**
 * The card shown in place of a live fight.
 *
 * Deliberately not a video or a summary: the event log is there, so the caller can hand it
 * to the battle view and play the fight properly. This is what is shown if that is not
 * possible - and the honest reason it might not be is that the battle view needs both
 * plants, which are only present when the duel was just answered.
 */
export function duelSummaryCard(
  result: DuelResult,
  iAm: "a" | "b",
  onExit: () => void,
): HTMLElement {
  const out = summarise(result, iAm);
  const mine = iAm === "a" ? result.a : result.b;
  const mineName = iAm === "a" ? result.aName : result.bName;
  const theirName = iAm === "a" ? result.bName : result.aName;
  const myPower = iAm === "a" ? result.aPower : result.bPower;
  const theirPower = iAm === "a" ? result.bPower : result.aPower;

  const card = el("div", { class: "card pop duel-result", style: "text-align:center" });

  card.append(
    el(
      "div",
      { style: "font-size:34px;font-weight:900;margin-top:6px" },
      [out.draw ? "🤝 HÒA" : out.won ? "🎉 THẮNG!" : "💀 THUA"],
    ),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [`${mineName} VS ${theirName}`]),
    el("div", { class: "tiny muted", style: "margin-top:2px" }, [
      `Lực ${myPower} · ${theirPower} · máy chủ quyết định toàn bộ kết quả trận`,
    ]),
    el("div", { class: "divider" }),
    el(
      "div",
      { class: "row", style: "justify-content:center;gap:22px;margin-top:4px" },
      [
        stat("ST gây ra", Math.round(mine.damageDealt)),
        stat("ST nhận", Math.round(mine.damageTaken)),
        stat("HP còn lại", `${Math.round(mine.hpPct)}%`),
      ],
    ),
    el("div", { class: "divider" }),
    el("div", { class: "row between small" }, [
      el("span", { class: "muted" }, ["Phần thưởng"]),
      el("span", { class: "mono", style: "color:var(--accent-2);font-weight:700" }, [
        `+${out.coins}🪙 +${out.items}🎒`,
      ]),
    ]),
  );

  // How it went, in words. From the events rather than the result's `log`, which the
  // simulation never fills.
  const story = duelNarrative(duelEvents(result), iAm);
  if (story.length) {
    const box = el("div", { class: "callout", style: "margin-top:10px;text-align:left" });
    for (const line of story) box.appendChild(el("div", {}, [line]));
    card.appendChild(box);
  }

  const back = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["Về vườn"]);
  back.addEventListener("click", () => {
    sfx.play("tap");
    onExit();
  });
  card.appendChild(back);

  return card;
}

function stat(label: string, value: string | number): HTMLElement {
  return el("div", {}, [
    el("div", { style: "font-size:19px;font-weight:800" }, [String(value)]),
    el("div", { class: "tiny muted" }, [label]),
  ]);
}

/** The event log, typed. Kept narrow so a malformed payload cannot crash the viewer. */
export function duelEvents(result: DuelResult): BattleEvent[] {
  return Array.isArray(result.events) ? (result.events as BattleEvent[]) : [];
}

/**
 * A few lines describing how the fight went, read out of the event log.
 *
 * Not out of `result.log`, because `simulateBattle` never fills that field: it declares an
 * array and hands it to helpers whose parameter is named `_log`, so it comes back empty.
 * A result screen that printed its last three lines therefore printed nothing at all,
 * which reads as a bug rather than as an absence.
 *
 * The events are the record, and both players hold the same ones - so both get the same
 * sentences, with no extra payload and no second source of truth.
 *
 * Picked for what somebody would want to read afterwards: the hardest blow of the fight, a
 * transformation, a near miss, and how it ended. Capped, because a wall of text on a result
 * screen is a wall nobody reads.
 */
export function duelNarrative(events: BattleEvent[], iAm: "a" | "b"): string[] {
  const lines: string[] = [];
  const sideName = (s?: "a" | "b") => (s === iAm ? "Bạn" : "Đối thủ");

  // Compared across the whole fight rather than per side, because the single hardest blow
  // is the one worth naming and it is often not yours.
  let biggest: BattleEvent | null = null;
  for (const e of events) {
    if (e.type !== "DAMAGE_APPLIED") continue;
    if (!biggest || (e.amount ?? 0) > (biggest.amount ?? 0)) biggest = e;
  }
  if (biggest && (biggest.amount ?? 0) > 0) {
    lines.push(
      `${sideName(biggest.side)} gây ${Math.round(biggest.amount ?? 0)} sát thương${biggest.isCrit ? " — chí mạng!" : ""}.`,
    );
  }

  const morph = events.find((e) => e.type === "MORPH_STARTED");
  if (morph?.text) lines.push(morph.text);
  else if (morph?.form) lines.push(`${sideName(morph.side)} biến hình thành ${morph.form}.`);

  const near = events.find((e) => e.type === "EVADED" || e.type === "IMMUNE");
  if (near?.text) lines.push(near.text);

  const death = events.find((e) => e.type === "DEATH");
  if (death?.text) lines.push(death.text);

  return lines.slice(0, 4);
}
