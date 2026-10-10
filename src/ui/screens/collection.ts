/** Collection screen: the species dex, then the live plants + sell (docs/05 §5, docs/16). */

import { el, plantCard, toast, rarityTag, fmt, plantThumb } from "../components";
import { store, navigate } from "../app";
import { rewardFly } from "../fx/gardenFx";
import { sfx } from "../../audio/audio";

import { RARITY_META, RARITY_ORDER, type Rarity } from "../../config/rarity";
import { canSell } from "../../growth/stages";
import { plantDisplayName } from "../../core/plantNames";
import { sellPrice } from "../../economy/shop";
import { openDetail } from "./garden";
import { getSpecies, type SpeciesId } from "../../config/species";
import { createSeedPlant } from "../../genetics/genomeGenerator";
import { plantBedArt } from "../../render/lazySvg";
import { dominantElement, ELEMENT_INFO } from "../../config/elements";
import { ARCHETYPE_ROLE } from "../../config/balance";
import type { Plant } from "../../core/types";
import type { Navigate } from "./types";

type Filter = "all" | "ready" | "breed" | Rarity;
type View = "mine" | "dex";

/** Which collection view the player left open; persists across repaints. */
let view: View = "mine";

export function renderCollection(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const shell = document.querySelector(".shell")!;

  /*
   * Two views, one segmented switch — "my plants" and "the species index" are
   * different questions (what do I hold vs. what have I ever discovered) and
   * stacking both on one page buried the dex under the sell table.
   */
  const seg = el("div", { class: "seg", role: "tablist", "aria-label": "Chế độ xem bộ sưu tập" });
  const body = el("div");
  const paint = (): void => {
    body.replaceChildren();
    if (view === "mine") paintMine(body, nav, shell);
    else paintDex(body, nav, shell);
  };
  for (const [id, label] of [
    ["mine", "Cây của tôi"],
    ["dex", "Bộ sưu tập"],
  ] as const) {
    const b = el("button", {
      class: view === id ? "on" : "",
      role: "tab",
      "aria-selected": String(view === id),
    });
    b.appendChild(document.createTextNode(label));
    b.addEventListener("click", () => {
      if (view === id) return;
      view = id;
      for (const other of seg.querySelectorAll("button")) {
        const on = other === b;
        other.classList.toggle("on", on);
        other.setAttribute("aria-selected", String(on));
      }
      sfx.play("tap");
      paint();
    });
    seg.appendChild(b);
  }
  root.append(seg, body);
  paint();
  return root;
}

