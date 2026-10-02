/** Garden screen: plot list, plant detail sheet, care sheet (docs/05 §2-§4). */

import { el, plantThumb, elementTags, traitChips, bar, statRow, rarityTag, toast, sheet, statGainFloat, archetypeRadar, fmt, seedChip } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";
import { STAGE_LABEL, STAT_LABEL } from "../../core/types";
import type { DailyGoal, GardenWeather } from "../../core/store";
import { canBattle, canBreed } from "../../growth/stages";
import { plotCard } from "./plotCard";
import { GOAL_POOL, WEATHER_INFO, streakLabel } from "../../config/quests";
import { CARE_ACTIONS, CARE_LIST, MOOD_LABEL, MOOD_EFFECTS, type CareActionId } from "../../config/careActions";
import { ARCHETYPE_STRENGTH, ARCHETYPE_WEAKNESS, ARCHETYPE_ROLE } from "../../config/balance";
import { dominantArchetype } from "../../core/types";
import { SPECIES, type SpeciesId, type SpeciesDef } from "../../config/species";
import { featuredSpecies } from "../../economy/shop";
import { TRAITS_BY_ID } from "../../config/traits";
import { playPlanting, setRevealArt } from "./planting";
import { sfx } from "../../audio/audio";
import { MAX_PLOTS, plotStatuses, type PlotStatus } from "../../config/unlocks";
import { seedColor } from "../components";
import { renderPlantSvg } from "../../render/plantRenderer";
import type { Navigate } from "./types";

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
type GardenTab = "plots" | "today" | "seeds";
let gardenTab: GardenTab = "plots";

export function renderGarden(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const shell = document.querySelector(".shell")!;

  selectedSeed = selectedSeed ?? firstOwnedSeed() ?? SPECIES[0].id;

  const tabs: { id: GardenTab; label: string }[] = [
    { id: "plots", label: "Vườn" },
    { id: "today", label: "Hôm nay" },
    { id: "seeds", label: "Túi hạt" },
  ];

  const chipRow = el("div", { class: "tabs", role: "tablist" });
  const body = el("div");
  for (const t of tabs) {
    const b = el(
      "button",
      { class: "tab" + (t.id === gardenTab ? " active" : ""), role: "tab", "aria-selected": String(t.id === gardenTab) },
      [t.label],
    );
    b.addEventListener("click", () => {
      if (gardenTab === t.id) return;
      gardenTab = t.id;
      for (const other of chipRow.querySelectorAll(".tab")) {
        other.classList.remove("active");
        other.setAttribute("aria-selected", "false");
      }
      b.classList.add("active");
      b.setAttribute("aria-selected", "true");
      sfx.play("tap");
      paint();
    });
    chipRow.appendChild(b);
  }
  root.append(chipRow, body);

  const paint = () => {
    body.replaceChildren();
    if (gardenTab === "plots") paintPlots(body, nav, shell);
    else if (gardenTab === "today") paintToday(body, nav);
    else paintSeeds(body, nav);
  };
  paint();

  return root;
}

