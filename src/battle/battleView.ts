/** Battle playback controller: drives a BattleSession and paints the arena. */

import { el } from "../ui/components";
import { BattleSession, TICK_DT, STANCE_LABEL, battlePhase, type BattleEvent, type BattleSideState, type Stance } from "../battle/engine";
import type { Plant } from "../core/types";
import { renderPlantSvg } from "../render/plantRenderer";
import { RARITY_META } from "../config/rarity";
import type { ElementId } from "../config/elements";
import { FxLayer, deliveryGlyph, elementColour, type FxSide } from "./battleFx";
import { CombatJuice, weightFor } from "./juice";
import { sfx } from "../audio/audio";
import { dominantElement } from "../config/elements";
import type { Delivery, EffectKind } from "../config/skills";

export interface BattleIntent {
  kind: "cast" | "stance" | "focus";
  value?: string;
  stance?: Stance;
}

export interface BattleSummary {
  hp: number;
  hpPct: number;
  damageDealt: number;
  damageTaken: number;
  shields: number;
  heals: number;
  skillUses: number;
  energyPeak: number;
}

export interface BattleViewOptions {
  container: HTMLElement;
  plantA: Plant;
  plantB: Plant;
  mySide: "a" | "b";
  maxSeconds?: number;
  interactive?: boolean;
  /**
   * The seed the fight was already settled with, so this replays that fight instead of
   * running a second one.
   *
   * Supplied by anything that has already decided an outcome — the ladder passes the seed
   * `runAscentStage` returned. Omitted only when the view *is* the decision, which is the
   * arena, where the player's own inputs are part of the result.
   */
  seed?: string;
  /**
   * Stances to open with, when the caller already fixed them.
   *
   * Part of the same contract as `seed`: the store settles with the default stances, so a
   * replay that opened on anything else would diverge from tick one.
   */
  stances?: { a: Stance; b: Stance };
  /**
   * Draw the arena without the stance row, the skill bar or the speed controls.
   *
   * For a fight that is being watched rather than played - the PvE ladder, and a duel that
   * the Worker already resolved. Those fights have an outcome before the first frame, so
   * live controls on them invite input on a decision that is already made: the finished-stage
   * screenshot showed a stance row and a skill list still lit under the result, which reads as
   * a fight still in progress.
   */
  hideControls?: boolean;
  onIntent?: (intent: BattleIntent) => void;
  onFinish: (result: { winner: "a" | "b" | "draw"; a: BattleSummary; b: BattleSummary; events: BattleEvent[] }) => void;
}

const PHASE_LABEL: Record<string, string> = {
  opening: "Mở màn",
  mid: "Giữa trận",
  late: "Quyết chiến",
  overtime: "Overtime",
};

const STANCE_LIST: Stance[] = ["aggressive", "guard", "swift", "focus"];

/** Delivery and effect shown on each skill button, in plain Vietnamese. */
const DELIVERY_NAME: Record<Delivery, string> = {
  projectile: "Phun",
  melee: "Vung",
  aura: "Tỏa",
  trap: "Bẫy",
  channel: "Dây chuyền",
  summon: "Mộc",
  morph: "Biến hình",
};

const EFFECT_NAME: Record<EffectKind, string> = {
  damage: "sát thương",
  dot: "độc lan",
  heal: "hồi máu",
  shield: "khiên",
  slow: "làm chậm",
  stun: "choáng",
  root: "trói",
  chain: "dây chuyền",
  regen: "tái tạo",
  cleanse: "khử",
};

export class BattleView {
  readonly session: BattleSession;
  private readonly opts: BattleViewOptions;
  private readonly maxSeconds: number;
  /**
   * The live combo: consecutive damaging actions without being hit.
   *
   * Tracked here rather than by asking `readCombo` afterwards, because a combo the player
   * only sees on a results screen is not something to chase. The rule is identical to the one
   * `progression/objectives` applies to the recorded log — one rule, two consumers, so the
   * number on the result screen and the number that was counted on screen cannot disagree.
   */
  private comboRun = 0;
  private comboBest = 0;
  /** The live combo readout. One element, reused — see `paintCombo`. */
  private comboMeter!: HTMLElement;

  /** Live skill buttons, built once. See `renderSkills`. */
  private readonly skillBtns = new Map<string, { btn: HTMLButtonElement; cd: Element | null }>();
  private timer: number | null = null;
  private finished = false;
  private speed = 1;
  /** Whether the fight is stopped on purpose, as opposed to finished. */
  private paused = false;
  /** Whether this fight has announced itself. See estartTimer. */
  private started = false;
  private pauseBtn: HTMLButtonElement | null = null;
  /** Detached in `destroy`, or every fight ever opened would leave a keydown behind. */
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private pauseVeil: HTMLElement | null = null;

