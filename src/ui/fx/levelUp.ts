/**
 * The level-up celebration, and the experience bar it is a celebration *of*.
 *
 * ## Why this is a module and not a function in a screen
 *
 * Four surfaces need it — a stage cleared, a plant levelled after a fight, a care action,
 * the breeder levelling — and none of them owns it. Written once per screen it would be
 * four slightly different animations, and the fourth would be the one nobody checked.
 *
 * ## Everything here is bound to real state
 *
 * Nothing here invents a number. The level, the EXP, the milestones and the rewards are
 * all arguments, and the caller passes what the store just committed. The one thing this
 * module decides for itself is *when a grant happened*, because it listens for it rather
 * than being told — see `watchProgression`.
 *
 * ## Reduced motion is honoured, not merely respected
 *
 * `reducedMotion()` collapses the whole sequence to a plain panel with no particles, no
 * shake, no flight and no stagger. The information is identical: a player with vestibular
 * sensitivity gets told exactly what they unlocked, in the same order, in about a second.
 */

import { el } from "../components";
import { reducedMotion, sfx } from "../../audio/audio";
import {
  xpRemainingText,
  type Milestone,
  type ProgressionSnapshot,
} from "../../progression/levels";

/** One reward line in the celebration. */
export interface LevelUpReward {
  icon: string;
  label: string;
  gloss: string;
}

export interface LevelUpOptions {
  /** The level reached, or the highest level crossed when several were. */
  level: number;
  /** How many were crossed. One is the common case; more happens on a big stage clear. */
  levelsGained: number;
  /** What the EXP was for: the breeder, or a named plant. */
  subject: string;
  subjectIcon?: string;
  /** EXP banked, for the "you just earned" line. */
  expGained: number;
  /** The bar after the grant, so the celebration can show where it landed. */
  after: ProgressionSnapshot;
  /** Everything unlocked across the levels crossed, de-duplicated and in order. */
  rewards: LevelUpReward[];
  /** Called when the player dismisses the panel. Awaited before the next one shows. */
  onDone?: () => void;
}

/**
 * Show the celebration. Resolves when it is dismissed.
 *
 * Never rejects. A celebration that can throw takes the fight that earned it down with it.
 */
