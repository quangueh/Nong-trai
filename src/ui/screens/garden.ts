/** Garden screen: plot list, plant detail sheet, care sheet (docs/05 §2-§4). */

import { el, plantThumb, elementTags, traitChips, bar, statRow, rarityTag, toast, sheet, statGainFloat, archetypeRadar, fmt, seedChip } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";
import { STAGE_LABEL, STAT_LABEL } from "../../core/types";
import type { GardenWeather } from "../../core/store";
import { canBattle, stageProgress } from "../../growth/stages";
import { previewCare } from "../../growth/care";
import { plotCard, canWaterNow } from "./plotCard";
import { WEATHER_INFO, streakLabel } from "../../config/quests";
import { QUEST_TABS } from "../../quests/catalog";
import type { QuestType, QuestView } from "../../quests/types";
import { CARE_ACTIONS, CARE_LIST, MOOD_LABEL, MOOD_EFFECTS, type CareActionId } from "../../config/careActions";
import { ARCHETYPE_STRENGTH, ARCHETYPE_WEAKNESS, ARCHETYPE_ROLE } from "../../config/balance";
import { dominantArchetype } from "../../core/types";
import { SPECIES, type SpeciesId, type SpeciesDef } from "../../config/species";
import { featuredSpecies } from "../../economy/shop";
import { playPlanting, setRevealArt } from "./planting";
import { sfx } from "../../audio/audio";
import { MAX_PLOTS, plotStatuses, type PlotStatus } from "../../config/unlocks";
import { seedColor } from "../components";
import { renderPlantSvg } from "../../render/plantRenderer";
import { skillMasteryPct, skillMasteryText } from "../../progression/objectives";
import { celebrateExpGain } from "../fx/expGain";
import { markUnlock, rewardFly } from "../fx/gardenFx";
import { currencyInfo } from "../../core/currency";
import { createSeedPlant } from "../../genetics/genomeGenerator";
import type { Navigate, Screen } from "./types";
import { gardenBar } from "./gardenBar";

// The ceremony renders real plant art, so it needs the renderer. Wiring it here
// keeps planting.ts free of a render import.
setRevealArt((p, size) => renderPlantSvg(p, size, { anim: size > 120 }));

let selectedSeed: SpeciesId | null = null;

/**
 * Which tab the garden screen is showing.
 *
 * Module-level so it survives the re-render that a purchase or a level-up causes.
 * Resetting it on every render meant the banner that says "1163 loài mới" arrived
 * on the plots tab, whatever the player was reading a moment earlier.
 */
type GardenTab = "plots" | "quests" | "seeds";
let gardenTab: GardenTab = "plots";

/** Which shelf of the quest panel is open. Survives re-renders the same way `gardenTab` does. */
let questTab: QuestType = "main";

export function renderGarden(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const shell = document.querySelector(".shell")!;

  selectedSeed = selectedSeed ?? firstOwnedSeed() ?? SPECIES[0].id;

  const claimable = store.questClaimableCount();
  const tabs: { id: GardenTab; label: string }[] = [
    { id: "plots", label: "Vườn" },
    { id: "quests", label: "Nhiệm vụ" },
    { id: "seeds", label: "Túi hạt" },
  ];

  const chipRow = el("div", { class: "tabs", role: "tablist" });
  const body = el("div");

  /*
   * Tab switching, in one place.
   *
   * The quick-action dock needs the same jump the tab row performs (its "Việc"
   * and "Hạt" buttons are shortcuts to Nhiệm vụ and Túi hạt), and two paths
   * changing the same tab is how the strip and the content disagree about which
   * one is active.
   */
  const goTab = (t: GardenTab): void => {
    if (gardenTab === t) return;
    gardenTab = t;
    for (const other of chipRow.querySelectorAll<HTMLElement>(".tab")) {
      const on = other.dataset.tab === t;
      other.classList.toggle("active", on);
      other.setAttribute("aria-selected", String(on));
    }
    sfx.play("tap");
    paint();
  };

  for (const t of tabs) {
    const b = el(
      "button",
      { class: "tab" + (t.id === gardenTab ? " active" : ""), role: "tab", "aria-selected": String(t.id === gardenTab), "data-tab": t.id },
      [t.label],
    );
    // The reward badge lives on the tab itself: a player on the plots tab still needs to
    // know a claim is waiting without opening the panel to check.
    if (t.id === "quests" && claimable > 0) {
      b.appendChild(el("span", { class: "tab-badge" }, [String(claimable)]));
    }
    b.addEventListener("click", () => goTab(t.id));
    chipRow.appendChild(b);
  }
  root.append(chipRow, body);

  const paint = () => {
    body.replaceChildren();
    if (gardenTab === "plots") paintPlots(body, nav, shell, goTab);
    else if (gardenTab === "quests") paintQuests(body, nav);
    else paintSeeds(body, nav);
  };
  paint();

  return root;
}

