/** Collection screen: list + filters + sell (docs/05 §5, docs/16). */

import { el, plantCard, toast, rarityTag, fmt } from "../components";
import { store, navigate } from "../app";

import { RARITY_ORDER, type Rarity } from "../../config/rarity";
import { canSell } from "../../growth/stages";
import { plantDisplayName } from "../../core/plantNames";
import { sellPrice } from "../../economy/shop";
import { openDetail } from "./garden";
import type { Navigate } from "./types";

type Filter = "all" | "ready" | "breed" | Rarity;

export function renderCollection(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  const shell = document.querySelector(".shell")!;

  const title = el("div", { class: "sec-title" });
  title.append(el("span", {}, [`Bộ sưu tập (${store.state.plants.length})`]));
  root.appendChild(title);

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

  const grid = el("div", { class: "plots" });
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
      const row = el("div", { class: "row", style: "padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)" });
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
          toast(`+${r.price}🪙`);
          navigate("collection");
        } else toast(r.reason ?? "Không bán được");
      });
      row.append(info, rarityTag(p.rarity), price, sellBtn);
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

  return root;
}