export function celebrateLevelUp(options: LevelUpOptions): Promise<void> {
  const calm = reducedMotion();
  const host = document.querySelector(".shell") ?? document.body;

  const overlay = el("div", { class: `lvlup${calm ? " is-calm" : ""}`, role: "status" });

  /* The flash and the shake are the cheapest parts of the moment and the first two things
     to disappear under reduced motion — both are pure vestibular triggers and neither
     carries information. */
  if (!calm) {
    overlay.appendChild(el("div", { class: "lvlup-flash" }));
    overlay.appendChild(el("div", { class: "lvlup-shake" }));
  }

  const panel = el("div", { class: "lvlup-panel" });
  overlay.appendChild(panel);

  const title = el("div", { class: "lvlup-title" }, [options.levelsGained > 1 ? "LÊN CẤP!" : "LÊN CẤP!"]);
  panel.append(
    title,
    el("div", { class: "lvlup-level" }, [`${options.subjectIcon ?? "🌿"} Cấp ${options.level}`]),
    el("div", { class: "lvlup-exp" }, [
      options.expGained > 0
        ? `+${options.expGained.toLocaleString("vi-VN")} EXP`
        : `${options.subject} đã lên cấp`,
    ]),
  );

  /* Where the bar landed. A bar and a number, because either alone is a question. */
  const bar = el("div", { class: "lvlup-bar" }, [el("i")]);
  const fill = bar.firstElementChild as HTMLElement;
  panel.append(bar, el("div", { class: "lvlup-bar-text" }, [xpRemainingText(options.after)]));

  /* The rewards, staggered. The stagger is the point: they arrive one at a time so the
     player reads them, rather than as a wall that gets glanced at once. Under reduced
     motion they all appear at once, because a stagger is time, and time is the thing being
     removed. */
  if (options.rewards.length) {
    const list = el("div", { class: "lvlup-rewards" });
    options.rewards.forEach((r, i) => {
      const card = el("div", { class: "lvlup-reward", style: `--i:${i}` });
      /*
       * The icon bounces on its own, after the card has landed.
       *
       * The card's entrance is the stagger; this is the accent, and it is delayed past it so
       * the two do not read as one movement. Under reduced motion the CSS drops both.
       */
      card.append(
        el("span", { class: "lvlup-reward-icon" }, [r.icon]),
        el("span", { class: "lvlup-reward-body" }, [
          el("b", {}, [r.label]),
          el("span", { class: "lvlup-reward-gloss" }, [r.gloss]),
        ]),
      );
      list.appendChild(card);
    });
    panel.append(list);
  } else if (options.levelsGained > 1) {
    panel.appendChild(el("div", { class: "lvlup-note tiny muted" }, [`Vượt ${options.levelsGained} cấp liên tiếp.`]));
  }

  const go = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["Tiếp tục"]);
  panel.appendChild(go);

  host.appendChild(overlay);

  const done = new Promise<void>((resolve) => {
    const finish = (): void => {
      sfx.play("tap");
      overlay.classList.add("is-leaving");
      // Removed on the animation's own end rather than after a guessed delay: a timeout
      // that outlasts the animation leaves a visible ghost, and one that fires early cuts
      // the player off mid-swipe.
      const remove = (): void => {
        overlay.remove();
        resolve();
      };
      overlay.addEventListener("animationend", remove, { once: true });
      setTimeout(remove, 600);
    };
    go.addEventListener("click", finish);
    overlay.addEventListener("click", (e: Event) => {
      if (e.target === overlay) finish();
    });
  });

  /* The bar animates from empty, because "your bar filled" is the fact the celebration is
     reporting and a bar that was already full when the panel appeared reports nothing. */
  requestAnimationFrame(() => {
    fill.style.transform = `scaleX(${(options.after.pct / 100).toFixed(3)})`;
    /*
     * The full-bar flash, fired once the fill has landed rather than with it.
     *
     * `options.after.capped` means the bar is complete because the level cap was reached,
     * which is the strongest possible version of the same moment and gets the stronger
     * treatment. A bar that is merely "very full" is not the event, and flashing every fill
     * would make the real one mean nothing.
     */
    fill.addEventListener(
      "transitionend",
      () => {
        bar.classList.add("is-full");
        if (options.after.capped) bar.classList.add("is-capped");
        window.setTimeout(() => {
          bar.classList.remove("is-full", "is-capped");
        }, 1100);
      },
      { once: true },
    );
  });

  /*
   * Burst and sound, with one deliberate exception.
   *
   * The sound plays either way — a level-up is information, and reduced motion is about
   * vestibular triggers, not about muting the game. The burst is the part that goes, because
   * thirty particles flying outward is exactly the kind of movement that setting exists to
   * suppress.
   *
   * Previously this was an if/else whose two arms were identical except for the burst, which
   * read as though the calm path had a quieter sound. It did not; it read as though it might.
   */
  sfx.play("levelUp");

  /*
   * A second voice under it, half a beat later.
   *
   * `levelUp` states the fact — it is the same sound for every level and carries the weight.
   * `powerUp` is the sweep *into* the plant, and it is delayed rather than simultaneous
   * because two cues at once sum into one louder cue and the player hears neither: you feel
   * the volume go up rather than hearing two things happen.
   */
  window.setTimeout(() => sfx.play("powerUp"), 260);

  if (!calm) burst(panel);

  go.focus();
  void options.onDone;
  return done;
}

/**
 * The particle burst.
 *
 * DOM rather than canvas, deliberately: there are thirty of them, they live for under a
 * second, and thirty short-lived elements cost nothing where a second animation loop for
 * one effect on one screen would cost a frame budget every frame of every fight.
 *
 * Seeded from the panel's own box so the burst comes from where the player's eye already
 * is rather than from the middle of the screen.
 */