/** The plots, and nothing else. */
function paintPlots(body: HTMLElement, nav: Navigate, shell: Element, goTab: (t: GardenTab) => void): void {
  /*
   * The quest tracker, above the plots.
   *
   * One main line plus whatever optional work is closest to done — the answer to "what should
   * I do now" — sitting above the soil because the plots are a wall of tiles and a tracker
   * under them would only be found by scrolling past the thing it is meant to direct. Tapping
   * it opens the quest shelf; claiming happens there, not here.
   */
  body.appendChild(questTracker(() => {
    gardenTab = "quests";
    nav("garden");
  }));

  // --- plots ---
  const section = el("div");
  const title = el("div", { class: "sec-title" });
  title.append(
    el("span", {}, ["Vườn"]),
    el("span", { class: "tiny mono" }, [`${store.state.plants.length}/${store.state.nurseryCap} · ${MAX_PLOTS} ô`]),
  );
  section.appendChild(title);

  const grid = el("div", { class: "plots" });

  /*
   * The quick-action dock.
   *
   * Created before the cards so a plot tap can be routed through it: every card
   * asks the dock what a tap means right now (inspect, a care tool, or the full
   * menu) instead of hard-wiring the detail sheet. The dock is `position:
   * fixed` inside the screen, so it rides above the bottom nav without covering
   * the soil and dies with the tab.
   */
  const cardById = new Map<string, HTMLElement>();
  const qaBar = gardenBar({
    cards: cardById,
    grid,
    nav,
    goTab,
    pickSeed: () => openSeedPicker(nav),
    openDetail: (p) => openDetail(p, nav, shell),
    openCare: (p) => openCare(p, nav, shell),
  });

  // Plants fill plots from 1 upward, so the nth plant is in plot n. That is the
  // same convention the ladder uses, which is what lets a player go from "ô 7"
  // in the shop to the same tile here.
  store.state.plants.forEach((plant, i) => {
    const card = plotCard(plant, () => qaBar.onPlotTap(plant, card), i + 1);
    card.dataset.plantId = plant.plantId;
    // The cooldown chip the dock writes into. Present from the start so a badge
    // never has to be inserted under a tap.
    card.appendChild(el("span", { class: "care-mark", "aria-hidden": "true" }));
    cardById.set(plant.plantId, card);
    grid.appendChild(card);
  });

  // Every plot, open or not, in one grid. The locked ones carry their own
  // requirement and price, so the garden reads as something being built.
  const plots = plotStatuses(store.unlockContext(), store.state.nurseryCap);
  for (const status of plots) {
    if (status.open) {
      /*
       * Only the *unoccupied* remainder. Plants fill the grid from index 1 up,
       * so every open status at or below `plants.length` already has a card —
       * rendering it a second time gave the garden two tiles numbered "1".
       */
      if (status.index > store.state.plants.length) grid.appendChild(emptyPlot(nav, status.index));
    } else {
      grid.appendChild(lockedPlot(status, () => nav("garden")));
    }
  }

  if (store.state.plants.length === 0) {
    grid.appendChild(el("div", { class: "empty" }, [el("div", { class: "big" }, ["🌱"]), el("div", {}, ["Vườn trống. Mua hạt ở Cửa hàng để bắt đầu."])]));
  }
  section.appendChild(grid);

  /*
   * The garden is a scene, not a grid of cards.
   *
   * Sky, a sun, drifting clouds and two far islands give the floating soil
   * something to float in. Decoration is absolutely positioned behind the
   * plots with pointer-events:none, so it costs the grid nothing and can
   * never steal a tap.
   */
  const scene = el("div", { class: "garden-scene" });
  scene.append(
    el("div", { class: "scene-sun", "aria-hidden": "true" }),
    el("div", { class: "scene-cloud c1", "aria-hidden": "true" }),
    el("div", { class: "scene-cloud c2", "aria-hidden": "true" }),
    el("div", { class: "scene-cloud c3", "aria-hidden": "true" }),
    el("div", { class: "scene-isle i1", "aria-hidden": "true" }),
    el("div", { class: "scene-isle i2", "aria-hidden": "true" }),
    el("div", { class: "scene-flutter f1", "aria-hidden": "true" }, ["🦋"]),
    el("div", { class: "scene-flutter f2", "aria-hidden": "true" }, ["🦋"]),
    el("div", { class: "scene-body" }, [section]),
  );
  body.appendChild(scene);
  body.appendChild(qaBar.root);

  // Kept on the plots tab rather than the today tab: it explains what the plots
  // are for, and it is what a new player needs on their first visit to the soil.
  const info = el("div", { class: "card strategy-card", style: "margin-top:18px" });
  info.append(
    el("div", { class: "small", style: "font-weight:800;margin-bottom:8px" }, ["Vòng chơi chính"]),
    el("div", { class: "simple-loop" }, [
      loopStep("1", "Gieo hạt"),
      loopStep("2", "Chăm cây"),
      loopStep("3", "Đợi trưởng thành"),
      loopStep("4", "Đấu để lấy xu và vật tư"),
      loopStep("5", "Chăm tiếp hoặc lai giống"),
    ]),
  );
  body.appendChild(info);
}

/**
 * The quest shelf: today's weather on top, then the four kinds of quest in tabs.
 *
 * This is the whole progression surface — the main line, optional work, the day's roll and the
 * long-term marks — one list behind one set of tabs. It replaced three older to-do surfaces
 * (a starter roadmap, a discovery book and the daily-goal rows) which each kept their own
 * progress and their own claim path and none of which knew about the others.
 */
function paintQuests(body: HTMLElement, nav: Navigate): void {
  body.appendChild(gardenPulse());

  const views = store.questViews();
  const tabs = el("div", { class: "quest-tabs", role: "tablist" });
  const list = el("div", { class: "quest-list" });

  const paintList = (): void => {
    list.replaceChildren();
    const inTab = views.filter((v) => v.def.type === questTab);
    // Claimable first, then active by closeness, then locked, then claimed last — the order a
    // player reads it: what can I take, what am I close to, what is still shut, what is done.
    const rank = (v: QuestView): number =>
      v.status === "completed" ? 0 : v.status === "active" ? 1 : v.status === "locked" ? 2 : 3;
    const ordered = [...inTab].sort(
      (a, b) => rank(a) - rank(b) || b.fraction - a.fraction || a.def.priority - b.def.priority,
    );
    if (!ordered.length) {
      list.appendChild(
        el("div", { class: "empty" }, [
          el("div", { class: "big" }, ["📋"]),
          el("div", {}, [questTab === "daily" ? "Hôm nay chưa có nhiệm vụ. Vượt ải 2 để mở hằng ngày." : "Chưa có nhiệm vụ nào ở đây."]),
        ]),
      );
    }
    for (const v of ordered) list.appendChild(questCard(v, nav));
  };

  for (const t of QUEST_TABS) {
    const badge = views.filter((v) => v.def.type === t.type && v.status === "completed").length;
    const b = el(
      "button",
      {
        class: "quest-tab" + (t.type === questTab ? " active" : ""),
        role: "tab",
        "aria-selected": String(t.type === questTab),
      },
      [el("span", { class: "quest-tab-ico" }, [t.icon]), el("span", {}, [t.label])],
    );
    if (badge > 0) b.appendChild(el("span", { class: "tab-badge" }, [String(badge)]));
    b.addEventListener("click", () => {
      if (questTab === t.type) return;
      questTab = t.type;
      for (const o of tabs.querySelectorAll(".quest-tab")) {
        o.classList.remove("active");
        o.setAttribute("aria-selected", "false");
      }
      b.classList.add("active");
      b.setAttribute("aria-selected", "true");
      sfx.play("tap");
      paintList();
    });
    tabs.appendChild(b);
  }

  /* One tap collects every finished reward, whichever tab it sits on. The count in
     the label is the reason the button exists — a shelf with four claimable rows is
     four taps without it. */
  const claimable = views.filter((v) => v.status === "completed");
  if (claimable.length) {
    const all = el("button", { class: "btn primary block", style: "margin:8px 0" }, [
      `🎁 Nhận tất cả (${claimable.length})`,
    ]);
    all.addEventListener("click", () => {
      const totals = { coins: 0, exp: 0, breederXp: 0, items: 0, geneCrystal: 0 };
      let got = 0;
      for (const v of claimable) {
        const res = store.claimQuest(v.def.id);
        if (!res.ok || !res.rewards) continue;
        got++;
        totals.coins += res.rewards.coins ?? 0;
        totals.exp += res.rewards.exp ?? 0;
        totals.breederXp += res.rewards.breederXp ?? 0;
        totals.items += res.rewards.items ?? 0;
        totals.geneCrystal += res.rewards.geneCrystal ?? 0;
      }
      try {
        if (got > 0) {
          rewardFly(all, totals);
          const parts = [
            totals.coins ? `🪙 ${totals.coins.toLocaleString("vi-VN")}` : "",
            totals.exp ? `✨ ${totals.exp} EXP cây` : "",
            totals.breederXp ? `🎖️ ${totals.breederXp} EXP nhà lai` : "",
            totals.items ? `🧺 ${totals.items}` : "",
            totals.geneCrystal ? `💎 ${totals.geneCrystal}` : "",
          ]
            .filter(Boolean)
            .join("  ");
          toast(`Đã nhận ${got} nhiệm vụ${parts ? `: ${parts}` : ""}`, 3000);
        } else {
          toast("Chưa nhận được thưởng nào");
        }
      } finally {
        // Same rule as the single-card claim: the rewards already landed, so the
        // shelf must repaint no matter what the celebration did.
        nav("garden");
      }
    });
    body.append(tabs, all, list);
  } else {
    body.append(tabs, list);
  }
  paintList();
}