/** The plots, and nothing else. */
function paintPlots(body: HTMLElement, nav: Navigate, shell: Element): void {
  // --- plots ---
  const section = el("div");
  const title = el("div", { class: "sec-title" });
  title.append(
    el("span", {}, ["Vườn"]),
    el("span", { class: "tiny mono" }, [`${store.state.plants.length}/${store.state.nurseryCap} · ${MAX_PLOTS} ô`]),
  );
  section.appendChild(title);

  const grid = el("div", { class: "plots" });
  // Plants fill plots from 1 upward, so the nth plant is in plot n. That is the
  // same convention the ladder uses, which is what lets a player go from "ô 7"
  // in the shop to the same tile here.
  store.state.plants.forEach((plant, i) => {
    grid.appendChild(plotCard(plant, () => openDetail(plant, nav, shell), i + 1));
  });

  // Every plot, open or not, in one grid. The locked ones carry their own
  // requirement and price, so the garden reads as something being built.
  const plots = plotStatuses(store.unlockContext(), store.state.nurseryCap);
  for (const status of plots) {
    if (status.open) {
      // The plot's own number, not a slot index. See the note on emptyPlot.
      grid.appendChild(emptyPlot(nav, status.index));
    } else {
      grid.appendChild(lockedPlot(status, () => nav("garden")));
    }
  }

  if (store.state.plants.length === 0) {
    grid.appendChild(el("div", { class: "empty" }, [el("div", { class: "big" }, ["🌱"]), el("div", {}, ["Vườn trống. Mua hạt ở Cửa hàng để bắt đầu."])]));
  }
  section.appendChild(grid);
  body.appendChild(section);

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

/** Everything that is a to-do for today rather than a place. */
function paintToday(body: HTMLElement, nav: Navigate): void {
  body.appendChild(gardenPulse(nav));
  body.appendChild(starterRoadmap(nav));
  body.appendChild(discoveryBook(nav));
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

function starterRoadmap(nav: Navigate): HTMLElement {
  const plants = store.state.plants;
  const hasPlant = plants.length > 0;
  const hasCared = plants.some((p) => p.economy.careCycles > 0);
  const mature = plants.some((p) => canBattle(p));
  const fought = plants.some((p) => p.battleRecord.wins + p.battleRecord.losses + p.battleRecord.draws > 0);
  const breedable = plants.filter((p) => canBreed(p)).length >= 2;
  const steps = [
    { label: "Gieo cây đầu tiên", done: hasPlant, action: "Gieo", target: "garden" },
    { label: "Chăm 1 lần để tăng chỉ số", done: hasCared, action: "Chăm", target: "care" },
    { label: "Đợi cây trưởng thành", done: mature, action: "Xem giờ", target: "garden" },
    { label: "Đấu AI/người chơi để nhận xu + vật tư", done: fought, action: "Đấu", target: "arena" },
    { label: "Dùng thưởng để chăm tiếp hoặc lai giống", done: breedable, action: breedable ? "Lai" : "Tiếp tục", target: breedable ? "breeding" : "arena" },
  ];
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];
  const card = el("section", { class: "roadmap-card" });
  card.append(
    el("div", { class: "roadmap-head" }, [
      el("div", {}, [
        el("b", {}, ["Lộ trình tân thủ"]),
        el("small", {}, ["Làm theo từng bước, game sẽ tự mở nhịp chăm và đấu"]),
      ]),
      el("button", { class: "roadmap-action" }, [current.action]),
    ]),
  );
  card.querySelector("button")?.addEventListener("click", () => {
    if (current.target === "arena") nav("arena");
    else if (current.target === "breeding") nav("breeding");
    else nav("garden");
  });
  const list = el("div", { class: "roadmap-list" });
  for (const step of steps) {
    list.appendChild(el("div", { class: `roadmap-step ${step.done ? "done" : step === current ? "current" : ""}` }, [
      el("span", {}, [step.done ? "✓" : step === current ? "•" : ""]),
      el("b", {}, [step.label]),
    ]));
  }
  card.appendChild(list);
  return card;
}

function discoveryBook(nav: Navigate): HTMLElement {
  const milestones = store.discoveryMilestones();
  const done = milestones.filter((m) => m.claimed).length;
  const claimable = milestones.filter((m) => m.progress >= m.target && !m.claimed);
  const card = el("section", { class: "discovery-card" });

  card.append(
    el("div", { class: "discovery-head" }, [
      el("div", {}, [
        el("b", {}, ["Sổ khám phá"]),
        el("small", {}, [`${done}/${milestones.length} mốc · ${store.state.discovery.species.length} giống · ${store.state.discovery.elements.length} hệ · ${store.state.discovery.traits.length} đặc tính`]),
      ]),
      claimable.length
        ? el("button", { class: "discovery-action pulse" }, [`Nhận ${claimable.length} mốc`])
        : el("button", { class: "discovery-action" }, ["Mở rộng"]),
    ]),
  );
  card.querySelector("button")?.addEventListener("click", () => {
    if (claimable.length) {
      // Claim everything the player has already earned.
      let got = 0;
      for (const m of claimable) {
        if (store.claimDiscovery(m.id).ok) got++;
      }
      toast(got > 0 ? `Đã nhận ${got} phần thưởng khám phá` : "Chưa nhận được phần thưởng nào");
      nav("garden");
      return;
    }
    nav("collection");
  });

  // Claimable first, then in-progress by closeness, then locked.
  const ordered = [...milestones].sort((a, b) => {
    const rank = (m: typeof a) => (m.claimed ? 2 : m.progress >= m.target ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return b.progress / b.target - a.progress / a.target;
  });

  const list = el("div", { class: "discovery-list scrollable" });
  for (const milestone of ordered) {
    const finished = milestone.progress >= milestone.target;
    const reward = rewardLabel(milestone.reward);
    const row = el("button", { class: `discovery-row ${finished ? "done" : ""} ${milestone.claimed ? "claimed" : ""}` });
    row.append(
      el("span", { class: "discovery-main" }, [
        el("b", {}, [milestone.label]),
        el("small", {}, [milestone.claimed ? "Đã nhận thưởng" : `${milestone.hint} · ${reward}`]),
        el("span", { class: "discovery-bar" }, [bar(Math.min(1, milestone.progress / milestone.target))]),
      ]),
      el("span", { class: "discovery-progress mono" }, [`${Math.min(milestone.progress, milestone.target)}/${milestone.target}`]),
    );
    row.addEventListener("click", () => {
      if (finished && !milestone.claimed) {
        const res = store.claimDiscovery(milestone.id);
        toast(res.ok ? `Đã nhận thưởng: ${milestone.label}` : res.reason ?? "Chưa nhận được");
        nav("garden");
      }
    });
    list.appendChild(row);
  }
  card.appendChild(list);

  const recentTraits = store.state.discovery.traits.slice(-4).map((id) => TRAITS_BY_ID[id]?.name ?? id);
  if (recentTraits.length) {
    card.appendChild(el("div", { class: "discovery-traits tiny" }, [`Đặc tính đã gặp: ${recentTraits.join(", ")}`]));
  }
  return card;
}

function rewardLabel(reward: { leafCoin?: number; geneCrystal?: number; items?: number }): string {
  return [
    reward.leafCoin ? `${reward.leafCoin} xu` : "",
    reward.geneCrystal ? `${reward.geneCrystal} tinh thể` : "",
    reward.items ? `${reward.items} vật tư` : "",
  ].filter(Boolean).join(" + ");
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
  const today = featuredSpecies(store.state.playerId, Math.floor(Date.now() / 86400000), store.state.breederLevel, 10);
  const listed: SpeciesDef[] = [...held];
  for (const sp of today) {
    if (!listed.includes(sp) && listed.length < 24) listed.push(sp);
  }

  if (listed.length === 0) {
    wrap.appendChild(el("div", { class: "notice" }, ["Túi hạt đang trống. Mở Cửa hàng để mua hạt đầu tiên."]));
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
  plot.append(
    el("div", { class: "soil-mark" }, [String(index)]),
    el("strong", {}, ["Chọn hạt để gieo"]),
    el("small", {}, ["Bấm vào ô đất này"]),
  );

  // A tap opens the chooser. Nothing is planted and nothing is bought until a
  // card in that chooser is picked.
  //
  // The 480ms press-and-hold this replaces could not be discovered: nobody holds
  // a button for half a second hoping something happens. Right-click stays as an
  // alias because muscle memory reaches for it.
  plot.addEventListener("click", () => openSeedPicker(nav));
  plot.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openSeedPicker(nav);
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
function openSeedPicker(nav: Navigate): void {
  const held = SPECIES.filter((s) => (store.state.seeds[s.id] ?? 0) > 0);
  const body = el("div", { class: "seed-picker" });

  // Preview, filled by whichever card is focused or hovered.
  const preview = el("div", { class: "seed-preview" });
  const showPreview = (sp: SpeciesDef): void => {
    preview.replaceChildren(
      el("div", { class: "seed-preview-orb", style: `--seed:${seedColor(sp.id)}` }),
      el("div", { class: "seed-preview-copy" }, [
        el("b", {}, [sp.name]),
        el("small", {}, [ARCHETYPE_ROLE[sp.archetype] ?? sp.archetype]),
        el("p", {}, [sp.blurb]),
        el(
          "div",
          { class: "seed-preview-stats" },
          Object.entries(sp.statBias).map(([k, v]) =>
            el("span", {}, [`${STAT_LABEL[k] ?? k} +${Math.round((v as number) * 100)}`]),
          ),
        ),
      ]),
    );
  };

  const makeCard = (sp: SpeciesDef, count: number, price: number | null): HTMLElement => {
    const card = seedChip(sp, count, { showPrice: false });
    card.classList.add("picker-card");
    if (price !== null) card.appendChild(el("span", { class: "buy-tag" }, [`Mua ${price} xu`]));
    // Focus as well as hover: the whole grid is keyboard-reachable, and a preview
    // that only appears under a mouse is a preview half the players never see.
    card.addEventListener("pointerenter", () => showPreview(sp));
    card.addEventListener("focus", () => showPreview(sp));
    card.addEventListener("click", () => {
      sfx.play("dig");
      doPlant(nav, sp.id);
      close();
    });
    return card;
  };

  const grid = el("div", { class: "picker-grid" });

  if (held.length === 0) {
    body.appendChild(el("p", { class: "picker-empty" }, ["Túi hạt đang trống — mua một hạt để gieo cây đầu tiên."]));
    const today = featuredSpecies(store.state.playerId, Math.floor(Date.now() / 86400000), store.state.breederLevel, 8);
    for (const sp of today) grid.appendChild(makeCard(sp, 0, sp.seedPrice));
    const openShop = el("button", { class: "btn ghost wide", style: "margin-top:12px" }, ["🛒 Xem thêm ở Cửa hàng"]);
    openShop.addEventListener("click", () => {
      sfx.play("tap");
      close();
      nav("lab");
    });
    body.appendChild(openShop);
  } else {
    for (const sp of held) grid.appendChild(makeCard(sp, store.state.seeds[sp.id] ?? 0, null));
    const more = el("button", { class: "btn ghost wide", style: "margin-top:12px" }, ["🛒 Mua thêm hạt"]);
    more.addEventListener("click", () => {
      sfx.play("tap");
      close();
      nav("lab");
    });
    body.appendChild(more);
  }

  showPreview(held[0] ?? SPECIES[0]);
  body.prepend(preview, el("h3", { class: "picker-title" }, [held.length ? "Chọn hạt để gieo" : "Hạt nổi bật hôm nay"]), grid);

  const { overlay, sheet: s } = sheet(body, () => close());
  const close = (): void => {
    sfx.play("back");
    overlay.remove();
    s.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  document.querySelector(".shell")!.append(overlay, s);
}


function firstOwnedSeed(): SpeciesId | null {
  return (SPECIES.find((sp) => (store.state.seeds[sp.id] ?? 0) > 0)?.id ?? null);
}

function gardenPulse(nav: Navigate): HTMLElement {
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

  const goals = el("div", { class: "goal-stack" });
  for (const goal of day.goals) goals.appendChild(goalRow(goal, nav));
  hero.appendChild(goals);
  return hero;
}

function pulseStat(label: string, value: string): HTMLElement {
  return el("div", { class: "pulse-stat" }, [
    el("span", {}, [label]),
    el("strong", { class: "mono" }, [value]),
  ]);
}

function goalRow(goal: DailyGoal, nav: Navigate): HTMLElement {
  const done = goal.progress >= goal.target;
  const row = el("button", { class: `goal-row ${done ? "done" : ""} ${goal.claimed ? "claimed" : ""}` });
  const reward = [
    goal.reward.leafCoin ? `${goal.reward.leafCoin}🪙` : "",
    goal.reward.geneCrystal ? `${goal.reward.geneCrystal}💎` : "",
    goal.reward.items ? `${goal.reward.items}🧺` : "",
  ].filter(Boolean).join(" ");
  const template = GOAL_POOL.find((t) => goal.id.endsWith(`-${t.id}`));
  row.append(
    el("span", { class: "goal-main" }, [
      el("b", {}, [goal.label]),
      el("small", {}, [
        el("span", { class: "goal-count mono" }, [`${goal.progress}/${goal.target}`]),
        ` · ${goal.claimed ? "Đã nhận" : reward}`,
      ]),
      !goal.claimed && template ? el("span", { class: "goal-hint tiny" }, [template.hint]) : null,
      !goal.claimed ? el("span", { class: "goal-bar" }, [bar(Math.min(1, goal.progress / goal.target))]) : null,
    ]),
    el("span", { class: "goal-cta" }, [goal.claimed ? "✓" : done ? "Nhận" : actionHint(goal.kind)]),
  );
  row.addEventListener("click", () => {
    if (goal.claimed) return;
    if (done) {
      const res = store.claimGoal(goal.id);
      toast(res.ok ? "Đã nhận thưởng nhiệm vụ" : res.reason ?? "Chưa nhận được");
      nav("garden");
      return;
    }
    if (goal.kind === "plant") nav("lab");
    if (goal.kind === "battle") nav("arena");
    if (goal.kind === "breed") nav("breeding");
    if (goal.kind === "care") nav("garden");
  });
  return row;
}

/**
 * What tapping a goal should send the player to do.
 *
 * Every kind needs an entry, and the union type is what forces that: five kinds
 * were added with the quest rewrite and the compiler flagged the gap rather than
 * leaving a goal whose hint silently sent you somewhere useless.
 */
function actionHint(kind: DailyGoal["kind"]): string {
  const map: Record<DailyGoal["kind"], string> = {
    plant: "Mua hạt",
    care: "Chăm cây",
    battle: "Đấu",
    win: "Đấu",
    breed: "Lai",
    sell: "Bán cây",
    awaken: "Thức tỉnh",
    openPlot: "Mở ô vườn",
    unlock: "Xem loài mới",
  };
  return map[kind];
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
  for (const skill of plant.skills) {
    const sc = el("div", { class: "card", style: "margin-bottom:8px" });
    sc.append(
      el("div", { class: "row between" }, [
        el("div", { class: "small", style: "font-weight:700" }, [skill.name]),
        el("span", { class: "tag mono" }, [`Lv${skill.level}`]),
      ]),
      el("div", { class: "tiny muted", style: "margin-top:3px" }, [
        `${skill.core.delivery} · ${skill.core.effect} · CD ${skill.cooldown}s · Sức ${Math.round(skill.power)}`,
      ]),
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
    bal.appendChild(el("div", { class: "notice warn", style: "margin-top:6px" }, [`Cảnh báo: ${v.warnings.join(", ")}`]));
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
    const fight = el("button", { class: "btn gold grow" }, ["⚔ Đấu"]);
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
    b.append(title, el("div", { class: "tiny", style: `color:${cost.ok ? "var(--muted)" : "var(--danger)"}` }, [cost.label]), desc);
    if (!cost.ok) b.disabled = true;
    b.addEventListener("click", () => {
      const before = { leafCoin: store.state.leafCoin, items: store.state.items, geneCrystal: store.state.geneCrystal };
      const res = store.care(plant.plantId, action.id as CareActionId);
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
    el("div", { class: "notice" }, ["Combo không bắt buộc. Người mới chỉ cần chăm 1-2 lần, đợi cây trưởng thành, rồi đem đi đấu để nhận thêm xu và vật tư."]),
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
