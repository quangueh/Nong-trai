/**
 * The stage overlay: starting one, completing one, failing one, and the tally in between.
 *
 * ## Why the fight's outcome is a scene and not a banner
 *
 * A stage is the game's main unit of progress and a banner is the game's way of saying
 * something that already happened. "Ải 20: thua" in a strip that slides away for three
 * seconds cannot carry: which of your plant fought, what the monster was, what it cost,
 * what you earned, and what is now open that was not open before. So a stage gets a panel
 * with a tally, and the banner keeps doing the banner's job.
 *
 * ## Everything on screen is a number the store already paid
 *
 * The tally is built from the reward object `runAscentStage` returned, not recomputed from
 * the stage's tables. Two sources of truth for a payout means the receipt and the ledger
 * can disagree, and a receipt that lies about what was paid is worse than no receipt.
 *
 * ## The continue button waits
 *
 * It is disabled until the tally has finished counting. Not as theatre — as a contract: a
 * player who can press through in the first 200ms sees a total that is still counting up,
 * and either reads the wrong number or learns that the number is not worth waiting for.
 */

import { el } from "../components";
import { sfx } from "../../audio/audio";
import { reducedMotion } from "../../audio/audio";
import { compactNumber } from "../../core/currency";
import type { DropRoll } from "../../core/drops";
import type { StageBrief, StageReward } from "../../pve";
import type { MonsterSpec } from "../../pve";
import { celebrateLevelUp, rewardsFromMilestones } from "./levelUp";
import { milestoneForLevel, previewPlantGain, xpRemainingText, plantSnapshot } from "../../progression/levels";
import { stageIdentity } from "../../pve/stages";
import { stageObjectives, type ObjectiveOutcome } from "../../progression/objectives";
import type { Plant } from "../../core/types";

/** How long one tally line takes to count. */
const COUNT_MS = 420;

export interface StageOutcome {
  won: boolean;
  stage: number;
  monster: MonsterSpec;
  reward: StageReward;
  drops: DropRoll[];
  nextUnlocked?: number;
  /** Which sub-objectives were met, and what they paid. From the store, not recomputed. */
  objectives?: ObjectiveOutcome;
  /** The plant that fought, so the result can name it and preview its own EXP. */
  fighter: Plant;
  /**
   * The stage's power as a share of this account's best plant, for the outlook line.
   *
   * Passed rather than recomputed because the ladder's "this is 52% of your strongest"
   * figure is a function of the *chosen* plant, and a result screen that recomputed it from
   * the store's best fighter would contradict the brief the player agreed to ten seconds ago.
   */
  share?: number;
}

/**
 * Show the result, count the rewards, then let the player continue.
 *
 * `onNext` is offered only when a stage was actually cleared and the next one exists —
 * a "next stage" button on a failed stage is a button that leads to a fight they just
 * lost, which is how a player learns to stop reading the button.
 */