/**
 * Where a quest's work is done, for the "go" action on an unfinished card.
 *
 * Mapped from the event the quest listens to rather than stored on the definition: the
 * catalogue is data about *what* is measured, and the screen it is measured on is a UI fact.
 */
function questDestination(v: QuestView): { screen: Screen; params?: unknown } | null {
  switch (v.def.track.event) {
    case "plant":
      return { screen: "garden" };
    case "care":
      return { screen: "garden" };
    case "breed":
      return { screen: "breeding" };
    case "stage_completed":
    case "stage_failed":
    case "enemy_defeated":
    case "combo_reached":
      return { screen: "ascent" };
    case "level_up":
      return { screen: "ascent" };
    case "item_collected":
      // "Sở hữu hạt X" means the shop — and it means *that* species' card, so the
      // player lands on the thing to buy rather than a 12,000-species shelf.
      return { screen: "lab", params: v.def.track.match?.species ? { seed: v.def.track.match.species } : undefined };
    case "exp_gained":
      return { screen: "ascent" };
    case "skill_unlocked":
      return { screen: "lab" };
    case "reward_claimed":
      return null;
    default:
      return null;
  }
}

/** One reward, as a chip. `unlocks` render separately because they name a gate, not a payout. */
function rewardChip(label: string, cls: string): HTMLElement {
  return el("span", { class: `quest-reward ${cls}` }, [label]);
}

function questRewardChips(v: QuestView): HTMLElement[] {
  const r = v.def.rewards;
  const chips: HTMLElement[] = [];
  if (r.exp) chips.push(rewardChip(`✨ ${r.exp} EXP cây`, "rw-exp"));
  if (r.breederXp) chips.push(rewardChip(`🎖️ ${r.breederXp} EXP nhà lai`, "rw-exp"));
  if (r.coins) chips.push(rewardChip(`🪙 ${r.coins.toLocaleString("vi-VN")}`, "rw-coin"));
  if (r.items) chips.push(rewardChip(`🧺 ${r.items}`, "rw-item"));
  if (r.geneCrystal) chips.push(rewardChip(`💎 ${r.geneCrystal}`, "rw-crystal"));
  for (const u of r.unlocks ?? []) chips.push(rewardChip(`🔓 ${u}`, "rw-unlock"));
  return chips;
}

/**
 * One quest.
 *
 * The card is also the claim button — a finished quest gets a glowing "Nhận" chip and the
 * whole row claims it — because splitting "read the quest" from "take the reward" into two
 * controls is how a claim ends up behind a second tap for no reason.
 */
function questCard(v: QuestView, nav: Navigate): HTMLElement {
  const state =
    v.status === "completed" ? "done" : v.status === "claimed" ? "claimed" : v.status === "locked" ? "locked" : "active";
  const card = el("button", { class: `quest-card ${state}` });
  card.setAttribute("aria-label", `${v.def.title} — ${v.progress}/${v.target}`);

  const pctText = `${Math.min(v.progress, v.target).toLocaleString("vi-VN")}/${v.target.toLocaleString("vi-VN")}`;

  const right =
    v.status === "completed"
      ? el("span", { class: "quest-cta claim pulse" }, ["Nhận"])
      : v.status === "claimed"
        ? el("span", { class: "quest-cta done" }, ["✓"])
        : v.status === "locked"
          ? el("span", { class: "quest-cta" }, ["🔒"])
          : el("span", { class: "quest-count mono" }, [pctText]);

  card.append(
    el("span", { class: "quest-ico" }, [v.def.icon]),
    el("span", { class: "quest-main" }, [
      el("b", {}, [v.def.title]),
      el("small", {}, [
        v.status === "locked" ? v.lockedReason : v.status === "claimed" ? "Đã nhận thưởng" : v.def.objective,
      ]),
      el("span", { class: "quest-rewards" }, questRewardChips(v)),
      v.status !== "claimed" && v.status !== "locked"
        ? el("span", { class: "quest-bar" }, [bar(v.fraction)])
        : null,
    ]),
    right,
  );

  card.addEventListener("click", () => {
    if (v.status === "completed") {
      const res = store.claimQuest(v.def.id);
      try {
        if (res.ok) {
          // Rewards visibly fly into the HUD pills, then the pill bumps — the
          // claim is the moment the garden pays out, and it should look like one.
          rewardFly(card, v.def.rewards);
          sfx.play("reward");
          const what = questRewardChips(v)
            .map((c) => c.textContent ?? "")
            .join("  ");
          toast(`Nhận thưởng ${res.title}: ${what || "xong"}`, 2600);
        } else {
          sfx.play("error");
          toast(res.reason ?? "Chưa nhận được");
        }
      } finally {
        // The repaint is not optional: the claim already landed in the store, so a
        // screen that keeps the old "Nhận" card answers the next tap with
        // "đã nhận rồi" — success wearing the clothes of failure.
        nav("garden");
      }
      return;
    }
    if (v.status === "claimed") return;
    if (v.status === "locked") {
      sfx.play("error");
      toast(v.lockedReason || "Chưa mở");
      return;
    }
    const dest = questDestination(v);
    if (dest && dest.screen !== "garden") {
      sfx.play("tap");
      nav(dest.screen, dest.params);
    } else if (dest?.screen === "garden") {
      gardenTab = "plots";
      sfx.play("tap");
      nav("garden");
    } else {
      toast(v.def.description, 2600);
    }
  });
  return card;
}

/**
 * The tracker on the plots tab: the main line and the nearest optional work.
 *
 * Compact on purpose — it is a signpost, not the shelf. Progress, the next objective and a
 * claimable count are the whole content; tapping anywhere on it opens the quest tab.
 */
