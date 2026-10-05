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
  private timer: number | null = null;
  private finished = false;
  private speed = 1;

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
    this.session = new BattleSession(opts.plantA, opts.plantB, {
      seed: `view:${opts.plantA.plantId}:${opts.plantB.plantId}:${Date.now()}`,
      maxSeconds: this.maxSeconds,
      arena: "sunny",
    });
    this.build();
  }

  // --- construction ---

  private build(): void {
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

    this.sides.b = new FighterView(this.session.b, true, this.opts.plantB);
    this.sides.a = new FighterView(this.session.a, false, this.opts.plantA);

    const center = el("div", { class: "battle-arena" });
    this.phaseLabel = el("div", { class: "phase" }, ["Mở màn"]);
    this.clock = el("div", { class: "clock" }, [`${this.maxSeconds}`]);
    center.append(this.phaseLabel, this.clock);

    field.append(this.sides.b.root, center, this.sides.a.root);

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
        this.renderSkills();
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
    tools.append(this.focusBtn, this.autoBtn, speedBtn);
    controls.appendChild(tools);
    c.appendChild(controls);

    this.logBox = el("div", { class: "battlelog" });
    this.logBox.appendChild(el("div", { class: "l hi" }, ["Trận đấu bắt đầu!"]));
    c.appendChild(this.logBox);

    this.renderSkills();
    this.renderStances();
  }

  // --- lifecycle ---

  start(): void {
    if (this.timer != null) return;
    this.restartTimer();
  }

  private restartTimer(): void {
    this.stop();
    if (this.finished) return;
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

    this.renderSkills();

    if (this.session.done) {
      this.finished = true;
      this.stop();
      const s = this.session.summary();
      setTimeout(() => this.opts.onFinish({ winner: s.winner, a: s.a, b: s.b, events: s.events }), 750);
    }
  }

  // --- painting ---

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
        this.renderSkills();
        break;
      }
      case "DAMAGE_APPLIED": {
        // `side` is the attacker and `other` is who was hit — see applyDamage in
        // the engine. Getting this backwards puts the hit flash on the plant that
        // threw the punch.
        const victim: FxSide = ev.other ?? (ev.side === "a" ? "b" : "a");
        const amount = ev.amount ?? 0;
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

  private renderSkills(): void {
    const side = this.session.side(this.opts.mySide);
    this.skillRow.replaceChildren();
    if (!this.opts.interactive) {
      this.skillRow.appendChild(el("div", { class: "tiny muted" }, ["Cây tự chiến — bạn vẫn đổi stance và dùng Bản năng được."]));
      this.focusBtn.disabled = side.focusUsed;
      return;
    }
    for (const skill of side.snap.skills) {
      const cd = Math.max(0, (side.cooldown[skill.id] ?? 0) - this.session.elapsed);
      const ready = cd <= 0 && !side.casting;
      const b = el("button", { class: "skillbtn" + (ready ? " ready" : " cooling") }) as HTMLButtonElement;
      b.append(
        el("span", { class: "ico" }, [deliveryGlyph(skill.core.delivery)]),
        el("span", { class: "nm" }, [skill.name]),
      );
      // The delivery is shown as text, not just an icon: the player is choosing
      // between "hits hard once" and "hits three times slowly", and a glyph
      // alone does not say which is which.
      b.appendChild(el("span", { class: "dl" }, [`${DELIVERY_NAME[skill.core.delivery] ?? ""} · ${EFFECT_NAME[skill.core.effect] ?? ""}`]));
      if (!ready) {
        // The text goes in `data-cd`; the stylesheet draws it as a corner chip so
        // it cannot land on the skill's name.
        b.appendChild(el("div", { class: "cd", "data-cd": cd > 0 ? String(Math.ceil(cd)) : "…" }));
        b.disabled = true;
      }
      b.addEventListener("click", () => {
        if (this.session.castSkill(this.opts.mySide, skill.id)) {
          this.opts.onIntent?.({ kind: "cast", value: skill.id });
          this.renderSkills();
        }
      });
      this.skillRow.appendChild(b);
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
    if (intent.kind === "cast" && intent.value) this.session.castSkill(this.opts.mySide, intent.value);
    if (intent.kind === "stance" && intent.stance) this.session.changeStance(this.opts.mySide, intent.stance);
    if (intent.kind === "focus") this.session.useFocus(this.opts.mySide);
    this.renderSkills();
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
