/**
 * Vượt ải: the PvE ladder screen.
 *
 * Two halves that deliberately do not look the same. Looking down the ladder is a list of
 * stages, because that is what a ladder is. Fighting one is the arena's own battle view,
 * because a stage the player cannot act in is not the same game as a duel they can.
 *
 * ## Why the fight is resolved by the store and then played back
 *
 * `runAscentStage` simulates the fight and hands back the event log, and this screen plays
 * that log through `BattleView`. The alternative - letting the player cast skills live and
 * settling it afterwards - sounds better and is wrong here: a live fight and a simulated one
 * with the same inputs can settle differently, and if the screen and the ledger disagree the
 * player watches a fight they won get recorded as a loss. One simulation, one outcome, then
 * watch it.
 *
 * The monster is a real `Plant` (`pve/monster.ts`), so this screen has no PvE rendering, no
 * PvE sound and no PvE rules. It is the arena, pointed at something the garden did not breed.
 */

import { el } from "../components";
import { sfx } from "../../audio/audio";
import { renderPlantSvg } from "../../render/plantRenderer";
import { BattleView } from "../../battle/battleView";
import { store } from "../app";
import { ELEMENT_INFO } from "../../config/elements";
import { ARCHETYPE_ROLE, TIER_META } from "../../config/balance";
import { RARITY_META } from "../../config/rarity";
import { compactNumber, type CurrencyId } from "../../core/currency";
import type { DropRoll } from "../../core/drops";
import { BAND_LABEL, LOOKAHEAD, type MonsterSpec, type StageBrief, type StageReward } from "../../pve";
import type { Navigate } from "./types";

/** How many stage rows to draw. The list is long by design; scrolling it is the point. */
const WINDOW = 24;