function questTracker(open: () => void): HTMLElement {
  const { main, extras } = store.questTracker();
  const claimable = store.questClaimableCount();

  const card = el("button", { class: "quest-tracker" + (claimable > 0 ? " has-claim" : "") });
  card.setAttribute("aria-label", "Mở bảng nhiệm vụ");

  const head = el("div", { class: "quest-tracker-head" }, [
    el("b", {}, ["Nhiệm vụ"]),
    claimable > 0
      ? el("span", { class: "tab-badge" }, [`${claimable} thưởng`])
      : el("span", { class: "tiny muted" }, ["Xem tất cả ›"]),
  ]);
  card.appendChild(head);

  if (main) {
    card.appendChild(
      el("div", { class: "quest-track-row main" }, [
        el("span", { class: "quest-ico sm" }, [main.def.icon]),
        el("span", { class: "quest-track-main" }, [
          el("b", {}, [main.def.objective]),
          el("span", { class: "quest-bar" }, [bar(main.fraction)]),
        ]),
        el("span", { class: "quest-count mono" }, [`${main.progress}/${main.target}`]),
      ]),
    );
  }
  for (const v of extras) {
    card.appendChild(
      el("div", { class: "quest-track-row" }, [
        el("span", { class: "quest-ico sm" }, [v.def.icon]),
        el("span", { class: "quest-track-main" }, [
          el("small", {}, [v.def.objective]),
          el("span", { class: "quest-bar" }, [bar(v.fraction)]),
        ]),
        el("span", { class: "quest-count mono" }, [`${v.progress}/${v.target}`]),
      ]),
    );
  }
  if (!main && extras.length === 0) {
    card.appendChild(el("div", { class: "tiny muted", style: "padding:4px 0" }, [claimable > 0 ? "Có phần thưởng chờ nhận." : "Đã xong hết nhiệm vụ chính."]));
  }

  card.addEventListener("click", () => {
    sfx.play("tap");
    open();
  });
  return card;
}

/** The seed bag, read-only: what you hold and what it costs. */
function paintSeeds(body: HTMLElement, nav: Navigate): void {
  body.append(
    el("div", { class: "tiny muted", style: "margin-bottom:8px" }, [
      "Giá ở đây để so sánh. Mua hạt ở Cửa hàng, rồi bấm một ô trống ở tab Vườn để gieo.",
    ]),
  );
  body.appendChild(seedBelt(nav));
}

function loopStep(n: string, label: string): HTMLElement {
  return el("div", { class: "loop-step" }, [el("span", {}, [n]), el("b", {}, [label])]);
}

function seedBelt(nav: Navigate): HTMLElement {
  const wrap = el("section", { class: "seed-belt" });
  const head = el("div", { class: "seed-belt-head" });
  head.append(
    el("div", {}, [
      el("b", {}, ["Túi hạt"]),
      // The instruction matches the flow that actually exists. The old line still
      // told players to press and hold, which no longer does anything — and an
      // instruction for a gesture that is gone is worse than no instruction.
      el("small", {}, ["Bấm ô đất trống, chọn hạt trong túi là cây được gieo."]),
    ]),
    el("button", { class: "seed-shop-link" }, ["Cửa hàng"]),
  );
  head.querySelector("button")?.addEventListener("click", () => nav("lab"));
  wrap.appendChild(head);

// Owned seeds first, then today's featured stock as browsable filler. The
  // registry holds 1005 species — a rail of all of them is not a rail, it is a
  // scrollbar — and the player only ever plants what they actually holds.
  const held = SPECIES.filter((sp) => (store.state.seeds[sp.id] ?? 0) > 0);
  const today = featuredSpecies(store.state.playerId, Math.floor(Date.now() / 86400000), store.state.breederLevel, 10, store.unlockContext());
  const listed: SpeciesDef[] = [...held];
  for (const sp of today) {
    if (!listed.includes(sp) && listed.length < 24) listed.push(sp);
  }

  if (listed.length === 0) {
    wrap.appendChild(el("div", { class: "callout" }, ["Túi hạt đang trống. Mở Cửa hàng để mua hạt đầu tiên."]));
  }

  const rail = el("div", { class: "seed-rail" });
  for (const sp of listed) {
    rail.appendChild(
      seedChip(sp, store.state.seeds[sp.id] ?? 0, {
        active: selectedSeed === sp.id,
        onPick: () => {
          selectedSeed = sp.id;
          nav("garden");
        },
      }),
    );
  }
  wrap.appendChild(rail);
  return wrap;
}

/**
 * An empty plot.
 *
 * Double intent, so both are visible before anything is committed: tap plants
 * the seed you have, hold opens the seed picker. Previously a plot with no seed
 * silently bought one and planted it in the same tap, which meant a mis-tap
 * could spend coins the player never chose to spend.
 */
/**
 * `index` is the 1-based plot number from `PlotDef`, printed as given.
 *
 * It used to be a slot index with a `+ 1` inside, which combined with the caller's
 * own offset to label plots 2..24 as 1..23 — so the shop's "Mở ô 7" and the
 * garden's tile "6" were the same plot under two numbers. A number is an
 * identifier; it has to come from the one place that defines it.
 */
function emptyPlot(nav: Navigate, index: number): HTMLElement {
  const plot = el("button", { class: "plot empty-plot" });
  // The number goes in the corner tag where every planted plot keeps its, and the
  // middle of the soil gets a seed hole instead. This tile used to carry one large
  // brown pill doing both jobs, which meant an empty plot had a different silhouette
  // from a full one - and the tile a new player taps first should not look like a
  // different object from the twenty-three around it.
  plot.append(
    el("div", { class: "soil-mark" }, [String(index)]),
    el("div", { class: "plot-hole" }, ["\u{1F331}"]),
    el("strong", {}, ["Chọn hạt để gieo"]),
    el("small", {}, ["Bấm vào ô đất này"]),
  );

  // A tap opens the chooser. Nothing is planted and nothing is bought until a
  // card in that chooser is picked.
  //
  // The 480ms press-and-hold this replaces could not be discovered: nobody holds
  // a button for half a second hoping something happens. Right-click stays as an
  // alias because muscle memory reaches for it.
  plot.addEventListener("click", () => openSeedPicker(nav, plot));
  plot.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openSeedPicker(nav, plot);
  });
  return plot;
}

/**
 * A plot the player has not opened yet.
 *
 * Shows the price and the requirement, and shows *progress* on the requirement
 * when there is more than one route to it. Pressing opens the purchase, which is
 * a separate confirmation because it spends coins.
 */
