/** Shop / lab screen: seeds, items, land, NPC orders (docs/05, docs/16 §21). */

import { sfx } from "../../audio/audio";
import { spendChip } from "../fx/gardenFx";
import { MAX_PLOTS, RULE_LABEL, checkUnlock, plotStatuses } from "../../config/unlocks";
import { el, toast, fmt, seedChip, seedIcon } from "../components";
import { store } from "../app";
import { plantDisplayName } from "../../core/plantNames";
import { CURRENCIES } from "../../core/currency";
import { currencyIcon } from "../../core/currency";
import { getSpecies, type SpeciesDef } from "../../config/species";
import { ELEMENTS, ELEMENT_INFO } from "../../config/elements";
import { ARCHETYPE_ROLE } from "../../config/balance";
import {
  generateOrders,
  sellPrice,
  featuredSpecies,
  queryCatalogue,
  TIER_UNLOCK,
  type CatalogueSort,
} from "../../economy/shop";
import { canSell } from "../../growth/stages";

import type { Navigate } from "./types";

type Tab = "seeds" | "items" | "land" | "orders";

export function renderLab(_nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const shell = document.querySelector(".shell")!;

  const tabs: { id: Tab; label: string }[] = [
    { id: "seeds", label: "Hạt cơ bản" },
    { id: "items", label: "Vật tư" },
    { id: "land", label: "Vườn" },
    { id: "orders", label: "Đơn hàng" },
  ];
  let active: Tab = "seeds";

  const chipRow = el("div", { class: "scrollx", style: "margin-bottom:12px" });
  const body = el("div");
  for (const t of tabs) {
    const b = el("button", { class: "btn sm" + (t.id === active ? " primary" : "") }, [t.label]);
    b.addEventListener("click", () => {
      active = t.id;
      for (const other of chipRow.querySelectorAll(".btn")) other.classList.remove("primary");
      b.classList.add("primary");
      paint();
    });
    chipRow.appendChild(b);
  }
  root.append(chipRow, body);

  const paint = () => {
    body.replaceChildren();
    /*
     * Each tab gets `paint` itself as its refresh, not `nav("lab")`.
     *
     * Re-navigating used to be the post-purchase refresh, but it re-runs
     * renderLab and throws away everything the screen remembers: the seeds tab
     * loses every filter the player set, and the other tabs are thrown back to
     * "seeds". The top bar already repaints itself through store.subscribe, so
     * a purchase needs nothing from a navigation.
     */
    if (active === "seeds") paintSeeds(body);
    else if (active === "items") paintItems(body, paint);
    else if (active === "land") paintLand(body, paint);
    else paintOrders(body, paint);
    void shell;
  };
  paint();
  return root;
}