function paintMine(root: HTMLElement, nav: Navigate, shell: Element): void {
  // --- the live inventory -----------------------------------------------------
  root.appendChild(el("div", { class: "sec-title" }, [`Cây trong vườn (${store.state.plants.length})`]));

  // --- filters ---
  const filters: Filter[] = ["all", "ready", "breed", "C", "B", "A", "S", "SS", "SSS"];
  const chipRow = el("div", { class: "scrollx", style: "margin-bottom:12px" });
  let active: Filter = "all";
  const paintGrid = () => {
    const filtered = store.state.plants.filter((p) => {
      if (active === "all") return true;
      if (active === "ready") return p.growth.stage === "mature" || p.growth.stage === "awakened";
      if (active === "breed") return p.growth.level >= 10;
      return p.rarity === active;
    });
    grid.replaceChildren();
    if (!filtered.length) {
      grid.appendChild(el("div", { class: "empty" }, [el("div", { class: "big" }, ["📭"]), el("div", {}, ["Không có cây phù hợp."])]));
    }
    for (const p of filtered) {
      grid.appendChild(
        plantCard(p, () => {
          openDetail(p, nav, shell);
        }),
      );
    }
    countLabel.textContent = `${filtered.length} cây`;
  };

  for (const f of filters) {
    const b = el("button", { class: "btn sm" });
    b.textContent = f === "all" ? "Tất cả" : f === "ready" ? "Sẵn sàng đấu" : f === "breed" ? "Có thể lai" : f;
    if (f === "all") b.classList.add("primary");
    b.addEventListener("click", () => {
      active = f;
      for (const other of chipRow.querySelectorAll(".btn")) other.classList.remove("primary");
      b.classList.add("primary");
      paintGrid();
    });
    chipRow.appendChild(b);
  }
  root.appendChild(chipRow);

  const countLabel = el("div", { class: "tiny muted", style: "margin-bottom:8px" });
  root.appendChild(countLabel);

  /* `shelf`, not `plots`.

     The garden's grid paints a sky - clouds, a horizon gradient, a rim - because it is a
     field of floating islands and that is what the islands are floating in. On the collection
     screen the same class painted a large sky panel around a list, with one plant card in its
     top-left corner and the rest of it empty blue. The panel is sized for a field; a
     collection is a shelf. */
  const grid = el("div", { class: "shelf" });
  root.appendChild(grid);
  paintGrid();

  // --- sell section ---
  const sellable = store.state.plants.filter((p) => canSell(p));
  root.appendChild(el("div", { class: "sec-title", style: "margin-top:18px" }, ["Bán cây"]));
  if (!sellable.length) {
    root.appendChild(
      el("div", { class: "callout" }, ["Chỉ cây trưởng thành, không khoá, không yêu thích mới bán được. Bỏ khoá trong chi tiết cây."]),
    );
  } else {
    const list = el("div", { class: "card" });
    for (const p of sellable.slice(0, 12)) {
      const row = el("div", { class: "row sell-row", style: "padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)" });
      /* The plant itself, small: the row is where "sell the wrong one" happens,
         and a face is quicker to check than a name. */
      const thumb = el("div", { class: "sell-thumb" });
      thumb.innerHTML = plantThumb(p, 34).innerHTML;
      const info = el("div", { class: "grow" });
      info.append(
        el(
          "div",
          { class: "small", style: "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" },
          // Selling is permanent, and this list is the only thing distinguishing two
          // plants that happen to share a name. Resolved against the whole garden so the
          // plant carries the same name on the screen above this one.
          [plantDisplayName(p, store.state.plants)],
        ),
        el("div", { class: "tiny muted" }, [`Đời ${p.generation} · Cấp ${p.growth.level} · Chăm ${p.economy.careCycles} lần`]),
      );
      const price = el("div", { class: "mono", style: "color:var(--accent-2);font-weight:700" });
      price.textContent = `${fmt(sellPrice(p))}🪙`;
      const sellBtn = el("button", { class: "btn sm" }, ["Bán"]);
      sellBtn.addEventListener("click", () => {
        // High rarity needs confirm.
        if (["S", "SS", "SSS"].includes(p.rarity)) {
          const ok = confirm(`Bán ${p.name} (${p.rarity})? Đây là cây hiếm, không thể hoàn tác.`);
          if (!ok) return;
        } else if (["A"].includes(p.rarity)) {
          if (!confirm(`Bán ${p.name} (${p.rarity})?`)) return;
        }
        const r = store.sell(p.plantId);
        if (r.ok) {
          rewardFly(row, { coins: r.price });
          toast(`+${r.price}🪙`);
          navigate("collection");
        } else {
          row.classList.remove("shop-deny");
          void row.offsetWidth;
          row.classList.add("shop-deny");
          sfx.play("error");
          toast(r.reason ?? "Không bán được");
        }
      });
      row.append(thumb, info, rarityTag(p.rarity), price, sellBtn);
      list.appendChild(row);
    }
    root.appendChild(list);
  }

  // --- stats ---
  root.appendChild(el("div", { class: "sec-title", style: "margin-top:18px" }, ["Thống kê"]));
  const stats = el("div", { class: "card" });
  const counts = {} as Record<string, number>;
  for (const p of store.state.plants) counts[p.rarity] = (counts[p.rarity] ?? 0) + 1;
  for (const r of RARITY_ORDER) {
    if (!counts[r]) continue;
    const row = el("div", { class: "row between", style: "padding:3px 0;font-size:13px" });
    row.append(rarityTag(r as Rarity), el("span", { class: "mono" }, [`${counts[r]} cây`]));
    stats.appendChild(row);
  }
  const totalPower = store.state.plants.reduce((a, p) => a + p.powerRating, 0);
  const wins = store.state.plants.reduce((a, p) => a + p.battleRecord.wins, 0);
  stats.appendChild(el("div", { class: "divider" }));
  stats.appendChild(el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Tổng lực chiến"]), el("span", { class: "mono" }, [fmt(totalPower)])]));
  stats.appendChild(el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Tổng thắng"]), el("span", { class: "mono" }, [String(wins)])]));
  root.appendChild(stats);
}

function paintDex(root: HTMLElement, nav: Navigate, shell: Element): void {
  /* --- the species dex -----------------------------------------------------
   *
   * A collection is what has ever been opened, not what is on hand — a plant
   * spent as a breeding parent leaves the garden but does not un-discover its
   * species. `discovery.species` is rebuilt from every plant's lineage, so a
   * consumed parent still counts. The inventory (and the sell table) lives below.
   */
  const ownedBySpecies = new Map<string, number>();
  for (const p of store.state.plants) {
    for (const sp of p.baseLineage) ownedBySpecies.set(sp, (ownedBySpecies.get(sp) ?? 0) + 1);
  }

  root.appendChild(el("div", { class: "sec-title" }, [`Bộ sưu tập loài`]));

  let dexFilter: "all" | "owned" | "gone" = "all";
  const dexChips = el("div", { class: "scrollx", style: "margin-bottom:12px" });
  const dexGrid = el("div", { class: "shelf" });
  root.appendChild(dexChips);
  root.appendChild(dexGrid);

  // Species are rendered through a representative plant built on demand — the
  // dex shows what the species *is*, so the portrait is synthesised rather than
  // borrowed from whichever live plant happens to carry the blood.
  const portraits = new Map<string, Plant>();
  const portrait = (id: string): Plant => {
    let p = portraits.get(id);
    if (!p) {
      p = createSeedPlant(id as SpeciesId, store.state.playerId, `dex:${id}`, 0);
      portraits.set(id, p);
    }
    return p;
  };

  const renderDex = () => {
    const shown = store.state.discovery.species
      .map((id) => getSpecies(id as SpeciesId))
      .filter((sp): sp is NonNullable<typeof sp> => Boolean(sp))
      .filter((sp) => {
        const has = (ownedBySpecies.get(sp.id) ?? 0) > 0;
        if (dexFilter === "owned") return has;
        if (dexFilter === "gone") return !has;
        return true;
      });
    dexGrid.replaceChildren();
    if (!shown.length) {
      dexGrid.appendChild(
        el("div", { class: "empty" }, [
          el("div", { class: "big" }, ["📭"]),
          el("div", {}, [dexFilter === "all" ? "Chưa mở loài nào — trồng hoặc lai cây để ghi vào bộ sưu tập." : "Không có loài phù hợp."]),
        ]),
      );
      return;
    }
    for (const sp of shown) {
      const owned = ownedBySpecies.get(sp.id) ?? 0;
      const rep = portrait(sp.id);
      const card = el("div", { class: `plantcard rar-${rep.rarity}` + (owned === 0 ? " dex-gone" : "") });
      /* The same rarity ribbon the live shelf wears — a species page is still
         a plant portrait, and the rim is how rarity reads at thumbnail size. */
      const ribbon = el("div", { class: "ribbon" });
      ribbon.style.background = `linear-gradient(90deg, ${RARITY_META[rep.rarity].colour}, ${RARITY_META[rep.rarity].colour}22)`;
      card.appendChild(ribbon);
      const bed = el("div", { class: "bed" });
      /* The dex grows with discovery — lazy art here for the same DOM-budget
         reason as the garden plots it mirrors. */
      plantBedArt(bed, rep, 150);
      card.appendChild(bed);
      card.appendChild(el("div", { class: "pname" }, [sp.name]));
      const dom = dominantElement(rep.dna.elementGenes);
      const meta = el("div", { class: "prow" });
      const tierChip = el("span", { class: "chip dim" }, [`Bậc ${"I".repeat(sp.tier + 1)}`]);
      const elemChip = el("span", { class: "chip dim" }, [ELEMENT_INFO[dom.id].name]);
      elemChip.style.color = ELEMENT_INFO[dom.id].ink;
      meta.append(tierChip, elemChip);
      card.appendChild(meta);
      card.appendChild(
        el("div", { class: "tiny " + (owned > 0 ? "" : "muted"), style: owned > 0 ? "font-weight:700" : "" }, [
          owned > 0 ? `Đang có ×${owned}` : "Đã mở · hiện không còn",
        ]),
      );
      card.title = `${sp.name} — ${ARCHETYPE_ROLE[sp.archetype]} · ${owned > 0 ? `còn ${owned} trong vườn` : "đã từng mở, hiện không còn cây nào"}`;
      // Clicking a species that is still in the garden opens that plant; a species
      // whose plants were all spent has nothing to open — its entry is the record.
      const live = store.state.plants.find((p) => p.baseLineage.includes(sp.id));
      card.addEventListener("click", () => {
        if (live) openDetail(live, nav, shell);
        else toast("Loài này đã từng mở — hiện không còn cây nào trong vườn");
      });
      dexGrid.appendChild(card);
    }
  };

  for (const [id, label] of [
    ["all", "Tất cả"],
    ["owned", "Đang có"],
    ["gone", "Đã lai mất"],
  ] as const) {
    const b = el("button", { class: "btn sm" + (id === "all" ? " primary" : "") }, [label]);
    b.addEventListener("click", () => {
      dexFilter = id;
      for (const other of dexChips.querySelectorAll(".btn")) other.classList.remove("primary");
      b.classList.add("primary");
      renderDex();
    });
    dexChips.appendChild(b);
  }
  renderDex();
}