function lockedPlot(status: PlotStatus, onChange: () => void): HTMLElement {
  const box = el("button", { class: "plot plot-locked" + (status.canBuy ? " can-buy" : "") });
  box.append(
    el("div", { class: "plot-mark" }, [String(status.index)]),
    el("div", { class: "plot-req" }, [status.blocked || "Sẵn sàng mở"]),
    el("div", { class: "plot-cost" }, [`${status.def.cost.toLocaleString("vi-VN")} xu`]),
  );

  // No per-rule progress line here. The blocker line above already carries
  // "have/need" for the requirement that is actually stopping you, and a second
  // line listing every route at 9px inside a 100px tile was both cramped and
  // redundant. The shop cards have the room for the full list; a garden tile does
  // not, so the garden shows the one thing you need to act on.

  box.addEventListener("click", () => {
    if (!status.canBuy) {
      sfx.play("error");
      toast(status.blocked || "Chưa mở được ô này");
      return;
    }
    const res = store.buyPlot(status.index);
    if (!res.ok) {
      sfx.play("error");
      toast(res.reason ?? "Không mở được ô");
      return;
    }
    sfx.play("buy");
    markUnlock(status.index);
    toast(`Đã mở ô ${status.index}`);
    onChange();
  });
  return box;
}

/** Buy if needed, plant, then hand over to the ceremony. */
function doPlant(nav: Navigate, seedId: SpeciesId): void {
  const hadNone = (store.state.seeds[seedId] ?? 0) <= 0;
  if (hadNone) {
    const bought = store.buySeed(seedId);
    if (!bought.ok) {
      sfx.play("error");
      toast(bought.reason ?? "Không mua được hạt");
      return;
    }
    // Coins are a different gesture from planting, and they should sound like one.
    sfx.play("buy");
  }
  const res = store.plantSeed(seedId);
  if (!res.ok || !res.plantId) {
    sfx.play("error");
    toast(res.reason ?? "Không thể gieo");
    return;
  }
  sfx.play("plant");
  const plant = store.get(res.plantId);
  if (!plant) {
    nav("garden");
    return;
  }
  playPlanting({ plant, onPlanted: () => nav("garden") });
}

/**
 * Seed chooser, opened by tapping an empty plot.
 *
 * The card grid is the whole interaction: hovering or focusing a card fills the
 * preview above it, and pressing a card plants that seed. Buying is a line on the
 * card — "Còn 3 hạt" versus "Mua 120 xu" — so spending is always something the
 * player saw before it happened, which is what the old one-tap-plant could not
 * promise.
 */
/**
 * `anchorEl` is the plot that was tapped. Without it the picker centres itself,
 * which is what the keyboard and the context-menu entry point use — a menu opened
 * without a pointer still has to appear somewhere.
 */
function openSeedPicker(nav: Navigate, _anchor?: HTMLElement): void {
  const held = SPECIES.filter((s) => (store.state.seeds[s.id] ?? 0) > 0);
  const today = featuredSpecies(
    store.state.playerId,
    Math.floor(Date.now() / 86400000),
    store.state.breederLevel,
    10,
    store.unlockContext(),
  );
  // Owned seeds first, then today's shop stock — a player with an empty bag
  // should still land on a chooser, not on a dead end.
  const listed: SpeciesDef[] = [...held];
  for (const sp of today) if (!listed.includes(sp) && listed.length < 16) listed.push(sp);

  const content = el("div", { class: "seed-sheet" });
  let pick: SpeciesId | null = held[0]?.id ?? listed[0]?.id ?? null;

  const heroArt = el("div", { class: "seed-hero-art" });
  const heroInfo = el("div", { class: "seed-hero-info" });
  const cta = el("button", { class: "btn primary wide seed-cta" });
  const rows = new Map<SpeciesId, HTMLElement>();

  const showPick = (): void => {
    const sp = listed.find((s) => s.id === pick);
    for (const [id, row] of rows) row.classList.toggle("selected", id === pick);
    if (!sp) {
      heroArt.replaceChildren();
      heroInfo.replaceChildren(el("b", {}, ["Túi hạt đang trống"]));
      cta.textContent = "Vào Cửa hàng";
      cta.onclick = () => { close(); nav("lab"); };
      return;
    }
    const owned = store.state.seeds[sp.id] ?? 0;
    const cur = currencyInfo(sp.currency);
    // The hero shows the grown plant, not the seed: a preview plant built for
    // the species and forced to mature, so "gieo hạt này" answers "ra cây gì".
    const preview = createSeedPlant(sp.id, store.state.playerId, `preview-${sp.id}`, Date.now());
    preview.growth.stage = "mature";
    heroArt.innerHTML = renderPlantSvg(preview, 92);
    heroInfo.replaceChildren(
      el("b", {}, [sp.name]),
      el("small", {}, [sp.blurb]),
      el("div", { class: "seed-hero-chips" }, [
        el("span", { class: "tag" }, [`⏱ ~${sp.growMinutes}p`]),
        el("span", { class: "tag" }, [ARCHETYPE_ROLE[sp.archetype] ?? sp.archetype]),
        owned > 0
          ? el("span", { class: "tag ok" }, [`Còn ${owned} hạt`])
          : el("span", { class: "tag gold" }, [`Mua ${sp.seedPrice.toLocaleString("vi-VN")}${cur.icon}`]),
      ]),
    );
    if (owned > 0) {
      cta.textContent = `🌱 Trồng ${sp.name}`;
      cta.removeAttribute("disabled");
    } else {
      const short = Math.max(0, sp.seedPrice - store.state[sp.currency]);
      if (short > 0) {
        cta.textContent = `Thiếu ${short.toLocaleString("vi-VN")}${cur.icon}`;
        cta.setAttribute("disabled", "true");
      } else {
        cta.textContent = `🌱 Mua + Trồng · ${sp.seedPrice.toLocaleString("vi-VN")}${cur.icon}`;
        cta.removeAttribute("disabled");
      }
    }
    cta.onclick = () => {
      sfx.play("dig");
      close();
      doPlant(nav, sp.id);
    };
  };

  const list = el("div", { class: "seed-pick-list" });
  for (const sp of listed) {
    const owned = store.state.seeds[sp.id] ?? 0;
    const cur = currencyInfo(sp.currency);
    const row = el("button", { class: "seed-pick" });
    row.append(
      el("span", { class: "seed-orb", style: `--seed:${seedColor(sp.id)}` }, [String(owned)]),
      el("span", { class: "seed-pick-info" }, [
        el("b", {}, [sp.name]),
        el("small", {}, [ARCHETYPE_ROLE[sp.archetype] ?? sp.archetype]),
      ]),
      el("span", { class: "seed-pick-meta" }, [
        el("span", {}, [`⏱ ${sp.growMinutes}p`]),
        el("span", {}, [owned > 0 ? `còn ${owned}` : `${sp.seedPrice.toLocaleString("vi-VN")}${cur.icon}`]),
      ]),
    );
    row.addEventListener("click", () => {
      pick = sp.id;
      sfx.play("tap");
      showPick();
    });
    rows.set(sp.id, row);
    list.appendChild(row);
  }

  const shopLink = el("button", { class: "btn ghost wide" }, ["🛒 Xem thêm ở Cửa hàng"]);
  shopLink.addEventListener("click", () => {
    sfx.play("tap");
    close();
    nav("lab");
  });

  content.append(
    el("div", { class: "row between" }, [
      el("h3", { class: "grow" }, [held.length ? "Chọn hạt để gieo" : "Hạt nổi bật hôm nay"]),
      el("button", { class: "btn sm ghost", "aria-label": "Đóng" }, ["✕"]),
    ]),
    el("div", { class: "seed-hero" }, [heroArt, heroInfo]),
    list,
    cta,
    shopLink,
  );
  content.querySelector(".row.between button")?.addEventListener("click", () => close());

  const { overlay, sheet: s } = sheet(content, () => close());
  const close = (): void => {
    sfx.play("back");
    overlay.remove();
    s.remove();
  };
  // Escape is handled inside `sheet()` — a second listener here would fire
  // close() twice and double the sound.
  document.querySelector(".shell")!.append(overlay, s);
  showPick();
}