  /**
   * Stop and resume the fight.
   *
   * Public because the arena's own leave button and the ladder's back button both need it:
   * a fight that keeps ticking after the screen that showed it is gone is a fight playing
   * sounds in an empty garden.
   */
  togglePause(): void {
    if (this.finished) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.stop();
      this.showPauseVeil();
    } else {
      this.hidePauseVeil();
      this.restartTimer();
    }
    if (this.pauseBtn) this.pauseBtn.textContent = this.paused ? "▶" : "⏸";
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** The "paused" plate, so a stopped fight never looks like a hung one. */
  private showPauseVeil(): void {
    if (this.pauseVeil) return;
    this.pauseVeil = el("div", { class: "battle-paused" }, [
      el("div", { class: "battle-paused-title" }, ["⏸ Tạm dừng"]),
      el("div", { class: "tiny muted" }, ["Nhấn cách hoặc ▶ để tiếp tục"]),
    ]);
    // Over `.battlefield`, which is the positioned box the fighters and the fx layer live in.
    // It is not `.battlebox` - that class does not exist, and the veil was being appended to
    // `null` and silently doing nothing, so the pause stopped the fight with no way to tell.
    const field = this.opts.container.querySelector(".battlefield");
    if (field) field.appendChild(this.pauseVeil);
    else this.opts.container.appendChild(this.pauseVeil);
  }

  private hidePauseVeil(): void {
    this.pauseVeil?.remove();
    this.pauseVeil = null;
  }

  private fx!: FxLayer;
  private juice!: CombatJuice;
  /** What the last cast was, so its damage can be drawn as the same effect. */
  private lastCast: { side: FxSide; delivery: Delivery; colour: string; at: number } | null = null;
  private sides: Record<"a" | "b", FighterView> = { a: null as never, b: null as never };
  private clock!: HTMLElement;
  private phaseLabel!: HTMLElement;
  private logBox!: HTMLElement;
  private skillRow!: HTMLElement;
  private stanceRow!: HTMLElement;
  private focusBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;

  constructor(opts: BattleViewOptions) {
    this.opts = opts;
    this.maxSeconds = opts.maxSeconds ?? 90;
    /*
     * The seed the caller settled the fight with, when it has one.
     *
     * This is what makes a stage result honest. The view used to mint its own seed from
     * `Date.now()`, so the fight on screen and the fight the store had already paid for
     * were two different fights with the same participants — and, because the two engines
     * had drifted, they did not even agree on who won. A player could watch themselves win
     * a ladder stage and be told they lost.
     *
     * Passing the seed is only sufficient because there is now one engine. With two, an
     * identical seed would still have produced two different event logs.
     */
    this.session = new BattleSession(opts.plantA, opts.plantB, {
      seed: opts.seed ?? `view:${opts.plantA.plantId}:${opts.plantB.plantId}:${Date.now()}`,
      maxSeconds: this.maxSeconds,
      arena: "sunny",
      ...(opts.stances ? { stances: opts.stances } : {}),
    });
    this.build();
    this.opts.container.appendChild(this.comboMeter);
  }

  // --- construction ---