export function renderAscent(_nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const ascent = store.state.ascent;
  const best = store.bestFighter();

  /* --- the header: where you are on an endless ladder ---------------------- */
  const header = el("div", { class: "card", style: "margin-bottom:12px" });
  header.append(
    el("div", { style: "font-size:20px;font-weight:900" }, [
      ascent.highest > 0 ? `Ải ${ascent.highest} đã vượt` : "Vượt ải",
    ]),
    el("div", { class: "tiny muted", style: "margin-top:3px" }, [
      best ? `Cây mạnh nhất: ${best.name} · ${best.powerRating} lực` : "Chưa có cây trưởng thành nào để đánh",
    ]),
  );

  if (!best) {
    /* Specific rather than a disabled button: the blocker is maturity, not strength, and
       saying so is more use than "you need a plant". */
    header.appendChild(
      el("div", { class: "callout", style: "margin-top:10px" }, [
        "Hãy trồng và chăm sóc một cây đến khi trưởng thành, rồi quay lại đây.",
      ]),
    );
  } else if (ascent.attempts > 0) {
    header.appendChild(
      el("div", { class: "callout", style: "margin-top:10px" }, [
        `Đã thử ải ${ascent.highest + 1} ${ascent.attempts} lần mà chưa thắng. Thưởng thua giảm dần — nâng cấp cây rồi thử lại nhé.`,
      ]),
    );
  }
  root.appendChild(header);

  /* --- the fighters on hand ------------------------------------------------ */
  const mature = store.state.plants.filter(
    (p) => p.growth.stage === "mature" || p.growth.stage === "awakened",
  );
  let chosen: string | null = best?.plantId ?? null;

  const roster = el("div", { class: "row", style: "gap:8px;overflow-x:auto;margin-bottom:12px;padding-bottom:4px" });
  const listHost = el("div");
  if (mature.length) {
    root.append(
      el("div", { class: "small", style: "font-weight:700;margin-bottom:6px" }, ["Cây đem đi"]),
      roster,
      listHost,
    );
  } else {
    root.appendChild(listHost);
  }

  /* --- the ladder ----------------------------------------------------------
     Painted into one host that can be replaced wholesale, so switching fighters cannot leave
     half the list showing the previous one's power. */
  function buildList(): void {
    listHost.replaceChildren();
    if (!mature.length) {
      listHost.appendChild(
        el("div", { class: "callout" }, ["Chưa có cây trưởng thành nào."]),
      );
      return;
    }

    /* Anchored at the frontier, not centred on the record.
     *
     * Centring put a player who had cleared 17 looking at stages 9-13 - all of them already
     * beaten, the top of the list cut off above, and the stage they were actually stuck on
     * nowhere on screen. A ladder is read from the top of what's left to climb. */
    const first = Math.max(1, ascent.highest + 1);
    const top = Math.max(1, first - Math.floor(LOOKAHEAD / 2));
    const bottom = top + WINDOW;

    const record = el("div", { class: "small", style: "font-weight:700;margin:4px 0 8px" }, [
      ascent.highest > 0 ? `Ải ${top} – ${bottom - 1}  ·  đã tới ải ${ascent.highest}` : `Ải ${top} – ${bottom - 1}`,
    ]);
    listHost.appendChild(record);
    for (let stage = top; stage < bottom; stage++) listHost.appendChild(stageRow(stage));

    if (ascent.highest >= bottom) {
      const more = el("button", { class: "btn block", style: "margin-top:8px" }, [`Xem ải ${bottom} trở đi`]);
      more.addEventListener("click", () => {
        sfx.play("tap");
        listHost.replaceChildren();
        // Appended rather than replacing the window, so the stages the player was reading do
        // not vanish upward while they scroll down.
        for (let stage = bottom; stage < bottom + WINDOW; stage++) listHost.appendChild(stageRow(stage));
      });
      listHost.appendChild(more);
    }
  }

  function rebuildRoster(): void {
    roster.replaceChildren();
    if (chosen && !mature.some((p) => p.plantId === chosen)) chosen = best?.plantId ?? null;
    for (const p of mature) {
      const chip = el("button", { class: "btn xs" + (chosen === p.plantId ? " primary" : "") }, [
        `${p.name} · ${p.powerRating}`,
      ]);
      chip.addEventListener("click", () => {
        chosen = p.plantId;
        sfx.play("tap");
        // Rebuilt rather than re-rendered, so the ladder does not scroll back to the top and
        // the player loses the stage they were reading.
        rebuildRoster();
        buildList();
      });
      roster.appendChild(chip);
    }
  }

  function stageRow(stage: number): HTMLElement {
    const cleared = stage <= ascent.highest;
    const open = stage <= ascent.highest + LOOKAHEAD;
    const brief = store.stageBrief(stage);
    const monster = open ? store.stageMonster(stage) : null;

    const row = el("div", { class: "card", style: "margin-bottom:8px" });
    row.append(
      el("div", { class: "row between" }, [
        el("div", { style: "font-weight:800" }, [cleared ? `✅ Ải ${stage}` : `Ải ${stage}`]),
        el("div", { class: "tiny muted" }, [BAND_LABEL[brief.band]]),
      ]),
    );

    if (!open || !monster) {
      row.appendChild(
        el("div", { class: "tiny muted", style: "margin-top:6px" }, [`Vượt ải ${ascent.highest + 1} để mở.`]),
      );
      return row;
    }

    row.appendChild(monsterStrip(monster, brief));

    if (cleared) {
      row.appendChild(
        el("div", { class: "tiny muted", style: "margin-top:6px" }, [
          `Đã vượt · ${TIER_META[brief.tier].label} · ${RARITY_META[brief.rarity].label}`,
        ]),
      );
    }

    if (chosen) {
      const fight = el("button", { class: "btn primary block", style: "margin-top:10px" }, [
        cleared ? "Đánh lại" : "Vượt ải này",
      ]);
      fight.addEventListener("click", () => {
        sfx.play("tap");
        openFight(stage, chosen!, monster);
      });
      row.appendChild(fight);
    }
    return row;
  }

  /** The monster's own body and its affixes: what makes a stage legible before it is a fight. */
  function monsterStrip(monster: MonsterSpec, brief: StageBrief): HTMLElement {
    const box = el("div", { class: "row", style: "gap:10px;margin-top:10px;align-items:flex-start" });
    const tint = monster.affixes[0]?.colour ?? "#2f4a2a";
    const art = el("div", {
      style: `width:56px;height:56px;flex:0 0 56px;border-radius:10px;background:${tint}33;overflow:hidden`,
    });
    art.innerHTML = renderPlantSvg(monster.plant, 56, { anim: false });
    box.appendChild(art);

    const info = el("div", { class: "grow" });
    info.append(
      el("div", { style: "font-weight:700;font-size:13px" }, [monster.name]),
      el("div", { class: "tiny muted" }, [
        [ELEMENT_INFO[monster.element]?.name ?? monster.element, "·", ARCHETYPE_ROLE[monster.archetype], "·", monster.rarity].join(" "),
      ]),
      el("div", { class: "tiny mono" }, [`${monster.power} lực`]),
    );

    /* The share of the player's own best, which is the number that actually says whether this
       is winnable. Printed only with a fighter: against an empty garden the percentage is
       meaningless rather than reassuring. */
    if (best) {
      const pct = Math.round(brief.share * 100);
      const tone = pct > 110 ? "var(--bad)" : pct > 95 ? "#c9821f" : "var(--accent-2)";
      info.appendChild(
        el("div", { class: "tiny", style: `color:${tone};font-weight:700` }, [
          pct > 115 ? "Quá mạnh" : pct > 95 ? "Kịch tranh" : `Khoảng ${pct}% sức mạnh của bạn`,
        ]),
      );
    }

    if (monster.affixes.length) {
      const chips = el("div", { class: "row", style: "gap:4px;flex-wrap:wrap;margin-top:6px" });
      for (const a of monster.affixes) {
        chips.appendChild(
          el(
            "span",
            {
              style: `background:${a.colour}22;border:1px solid ${a.colour}66;border-radius:5px;padding:1px 5px`,
              title: a.gloss,
            },
            [a.name],
          ),
        );
      }
      info.appendChild(chips);
    }

    box.appendChild(info);
    return box;
  }

  /** The fight: the arena's own battle view, pointed at the monster. */
  function openFight(stage: number, plantId: string, monster: MonsterSpec): void {
    const me = store.get(plantId);
    if (!me) return;

    const out = store.runAscentStage(plantId, stage);
    if (!out.ok) {
      listHost.prepend(el("div", { class: "callout", style: "margin-bottom:10px" }, [out.reason ?? "Không thể đánh."]));
      return;
    }

    /* The fight, with its own heading above the verdict card.
     *
     * Two things came out of looking at this rather than reading it. The verdict was in the
     * same card as the fight and the fight is 300px tall, so on a phone "Vượt ải 16: thắng"
     * and "🏆 Vượt ải 16!" appeared at two different times in the same view and the player
     * could read the stale one first. And the whole screen still showed the ladder underneath,
     * which is what let a defeated fight stay on screen without anything looking wrong.
     *
     * So the fight replaces the list for as long as it is on, and gets its own header. */
    /* The fight takes over the screen. `hidden` rather than removed, so the ladder is still
       there when it ends and coming back does not re-render it from nothing. */
    /* Non-interactive: the store already settled it, and letting the player cast into a battle
       that is over would be theatre.

       The controls go with it. Left in place they invited input on a decided fight - and the
       screenshot of a finished stage showed a stance row, an auto-toggle, a speed toggle and a
       skill list, all live, under the result. A player would reasonably read that as a fight
       they could still lose. So the view is told to hide them rather than having this screen
       reach into its DOM, which keeps the decision where the markup is. */
    listHost.hidden = true;
    const sheet = el("div", { class: "card pop", style: "margin-bottom:12px" });
    const stageTitle = el("div", { class: "small", style: "font-weight:700;margin-bottom:2px" }, [
      `Ải ${stage} · ${monster.name}`,
    ]);
    const verdict = el("div", { style: "font-weight:800;margin-bottom:8px" }, [
      out.won ? `🏆 Vượt ải ${stage}!` : `Ải ${stage}: thua`,
    ]);
    const host = el("div");
    const footer = el("div");
    sheet.append(stageTitle, verdict, host, rewardStrip(out.reward!, out.drops ?? []), footer);
    root.prepend(sheet);
    root.scrollIntoView({ block: "start", behavior: "smooth" });

    if (out.nextUnlocked) {
      footer.appendChild(el("div", { class: "callout", style: "margin-top:10px" }, [`Ải ${out.nextUnlocked} đã mở.`]));
    }

    const view = new BattleView({
      container: host,
      plantA: me,
      plantB: monster.plant,
      mySide: "a",
      interactive: false,
      hideControls: true,
      onFinish: () => {
        const done = el("button", { class: "btn block", style: "margin-top:10px" }, ["Về thang"]);
        done.addEventListener("click", () => {
          sfx.play("tap");
          // Repainted from the store rather than navigated away, so the ladder comes back at
          // the new record with the stage just cleared marked - which is the receipt for it.
          rebuildRoster();
          buildList();
          listHost.hidden = false;
          sheet.remove();
        });
        footer.appendChild(done);
        done.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
    });
    view.start();
  }

  /** What the fight paid, printed from the same figures that were credited. */
  function rewardStrip(reward: StageReward, drops: DropRoll[]): HTMLElement {
    const box = el("div", { class: "row", style: "gap:12px;flex-wrap:wrap;margin-top:8px" });
    const add = (icon: string, amount: number) => {
      if (amount <= 0) return;
      box.appendChild(el("span", { class: "small", style: "font-weight:700" }, [`${icon} +${compactNumber(amount)}`]));
    };
    add("🪙", reward.leafCoin);
    add("🍯", reward.nectar);
    add("🌼", reward.pollen);
    add("💎", reward.geneCrystal);
    add("🎒", reward.items);
    // Dropped by the arena's own table, so the odds it prints and the odds it pays agree.
    for (const d of drops) add(iconOf(d.currency), d.amount);
    box.appendChild(el("span", { class: "small muted" }, [`+${reward.plantXp} EXP cây`]));
    return box;
  }

  rebuildRoster();
  buildList();
  return root;
}

/** The currency's own glyph, so a reward cannot name the wrong thing. */
function iconOf(id: CurrencyId): string {
  return id === "nectar" ? "🍯" : id === "pollen" ? "🌼" : id === "ember" ? "🔥" : "🪙";
}