function paintSeeds(body: HTMLElement) {
  const day = Math.floor(Date.now() / 86400000);
  // Filter state lives across repaints so typing in the search box or paging
  // through the catalogue does not reset the shelf.
  let search = "";
  let tier: number | null = null;
  /**
   * Three states, not two.
   *
   * This was a boolean, and "Chỉ loài đã mở" was wired to the same value as "Tất cả" -
   * so asking the shop for the species you already own returned the locked ones as well,
   * and both chips lit up at once because they were the same choice. A boolean cannot
   * express "neither", which is exactly what a filter needs here.
   */
  let lockFilter: "all" | "open" | "locked" = "all";
  let element: string | null = null;
  let archetype: string | null = null;
  /**
   * Shelf order, and whether to hide what the player cannot pay for.
   *
   * Both live here rather than in the query because this screen owns them; they are handed
   * to the query, which applies them before it paginates.
   */
  let sort: CatalogueSort = "default";
  let affordableOnly = false;
  /** Which currency's shelf to browse. Null means all four at once. */
  let currency: string | null = null;
  /** Whether the nineteen element/archetype chips are showing. Closed by default. */
  let fancyOpen = false;
  let page = 1;

  const list = el("div");
  const tools = el("div", { style: "margin-bottom:12px" });
  body.append(
    el("div", { class: "callout", style: "margin-bottom:12px" }, [
      "Cửa hàng chỉ bán hạt độ hiếm C. Cây hiếm phải tự lai tạo, không mua bằng tiền.",
    ]),
    tools,
    list,
  );

  const repaint = () => {
    list.replaceChildren();
    list.append(buildTools());
    list.append(buildFeatured());
    list.append(buildCatalogue());
  };

  const buildTools = (): HTMLElement => {
    tools.replaceChildren();
    const wrap = el("div");

    const searchRow = el("div", { class: "row", style: "gap:8px;margin-bottom:10px" });
    const box = el("input", { class: "input grow", placeholder: "Tìm loài cây" }) as HTMLInputElement;
    box.value = search;
    box.addEventListener("input", () => {
      search = box.value;
      page = 1;
      repaint();
      // Re-focus: repaint replaces the DOM, so the caret would otherwise jump.
      const again = wrap.querySelector("input") as HTMLInputElement | null;
      if (again) {
        again.focus();
        again.setSelectionRange(search.length, search.length);
      }
    });
    searchRow.append(box);
    wrap.appendChild(searchRow);

    // Tier chips.
    //
    // Every tier is clickable, locked or not. They used to read "II locked" and be
    // disabled, which meant the one control that could explain the gate did nothing.
    // Locked species were also filtered out of the list, so there was nowhere left in
    // the shop that answered "what do I need" — the complaint that started this.
    //
    // Selecting a locked tier shows its species with their requirement on each card.
    const tierRow = el("div", { class: "scrollx", style: "gap:6px;margin-bottom:8px" });
    const tierChip = (label: string, value: number | null, title: string) => {
      const b = el(
        "button",
        { class: "btn xs" + (tier === value ? " primary" : ""), title },
        [label],
      );
      b.addEventListener("click", () => {
        tier = value;
        page = 1;
        repaint();
      });
      tierRow.appendChild(b);
    };
    tierChip("Tất cả bậc", null, "Mọi bậc, kể cả loài đang khoá");
    for (let t = 0; t < TIER_UNLOCK.length; t++) {
      tierChip("I".repeat(t + 1), t, `Bậc ${t + 1} — xem cả loài đang khoá`);
    }
    wrap.appendChild(tierRow);

    // "Only what I am working towards", and its opposite, which is a reasonable thing to
    // want too: a shelf of what you can already buy tells you what to go and breed.
    const lockRow = el("div", { class: "scrollx", style: "gap:6px;margin-bottom:12px" });
    const lockChip = (label: string, value: "all" | "open" | "locked") => {
      const b = el("button", { class: "btn xs" + (lockFilter === value ? " primary" : "") }, [label]);
      b.addEventListener("click", () => {
        lockFilter = value;
        page = 1;
        repaint();
      });
      lockRow.appendChild(b);
    };
    lockChip("Tất cả", "all");
    lockChip("Chỉ loài đã mở", "open");
    lockChip("Chỉ loài đang khoá", "locked");
    wrap.appendChild(lockRow);

    const optRow = el("div", { class: "scrollx", style: "gap:6px;margin-bottom:12px" });
    const optChip = (label: string, on: boolean, apply: () => void) => {
      const b = el("button", { class: "btn xs" + (on ? " primary" : "") }, [label]);
      b.addEventListener("click", apply);
      optRow.appendChild(b);
    };
    /*
     * Elements and archetypes, folded away by default.
     *
     * This row is nineteen chips long and it was always the least-used filter on the
     * screen. Left open it pushes the shelf itself below the fold on a phone, and a shop
     * whose first screen is nineteen buttons is a shop nobody scrolls past. The toggle says
     * how many are active, so a filter set here is still visible from the collapsed state
     * rather than becoming invisible work.
     */
    const fancyCount = (element ? 1 : 0) + (archetype ? 1 : 0);
    const fancyBtn = el("button", { class: "btn xs" + (fancyOpen ? " primary" : "") }, [
      fancyOpen ? "▾ Nguyên tố" : `▸ Nguyên tố${fancyCount ? ` (${fancyCount})` : ""}`,
    ]);
    fancyBtn.addEventListener("click", () => {
      fancyOpen = !fancyOpen;
      repaint();
    });
    optRow.appendChild(fancyBtn);
    if (fancyOpen) {
      for (const e of ELEMENTS) {
        const on = element === e;
        optChip(ELEMENT_INFO[e].name, on, () => {
          element = on ? null : e;
          page = 1;
          repaint();
        });
      }
      for (const a of ["tank", "burst", "sustain", "control", "tempo", "counter"] as const) {
        const on = archetype === a;
        optChip(ARCHETYPE_ROLE[a], on, () => {
          archetype = on ? null : a;
          page = 1;
          repaint();
        });
      }
    }
    wrap.appendChild(optRow);

    // Price order, and affordability.
    //
    // Put after the element and archetype chips because those narrow *which* plants are
    // shown and these only decide *in what order* - so a player who has just filtered to
    // "Lửa" is not made to re-pick the order afterwards.
    const sortRow = el("div", { class: "scrollx", style: "gap:6px;margin-bottom:10px" });
    const sortChip = (label: string, value: CatalogueSort) => {
      const b = el("button", { class: "btn xs" + (sort === value ? " primary" : "") }, [label]);
      b.addEventListener("click", () => {
        sort = value;
        page = 1;
        repaint();
      });
      sortRow.appendChild(b);
    };
    sortChip("↕ Mặc định", "default");
    sortChip("💰 Giá thấp → cao", "price-asc");
    sortChip("💎 Giá cao → thấp", "price-desc");

    // "Can I afford this" is the question a price order exists to answer, and it cannot be
    // answered from the order alone now that a shelf carries four currencies: the cheapest
    // card may be priced in Pollen the player holds none of. This is the toggle that makes
    // ascending order actionable.
    const affordChip = el("button", { class: "btn xs" + (affordableOnly ? " primary" : "") }, [
      affordableOnly ? "✓ Chỉ loài tôi đủ tiền" : "Chỉ loài tôi đủ tiền",
    ]);
    affordChip.addEventListener("click", () => {
      affordableOnly = !affordableOnly;
      page = 1;
      repaint();
    });
    sortRow.appendChild(affordChip);

    wrap.appendChild(sortRow);

    // Which currency's shelf to browse.
    //
    // The default order leads with tier 0, which is entirely LeafCoin - so without this a
    // player browsing the shop sees one currency and never learns the other three exist.
    //
    // Its own row, and icon-plus-balance rather than name-and-balance. Folded into the sort
    // row it did not fit: nine chips in a 780px column put the four currency chips entirely
    // off the right edge, which is worse than an extra row - a filter nobody can see is not
    // a filter. The full name moved into the tooltip, where it costs no width.
    const curRow = el("div", { class: "scrollx", style: "gap:6px;margin-bottom:12px" });
    const balances: Record<string, number> = {
      leafCoin: store.state.leafCoin,
      nectar: store.state.nectar,
      pollen: store.state.pollen,
      ember: store.state.ember,
    };
    const curChip = (label: string, title: string, value: string | null) => {
      const b = el("button", { class: "btn xs" + (currency === value ? " primary" : ""), title }, [label]);
      b.addEventListener("click", () => {
        currency = value;
        page = 1;
        repaint();
      });
      curRow.appendChild(b);
    };
    curChip("Mọi tiền tệ", "Mọi tiền tệ", null);
    for (const c of CURRENCIES) {
      const held = Math.round(balances[c.id] ?? 0);
      curChip(`${c.icon} ${held.toLocaleString("vi-VN")}`, `${c.name} — bạn đang có ${held.toLocaleString("vi-VN")}`, c.id);
    }
    wrap.appendChild(curRow);

    return wrap;
  };

  const buildFeatured = (): HTMLElement => {
    const box = el("div", { style: "margin-bottom:14px" });
    box.appendChild(
      el("div", { class: "small", style: "font-weight:700;margin-bottom:8px" }, ["🌟 Nổi bật hôm nay"]),
    );
    const rail = el("div", { class: "seed-rail" });
    const picks = featuredSpecies(store.state.playerId, day, store.state.breederLevel, 10, store.unlockContext());
    for (const sp of picks) {
      rail.appendChild(
        seedChip(sp, store.state.seeds[sp.id] ?? 0, {
          onPick: (chip) => {
            const r = store.buySeed(sp.id);
            if (r.ok) {
              if (chip) spendChip(chip, `-${fmt(sp.seedPrice)}🪙`);
              sfx.play("buy");
              toast(`Đã mua hạt ${sp.name}`);
              repaint();
            } else toast(r.reason ?? "Không mua được");
          },
        }),
      );
    }
    box.appendChild(rail);
    return box;
  };

  const buildCatalogue = (): HTMLElement => {
    const res = queryCatalogue({
      playerId: store.state.playerId,
      breederLevel: store.state.breederLevel,
      search,
      tier,
      element,
      archetype,
      page,
      perPage: 24,
      sort,
      affordableOnly,
      locked: lockFilter,
      currency,
      // What the player holds in each currency, so "can I afford this" can be answered
      // per species - the shelf is priced in four of them.
      balances: {
        leafCoin: store.state.leafCoin,
        nectar: store.state.nectar,
        pollen: store.state.pollen,
        ember: store.state.ember,
      },
      // Handed in rather than built here: the query needs the real nursery to
      // tell a gated species from an open one.
      progress: store.unlockContext(),
    });
    const box = el("div");

    box.appendChild(
      el("div", { class: "small", style: "font-weight:700;margin-bottom:8px" }, [
        "Danh mục",
      ]),
    );

    if (res.total === 0) {
      box.appendChild(el("div", { class: "callout" }, ["Không có loài nào khớp bộ lọc."]));
      return box;
    }

    // A grid, not a stack: 24 full cards in one column is a very long scroll.
    const grid = el("div", { class: "seed-grid", style: "margin-bottom:10px" });
    // The lock filter is applied inside the query now, so pagination counts what is shown.
    const shown = res.entries;
    for (const entry of shown) {
      const owned = store.state.seeds[entry.species] ?? 0;
      grid.appendChild(seedCard(getSpecies(entry.species), repaint, owned));
    }
    box.appendChild(grid);

    if (res.pages > 1) {
      const pager = el("div", { class: "row", style: "justify-content:center;gap:8px;margin-top:6px" });
      const prev = el("button", { class: "btn sm" }, ["‹ Trước"]);
      prev.disabled = res.page <= 1;
      prev.addEventListener("click", () => {
        page = res.page - 1;
        repaint();
      });
      const next = el("button", { class: "btn sm" }, ["Sau ›"]);
      next.disabled = res.page >= res.pages;
      next.addEventListener("click", () => {
        page = res.page + 1;
        repaint();
      });
      pager.append(prev, el("span", { class: "small muted" }, [`${res.page} / ${res.pages}`]), next);
      box.appendChild(pager);
    }
    return box;
  };

  repaint();
}