  private build(): void {
    /*
     * The combo meter.
     *
     * Built here and never rebuilt: it is one element whose text and classes change, which is
     * the opposite of the skill bar's old habit of being destroyed and recreated every tick.
     *
     * Hidden for a watched fight — the player cannot affect a fight they are only watching, so
     * a counter they cannot influence would be noise.
     */
    this.comboMeter = el("div", { class: "combometer", role: "status" });
    this.comboMeter.hidden = !this.opts.interactive;
    const c = this.opts.container;
    c.replaceChildren();

    const field = el("div", { class: "battlefield" });

    // The sky, sun and ground plane are already drawn by `.battlefield`'s own
    // pseudo-elements — adding real elements for them put a second ground on top
    // of the first. All this does is hand them the two fighters' element colours
    // so the arena is tinted by the plants standing in it.
    const dom = dominantElement(this.opts.plantA.dna.elementGenes).id;
    const foeDom = dominantElement(this.opts.plantB.dna.elementGenes).id;
    field.style.setProperty("--a-el", elementColour(dom));
    field.style.setProperty("--b-el", elementColour(foeDom));

    /*
     * Which side is "mine" is a UI question, not an engine one.
     *
     * Both peers settle the same fight with the same seed and the same plant order, so the
     * engine's `a` is the host on both screens. The player's own fighter still has to read as
     * *theirs*: styled as the ally and placed on the right, with the opponent on the left. Hard
     * coding `a` as the player put the guest's own plant on the enemy side and labelled it so.
     */
    const mine = this.opts.mySide;
    const other: "a" | "b" = mine === "a" ? "b" : "a";
    this.sides[mine] = new FighterView(this.session[mine], false, this.opts[mine === "a" ? "plantA" : "plantB"]);
    this.sides[other] = new FighterView(this.session[other], true, this.opts[other === "a" ? "plantA" : "plantB"]);

    const center = el("div", { class: "battle-arena" });
    this.phaseLabel = el("div", { class: "phase" }, ["Mở màn"]);
    this.clock = el("div", { class: "clock" }, [`${this.maxSeconds}`]);
    center.append(this.phaseLabel, this.clock);

    field.append(this.sides[other].root, center, this.sides[mine].root);

    // The contact wash. Owned by the arena so the juice layer has something to
    // drive without reaching into the effects markup.
    field.appendChild(el("div", { class: "battle-flash", "aria-hidden": "true" }));

    this.fx = new FxLayer(field);
    this.fx.bind(this.sides.a.root, this.sides.b.root);
    this.juice = new CombatJuice(
      field,
      { root: this.sides.a.root, avatar: this.sides.a.avatar },
      { root: this.sides.b.root, avatar: this.sides.b.avatar },
    );
    this.juice.attachFlash(field.querySelector<HTMLElement>(".battle-flash")!);
    c.appendChild(field);

    // --- action bar ---
    const controls = el("div", { class: "card", style: "padding:12px" });
    this.skillRow = el("div", { class: "actionbar" });
    this.stanceRow = el("div", { class: "segmented" });
    controls.append(this.skillRow, this.stanceRow);

    const tools = el("div", { class: "row", style: "gap:6px;justify-content:center;margin-top:10px;flex-wrap:wrap" });
    this.focusBtn = el("button", { class: "btn sm gold" }, ["✨ Bản năng"]) as HTMLButtonElement;
    this.focusBtn.addEventListener("click", () => {
      if (this.session.useFocus(this.opts.mySide)) {
        this.opts.onIntent?.({ kind: "focus" });
        this.pushLog("Bản năng được kích hoạt!", "hi");
    // State refresh only — the skill set cannot change mid-fight. This line used to rebuild
    // every button from scratch ten times a second, discarding a node the player could have
    // been pressing at that instant. See `renderSkills`.
        this.refreshSkillBar();
      }
    });
    this.autoBtn = el("button", { class: "btn sm ghost" }, ["🤖 Tự ra chiêu"]);
    let auto = true;
    this.autoBtn.addEventListener("click", () => {
      auto = !auto;
      this.session.side(this.opts.mySide).autoSkill = auto;
      this.autoBtn.textContent = `🤖 Tự ra chiêu: ${auto ? "BẬT" : "TẮT"}`;
    });
    const speedBtn = el("button", { class: "btn sm ghost" }, ["⏩ 1x"]);
    speedBtn.addEventListener("click", () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      speedBtn.textContent = `⏩ ${this.speed}x`;
      this.restartTimer();
    });