function firstOwnedSeed(): SpeciesId | null {
  return (SPECIES.find((sp) => (store.state.seeds[sp.id] ?? 0) > 0)?.id ?? null);
}

function gardenPulse(): HTMLElement {
  const day = store.state.gardenDay;
  const hero = el("section", { class: `garden-pulse weather-${day.weather}` });
  const ready = store.state.plants.filter((p) => canBattle(p)).length;
  const rare = store.state.plants.filter((p) => ["A", "S", "SS", "SSS"].includes(p.rarity)).length;

  hero.append(
    el("div", { class: "pulse-copy" }, [
      el("div", { class: "weather-chip" }, [
        `${store.state.plants.length}/${store.state.nurseryCap}`,
        " · ",
        weatherIcon(day.weather),
        " ",
        weatherName(day.weather),
      ]),
      el("h1", {}, ["Nhà kính hôm nay"]),
      el("p", {}, [store.gardenWeatherNote()]),
    ]),
  );

  const stats = el("div", { class: "pulse-stats" });
  stats.append(
    pulseStat("Tập trung", `${day.focus}%`),
    pulseStat(streakLabel(day.streak).split("—")[0].trim(), `${day.focus}%`),
    pulseStat("Sẵn sàng", `${ready}`),
    pulseStat("Hiếm", `${rare}`),
  );
  hero.appendChild(stats);
  return hero;
}

function pulseStat(label: string, value: string): HTMLElement {
  return el("div", { class: "pulse-stat" }, [
    el("span", {}, [label]),
    el("strong", { class: "mono" }, [value]),
  ]);
}

function weatherName(w: GardenWeather): string {
  return WEATHER_INFO[w].name;
}

function weatherIcon(w: GardenWeather): string {
  return { mist: "◌", sun: "☀", storm: "ϟ", moon: "◐" }[w];
}

