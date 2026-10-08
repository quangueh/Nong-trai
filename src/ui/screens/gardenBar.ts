/**
 * Quick action dock for the garden (docs/05 §2 companion).
 *
 * ## What this is for
 *
 * Tending used to be three screens deep: plot -> detail sheet -> care sheet ->
 * one of seven buttons. That made the single most repeated interaction in the
 * game also the slowest. This dock puts the frequent actions one tap away:
 *
 *   arm a tool (💧 Tưới) -> tap a plant -> it is watered. Two touches, and the
 *   tool stays armed so the twentieth plant is as fast as the second.
 *
 * ## What lives on it
 *
 * Mode buttons (left of the separator) arm what a plot tap does; action buttons
 * (right of it) fire immediately. "Chăm" keeps the full seven-action sheet
 * reachable in two taps for the rare actions that did not earn a slot.
 *
 * ## Where it lives in the DOM
 *
 * Inside the screen, `position: fixed`, so it dies with the plots tab - a tab
 * switch or a navigation removes it with the rest of the body and there is no
 * teardown to forget. Being fixed also means the garden scrolls under it
 * without the bar ever covering a plot.
 */

import { el, toast, statGainFloat } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";
import { CARE_ACTIONS, type CareActionId } from "../../config/careActions";
import { careCooldownLeft } from "../../growth/care";
import { canBattle } from "../../growth/stages";
import { plotStatuses } from "../../config/unlocks";
import { sfx } from "../../audio/audio";
import { celebrateExpGain } from "../fx/expGain";
import { waterPlotFx } from "../fx/gardenFx";
import { plantSnapshot } from "../../progression/levels";
import type { Navigate } from "./types";

/** What a plot tap currently means. "inspect" is the unarmed state. */
type ToolId = CareActionId | "inspect" | "care_menu";

const isCareTool = (t: ToolId): t is CareActionId => t !== "inspect" && t !== "care_menu";

/**
 * The armed tool, module-level for the same reason `gardenTab` is: the garden
 * re-renders on every state change and the selection has to survive that. A
 * player mid-way through watering the nursery should not have to re-arm after
 * every refresh.
 */
let armed: ToolId = "inspect";

/* The left group. One row, ordered by how often a player reaches for them:
   water first (cheapest, most frequent), the full menu last. */
const TOOL_ROW: { id: ToolId; icon: string; label: string; tip: string }[] = [
  { id: "inspect", icon: "👆", label: "Xem", tip: "Xem chi tiết cây" },
  { id: "water", icon: "💧", label: "Tưới", tip: `Tưới nước · tốn ${CARE_ACTIONS.water.cost.items}🧺 · rồi chạm vào cây` },
  { id: "sunlight", icon: "☀️", label: "Nắng", tip: `Phơi nắng · tốn ${CARE_ACTIONS.sunlight.cost.leafCoin}🪙 · rồi chạm vào cây` },
  { id: "fertilizer", icon: "💩", label: "Phân", tip: `Bón phân · tốn ${CARE_ACTIONS.fertilizer.cost.leafCoin}🪙 · rồi chạm vào cây` },
  { id: "pruning", icon: "✂️", label: "Tỉa", tip: `Cắt tỉa · tốn ${CARE_ACTIONS.pruning.cost.items}🧺 · rồi chạm vào cây` },
  { id: "care_menu", icon: "🧺", label: "Chăm", tip: "Menu chăm đầy đủ: nhạc, ánh trăng, tinh chất · chạm vào cây để mở" },
];

/* The right group. These fire on press rather than changing what a plot tap
   means, so they cannot be "armed" and are separated by a hairline. */
const ACT_ROW: { id: "plant" | "quests" | "seeds"; icon: string; label: string; tip: string }[] = [
  { id: "plant", icon: "🌱", label: "Gieo", tip: "Chọn hạt để gieo vào ô trống" },
  { id: "quests", icon: "🎯", label: "Việc", tip: "Bảng nhiệm vụ" },
  { id: "seeds", icon: "🎒", label: "Hạt", tip: "Túi hạt giống" },
];