    /* Pause.
     *
     * A fight that cannot be paused is a fight the player has to sit through - and on a phone
     * that is a fight they put down mid-match. The tick is a plain interval, so pausing is
     * stopping it and resuming is restarting it; the simulation is untouched either way, so
     * nothing about the outcome depends on whether anybody was looking.
     *
     * Space bar as well, because holding a phone and reaching for a button is the worst of
     * both, and `Escape` for the same reason on a desktop. Both are ignored while the player
     * is typing in a field.
     */
    const pauseBtn = el("button", { class: "btn sm ghost", title: "Tạm dừng (cách)" }, ["⏸"]);
    pauseBtn.addEventListener("click", () => this.togglePause());
    this.pauseBtn = pauseBtn;
    this.onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space" || e.code === "Escape") {
        e.preventDefault();
        this.togglePause();
      }
    };
    window.addEventListener("keydown", this.onKey);

    tools.append(this.focusBtn, this.autoBtn, speedBtn, pauseBtn);
    controls.appendChild(tools);
    c.appendChild(controls);

    /* Watched rather than played: drop every control but the pause, which is the one thing a
       viewer still wants. The stances and skills go too - they are the game's inputs, and a
       viewer has none. */
    if (this.opts.hideControls) {
      controls.replaceChildren();
      const watch = el("div", { class: "row", style: "gap:8px;align-items:center" }, [
        el("span", { class: "tiny muted grow" }, ["Trận tự diễn — bạn có thể tạm dừng bất cứ lúc nào."]),
        pauseBtn,
      ]);
      controls.appendChild(watch);
      this.focusBtn.remove();
      this.autoBtn.remove();
      speedBtn.remove();
    }

    this.logBox = el("div", { class: "battlelog" });
    this.logBox.appendChild(el("div", { class: "l hi" }, ["Trận đấu bắt đầu!"]));
    c.appendChild(this.logBox);

    if (this.opts.hideControls) {
      // The skill bar and stance row are built and then taken straight back out; skipping the
      // build would mean branching renderSkills and renderStances, and those two are the same
      // code for both kinds of fight.
      this.renderSkills();
      this.renderStances();
      // `skillRow`, not `skillBar` - the latter is a CSS class, and reaching for it by name
      // would have left the real row on screen and taken nothing away.
      this.skillRow?.remove();
      this.stanceRow?.remove();
    } else {
      this.renderSkills();
      this.renderStances();
    }
  }

  // --- lifecycle ---

  start(): void {
    if (this.timer != null) return;
    this.restartTimer();
  }

  private restartTimer(): void {
    this.stop();
    if (this.finished) return;
    /*
     * Announce a *fresh* fight, once.
     *
     * `restartTimer` is also what un-pausing and changing speed call, so an unconditional
     * sound here would announce a new fight every time a player changes the speed — training
     * them to hear a start sound in the middle of one. `started` is the difference between
     * beginning and resuming.
     */
    if (!this.started) {
      this.started = true;
      sfx.play("start");
    }
    const tickMs = Math.max(16, (TICK_DT * 1000) / this.speed);
    this.timer = window.setInterval(() => this.advance(), tickMs);
  }

  stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.stop();
    this.paused = false;
    this.hidePauseVeil();
    if (this.onKey) {
      window.removeEventListener("keydown", this.onKey);
      this.onKey = null;
    }
    this.juice.destroy();
    this.fx.destroy();
    this.opts.container.replaceChildren();
  }

  /** Advance one logical tick. */
  advance(): void {
    if (this.finished) return;
    // Hitstop. The interval keeps firing; the simulation does not. Nothing about a
    // hit feels like a collision without this pause, and it is the cheapest piece
    // of juice there is.
    if (this.juice.frozen) return;
    const events = this.session.step();
    for (const ev of events) this.handleEvent(ev);
    this.sides.a.refresh();
    this.sides.b.refresh();
    this.sides.a.setStatuses(statusText(this.session.a, this.session.elapsed));
    this.sides.b.setStatuses(statusText(this.session.b, this.session.elapsed));

    const left = Math.max(0, this.maxSeconds - this.session.elapsed);
    this.clock.textContent = String(Math.ceil(left));
    this.clock.classList.toggle("critical", left <= 15);
    this.phaseLabel.textContent = PHASE_LABEL[battlePhase(this.session.elapsed, this.maxSeconds)];

    this.refreshSkillBar();

    if (this.session.done) {
      this.finished = true;
      this.stop();
      const s = this.session.summary();

      /*
       * The beat.
       *
       * The deciding blow and the result screen used to be separated by 750ms of nothing, so
       * a win and a loss looked identical through the moment the player is actually looking.
       * Now the frame is struck on the outcome: a short hard punch for a win, a longer dull
       * drop for a loss, and a draw gets neither — because "nothing happened" is the honest
       * reading of a draw and dressing it up would be a lie with a camera shake on it.
       *
       * The shake is already trauma-based and clamped in `Shake`, so this is a magnitude
       * rather than a new mechanism, and it respects `reducedMotion` the same way.
       */
      const mine = s.winner ? (s.winner === this.opts.mySide ? "win" : "lose") : "draw";
      this.playEndBeat(mine);

      setTimeout(() => this.opts.onFinish({ winner: s.winner, a: s.a, b: s.b, events: s.events }), 750);
    }
  }

  // --- painting ---

  /**
   * Draw the live combo, or break it.
   *
   * Escalates by run length rather than by a timer, so the feedback tracks the thing the
   * player is doing. The bands are deliberately coarse — three of them across the range a
   * ninety-second fight actually reaches — because a counter that changes its colour on every
   * hit is a counter nobody reads.
   *
   * One element, reused. Creating and removing a node per hit is the exact pattern that made
   * the skill bar expensive.
   */
  private paintCombo(broke: boolean): void {
    if (!this.opts.interactive) return;
    const meter = this.comboMeter;
    const n = this.comboRun;

    if (n < 2 && !broke) {
      if (meter.textContent) meter.textContent = "";
      return;
    }

    if (broke) {
      meter.textContent = this.comboBest >= 4 ? `Chuỗi ${this.comboBest} đứt` : "";
      meter.className = "combometer is-broke";
    } else {
      const band = n >= 12 ? 3 : n >= 6 ? 2 : 1;
      /*
       * The pitch is the run length.
       *
       * Capped at a nineteenth. A chain can reach thirty in a long fight, and thirty semitones
       * is three octaves of shrillness — the run would get *louder to the ear* exactly when it
       * should be getting more tense but not more painful. Half a semitone per hit also means
       * early gains are audible as steps rather than as one indistinct rise.
       */
      sfx.play("combo", { pitch: Math.min(19, n - 1) });
      meter.textContent = `${n}×`;
      meter.className = "combometer is-live band" + band;
    }

    // Re-trigger the pop by removing and restoring the class across a reflow. Assigning the
    // same class twice does nothing, and two hits landing in successive ticks is the common
    // case, not the rare one.
    meter.classList.remove("is-pop");
    void meter.offsetWidth;
    meter.classList.add("is-pop");
  }

  /**
   * The beat at the end of a fight.
   *
   * Win, loss and draw are three different things and get three different treatments: a short
   * hard punch, a longer dull drop, and nothing at all. A draw getting nothing is deliberate —
   * "nothing happened" is the honest reading of it, and dressing it up would be a lie with a
   * camera shake on it.
   *
   * Magnitudes, not a new mechanism: the underlying `Shake` is already trauma-based and
   * clamped, and already stands down under reduced motion.
   */
  private playEndBeat(kind: "win" | "lose" | "draw"): void {
    if (kind === "draw") return;
    this.opts.container.classList.add(kind === "win" ? "is-beat-win" : "is-beat-lose");
    window.setTimeout(() => this.opts.container.classList.remove("is-beat-win", "is-beat-lose"), 520);

    // The shake itself, so the frame is struck as well as tinted. A separate, small amount
    // from the per-hit shake: the fight already accumulated trauma, and adding a large one on
    // top would spend the whole budget on the last frame.
    const shake = kind === "win" ? 0.42 : 0.3;
    sfx.play(kind === "win" ? "win" : "lose");
    this.juice.shakeFor(shake, kind === "win" ? 260 : 420);
  }

  /**
   * Look up what a skill actually is, so its effect can be drawn as that effect.
   *
   * The events carry a skill id but not a delivery or an effect, and those are
   * what make a bolt look like a bolt and a heal look like a heal. The snapshot
   * on the casting side is the authoritative list.
   */
  private skillOf(side: FxSide, id: string | undefined) {
    if (!id) return null;
    return this.session.side(side).snap.skills.find((s) => s.id === id) ?? null;
  }

  private handleEvent(ev: BattleEvent): void {
    switch (ev.type) {
      case "BASIC_ATTACK": {
        if (!ev.side || !ev.other) break;
        this.sides[ev.side].attack();
        this.fx.strike(ev.side, ev.other, "melee", "damage", elementColour(dominantElement(this.session.side(ev.side).snap.elements).id), false);
        break;
      }
      case "SKILL_CAST_STARTED": {
        if (!ev.side) break;
        const skill = this.skillOf(ev.side, ev.skillId);
        const delivery: Delivery = skill?.core.delivery ?? "projectile";
        const effect: EffectKind = skill?.core.effect ?? "damage";
        const colour = elementColour(dominantElement(this.session.side(ev.side).snap.elements).id);
        this.pushLog(ev.text ?? "ra chiêu", "hi");
        this.sides[ev.side].attack();
        this.fx.castStart(ev.side, delivery, colour);
        this.fx.banner(ev.side, ev.skillName ?? "Chiêu", delivery);
        this.juice.cue("cast", ev.side, () => {});
        // Remembered, not scheduled. The engine resolves the skill and applies its
        // damage in this same tick, so the contact frame is this frame; the
        // delivery effect belongs to the impact, not to the windup.
        this.lastCast = { side: ev.side, delivery, colour, at: performance.now() };
        void effect;
        this.refreshSkillBar();
        break;
      }
      case "DAMAGE_APPLIED": {
        // `side` is the attacker and `other` is who was hit — see applyDamage in
        // the engine. Getting this backwards puts the hit flash on the plant that
        // threw the punch.
        const victim: FxSide = ev.other ?? (ev.side === "a" ? "b" : "a");
        const amount = ev.amount ?? 0;

        /*
         * The live combo, fed on the same event that draws the hit.
         *
         * Consecutive damaging actions without being hit, handled here rather than in a
         * separate pass so the number on screen cannot drift out of step with the hits being
         * drawn, and so "the counter went up" and "something landed" are the same frame — which
         * is the only reason it reads as a consequence rather than as a statistic.
         *
         * Same rule as `progression/objectives` applies to the recorded log afterwards, so the
         * best run on the results screen is the best run the player watched happen.
         *
         * Being hit breaks it, and the break animates too: a counter that only ever goes up
         * reads as decoration.
         */
        if (amount > 0) {
          const mine = this.opts.mySide;
          if (ev.side === mine && victim !== mine) {
            this.comboRun++;
            if (this.comboRun > this.comboBest) this.comboBest = this.comboRun;
            this.paintCombo(false);
          } else if (victim === mine && ev.side !== mine) {
            /*
             * Being hit gets its own cue, and is not the same sound as hitting something.
             *
             * `enemy` is filtered down an octave and has no bright top, so it reads as the
             * room changing rather than as another attack — which is the information the player
             * needs, because it is the difference between their plan working and their plan
             * being interrupted. The combo break below it is part of the same event, and having
             * one sound for both would mean hearing them as one thing.
             */
            sfx.play("enemy", { gain: 0.9 });
            if (this.comboRun > 0) {
              this.comboRun = 0;
              this.paintCombo(true);
            }
          }
        }

        if (amount > 0) {
          const maxHp = Math.max(1, this.session.side(victim).snap.maxHp);
          const weight = weightFor(amount / maxHp, ev.isCrit === true, (ev.hpAfter ?? 1) <= 0);
          const attacker = (ev.side ?? (victim === "a" ? "b" : "a")) as FxSide;
          // The victim is pushed away from whoever hit it.
          const push = victim === "a" ? -1 : 1;
          const cast = this.lastCast;
          // Reuse the cast's delivery and colour if it was recent enough to be the
          // same action, so a trap that armed and then erupts erupts as a trap.
          const fresh = cast && performance.now() - cast.at < 400;
          const delivery: Delivery = fresh ? cast.delivery : "melee";
          const element = dominantElement(this.session.side(attacker).snap.elements).id;
          const colour = fresh ? cast.colour : elementColour(element);
          this.lastCast = null;

          this.sides[victim].hurt();
          // Everything below is one expression of the hit, fired in a single block:
          // hitstop, shake, recoil, squash, flash, debris, number and sound.
          this.juice.impact({
            victim,
            push,
            amount,
            weight,
            colour,
            draw: () => {
              this.fx.strike(attacker, victim, delivery, "damage", colour, weight === "crit" || weight === "kill");
              this.fx.impact(victim, weight === "kill" || weight === "crit" ? "crit" : "hit", undefined, weight);
              // The element's own impact, in addition to the generic burst above: the
              // burst carries magnitude, this carries cause. Without it every element
              // looked like every other one and the element a plant fought with was
              // only visible as a log line.
              this.fx.elementalHit(victim, element, amount / maxHp, weight);
              this.fx.float(victim, `-${Math.round(amount)}`, ev.isCrit ? "crit" : "dmg", weight);
            },
          });
          this.pushLog(ev.text ?? "", "");
        }
        break;
      }
      case "HEAL_APPLIED": {
        const amount = ev.amount ?? 0;
        if (ev.side && amount > 0) {
          const side: FxSide = ev.side;
          this.juice.cue("heal", side, () => {
            this.fx.impact(side, "heal");
            this.fx.float(side, `+${Math.round(amount)}`, "heal");
          });
          this.pushLog(ev.text ?? "", "");
        }
        break;
      }
      case "SHIELD_APPLIED": {
        const amount = ev.amount ?? 0;
        if (ev.side && amount > 0) {
          const side: FxSide = ev.side;
          this.juice.cue("shield", side, () => this.fx.impact(side, "shield"));
          this.pushLog(ev.text ?? "", "hi");
        }
        break;
      }
      case "MORPH_STARTED": {
        // Three channels at once, because the state is worth more than the hit:
        // the plant resizes and stays resized, the arena flashes in the element's
        // colour, and the shake is set by weight rather than picked at random.
        // A player should be able to see that a morph happened without reading
        // the log.
        const side: FxSide | undefined = ev.side as FxSide | undefined;
        if (side) {
          const element = ev.element as ElementId | undefined;
          const form = ev.form ?? "";
          // The enlargement is the juice layer's, not a CSS class: the effects
          // layer writes `avatar.style.transform` every frame, so a stylesheet
          // rule setting scale would be overwritten the moment the plant was hit.
          this.fx.morph(side, element, form, (on) => this.juice.setMorph(side, on));
          this.fx.impact(side, "crit");
          this.juice.cue("morph", side, () => this.fx.impact(side, "hit"));
          this.fx.float(side, form, "hi");
          this.pushLog(ev.text ?? "", "hi");
        }
        break;
      }
      case "MORPH_ENDED": {
        const side: FxSide | undefined = ev.side as FxSide | undefined;
        if (side) this.fx.endMorph(side, (on) => this.juice.setMorph(side, on));
        this.pushLog(ev.text ?? "", "");
        break;
      }
      case "STATUS_APPLIED":
        if (ev.side) this.fx.impact(ev.side, "status", ev.status);
        this.pushLog(ev.text ?? "", "");
        break;
      case "STATUS_TICK": {
        // Damage over time bleeds rather than bursts, so it gets its own
        // impact shape and a smaller number.
        const amount = ev.amount ?? 0;
        if (ev.side && amount > 0) {
          this.fx.impact(ev.side, "dot");
          this.fx.float(ev.side, `-${Math.round(amount)}`, "dmg");
        }
        break;
      }
      case "MISS":
      case "EVADED": {
        const side = ev.side as FxSide | undefined;
        if (side) this.juice.cue("miss", side, () => this.fx.impact(side, "miss"));
        this.pushLog(ev.text ?? "", "");
        break;
      }
      case "IMMUNE":
        this.pushLog(ev.text ?? "", "hi");
        break;
      case "REFLECT": {
        const amount = ev.amount ?? 0;
        if (ev.side && amount > 0) {
          this.fx.impact(ev.side, "hit");
          this.fx.float(ev.side, `-${Math.round(amount)}`, "dmg");
        }
        this.pushLog(ev.text ?? "", "hi");
        break;
      }
      case "LEECH": {
        const amount = ev.amount ?? 0;
        if (ev.side && amount > 0) this.fx.float(ev.side, `+${Math.round(amount)}`, "heal");
        this.pushLog(ev.text ?? "", "hi");
        break;
      }
      case "STUNNED":
        if (ev.side) this.fx.impact(ev.side, "status", "stun");
        this.pushLog(ev.text ?? "", "hi");
        break;
      case "DEATH": {
        const side = ev.side as FxSide | undefined;
        if (side) this.juice.cue("death", side, () => this.fx.impact(side, "death"));
        this.pushLog(ev.text ?? "", "bad");
        break;
      }
      case "BATTLE_FINISHED": {
        this.pushLog(ev.text ?? "", "hi");
        // The outcome has its own two sounds, and nothing else in the game uses
        // them, so a win or a loss is audible before the result screen is read.
        const mine = ev.winner ? (ev.winner === this.opts.mySide ? "win" : "lose") : "win";
        sfx.play(mine);
        break;
      }
      default:
        break;
    }
  }

  private pushLog(text: string, cls: string): void {
    if (!text) return;
    this.logBox.appendChild(el("div", { class: `l ${cls}` }, [text]));
    while (this.logBox.children.length > 40) this.logBox.removeChild(this.logBox.firstChild!);
    this.logBox.scrollTop = this.logBox.scrollHeight;
  }

  /**
   * Build the skill bar once.
   *
   * The buttons, and their listeners, live as long as the fight does. A tick never creates or
   * destroys one; it only writes state onto them.
   *
   * This used to be called from the tick and started with `replaceChildren()`, so at
   * TICK_RATE the bar was destroyed and rebuilt ten times a second — about forty detached
   * listeners a second, and a button thrown away while the pointer was still on it. A click
   * that landed between one tick's rebuild and the browser's own click dispatch went nowhere,
   * with nothing on screen to say so.
   */
  private renderSkills(): void {
    const side = this.session.side(this.opts.mySide);
    this.skillRow.replaceChildren();
    this.skillBtns.clear();

    if (!this.opts.interactive) {
      this.skillRow.appendChild(
        el("div", { class: "tiny muted" }, ["Cây tự chiến — bạn vẫn đổi stance và dùng năng lượng."]),
      );
      this.focusBtn.disabled = side.focusUsed;
      return;
    }

    for (const skill of side.snap.skills) {
      const b = el("button", { class: "skillbtn", type: "button" }, [
        el("span", { class: "ico" }, [deliveryGlyph(skill.core.delivery)]),
        el("span", { class: "nm" }, [skill.name]),
        // The delivery is text, not only a glyph: the player is choosing between "hits hard
        // once" and "hits three times slowly", and a glyph alone does not say which.
        el("span", { class: "dl" }, [`${DELIVERY_NAME[skill.core.delivery] ?? ""} · ${EFFECT_NAME[skill.core.effect] ?? ""}`]),
        el("div", { class: "cd", "data-cd": "" }),
      ]) as HTMLButtonElement;

      b.addEventListener("click", () => {
        /*
         * Acknowledged on the same frame as the press.
         *
         * The old listener was attached to a node the next tick would discard, so a press
         * could be lost outright. This one is bound once and cannot be. The state is then
         * re-read immediately rather than on the next tick, which is the difference between a
         * cast feeling like it happened and feeling like it was queued.
         */
        if (this.session.castSkill(this.opts.mySide, skill.id)) {
          this.opts.onIntent?.({ kind: "cast", value: skill.id });
          this.refreshSkillBar();
        }
      });

      this.skillBtns.set(skill.id, { btn: b, cd: b.querySelector(".cd") });
      this.skillRow.appendChild(b);
    }
    this.refreshSkillBar();
  }

  /**
   * Write state onto the buttons that already exist. Runs every tick; creates nothing.
   *
   * Three writes per button: the ready class, `disabled`, and the cooldown label. The
   * cooldown text is compared before it is assigned — setting `textContent` to the string it
   * already holds still invalidates layout for that node, and this runs ten times a second per
   * button.
   */
  private refreshSkillBar(): void {
    const side = this.session.side(this.opts.mySide);
    if (!this.opts.interactive) {
      this.focusBtn.disabled = side.focusUsed;
      return;
    }
    for (const [id, ref] of this.skillBtns) {
      const cd = Math.max(0, (side.cooldown[id] ?? 0) - this.session.elapsed);
      const ready = cd <= 0 && !side.casting;
      ref.btn.classList.toggle("ready", ready);
      ref.btn.classList.toggle("cooling", !ready);
      const label = cd > 0 ? String(Math.ceil(cd)) : "";
      if (ref.cd && ref.cd.textContent !== label) ref.cd.textContent = label;
      ref.btn.disabled = !ready;
    }
    this.focusBtn.disabled = side.focusUsed;
  }

  private renderStances(): void {
    this.stanceRow.replaceChildren();
    const side = this.session.side(this.opts.mySide);
    for (const st of STANCE_LIST) {
      const b = el("button", { class: "stancebtn" + (side.stance === st ? " on" : "") }, [STANCE_LABEL[st]]);
      b.addEventListener("click", () => {
        if (this.session.changeStance(this.opts.mySide, st)) {
          this.opts.onIntent?.({ kind: "stance", stance: st });
          this.renderStances();
        } else {
          this.pushLog("Stance cần 10s hồi.", "");
        }
      });
      this.stanceRow.appendChild(b);
    }
  }

  /** Host-driven mode: apply an intent that arrived from the other client. */
  applyRemoteIntent(intent: BattleIntent): void {
    // A remote intent is for the *other* side. Both peers build their local view with their own
    // plant as `mySide`; applying the guest's cast to the host's side sets one player acting as
    // themselves and as the opponent at the same time.
    const other = this.opts.mySide === "a" ? "b" : "a";
    if (intent.kind === "cast" && intent.value) this.session.castSkill(other, intent.value);
    if (intent.kind === "stance" && intent.stance) this.session.changeStance(other, intent.stance);
    if (intent.kind === "focus") this.session.useFocus(other);
    this.refreshSkillBar();
    this.renderStances();
  }
}