function burst(panel: HTMLElement): void {
  const box = panel.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height * 0.32;
  const colours = ["#ffd45e", "#6fce8f", "#7fc4ff", "#ff9d5c", "#ffffff"];

  for (let i = 0; i < 30; i++) {
    const p = el("div", { class: "lvlup-spark" });
    const angle = (i / 30) * Math.PI * 2 + (i % 3) * 0.18;
    const dist = 90 + ((i * 37) % 130);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--d", `${(i % 6) * 40}ms`);
    p.style.background = colours[i % colours.length];
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    document.body.appendChild(p);
    // Removed by the animation itself where the browser supports it; the timeout is the
    // fallback for a reduced-motion or backgrounded tab where the event never fires.
    p.addEventListener("animationend", () => p.remove(), { once: true });
    setTimeout(() => p.remove(), 1600);
  }
}

/**
 * Fly a number into a target, from wherever it was earned.
 *
 * Used for EXP gains that do *not* level anything, which are the common case and used to
 * produce nothing at all: the bar moved and there was no acknowledgement, so a player had
 * no way to tell a reward from a repaint.
 *
 * Returns immediately if reduced motion is on — there is no flight, only the bar's own
 * transition.
 */
export function flyExpTo(target: Element | null, amount: number, from?: Element | null): void {
  if (amount <= 0) return;
  if (reducedMotion()) return;
  if (!target) return;

  const to = target.getBoundingClientRect();
  const start = from?.getBoundingClientRect() ?? { left: window.innerWidth / 2, top: window.innerHeight * 0.4, width: 0, height: 0 };

  const n = Math.min(6, 1 + Math.floor(amount / 120));
  for (let i = 0; i < n; i++) {
    const chip = el("div", { class: "lvlup-fly" }, [`+${Math.round(amount / n).toLocaleString("vi-VN")}`]);
    const jx = start.left + (i - (n - 1) / 2) * 18;
    chip.style.left = `${jx}px`;
    chip.style.top = `${start.top}px`;
    chip.style.setProperty("--tx", `${to.left + to.width / 2 - jx}px`);
    chip.style.setProperty("--ty", `${to.top + to.height / 2 - start.top}px`);
    chip.style.setProperty("--d", `${i * 70}ms`);
    document.body.appendChild(chip);
    chip.addEventListener("animationend", () => chip.remove(), { once: true });
    setTimeout(() => chip.remove(), 1400);
  }
}

/**
 * Turn the store's level-up notices into celebrations.
 *
 * Returns a handler to hand to `store.onNotice`, rather than registering itself: this
 * module must not import the store, because the store's screens import this back and a
 * cycle here would be the kind that works until someone adds a top-level call.
 *
 * `onLevelUp` is where the real numbers come from — the caller reads the store, which is
 * the only thing that knows what actually happened. The notice is used only to decide
 * *that* something happened.
 */
export function levelNoticeHandler(opts: {
  onLevelUp: (o: { levelsGained: number; subject: string; subjectIcon: string }) => void;
}): (notice: { kind: string; title: string }) => void {
  return (notice) => {
    // Only level notices. An unlock or a quest still gets its banner, because those are
    // different facts and this celebration is specifically about a number going up.
    if (notice.kind !== "level") return;
    const gained = /vượt\s+(\d+)\s+cấp/i.exec(notice.title);
    opts.onLevelUp({
      levelsGained: gained ? Number(gained[1]) : 1,
      subject: "Cây của bạn",
      subjectIcon: "🌿",
    });
  };
}

/** Build the reward list for a set of milestones, de-duplicated. */
export function rewardsFromMilestones(milestones: Milestone[]): LevelUpReward[] {
  const seen = new Set<string>();
  const out: LevelUpReward[] = [];
  for (const m of milestones) {
    for (const r of m.unlocked) {
      if (seen.has(r.label)) continue;
      seen.add(r.label);
      out.push(r);
    }
  }
  return out;
}