/** One seed card, used by both the featured rail and the catalogue grid. */
function seedCard(sp: SpeciesDef, refresh: () => void, ownedOverride?: number): HTMLElement {
  const owned = ownedOverride ?? store.state.seeds[sp.id] ?? 0;
  const card = el("div", { class: "card", style: "margin-bottom:10px" });
  const row = el("div", { class: "row" });
  const icon = el("div", { style: "width:52px;height:52px;flex:none" });
  icon.innerHTML = seedIcon(sp.id);

  const info = el("div", { class: "grow" });
  info.append(
    el("div", { class: "small", style: "font-weight:700" }, [sp.name]),
    el("div", { class: "tiny muted", style: "margin-top:2px" }, [sp.blurb]),
    el("div", { class: "row wrap", style: "gap:4px;margin-top:5px" }, [
      el("span", { class: "tag" }, ["C"]),
      el("span", { class: "tag" }, [`${ARCHETYPE_ROLE[sp.archetype]}`]),
      el("span", { class: "tag" }, [`${sp.growMinutes} phút`]),
      owned > 0 ? el("span", { class: "tag good" }, [`Có ${owned}`]) : null,
    ]),
  );

  // The gate, resolved once and shown rather than merely enforced. A lock the
  // player cannot read is the same as no lock, except it wastes a tap.
  const gate = checkUnlock(store.unlockContext(), sp.unlock);
  if (!gate.met) {
    const lock = el("div", { class: "unlock-lock" });
    lock.appendChild(el("div", { class: "unlock-head" }, ["Chưa mở khóa"]));
    for (const r of gate.rules) {
      lock.appendChild(
        el("div", { class: "unlock-rule" + (r.met ? " is-met" : "") }, [
          el("span", { class: "unlock-mark" }, [r.met ? "✓" : "○"]),
          el("span", { class: "grow" }, [RULE_LABEL[r.rule.k](r.need)]),
          el("span", { class: "mono" }, [`${r.have}/${r.need}`]),
        ]),
      );
    }
    // "Any of these" is the difference between a requirement and an ultimatum.
    if (gate.rules.length > 1) {
      lock.appendChild(el("div", { class: "tiny muted" }, ["Đạt một trong các điều kiện trên là đủ."]));
    }
    info.appendChild(lock);
  }
  // The price stays visible when locked, with a lock on it. Hiding it loses
  // information the player wants: knowing a thing costs 98 is part of deciding
  // whether it is worth planning for. A dimmed empty slot says nothing.
  // The species' own currency, used for the label *and* the affordability test. Reading
  // one from the definition and the other from somewhere else is how a card ends up
  // offering a Pollen seed to somebody holding nothing but coins.
  const paid = sp.currency;
  const paidIcon = currencyIcon(paid);
  const afford = (n: number) => store.state[paid] >= n;

  const buy = el(
    "button",
    { class: "btn sm primary" + (gate.met ? "" : " is-locked") },
    gate.met ? [`${fmt(sp.seedPrice)}${paidIcon}`] : ["🔒", `${fmt(sp.seedPrice)}${paidIcon}`],
  );
  // Disabled rather than refused: a button you can press and that then complains is
  // worse than one that visibly cannot be pressed.
  buy.disabled = !afford(sp.seedPrice) || !gate.met;
  if (!gate.met) buy.title = gate.summary;
  buy.addEventListener("click", () => {
    const r = store.buySeed(sp.id);
    if (r.ok) {
      spendChip(buy, `-${fmt(sp.seedPrice)}🪙`);
      sfx.play("buy");
      toast(`Đã mua hạt ${sp.name}`);
      refresh();
    } else {
      deny(card);
      toast(r.reason ?? "Không mua được");
    }
  });

  const packPrice = Math.floor(sp.seedPrice * 10 * 0.95);
  const pack = el("button", { class: "btn sm", title: "Mua 10 hạt, giảm 5%" }, [`x10 · ${fmt(packPrice)}${paidIcon}`]);
  // The pack inherits the same gate as the single seed. It used to check only the
  // coin balance, so a locked species still showed a live “buy 10” button that
  // accepted the tap and then refused in silence — the one dead affordance on a card
  // whose entire purpose is to tell the player what they still have to do.
  pack.disabled = !afford(packPrice) || !gate.met;
  if (!gate.met) pack.title = gate.summary;
  pack.addEventListener("click", () => {
    const r = store.buySeed(sp.id, 10);
    if (r.ok) {
      spendChip(pack, `-${fmt(packPrice)}🪙`);
      sfx.play("buy");
      toast(`Đã mua 10 hạt ${sp.name}`);
      refresh();
    } else {
      deny(card);
      toast(r.reason ?? "Không đủ tiền");
    }
  });

  row.append(icon, info, el("div", { class: "col", style: "gap:4px;flex:none" }, [buy, pack]));
  card.appendChild(row);
  return card;
}