/** One fighter: portrait, name, layered HP/shield bar, status line. */
class FighterView {
  readonly root: HTMLElement;
  readonly avatar: HTMLElement;

  private name: HTMLElement;
  private hpText: HTMLElement;
  private ghostFill: HTMLElement;
  private hpFill: HTMLElement;
  private shieldFill: HTMLElement;
  private statusLine: HTMLElement;
  private chipTimer: number | null = null;

  constructor(
    private readonly state: BattleSideState,
    private readonly isEnemy: boolean,
    plant: Plant,
  ) {
    this.root = el("div", { class: "battler" + (isEnemy ? " b-enemy enemy" : " b-side") });
    this.avatar = el("div", { class: "avatar" });
    // Bigger than before: the plant is the fight, not a token beside it. The
    // growth animation is off — a battle must not have its fighters assembling
    // themselves mid-round.
    this.avatar.innerHTML = renderPlantSvg(plant, 104);

    const block = el("div", { class: "hpblock" });
    this.name = el("div", { class: "pname" });
    this.name.textContent = plant.name;
    this.name.style.color = RARITY_META[state.snap.rarity].colour;
    this.name.title = plant.name;

    this.hpText = el("div", { class: "tiny mono muted" });

    const stack = el("div", { class: "hpstack" });
    this.ghostFill = el("b");
    this.hpFill = el("i");
    this.shieldFill = el("u");
    stack.append(this.ghostFill, this.hpFill, this.shieldFill);

    this.statusLine = el("div", { class: "statusline" });

    block.append(this.name, this.hpText, stack, this.statusLine);
    this.root.append(this.avatar, block);
    this.refresh();
  }