export function showStageResult(out: StageOutcome, onContinue: () => void): Promise<void> {
  const calm = reducedMotion();
  const overlay = el("div", { class: `stagelive${calm ? " is-calm" : ""}${out.won ? " is-win" : " is-lose"}`, role: "status" });
  const identity = stageIdentity(out.stage, out.share ?? 1);

  const panel = el("div", { class: "stagelive-panel" });
  overlay.appendChild(panel);

  panel.append(
    el("div", { class: "stagelive-mark" }, [out.won ? "🏆" : "💀"]),
    el("div", { class: "stagelive-title" }, [out.won ? `Vượt ${identity.name}` : `Thua ở ${identity.name}`]),
    el("div", { class: "stagelive-sub" }, [`Ải ${out.stage} · ${identity.bandLabel} · ${out.fighter.name} vs ${out.monster.name}`]),
  );

  /*
   * The objective, restated — and this time it is the stage's *own* conditions, read from
   * `stageIdentity` rather than written out again here.
   *
   * Two reasons it matters more than it looks. First, because the fight is resolved before
   * this panel exists, so the player has no other way to find out what they were asked to.
   * Second, because on a loss this is the most useful line on the screen: it is the answer
   * to "why did that happen" — and the timeout rule in particular explains a loss that looks
   * inexplicable, because their plant was still standing.
   */
  panel.appendChild(
    el("div", { class: "stagelive-goal" }, [
      el("span", { class: "stagelive-goal-label" }, ["Luật"]),
      el("span", {}, [identity.conditions.win]),
      el("span", { class: "stagelive-goal-result" }, [out.won ? "✔ Đạt" : "✘ Chưa đạt"]),
    ]),
  );
  panel.appendChild(el("div", { class: "stagelive-rule tiny muted" }, [identity.conditions.timeout]));

  /* The tally. Built once, counted with `textContent`, so the number that lands is the
     number that was paid. */
  const lines: { icon: string; label: string; amount: number }[] = [
    { icon: "🪙", label: "Xu", amount: out.reward.leafCoin },
    { icon: "🍯", label: "Mật ong", amount: out.reward.nectar },
    { icon: "🌼", label: "Phấn hoa", amount: out.reward.pollen },
    { icon: "💎", label: "Ngọc gen", amount: out.reward.geneCrystal },
    { icon: "🎒", label: "Vật phẩm", amount: out.reward.items },
  ];
  for (const d of out.drops) {
    const icon = d.currency === "nectar" ? "🍯" : d.currency === "pollen" ? "🌼" : "🪙";
    const existing = lines.find((l) => l.icon === icon);
    if (existing) existing.amount += d.amount;
    else lines.push({ icon, label: "Rơi thêm", amount: d.amount });
  }

  const tally = el("div", { class: "stagelive-tally" });
  const rows = lines
    .filter((l) => l.amount > 0)
    .map((l) => {
      const value = el("span", { class: "stagelive-tally-value mono" }, ["0"]);
      const row = el("div", { class: "stagelive-tally-row" }, [
        el("span", { class: "stagelive-tally-icon" }, [l.icon]),
        el("span", { class: "grow" }, [l.label]),
        value,
      ]);
      tally.appendChild(row);
      return { row, value, amount: l.amount };
    });
  panel.appendChild(tally);

  /* Plant EXP, and what it will become — the "preview what this is worth" line. */
  const xpLine = el("div", { class: "stagelive-xp" });
  panel.appendChild(xpLine);

  /*
   * The sub-objectives, scored.
   *
   * Four rows, met and unmet alike. Showing only the ones that landed turns a checklist into
   * a trophy case — the player cannot tell what to try next, which is the only reason a
   * checklist is worth having. The unmet ones are greyed rather than hidden for that reason.
   */
  if (out.objectives) {
    const objHost = el("div", { class: "stagelive-objectives" });
    objHost.appendChild(
      el("div", { class: "stagelive-objectives-title tiny muted" }, [
        `Mục tiêu phụ  ${out.objectives.stars}/4`,
      ]),
    );
    for (const o of out.objectives.met) {
      objHost.appendChild(
        el("div", { class: "stagelive-objective is-met" }, [
          el("span", {}, [o.icon]),
          el("span", { class: "grow" }, [o.label]),
          el("span", { class: "mono tiny" }, [`+${o.xp}`]),
        ]),
      );
    }
    for (const o of out.objectives.missed) {
      objHost.appendChild(
        el("div", { class: "stagelive-objective" }, [
          el("span", {}, [o.icon]),
          el("span", { class: "grow" }, [o.label, el("span", { class: "tiny muted" }, [` — ${o.hint}`])]),
          el("span", { class: "mono tiny muted" }, ["—"]),
        ]),
      );
    }
    panel.appendChild(objHost);
  }

  /* The continue button, disabled while the tally runs. */
  const go = el("button", { class: "btn primary block", style: "margin-top:12px" }, [
    out.nextUnlocked ? `Tiếp tục → ải ${out.nextUnlocked}` : "Tiếp tục",
  ]);
  go.disabled = true;
  panel.appendChild(go);

  if (out.nextUnlocked) {
    panel.appendChild(el("div", { class: "stagelive-unlock" }, [`🔓 Ải ${out.nextUnlocked} đã mở khoá`]));
  }

  (document.querySelector(".shell") ?? document.body).appendChild(overlay);

  /* --- the count ------------------------------------------------------- */
  let cancelled = false;

  const countUp = (el0: HTMLElement, to: number, ms: number): Promise<void> =>
    new Promise((resolve) => {
      if (calm || to <= 0) {
        el0.textContent = `+${compactNumber(to)}`;
        resolve();
        return;
      }
      const start = performance.now();
      const step = (now: number): void => {
        if (cancelled) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / ms);
        // easeOutCubic: fast at first, settling. Linear would look like a loading bar and
        // would keep the last digits moving right up to the moment it stops, which is the
        // opposite of "settled".
        const eased = 1 - Math.pow(1 - t, 3);
        el0.textContent = `+${compactNumber(Math.round(to * eased))}`;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  /*
   * The EXP line, counting the base reward and the objective bonus separately.
   *
   * Split rather than summed because "where did this number come from" is the question a
   * result screen exists to answer, and a single total teaches the player that objectives
   * are decoration. The bonus only appears when it is non-zero, so a scrappy win does not
   * get an empty line about a bonus it did not earn.
   */
  const bonusXp = out.objectives?.bonusPlantXp ?? 0;
  const xpPreview = previewPlantGain(out.reward.plantXp + bonusXp, out.fighter);
  const snap = plantSnapshot(out.fighter);

  (async () => {
    sfx.play(out.won ? "levelUp" : "lose");
    for (const r of rows) await countUp(r.value, r.amount, COUNT_MS);

    xpLine.append(
      el("span", { class: "stagelive-xp-icon" }, ["🌱"]),
      el("span", { class: "grow" }, [`${out.fighter.name} nhận EXP`]),
      el("span", { class: "mono" }, [`+${out.reward.plantXp + bonusXp}`]),
    );
    if (bonusXp > 0) {
      xpLine.appendChild(el("div", { class: "stagelive-xp-bonus" }, [`gồm +${bonusXp} EXP mục tiêu phụ`]));
    }
    if (xpPreview.levelsGained > 0) {
      xpLine.appendChild(
        el("div", { class: "stagelive-xp-next" }, [
          xpPreview.levelsGained > 1
            ? `↗ Sẽ lên ${xpPreview.levelsGained} cấp (tới cấp ${xpPreview.finalLevel})`
            : `↗ Còn ${xpRemainingText(snap)}`,
        ]),
      );
    } else {
      xpLine.appendChild(el("div", { class: "stagelive-xp-next" }, [xpRemainingText(snap)]));
    }

    go.disabled = false;
    go.focus();
  })();

  /* --- the plant's own level-up, after the tally -----------------------
     Shown here rather than pushed as a separate global celebration, because it is caused by
     this fight and the player is already looking at the number that caused it. Two
     celebrations in a row — this one and the breeder's — would be one too many.
  */
  if (xpPreview.levelsGained > 0) {
    const milestones = xpPreview.milestones;
    void xpPreview.levelsGained;
    setTimeout(() => {
      void celebrateLevelUp({
        level: xpPreview.finalLevel,
        levelsGained: xpPreview.levelsGained,
        subject: out.fighter.name,
        subjectIcon: "🌱",
        expGained: out.reward.plantXp,
        after: snap,
        rewards: rewardsFromMilestones(milestones),
      });
    }, 900);
  }

  return new Promise<void>((resolve) => {
    const finish = (): void => {
      cancelled = true;
      sfx.play("tap");
      overlay.remove();
      onContinue();
      resolve();
    };
    go.addEventListener("click", finish);
  });
}

/**
 * The pre-fight panel: what this stage is, what it asks, and what it pays.
 *
 * Shown before the fight starts rather than after, so "điều kiện thắng" is something the
 * player knows *while* they are playing rather than something they are told about
 * afterwards.
 */
export function showStageBrief(brief: StageBrief, monster: MonsterSpec, fighter: Plant | null, onFight: () => void): void {
  const overlay = el("div", { class: "stagebrief", role: "dialog" });
  const panel = el("div", { class: "stagebrief-panel" });
  const id = stageIdentity(brief.index, brief.share);

  panel.append(
    el("div", { class: "stagebrief-title" }, [`Ải ${brief.index} · ${id.bandLabel}`]),
    el("div", { class: "stagebrief-name" }, [id.name]),
    el("div", { class: "stagebrief-monster" }, [monster.name]),
    el("div", { class: "stagebrief-meta tiny muted" }, [
      `${monster.rarity} · ${monster.power} lực · ${Math.round(brief.share * 100)}% sức mạnh cây của bạn`,
    ]),
  );

  /*
   * Difficulty, split into the part that is a property of the stage and the part that is a
   * property of *this* account against it.
   *
   * "Khó" alone tells a player nothing they can act on — stage 20 is a formality for a bred
   * garden and a wall for a new one. The outlook is the answerable half, and it comes from
   * the same `share` the power figure above prints, so the two cannot disagree.
   */
  panel.appendChild(
    el(
      "div",
      { class: `stagebrief-diff is-${id.difficulty.outlook}` },
      [
        el("span", { class: "stagebrief-diff-label tiny muted" }, ["Độ khó"]),
        el("span", { class: "stagebrief-diff-value" }, [id.difficulty.label]),
        el("span", { class: "stagebrief-diff-outlook" }, [id.difficulty.outlookLabel]),
      ],
    ),
  );

  const rows: [string, string][] = [
    ["🎯", id.conditions.win],
    ["⚔", id.conditions.lose],
    ["⏱", id.conditions.timeout],
  ];
  const goal = el("div", { class: "stagebrief-rows" });
  for (const [icon, text] of rows) {
    goal.appendChild(el("div", { class: "stagebrief-row" }, [el("span", {}, [icon]), el("span", { class: "grow" }, [text])]));
  }
  panel.appendChild(goal);

  if (id.conditions.hazard) {
    panel.appendChild(
      el("div", { class: "stagebrief-hazard" }, [
        el("b", {}, [id.conditions.hazard.name]),
        el("span", { class: "tiny muted" }, [id.conditions.hazard.gloss]),
      ]),
    );
  }

  /*
   * The sub-objectives, before the fight.
   *
   * Listed here rather than only on the result because an objective the player learns about
   * afterwards is not an objective — it is a receipt for something they had no way to know
   * they could have done. Each row states the threshold in the fight's own units ("Liên hoàn
   * — đánh liên 5 lần không bị trúng đòn"), because "Liên hoàn" on its own is a word.
   *
   * The EXP they are worth is shown too, and the brief's EXP preview is recomputed to include
   * them, so the number the player is deciding on is the number a perfect run would pay.
   */
  const objectives = stageObjectives(brief.index);
  const objHost = el("div", { class: "stagebrief-objectives" });
  objHost.appendChild(el("div", { class: "stagebrief-objectives-title tiny muted" }, ["Mục tiêu phụ"]));
  for (const o of objectives) {
    objHost.appendChild(
      el("div", { class: "stagebrief-objective" }, [
        el("span", { class: "stagebrief-objective-icon" }, [o.icon]),
        el("span", { class: "grow" }, [el("b", {}, [o.label]), el("span", { class: "tiny muted" }, [` — ${o.hint}`])]),
        el("span", { class: "stagebrief-objective-xp mono tiny" }, [`+${o.xp}`]),
      ]),
    );
  }
  panel.appendChild(objHost);

  /* The payout, and — the part that was missing — what the EXP will become. A player
     deciding whether a fight is worth the risk needs "will this level me", not "this gives
     247 EXP". */
  const pay = el("div", { class: "stagebrief-pay" });
  pay.appendChild(el("div", { class: "stagebrief-pay-title tiny muted" }, ["Phần thưởng nếu thắng"]));
  const payRow = el("div", { class: "stagebrief-pay-row" });
  const add = (icon: string, n: number): void => {
    if (n <= 0) return;
    payRow.appendChild(el("span", { class: "small" }, [`${icon} ${compactNumber(n)}`]));
  };
  add("🪙", brief.reward.leafCoin);
  add("🍯", brief.reward.nectar);
  add("🌼", brief.reward.pollen);
  add("💎", brief.reward.geneCrystal);
  add("🎒", brief.reward.items);
  pay.appendChild(payRow);

  if (fighter) {
    /*
     * The preview covers a *perfect* run, not the base payout.
     *
     * The stage's own experience plus every sub-objective, because that is the best the fight
     * can do and it is the number a player deciding whether to spend an attempt actually wants.
     * Previewing only the base reward would understate a good run by up to four times, and the
     * objectives would read as a bonus rather than as most of the reason to fight well.
     */
    const perfectXp = brief.reward.plantXp + objectives.reduce((sum, o) => sum + o.xp, 0);
    const preview = previewPlantGain(perfectXp, fighter);
    pay.appendChild(
      el("div", { class: "stagebrief-xp" }, [
        `🌱 +${brief.reward.plantXp} EXP cho ${fighter.name}` +
        (objectives.length ? ` (tối đa +${perfectXp - brief.reward.plantXp} từ mục tiêu phụ)` : "") +
        (preview.levelsGained > 0
          ? preview.levelsGained > 1
            ? ` — đủ để lên ${preview.levelsGained} cấp!`
            : " — đủ lên 1 cấp!"
          : ` — ${xpRemainingText(plantSnapshot(fighter))}`),
      ]),
    );
  }
  panel.appendChild(pay);

  if (brief.affixes.length) {
    const chips = el("div", { class: "stagebrief-affixes" });
    for (const a of brief.affixes) {
      chips.appendChild(
        el("span", { class: "stagebrief-affix", style: `--c:${a.colour}`, title: a.gloss }, [a.name]),
      );
    }
    panel.append(el("div", { class: "tiny muted" }, ["Đặc tính quái thủ"]), chips);
  }

  const go = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["Bắt đầu"]);
  const cancel = el("button", { class: "btn ghost block", style: "margin-top:8px" }, ["Quay lại"]);
  panel.append(go, cancel);
  overlay.appendChild(panel);
  (document.querySelector(".shell") ?? document.body).appendChild(overlay);

  const close = (): void => overlay.remove();
  go.addEventListener("click", () => {
    close();
    onFight();
  });
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (e: Event) => {
    if (e.target === overlay) close();
  });
  go.focus();
}

/** The reward milestones a level opens, for the map's tooltip. */
export function stageUnlocksAt(level: number): string[] {
  return milestoneForLevel(level).unlocked.map((u) => u.label);
}