function paintItems(body: HTMLElement, refresh: () => void) {
  const items = [
    { id: "water", name: "Bình nước tưới", emoji: "🪣", price: 15, desc: "Vật tư cho Tưới nước" },
    { id: "fertilizer", name: "Phân hữu cơ", emoji: "💩", price: 25, desc: "Dùng cho Bón phân" },
    { id: "serum", name: "Tinh chất gene", emoji: "🧪", price: 120, desc: "Dùng cho Tinh chất gene" },
  ];
  const card = el("div", { class: "card" });
  card.appendChild(el("div", { class: "small", style: "font-weight:700;margin-bottom:4px" }, ["🧺 Kho vật tư"]));
  card.appendChild(el("div", { class: "tiny muted", style: "margin-bottom:10px" }, [`Bạn có ${store.state.items} vật tư · ${store.state.geneCrystal} 💎`]));
  for (const it of items) {
    const row = el("div", { class: "row", style: "padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)" });
    const info = el("div", { class: "grow" });
    info.append(
      el("div", { class: "small", style: "font-weight:600" }, [`${it.emoji} ${it.name}`]),
      el("div", { class: "tiny muted" }, [it.desc]),
    );
    const buy = el("button", { class: "btn sm" }, [`${it.price}🪙`]);
    buy.disabled = store.state.leafCoin < it.price;
    buy.addEventListener("click", () => {
      if (store.state.leafCoin < it.price) {
        deny(row);
        toast("Không đủ tiền");
        return;
      }
      store.state.leafCoin -= it.price;
      store.state.ledger.push({ at: Date.now(), delta: -it.price, reason: `Mua ${it.name}` });
      if (it.id === "serum") store.state.geneCrystal += 1;
      else store.state.items += 5;
      store.save();
      spendChip(buy, `-${it.price}🪙`);
      sfx.play("buy");
      toast(`+5 ${it.name === "Tinh chất gene" ? "💎" : "🧺"}`);
      refresh();
    });
    row.append(info, buy);
    card.appendChild(row);
  }
  body.appendChild(card);

  body.appendChild(
    el("div", { class: "callout", style: "margin-top:12px" }, [
      "Vật tư chỉ hoàn lại 10-25% khi bán cây. Đây là chi phí cơ hội để bạn phải chọn cây nào đem đấu, cây nào bán.",
    ]),
  );
}