  refresh(): void {
    const max = this.state.snap.maxHp;
    const hpPct = clampPct((this.state.hp / max) * 100);
    // The ghost bar lags behind the real one, so a big hit shows as a pale slab
    // draining away rather than the bar simply being shorter. Without it a
    // 40-point hit and a 4-point hit look identical at a glance.
    this.ghostFill.style.transform = `scaleX(${hpPct / 100})`;
    this.hpFill.style.transform = `scaleX(${hpPct / 100})`;
    this.hpFill.classList.toggle("low", hpPct < 30);
    // Shield is drawn over the HP portion, capped so it never reads past 100%.
    const shieldPct = clampPct(Math.min(hpPct, (this.state.shield / max) * 100));
    this.shieldFill.style.transform = `scaleX(${shieldPct / 100})`;
    this.shieldFill.style.display = this.state.shield > 0 ? "block" : "none";
    this.hpText.textContent = `${Math.max(0, Math.round(this.state.hp))}/${max}${this.state.shield > 0 ? ` · 🛡 ${Math.round(this.state.shield)}` : ""}`;
    this.root.classList.toggle("dead", this.state.died);
  }

  setStatuses(text: string): void {
    this.statusLine.textContent = text;
  }

  /**
   * Reactions are driven by toggling classes on the fighter row; the keyframes
   * live in styles.css so they animate the SVG's own transform. Re-adding a
   * class that is already present does not restart the animation, hence the
   * reflow-forced remove in `replay`.
   */
  private replay(className: string, ms: number): void {
    const el = this.root;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), ms);
  }

  hurt(): void {
    this.replay(this.isEnemy ? "hit-enemy" : "hit", 360);
    this.chip();
  }

  /**
   * Let the ghost bar fall to the new HP over a beat.
   *
   * Held 420ms behind on purpose: it is the gap between "the bar got shorter" and
   * "something took that much off me" that makes a hit land.
   */
  chip(): void {
    if (this.chipTimer != null) window.clearTimeout(this.chipTimer);
    this.root.classList.add("is-chipping");
    this.chipTimer = window.setTimeout(() => this.root.classList.remove("is-chipping"), 440);
  }

  /** The fighter acts: a short lunge toward its opponent. */
  attack(): void {
    this.replay("attack", 440);
  }
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

const STATUS_NAME: Record<string, string> = {
  poison: "Độc",
  burn: "Cháy",
  slow: "Chậm",
  stun: "Choáng",
  root: "Trói",
  regen: "Tái tạo",
};

function statusText(s: BattleSideState, now: number): string {
  const parts = s.statuses
    .filter((st) => st.until > now)
    .map((st) => `${STATUS_NAME[st.kind] ?? st.kind} ${(st.until - now).toFixed(0)}s`);
  if (s.stunnedUntil > now && !parts.some((p) => p.startsWith("Choáng"))) parts.unshift("Choáng");
  return parts.join(" · ");
}