/** How the "apply to everything valid" chip is phrased per action. */
const ALL_LABEL: Record<CareActionId, string> = {
  water: "Tưới tất cả",
  sunlight: "Phơi nắng hết",
  fertilizer: "Bón phân hết",
  pruning: "Tỉa hết",
  music: "Cho nghe nhạc hết",
  moonlight: "Tắm trăng hết",
  gene_serum: "Tiêm tinh chất hết",
};

/** Past-tense verb for the summary toast after a mass action. */
const DONE_LABEL: Record<CareActionId, string> = {
  water: "tưới",
  sunlight: "phơi nắng",
  fertilizer: "bón phân",
  pruning: "cắt tỉa",
  music: "cho nghe nhạc",
  moonlight: "tắm trăng",
  gene_serum: "tiêm tinh chất",
};

/** What the player can actually pay right now. */
function wallet(): { leafCoin: number; items: number; geneCrystal: number } {
  const s = store.state;
  return { leafCoin: s.leafCoin, items: s.items, geneCrystal: s.geneCrystal };
}

/** The price an action just charged, as a short "đã trừ" line for the toast. */
function spentLabel(before: { leafCoin: number; items: number; geneCrystal: number }): string {
  const spent: string[] = [];
  const coin = before.leafCoin - store.state.leafCoin;
  const items = before.items - store.state.items;
  const crystal = before.geneCrystal - store.state.geneCrystal;
  if (coin > 0) spent.push(`-${coin} xu`);
  if (items > 0) spent.push(`-${items} vật tư`);
  if (crystal > 0) spent.push(`-${crystal} tinh thể`);
  return spent.join(" ");
}

/**
 * Why a resource cost cannot be met, or null when it can.
 *
 * Resources are shared across the garden, so this answers "is the button
 * usable at all" - the per-plant answer lives in `tendBlockReason`.
 */
export function resourceBlockReason(tool: CareActionId): string | null {
  const a = CARE_ACTIONS[tool];
  const w = wallet();
  if ((a.cost.items ?? 0) > w.items) return `Cần ${a.cost.items}🧺 vật tư`;
  if ((a.cost.leafCoin ?? 0) > w.leafCoin) return `Cần ${a.cost.leafCoin}🪙`;
  if ((a.cost.geneCrystal ?? 0) > w.geneCrystal) return `Cần ${a.cost.geneCrystal}💎 tinh thể`;
  return null;
}

/** Seconds until this plant can take this action again. Zero means now.
    Delegates to the engine's own `careCooldownLeft` so the button never
    predicts a "ready" the engine would refuse (per-action + shared rest). */
export function tendCooldownLeft(plant: Plant, tool: CareActionId, now = Date.now()): number {
  return Math.ceil(careCooldownLeft(plant, tool, now) / 1000);
}

/**
 * Why a tool cannot be applied to this plant right now, or null when it can.
 *
 * Mirrors `applyCare`'s own checks - cooldown first because it is the reason
 * that disappears on its own, then the resource floor. The store stays the
 * source of truth for the application; this only predicts its answer.
 */
export function tendBlockReason(plant: Plant, tool: CareActionId, now = Date.now()): string | null {
  const cd = tendCooldownLeft(plant, tool, now);
  if (cd > 0) return `Cây cần nghỉ ${cd}s`;
  return resourceBlockReason(tool);
}

/** How many plants could take this tool right now. */
function tendableCount(tool: CareActionId): number {
  const now = Date.now();
  return store.state.plants.filter((p) => !tendBlockReason(p, tool, now)).length;
}

/** Quests with a finished reward waiting - the harvestable payouts. */
function claimableQuests(): { id: string; title: string }[] {
  return store
    .questViews()
    .filter((v) => v.status === "completed")
    .map((v) => ({ id: v.def.id, title: v.def.title }));
}

function openPlotCount(): number {
  return plotStatuses(store.unlockContext(), store.state.nurseryCap).filter((s) => s.open).length;
}

function emptyPlotCount(): number {
  return Math.max(0, openPlotCount() - store.state.plants.length);
}

function strongestReadyPlant(): Plant | null {
  return (
    store.state.plants
      .filter(canBattle)
      .slice()
      .sort((a, b) => b.powerRating - a.powerRating)[0] ?? null
  );
}