/**
 * The plot ladder, in list form.
 *
 * The garden grid shows plots as tiles, which is right for planting and wrong for
 * planning: a tile cannot fit "cấp 14 · 9/14" plus a price plus a button. So the
 * same `plotStatuses` data is drawn here as a list, and the shop tab is a
 * purchase screen rather than a duplicate purchase path.
 *
 * One ladder, one price table, one set of gates — reachable from two screens
 * without either being a second, cheaper way in.
 */
function paintLand(body: HTMLElement, refresh: () => void) {
  const ctx = store.unlockContext();
  const rows = plotStatuses(ctx, store.state.nurseryCap);

  const openCount = rows.filter((r) => r.open).length;
  body.append(
    el("div", { class: "card" }, [
      el("div", { class: "small", style: "font-weight:700" }, [`🌿 Vườn: ${openCount}/${MAX_PLOTS} ô`]),
      el("div", { class: "tiny muted", style: "margin-top:4px" }, [
        `Đang trồng ${store.state.plants.length} cây. Mỗi ô mới có điều kiện riêng — cấp nhà lai tạo, số cây đã trồng, hoặc thành tựu trong vườn.`,
      ]),
    ]),
  );

  // Only the locked ones: the open ones are already visible in the garden grid,
  // and a list of twenty-four rows mostly reading "đã mở" is filler.
  const locked = rows.filter((r) => !r.open);
  const nextUp = locked.filter((r) => r.canBuy);

  if (nextUp.length === 0) {
    const cheapest = locked[0];
    body.appendChild(
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("div", { class: "small", style: "font-weight:700" }, ["Ô kế tiếp"]),
        el("div", { class: "tiny muted", style: "margin-top:4px" }, [cheapest ? `${cheapest.blocked} · ${cheapest.def.cost.toLocaleString("vi-VN")} xu` : "Vườn đã mở hết."]),
      ]),
    );
  }

  for (const row of locked) {
    const card = el("div", { class: "card plot-row" + (row.canBuy ? " can-buy" : "") });
    const head = el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "small", style: "font-weight:700" }, [`Ô ${row.index}`]),
        el("div", { class: "tiny muted", style: "margin-top:2px" }, [row.blocked || "Sẵn sàng mở"]),
      ]),
      el("div", { class: "mono", style: "font-weight:800" }, [`${row.def.cost.toLocaleString("vi-VN")} xu`]),
    ]);
    card.appendChild(head);

    // Every route, with progress. Unlike the garden tile — which shows only the
    // blocker because there is no room — a list row has space, and "level 14 OR
    // plant level 12" is a choice the player should be able to see.
    if (row.status.rules.length > 1) {
      const rules = el("div", { class: "plot-row-rules" });
      for (const r of row.status.rules) {
        rules.appendChild(
          el("div", { class: "unlock-rule" + (r.met ? " is-met" : "") }, [
            el("span", { class: "unlock-mark" }, [r.met ? "✓" : "○"]),
            el("span", { class: "grow" }, [RULE_LABEL[r.rule.k](r.need)]),
            el("span", { class: "mono" }, [`${r.have}/${r.need}`]),
          ]),
        );
      }
      card.appendChild(rules);
    }

    if (row.canBuy) {
      const btn = el("button", { class: "btn sm primary", style: "margin-top:8px" }, [`Mở ô ${row.index}`]);
      btn.addEventListener("click", () => {
        const res = store.buyPlot(row.index);
        if (!res.ok) {
          sfx.play("error");
          toast(res.reason ?? "Không mở được ô");
          return;
        }
        sfx.play("buy");
        toast(`Đã mở ô ${row.index}`);
        refresh();
      });
      card.appendChild(btn);
    }

    body.appendChild(card);
  }
}