export function openDetail(plant: Plant, nav: Navigate, shell: Element) {
  const content = el("div");

  // header
  const head = el("div", { class: "row between" });
  head.append(
    el("div", { class: "grow" }, [
      el("h3", { style: "font-size:18px" }, [plant.name]),
      el("div", { class: "row wrap", style: "gap:5px;margin-top:5px" }, [
        rarityTag(plant.rarity),
        el("span", { class: "tag" }, [`Đời ${plant.generation}`]),
        el("span", { class: "tag" }, [STAGE_LABEL[plant.growth.stage]]),
        el("span", { class: "tag" }, [`⚔ ${fmt(plant.powerRating)}`]),
      ]),
    ]),
  );
  content.appendChild(head);

  content.appendChild(el("div", { class: "row wrap", style: "gap:5px;margin-top:8px" }, elementTags(plant)));

  // Visual. Animated here because this is the one place the player looks at a
  // single plant up close — the garden grid stays static so it is not a wall of
  // twenty simultaneous animations.
  const visualBox = el("div", { style: "display:grid;place-items:center;padding:10px 0" });
  const vwrap = plantThumb(plant, 176, true);
  vwrap.style.width = "176px";
  vwrap.style.height = "176px";
  visualBox.replaceChildren(vwrap);
  content.appendChild(visualBox);

  /*
   * Growth, beside the art rather than buried in the table.
   *
   * "Tiến độ lớn và thời gian còn lại" is the sheet's farm read: stage chip,
   * a bar, a countdown while it develops, and the water badge when it can
   * drink. A mature plant says what it is for instead of a timer it no
   * longer has.
   */
  {
    const now = Date.now();
    const mature = canBattle(plant);
    const leftS = Math.max(0, Math.ceil((plant.growth.stageReadyAt - now) / 1000));
    const left = leftS >= 60 ? `${Math.floor(leftS / 60)}:${String(leftS % 60).padStart(2, "0")}` : `${leftS}s`;
    const growth = el("div", { class: "detail-growth" });
    growth.append(
      el("div", { class: "growline" }, [
        el("span", { class: "chip dim stage-chip" }, [STAGE_LABEL[plant.growth.stage]]),
        el("b", { class: "grow" }, [mature ? "Đã trưởng thành" : `Sẵn sàng sau ${left}`]),
        !mature && canWaterNow(plant, now) ? el("span", { class: "tag" }, ["💧 Có thể tưới"]) : null,
      ]),
      el("div", {}, [bar(stageProgress(plant, now))]),
    );
    content.appendChild(growth);
  }

  content.appendChild(el("div", { class: "divider" }));

  // stats
  content.appendChild(el("div", { class: "sec-title" }, ["Chỉ số"]));
  const statList = el("div", { class: "card" });
  for (const k of ["hp", "attack", "defense", "speed", "skillPower"]) {
    const v = plant.stats[k as keyof typeof plant.stats];
    const cap = plant.potential[k];
    statList.appendChild(
      statRow(STAT_LABEL[k] ?? k, cap ? `${Math.round(v)} / ${cap.softCap}` : String(Math.round(v))),
    );
  }
  statList.appendChild(statRow("Chí mạng", `${(plant.stats.crit * 100).toFixed(0)}%`));
  statList.appendChild(statRow("Né", `${(plant.stats.evasion * 100).toFixed(0)}%`));
  content.appendChild(statList);

  // radar + role
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Vai trò chiến đấu"]));
  const roleRow = el("div", { class: "card row" });
  const radarBox = el("div");
  radarBox.innerHTML = archetypeRadar(plant, 140);
  const roleText = el("div", { class: "grow" });
  const domArch = dominantArchetype(plant.archetype);
  roleText.append(
    el("div", { class: "small", style: "font-weight:700" }, [`${capitalise(domArch)}: ${ARCHETYPE_ROLE[domArch]}`]),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [ARCHETYPE_STRENGTH[domArch]]),
    el("div", { class: "tiny", style: "margin-top:4px;color:var(--danger)" }, ["Yếu: " + ARCHETYPE_WEAKNESS[domArch]]),
  );
  roleRow.append(radarBox, roleText);
  content.appendChild(roleRow);

  // traits
  const chips = traitChips(plant);
  if (chips.length) {
    content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Đặc tính"]));
    content.appendChild(el("div", { class: "row wrap", style: "gap:6px" }, chips));
  }

  // skills
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Chiêu thức"]));
  content.appendChild(
    el("div", { class: "tiny muted", style: "margin-bottom:6px" }, [
      // Said once rather than on every card. A skill's level is not decoration: every level
      // raises its power or shortens its cooldown, and 3 and 6 open an evolution node. The
      // old card printed "Lv3" and nothing else, so the whole system was paying out silently.
      "Mỗi cấp tăng 5% sức hoặc giảm 5% hồi chiêu (luân phiên). Cấp 3 và 6 mở node tiến hóa.",
    ]),
  );
  for (const skill of plant.skills) {
    const sc = el("div", { class: "card", style: "margin-bottom:8px" });
    const pct = skillMasteryPct(skill.level, skill.masteryXp);
    const bar = el("span", {
      class: "mastery-bar",
      role: "progressbar",
      "aria-valuenow": String(Math.round(pct)),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": `${skill.name} cấp ${skill.level}, ${skillMasteryText(skill.level, skill.masteryXp)}`,
    });
    bar.appendChild(el("i", { style: `transform:scaleX(${(pct / 100).toFixed(3)})` }));

    sc.append(
      el("div", { class: "row between" }, [
        el("div", { class: "small", style: "font-weight:700" }, [skill.name]),
        el("span", { class: "tag mono" }, [`Lv${skill.level}`]),
      ]),
      el("div", { class: "tiny muted", style: "margin-top:3px" }, [
        `${skill.core.delivery} · ${skill.core.effect} · CD ${skill.cooldown}s · Sức ${Math.round(skill.power)}`,
      ]),
      el("div", { class: "mastery" }, [bar, el("span", { class: "mastery-text tiny muted mono" }, [skillMasteryText(skill.level, skill.masteryXp)])]),
      el("div", { class: "row wrap", style: "gap:4px;margin-top:5px" }, skill.tags.slice(0, 4).map((t) => el("span", { class: "tag" }, [t]))),
    );
    content.appendChild(sc);
  }

  // balance
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Cân bằng gene"]));
  const bal = el("div", { class: "card tiny" });
  const v = plant.validation;
  bal.append(
    statRow("Điểm xây dựng / hạn mức", `${v.buildValue.toFixed(0)} / ${v.tierBudget}`),
    statRow("ECR (thực nghiệm)", v.ecr.toFixed(3)),
    statRow("Synergy tax", `-${v.synergyTax.toFixed(1)}`),
    statRow("Mood", MOOD_LABEL[plant.mood]),
  );
  if (v.warnings.length) {
    bal.appendChild(el("div", { class: "callout warn", style: "margin-top:6px" }, [`Cảnh báo: ${v.warnings.join(", ")}`]));
  }
  content.appendChild(bal);

  // actions
  const actions = el("div", { class: "row wrap", style: "gap:8px;margin-top:14px" });
  const careBtn = el("button", { class: "btn primary grow" }, ["🧺 Chăm cây"]);
  careBtn.addEventListener("click", () => {
    s.remove();
    overlay.remove();
    openCare(plant, nav, shell);
  });
  actions.appendChild(careBtn);

  if (canBattle(plant)) {
    // The farm's "thu hoạch": a mature plant earns by fighting. Full-width and
    // gold so the ready state has one obvious door.
    const fight = el("button", { class: "harvest-cta grow" }, ["✨ Sẵn sàng — Mang đi đấu"]);
    fight.addEventListener("click", () => {
      s.remove();
      overlay.remove();
      nav("arena", { plantId: plant.plantId });
    });
    actions.appendChild(fight);
  }

  const lockBtn = el("button", { class: "btn sm" }, [plant.locks.manual ? "🔒 Đã khoá" : "🔓 Khoá"]);
  lockBtn.addEventListener("click", () => {
    store.toggleLock(plant.plantId);
    s.remove();
    overlay.remove();
    nav("garden");
  });
  actions.appendChild(lockBtn);

  const favBtn = el("button", { class: "btn sm" }, [plant.locks.favorite ? "⭐" : "☆"]);
  favBtn.addEventListener("click", () => {
    store.toggleFavorite(plant.plantId);
    s.remove();
    overlay.remove();
    nav("garden");
  });
  actions.appendChild(favBtn);

  // awaken
  if (plant.growth.stage === "mature" && plant.growth.level >= 10) {
    const aw = el("button", { class: "btn sm ghost" }, ["✨ Thức tỉnh"]);
    aw.addEventListener("click", () => {
      // Through the store, not `tryAwaken` directly: awakening now advances a
      // daily goal and the store is the only place that can see the mutation.
      const r = store.awaken(plant.plantId);
      toast(r.reason);
      if (r.ok) {
        s.remove();
        overlay.remove();
        nav("garden");
      }
    });
    actions.appendChild(aw);
  }

  content.appendChild(actions);

  // rename
  const rn = el("button", { class: "btn sm ghost block", style: "margin-top:8px" }, ["✏️ Đổi tên"]);
  rn.addEventListener("click", () => {
    const n = prompt("Tên mới cho cây:", plant.name);
    if (n) {
      store.rename(plant.plantId, n);
      s.remove();
      overlay.remove();
      nav("garden");
    }
  });
  content.appendChild(rn);

  const { overlay, sheet: s } = sheet(content, () => {
    overlay.remove();
    s.remove();
  });
  shell.append(overlay, s);
}

// --- care sheet ---