export interface GardenBarDeps {
  /** Every planted card, keyed by plantId - for in-place badges and flashes. */
  cards: Map<string, HTMLElement>;
  /** The plot grid, so "armed" can change its affordance as well as its cards. */
  grid: HTMLElement;
  nav: Navigate;
  /** Jump to another garden tab (Nhiệm vụ / Túi hạt). */
  goTab(tab: "quests" | "seeds"): void;
  /** Open the seed chooser, unanchored (the bar has no plot to point at). */
  pickSeed(): void;
  openDetail(plant: Plant): void;
  /** The full seven-action care sheet, for tools without their own button. */
  openCare(plant: Plant): void;
}

export interface GardenBarHandle {
  root: HTMLElement;
  /** Route a planted-plot tap through the armed tool. */
  onPlotTap(plant: Plant, card: HTMLElement): void;
}

export function gardenBar(deps: GardenBarDeps): GardenBarHandle {
  const root = el("div", { class: "qabar" });
  const chips = el("div", { class: "qachips", role: "status" });
  const dock = el("div", { class: "qadock", role: "toolbar", "aria-label": "Thao tác nhanh trong vườn" });
  root.append(chips, dock);

  const refresh = (): void => {
    paintChips();
    paintDock();
    paintCards();
  };

  /*
   * Anchor the dock to the column it serves.
   *
   * `position: fixed; left: 50%` centres the bar on the *viewport*, which is
   * only correct while the screen is the full width of the window. On the
   * desktop frame the garden is the middle column of three, and a chips row
   * centred on the window spills over both side panels: 570px of chips across
   * a 530px column. The fix is not a wider max-width but the right origin -
   * centre on the screen's own rect and cap the bar at its width, so the dock
   * can never straddle a panel that is not its own.
   *
   * `transform: translateX(-50%)` stays in the stylesheet (the entrance
   * keyframes keep it), so this only moves the anchor point and the cap.
   */
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
  let observing = false;
  function place(): void {
    // Called at construction, before the bar is attached: closest() finds no
    // screen yet, so the work is deferred to the first tick after mount.
    const screen = root.closest<HTMLElement>(".screen");
    if (!screen) return;
    const r = screen.getBoundingClientRect();
    root.style.left = `${r.left + r.width / 2}px`;
    root.style.maxWidth = `${Math.max(0, r.width - 10)}px`;
    if (!observing) {
      observing = true;
      if (ro) ro.observe(screen);
      else window.addEventListener("resize", place);
    }
  }
  requestAnimationFrame(place);

  /* --- the dock ------------------------------------------------------------ */

  const paintDock = (): void => {
    dock.replaceChildren();
    for (const t of TOOL_ROW) {
      const block = isCareTool(t.id) ? resourceBlockReason(t.id) : null;
      const b = el("button", {
        class: "qabtn" + (armed === t.id ? " armed" : "") + (block ? " off" : ""),
        "aria-pressed": String(armed === t.id),
        "aria-label": `${t.label}: ${t.tip}`,
        "data-tool": t.id,
        title: t.tip,
      });
      if (block) b.setAttribute("aria-disabled", "true");
      b.append(el("span", { class: "qaico" }, [t.icon]), el("span", { class: "qalbl" }, [t.label]));
      b.addEventListener("click", () => {
        if (block) {
          // Off, not disabled: a disabled control swallows the tap and the
          // player never learns why. Here the reason is the whole point.
          sfx.play("error");
          toast(block);
          return;
        }
        if (isCareTool(t.id) && store.state.plants.length === 0) {
          sfx.play("error");
          toast("Vườn chưa có cây - gieo hạt trước đã");
          return;
        }
        armed = armed === t.id ? "inspect" : t.id;
        refresh();
      });
      dock.appendChild(b);
    }

    dock.appendChild(el("span", { class: "qasep", "aria-hidden": "true" }));

    for (const a of ACT_ROW) {
      const b = el("button", { class: "qabtn", "aria-label": `${a.label}: ${a.tip}`, "data-act": a.id, title: a.tip });
      b.append(el("span", { class: "qaico" }, [a.icon]), el("span", { class: "qalbl" }, [a.label]));
      if (a.id === "quests") {
        const n = store.questClaimableCount();
        if (n > 0) b.appendChild(el("span", { class: "qabadge" }, [String(n)]));
      }
      if (a.id === "plant") {
        // Open plots waiting for a seed. A garden with empty beds should say so.
        const empty = emptyPlotCount();
        if (empty > 0) b.appendChild(el("span", { class: "qabadge quiet" }, [String(empty)]));
      }
      b.addEventListener("click", () => {
        if (a.id === "plant") deps.pickSeed();
        else deps.goTab(a.id === "quests" ? "quests" : "seeds");
      });
      dock.appendChild(b);
    }
  };

  /* --- the chips -----------------------------------------------------------

   Contextual actions that only exist when they can do something: mass-tend
   when a tool is armed and anything is tendable, reward collection when a
   goal is claimable, the arena nudge when something is grown. A row that is
   sometimes absent is kinder than a row of dead buttons. */

  const chip = (text: string, cls = "", onTap?: () => void): HTMLElement => {
    const c = el(onTap ? "button" : "span", { class: `qachip ${cls}` }, [text]);
    if (onTap) c.addEventListener("click", onTap);
    return c;
  };

  const paintChips = (): void => {
    chips.replaceChildren();
    const plants = store.state.plants;

    if (isCareTool(armed)) {
      // A const snapshot, not `armed` itself: the guard narrows for this block,
      // but `armed` is module state the closures below read later, and by then
      // TypeScript can no longer prove what it holds. `tool` can.
      const tool = armed;
      const def = CARE_ACTIONS[tool];
      const n = tendableCount(tool);
      const state = plants.length === 0 ? "chưa có cây" : n === 0 ? "tất cả đang nghỉ" : `còn ${n} cây`;
      chips.appendChild(chip(`${def.emoji} ${def.name} · ${state} · chạm vào cây`, "status"));
      if (n > 0) {
        const all = chip(`✨ ${ALL_LABEL[tool]} · ${n}`, "act", () => applyAll(tool));
        all.setAttribute("data-qa", "all");
        chips.appendChild(all);
      }
      return;
    }

    if (armed === "care_menu") {
      chips.appendChild(chip("🧺 Chăm sóc · chạm vào cây để mở menu đầy đủ", "status"));
      return;
    }

    // Unarmed: offer the things a player most likely came to do next, with the
    // most repeated chores as one-tap chips instead of hidden behind a mode.
    const claimable = claimableQuests();
    if (claimable.length > 0) {
      chips.appendChild(chip(`🎁 Nhận ${claimable.length} thưởng`, "act", () => {
        let got = 0;
        for (const q of claimable) if (store.claimQuest(q.id).ok) got++;
        try {
          if (got > 0) sfx.play("collect", { pitch: Math.min(10, got * 2) });
          toast(got > 0 ? `Đã nhận ${got} phần thưởng nhiệm vụ` : "Chưa nhận được thưởng nào");
        } finally {
          /* Full repaint, not refresh(): the claim emptied the shelf — the tab badge,
             the tracker, the desktop rail cards and this chip are all still showing
             the pre-claim state. A stale "Nhận" card answers its next tap with
             "đã nhận rồi", which reads as the claim having failed when it landed. */
          deps.nav("garden");
        }
      }));
    }

    const waterable = tendableCount("water");
    if (plants.length > 0 && waterable > 0) {
      chips.appendChild(chip(`💧 Tưới tất cả · ${waterable}`, "act primary", () => applyAll("water")));
    }

    const readyPlant = strongestReadyPlant();
    const ready = plants.filter(canBattle).length;
    if (readyPlant) {
      chips.appendChild(
        chip(`⚔ Đấu cây mạnh nhất · ${ready}`, "act battle", () => deps.nav("arena", { plantId: readyPlant.plantId })),
      );
    }

    const empty = emptyPlotCount();
    if (empty > 0) {
      chips.appendChild(chip(`🌱 Gieo vào ${empty} ô trống`, "hint plant", () => deps.pickSeed()));
    }

    if (plants.length > 0 && waterable === 0) {
      chips.appendChild(chip("💧 Chọn công cụ tưới", "hint", () => {
        armed = "water";
        refresh();
      }));
    }
  };

  /* --- per-card state --------------------------------------------------------

   What the tool can see on each card: an outline on anything it could act on,
   a countdown chip on anything still resting. Recomputed cheaply every second
   so a "nghỉ 12s" badge is honest rather than a snapshot. */

  const paintCards = (): void => {
    const now = Date.now();
    const tool = isCareTool(armed) ? armed : null;
    deps.grid.classList.toggle("armed-care", tool !== null);
    for (const plant of store.state.plants) {
      const card = deps.cards.get(plant.plantId);
      if (!card) continue;
      const mark = card.querySelector<HTMLElement>(".care-mark");
      const cd = tool ? tendCooldownLeft(plant, tool, now) : 0;
      const blocked = tool ? tendBlockReason(plant, tool, now) : null;
      card.classList.toggle("can-tend", tool !== null && !blocked);
      card.classList.toggle("cooling", cd > 0);
      if (mark) {
        mark.classList.toggle("show", cd > 0);
        if (cd > 0) mark.textContent = `⏱ ${cd}s`;
      }
    }
  };

  /* --- applying ------------------------------------------------------------ */

  const denyCard = (card: HTMLElement, reason: string): void => {
    sfx.play("error");
    card.classList.remove("care-deny-shake");
    // Reflow so back-to-back denies still read as a shake each.
    void card.offsetWidth;
    card.classList.add("care-deny-shake");
    toast(reason);
  };

  const flashCard = (card: HTMLElement): void => {
    card.classList.remove("care-flash");
    void card.offsetWidth;
    card.classList.add("care-flash");
  };

  /**
   * Keep the card's own level strip honest after a grant.
   *
   * The garden does not re-render per action - re-rendering would throw away
   * the player's scroll and make mass tending impossible. The strip is the one
   * number on the card the action just moved, so it updates in place.
   */
  const updateCardLevel = (card: HTMLElement, plant: Plant): void => {
    const snap = plantSnapshot(plant);
    const lv = card.querySelector(".lvstrip-level");
    if (lv) lv.textContent = `Lv${snap.level}`;
    const xp = card.querySelector(".lvstrip-xp");
    if (xp) xp.textContent = snap.capped ? "MAX" : `${Math.round(snap.xp)}/${Math.round(snap.need)}`;
    const fill = card.querySelector<HTMLElement>(".lvstrip-bar i");
    if (fill) fill.style.transform = `scaleX(${(snap.pct / 100).toFixed(3)})`;
    const bar = card.querySelector(".lvstrip-bar");
    bar?.setAttribute("aria-valuenow", String(Math.round(snap.pct)));
  };

  const celebrate = (plant: Plant, card: HTMLElement, xp: number): void => {
    if (xp <= 0) return;
    celebrateExpGain({
      amount: xp,
      bar: card.querySelector(".lvstrip-bar"),
      from: card,
      filled: plantSnapshot(plant).pct >= 99.5,
    });
  };

  const applyTo = (plant: Plant, card: HTMLElement, tool: CareActionId): void => {
    const blocked = tendBlockReason(plant, tool);
    if (blocked) {
      denyCard(card, blocked);
      return;
    }
    const before = wallet();
    const res = store.care(plant.plantId, tool);
    if (!res.ok || !res.result) {
      denyCard(card, res.reason ?? "Chưa chăm được");
      refresh();
      return;
    }
    const r = res.result;
    // Watering gets its own theatre — drops and the plant leaning in — on top
    // of the shared success flash. The other tools keep the flash alone.
    if (tool === "water") waterPlotFx(card);
    flashCard(card);
    for (const g of r.gains.slice(0, 3)) statGainFloat(card, `+${g.amount} ${g.label}`);
    updateCardLevel(card, plant);
    if ((r.levels ?? 0) === 0) celebrate(plant, card, r.xp);

    const spent = spentLabel(before);
    if (r.mutation) toast(`${r.mutation.label}: ${r.mutation.detail}${spent ? ` · ${spent}` : ""}`, 2800);
    else if (r.logLines.length) toast(`${CARE_ACTIONS[tool].emoji} ${r.logLines.join(" · ")}${spent ? ` · ${spent}` : ""}`, 1600);
    refresh();
  };

  /**
   * Apply a tool to every plant that can take it.
   *
   * Iterates eligibility as it goes rather than trusting a pre-computed list:
   * the resource check is shared, so a run that starts able to afford five
   * waters can still legally stop at three. Plants that fail on cooldown are
   * skipped silently; the first resource failure ends the run and is reported.
   */
  const applyAll = (tool: CareActionId): void => {
    const def = CARE_ACTIONS[tool];
    let done = 0;
    let stops = 0;
    const totals = new Map<string, number>();
    let floats = 5;
    for (const plant of store.state.plants) {
      if (tendBlockReason(plant, tool)) continue;
      const res = store.care(plant.plantId, tool);
      if (!res.ok || !res.result) {
        stops++;
        continue;
      }
      done++;
      for (const g of res.result.gains) totals.set(g.label, (totals.get(g.label) ?? 0) + g.amount);
      const card = deps.cards.get(plant.plantId);
      if (card) {
        // Drops on the first few, a flash on the rest: twenty simultaneous
        // droplet runs is a weather system, not feedback.
        if (tool === "water" && done <= 3) waterPlotFx(card);
        flashCard(card);
        updateCardLevel(card, plant);
        // A wall of floaters is not a celebration; a few are.
        const first = res.result.gains[0];
        if (floats-- > 0 && first) statGainFloat(card, `+${first.amount} ${first.label}`);
      }
    }
    if (done === 0) {
      sfx.play("error");
      toast(plantsBlockedReason(tool));
      refresh();
      return;
    }
    sfx.play("collect", { pitch: Math.min(10, done * 2) });
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, a]) => `+${a} ${l}`).join(" · ");
    toast(
      `${def.emoji} Đã ${DONE_LABEL[tool]} ${done} cây${stops ? ` · dừng lại ${stops}` : ""}${top ? ` · ${top}` : ""}`,
      2600,
    );
    refresh();
  };

  /** The single most common reason nothing could be tended, for the all-fail toast. */
  const plantsBlockedReason = (tool: CareActionId): string => {
    const rs = resourceBlockReason(tool);
    if (rs) return rs;
    const now = Date.now();
    const soonest = Math.min(...store.state.plants.map((p) => tendCooldownLeft(p, tool, now)));
    return Number.isFinite(soonest) && soonest > 0 ? `Tất cả đang nghỉ - sớm nhất ${soonest}s` : "Chưa có cây nào hợp lệ";
  };

  /* --- wiring -------------------------------------------------------------- */

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && armed !== "inspect") {
      armed = "inspect";
      refresh();
    }
  };
  document.addEventListener("keydown", onKey);

  // Cooldown badges count down in real time, so the bar refreshes itself once a
  // second. It cleans itself up: the dock is inside the screen's DOM, so when a
  // navigation removes it the interval notices and dies rather than leak.
  const tick = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(tick);
      document.removeEventListener("keydown", onKey);
      ro?.disconnect();
      window.removeEventListener("resize", place);
      return;
    }
    paintCards();
    // Re-anchor once a second as a backstop: cheap, and covers the cases a
    // ResizeObserver misses (orientation, panel collapse, zoom).
    place();
    // A tendable count inside the status chip should tick too, but rebuilding
    // the chip row every second steals a tap mid-press. Only the armed state
    // gets live text; everything else waits for the next real refresh.
    const status = chips.querySelector<HTMLElement>(".qachip.status");
    const tool = isCareTool(armed) ? armed : null;
    if (status && tool) {
      const def = CARE_ACTIONS[tool];
      const n = tendableCount(tool);
      const state = store.state.plants.length === 0 ? "chưa có cây" : n === 0 ? "tất cả đang nghỉ" : `còn ${n} cây`;
      status.textContent = `${def.emoji} ${def.name} · ${state} · chạm vào cây`;
      const all = chips.querySelector<HTMLElement>("[data-qa='all']");
      if (all) all.textContent = `✨ ${ALL_LABEL[tool]} · ${n}`;
    }
  }, 1000);

  refresh();

  return {
    root,
    onPlotTap(plant: Plant, card: HTMLElement): void {
      if (armed === "inspect") {
        deps.openDetail(plant);
        return;
      }
      if (armed === "care_menu") {
        // The full sheet takes over the screen; leaving a tool armed behind it
        // would make the next plot tap feel like it came from nowhere.
        armed = "inspect";
        refresh();
        deps.openCare(plant);
        return;
      }
      applyTo(plant, card, armed);
    },
  };
}