function paintOrders(body: HTMLElement, refresh: () => void) {
  const orders = generateOrders(store.state.playerId, Date.now());
  body.appendChild(el("div", { class: "callout", style: "margin-bottom:12px" }, ["Đơn hàng NPC trả thêm tới 1,5 lần giá bán thường. Mỗi ngày có 3-5 đơn, làm mới theo giờ máy chủ."]));

  const sellable = store.state.plants.filter((p) => canSell(p));
  for (const order of orders) {
    const card = el("div", { class: "card", style: "margin-bottom:10px" });
    card.append(
      el("div", { class: "small", style: "font-weight:700" }, [`Cần: ${order.require.keyword}`]),
      el("div", { class: "tiny muted", style: "margin-top:2px" }, [`Tối thiểu ${order.require.minRarity}${order.require.element ? ` · Hệ ${order.require.element}` : ""}`]),
      el("div", { class: "row between", style: "margin-top:8px" }, [
        el("span", { class: "tag", style: `color:var(--accent-2)` }, [`Thưởng x${order.rewardMultiplier}`]),
      ]),
    );
    if (!sellable.length) {
      card.appendChild(el("div", { class: "tiny muted", style: "margin-top:8px" }, ["Chưa có cây bán được."]));
    } else {
      const sel = el("select");
      sel.appendChild(el("option", { value: "" }, ["Chọn cây"]));
      for (const p of sellable) {
        // Handing a plant to an NPC order is permanent, and this menu is the only thing
        // telling two same-named plants apart. Resolved against the whole garden.
        sel.appendChild(
          el("option", { value: p.plantId }, [
            `${plantDisplayName(p, store.state.plants)} (${p.rarity}) · ~${fmt(sellPrice(p) * order.rewardMultiplier)}🪙`,
          ]),
        );
      }
      const go = el("button", { class: "btn sm primary block", style: "margin-top:8px" }, ["Giao hàng"]);
      go.addEventListener("click", () => {
        const id = (sel as HTMLSelectElement).value;
        if (!id) {
          toast("Chọn cây trước");
          return;
        }
        const plant = store.get(id);
        if (!plant) return;
        // Check requirement.
        const ri = ["C", "B", "A", "S", "SS", "SSS"];
        if (ri.indexOf(plant.rarity) < ri.indexOf(order.require.minRarity)) {
          toast(`Cần tối thiểu rarity ${order.require.minRarity}`);
          return;
        }
        if (order.require.element && (plant.dna.elementGenes[order.require.element as never] ?? 0) < 0.2) {
          toast(`Cần cây hệ ${order.require.element}`);
          return;
        }
        const payout = Math.floor(sellPrice(plant) * order.rewardMultiplier);
        const sold = store.sell(plant.plantId);
        if (sold.ok) {
          store.state.leafCoin += payout - (sold.price ?? 0);
          store.save();
          toast(`Giao hàng thành công: +${payout - (sold.price ?? 0)}🪙 (thưởng đơn hàng)`);
          refresh();
        } else toast(sold.reason ?? "Không giao được");
      });
      card.append(sel, go);
    }
    body.appendChild(card);
  }
}

/**
 * Refused purchase: the row shakes once, the toast explains why.
 * A disabled button cannot be tapped to learn the reason — this is the answer
 * for the failures that survive to a click anyway.
 */
function deny(el: HTMLElement): void {
  el.classList.remove("shop-deny");
  void el.offsetWidth;
  el.classList.add("shop-deny");
}