export function openCare(plant: Plant, nav: Navigate, shell: Element) {
  const content = el("div");
  const head = el("div", { class: "row between" });
  head.append(
    el("h3", { style: "font-size:16px" }, ["🧺 Chăm cây"]),
    el("span", { class: "tag" }, [MOOD_LABEL[plant.mood]]),
  );
  content.appendChild(head);
  content.appendChild(el("div", { class: "tiny muted", style: "margin-top:4px" }, [MOOD_EFFECTS[plant.mood].note]));
  content.appendChild(
    el("div", { class: "wallet-row" }, [
      el("span", {}, [`${store.state.leafCoin} xu`]),
      el("span", {}, [`${store.state.items} vật tư`]),
      el("span", {}, [`${store.state.geneCrystal} tinh thể`]),
    ]),
  );

  const grid = el("div", { class: "grid2", style: "margin-top:12px" });
  for (const action of CARE_LIST) {
    const b = el("button", { class: "btn" });
    b.style.flexDirection = "column";
    b.style.alignItems = "flex-start";
    b.style.gap = "2px";
    b.style.textAlign = "left";
    b.style.padding = "10px";
    const title = el("div", { class: "small", style: "font-weight:700" }, [`${action.emoji} ${action.name}`]);
    const cost = costLabel(action.id);
    const desc = el("div", { class: "tiny muted" }, [descLabel(action.id)]);
    /* The decision-facing line: what this plant stands to gain, computed by the
       same math the action applies — "≈ +12 HP · +5 Thủ" is a choice, a bare
       label is a guess. Mutation odds surface only where they move. */
    const preview = previewCare(plant, action.id as CareActionId);
    // mutationChance applies as a permanent percent bump — show the unit.
    const parts = preview.gains.slice(0, 3).map((g) => (g.stat === "mutationChance" ? `+${g.amount}% ĐB` : `+${g.amount} ${g.label}`));
    if (preview.mutationChance >= 0.05) parts.push(`ĐB ${Math.round(preview.mutationChance * 100)}%`);
    const effect = el("div", { class: "tiny", style: "color:#7fb069;font-weight:600" }, [parts.length ? `≈ ${parts.join(" · ")}` : "Hết dư địa"]);
    b.append(title, el("div", { class: "tiny", style: `color:${cost.ok ? "var(--muted)" : "var(--danger)"}` }, [cost.label]), effect, desc);
    if (!cost.ok) b.disabled = true;
    b.addEventListener("click", () => {
      const before = { leafCoin: store.state.leafCoin, items: store.state.items, geneCrystal: store.state.geneCrystal };
      const beforeXp = plant.growth.xp;
      const res = store.care(plant.plantId, action.id as CareActionId);
      /*
       * The experience a care action grants, flown to the plant's own strip.
       *
       * Care pays experience every time and almost never levels anything, so this was the
       * clearest case of a reward that moved a bar and acknowledged nothing. Read after the
       * call, from the plant's own progress, so the figure shown is what was banked rather
       * than what the care table promises — the two disagree when a combination bonus fires.
       */
      if (res.ok && res.result && (res.result.levels ?? 0) === 0) {
        celebrateExpGain({
          amount: Math.max(0, plant.growth.xp - (beforeXp ?? plant.growth.xp)),
          bar: content.querySelector(".lvstrip-bar"),
        });
      }
      if (!res.ok) {
        toast(res.reason ?? "Không được");
        return;
      }
      const r = res.result!;
      // float the gains
      for (const g of r.gains.slice(0, 3)) {
        statGainFloat(b, `+${g.amount} ${g.label}`);
      }
      const paid = spentLabel(before);
      if (r.mutation) toast(`${r.mutation.label}: ${r.mutation.detail}${paid ? ` · ${paid}` : ""}`, 3000);
      else if (r.logLines.length) toast(`${r.logLines.join(" · ")}${paid ? ` · ${paid}` : ""}`, 1800);
      // Re-render sheet in place.
      content.remove();
      s.remove();
      overlay.remove();
      openCare(store.get(plant.plantId) ?? plant, nav, shell);
    });
    grid.appendChild(b);
  }
  content.appendChild(grid);

  // combo hint
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Combo gợi ý"]));
  content.appendChild(
    el("div", { class: "callout" }, ["Combo không bắt buộc. Người mới chỉ cần chăm 1-2 lần, đợi cây trưởng thành, rồi đem đi đấu để nhận thêm xu và vật tư."]),
  );

  const { overlay, sheet: s } = sheet(content, () => {
    overlay.remove();
    s.remove();
    nav("garden");
  });
  shell.append(overlay, s);
}

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

function costLabel(id: CareActionId): { ok: boolean; label: string } {
  const a = CARE_ACTIONS[id];
  const parts: string[] = [];
  let ok = true;
  if (a.cost.leafCoin) {
    if (store.state.leafCoin < a.cost.leafCoin) ok = false;
    parts.push(`${a.cost.leafCoin}🪙`);
  }
  if (a.cost.items) {
    if (store.state.items < a.cost.items) ok = false;
    parts.push(`${a.cost.items}🧺`);
  }
  if (a.cost.geneCrystal) {
    if (store.state.geneCrystal < a.cost.geneCrystal) ok = false;
    parts.push(`${a.cost.geneCrystal}💎`);
  }
  return { ok, label: parts.length ? parts.join(" ") : "Miễn phí" };
}

function descLabel(id: CareActionId): string {
  return CARE_ACTIONS[id].description;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What the wide desktop rails show on the garden screen.
 *
 * Quests on the left, the day's weather and the seed bag on the right — the
 * two panels a farm screen keeps at arm's reach. The phone never mounts these
 * (`.side-panel` is hidden under 1024px), so the mobile path pays only the
 * paint, not a second layout.
 */
export function gardenSidebars(nav: Navigate): { left: HTMLElement; right: HTMLElement } {
  const left = el("div");
  left.appendChild(
    el("div", { class: "panel-title" }, [
      el("b", {}, ["🎯 Nhiệm vụ"]),
      el("span", { class: "tiny muted" }, ["chạm để mở"]),
    ]),
  );
  left.appendChild(
    questTracker(() => {
      gardenTab = "quests";
      nav("garden");
    }),
  );
  // The rail keeps a short list: claimable first, then whatever is nearest.
  const views = store.questViews();
  const rank = (v: QuestView): number =>
    v.status === "completed" ? 0 : v.status === "active" ? 1 : v.status === "locked" ? 2 : 3;
  const top = [...views]
    .sort((a, b) => rank(a) - rank(b) || b.fraction - a.fraction || a.def.priority - b.def.priority)
    .slice(0, 6);
  const list = el("div", { class: "side-quest-list" });
  for (const v of top) list.appendChild(questCard(v, nav));
  left.appendChild(list);
  const more = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Xem tất cả nhiệm vụ ›"]);
  more.addEventListener("click", () => {
    gardenTab = "quests";
    nav("garden");
  });
  left.appendChild(more);

  const right = el("div");
  right.appendChild(el("div", { class: "panel-title" }, [el("b", {}, ["🎒 Túi hạt & thời tiết"])]));
  right.appendChild(gardenPulse());
  right.appendChild(seedBelt(nav));
  return { left, right };
}
