/** Breeding screen + mutation reveal (docs/05 §6, docs/02 §10). */

import { playFusion, stagger } from "../fusion";
import { sfx } from "../../audio/audio";
import { el, toast, oddsBar, probabilityRows, rarityTag, traitChips, plantThumb, archetypeRadar, fmt } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";

import { MUTATION_TIER_META } from "../../config/rarity";

import { dominantArchetype } from "../../core/types";
import { ARCHETYPE_ROLE } from "../../config/balance";
import { DRAWBACK_LABEL, COUNTER_TAG_LABEL } from "../../config/genePackages";
import type { BreedingResult } from "../../genetics/genomeGenerator";
import type { Navigate } from "./types";

export function renderBreeding(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });

  let slotA: string | null = null;
  let slotB: string | null = null;

  const title = el("div", { class: "sec-title" });
  title.append(el("span", {}, ["🧬 Phòng lai tạo"]));
  root.appendChild(title);

  const slots = el("div", { class: "grid2" });
  const slotElA = el("div", { class: "slot" });
  const slotElB = el("div", { class: "slot" });
  slots.append(slotElA, slotElB);
  root.appendChild(slots);

  const info = el("div", { class: "card", style: "margin-top:12px" });
  root.appendChild(info);

  const breedBtn = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["🧬 Lai tạo"]);
  root.appendChild(breedBtn);

  const candidates = store.state.plants.filter((p) => p.growth.stage === "mature" || p.growth.stage === "awakened");

  const paintSlots = () => {
    paintSlot(
      slotElA,
      slotA ? store.get(slotA) : undefined,
      () => openPicker((id) => {
        slotA = id;
        paintSlots();
      }),
      "cây A",
    );
    paintSlot(
      slotElB,
      slotB ? store.get(slotB) : undefined,
      () => openPicker((id) => {
        slotB = id;
        paintSlots();
      }),
      "cây B",
    );
    paintInfo();
  };

  const paintInfo = () => {
    info.replaceChildren();
    const a = slotA ? store.get(slotA) : undefined;
    const b = slotB ? store.get(slotB) : undefined;
    if (!a || !b) {
      info.appendChild(el("div", { class: "tiny muted" }, ["Chọn hai cây trưởng thành. Tỉ lệ hiếm bên dưới là xác suất THẬT sau mọi điều chỉnh."]));
      breedBtn.disabled = true;
      return;
    }
    breedBtn.disabled = false;
    if (a.plantId === b.plantId) {
      info.appendChild(el("div", { class: "notice bad" }, ["Không thể tự lai cùng một cây."]));
      breedBtn.disabled = true;
      return;
    }
    const weights = store.breedingPreview(a.plantId, b.plantId);
    if (!weights) return;
    info.append(
      el("div", { class: "tiny muted", style: "margin-bottom:6px" }, ["Xác suất độ hiếm của cây con:"]),
      oddsBar(weights),
    );
    const rows = el("div", { style: "margin-top:8px" });
    for (const r of probabilityRows(weights)) rows.appendChild(r);
    info.appendChild(rows);

    // meta
    const effLevel = Math.floor((a.growth.level + b.growth.level) / 2);
    const fee = Math.floor((sellPriceOf(a) + sellPriceOf(b)) * 0.2);
    const meta = el("div", { class: "divider" });
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Cấp cha mẹ trung bình"]), el("span", { class: "mono" }, [String(effLevel)])]));
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Phí lai"]), el("span", { class: "mono" }, [`${fee}🪙`])]));
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Độ đa dạng gene"]), el("span", { class: "mono" }, [diversityLabel(a, b)])]));
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Chu kỳ lai"]), el("span", { class: "mono" }, [String(store.state.pity.totalBreeds)])]));
    info.appendChild(meta);
  };

  breedBtn.addEventListener("click", () => {
    if (!slotA || !slotB) return;
    const res = store.breed(slotA, slotB);
    if (!res.ok || !res.result) {
      sfx.play("error");
      toast(res.reason ?? "Lai thất bại");
      return;
    }
    // The ceremony first, then the numbers. Two plants and a genome produced
    // this plant; showing a table of text as the whole result made the most
    // interesting thing in the game the least interesting moment in it.
    playFusion(res.result.plant, () => {
      openMutationReport(res.result!, () => nav("breeding"));
    });
  });

  paintSlots();

  if (!candidates.length) {
    root.appendChild(
      el("div", { class: "empty" }, [el("div", { class: "big" }, ["🌱"]), el("div", {}, ["Chưa có cây trưởng thành. Chăm cây cho tới khi lớn."])]),
    );
  }

  return root;
}

function sellPriceOf(p: Plant): number {
  // local import avoided for cycle safety
  return Math.max(50, Math.round(p.powerRating * 0.6));
}

function diversityLabel(a: Plant, b: Plant): string {
  const setA = new Set(a.dna.lineage);
  const setB = new Set(b.dna.lineage);
  const shared = [...setA].filter((s) => setB.has(s)).length;
  if (shared === 0) return "Cao (khác dòng)";
  if (shared < 2) return "Vừa";
  return "Thấp (cùng dòng)";
}

function paintSlot(slot: HTMLElement, plant: Plant | undefined, onClick: () => void, label = "cây") {
  slot.replaceChildren();
  if (plant) {
    slot.classList.add("filled");
    const thumb = el("div");
    thumb.innerHTML = plantThumb(plant, 120).innerHTML;
    thumb.style.width = "120px";
    thumb.style.height = "120px";
    const name = el("div", { class: "small", style: "font-weight:700;line-height:1.2" }, [plant.name]);
    const meta = el("div", { class: "tiny muted" }, [`Đời ${plant.generation} · Cấp ${plant.growth.level}`]);
    slot.append(thumb, rarityTag(plant.rarity), name, meta);
  } else {
    slot.classList.remove("filled");
    slot.append(
      el("div", { style: "font-size:30px;opacity:.5" }, ["🌱"]),
      // The label is parameterised: both slots used to read "Chọn cây A", so the
      // player could not tell which parent they were picking.
      el("div", { class: "small muted" }, [`Chọn ${label}`]),
    );
  }
  slot.onclick = onClick;
}

function openPicker(onPick: (id: string) => void) {
  const shell = document.querySelector(".shell")!;
  const content = el("div");
  content.appendChild(el("h3", { style: "font-size:16px;margin-bottom:10px" }, ["Chọn cây trưởng thành"]));
  const list = el("div", { class: "scrollx", style: "padding-bottom:8px" });
  const mature = store.state.plants.filter((p) => p.growth.stage === "mature" || p.growth.stage === "awakened");
  if (!mature.length) {
    content.appendChild(el("div", { class: "empty" }, ["Chưa có cây trưởng thành."]));
  }
  for (const p of mature) {
    const card = el("div", { class: "plantcard", style: "flex:none;width:120px" });
    card.appendChild(plantThumb(p, 70));
    const n = el("div", { class: "name", style: "font-size:11px" });
    n.textContent = p.name;
    card.appendChild(n);
    card.appendChild(el("div", { class: "tiny muted mono" }, [`Lv${p.growth.level} · D${p.generation}`]));
    card.addEventListener("click", () => {
      onPick(p.plantId);
      overlay.remove();
      s.remove();
    });
    list.appendChild(card);
  }
  content.appendChild(list);

  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet" });
  s.appendChild(el("div", { class: "handle" }));
  s.appendChild(content);
  overlay.addEventListener("click", () => {
    overlay.remove();
    s.remove();
  });
  shell.append(overlay, s);
}

// --- mutation reveal ---

export function openMutationReport(result: BreedingResult, onClose: () => void) {
  const shell = document.querySelector(".shell")!;
  const { plant, report } = result;
  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet", style: "max-height:92%" });
  s.appendChild(el("div", { class: "handle" }));

  const content = el("div", { class: "fadein" });
  content.appendChild(el("div", { class: "sec-title" }, ["Kết quả lai tạo"]));

  // headline
  const headline = el("div", { class: "row", style: "gap:12px;align-items:center" });
  const thumb = el("div");
  thumb.style.width = "100px";
  thumb.style.height = "100px";
  thumb.innerHTML = plantThumb(plant, 100).innerHTML;
  const htext = el("div", { class: "grow" });
  htext.append(
    el("h3", { style: "font-size:18px" }, [plant.name]),
    el("div", { class: "row wrap", style: "gap:5px;margin-top:6px" }, [
      rarityTag(report.rarity),
      el("span", { class: "tag" }, [`Đời ${plant.generation}`]),
      el("span", { class: "tag" }, [report.elementLine]),
    ]),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [`Điểm hiếm ${report.rarityScore.toFixed(1)} · Điểm xây dựng ${plant.validation.buildValue.toFixed(0)}/${plant.validation.tierBudget}`]),
  );
  headline.append(thumb, htext);
  content.appendChild(headline);

  // mutations
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Đột biến"]));
  const mutList = el("div", { class: "card" });
  // Collected so the list can arrive as a sequence. All at once it gave the eye
  // no order to read it in, and the mutation tiers are the whole reason to look.
  const mutRows: HTMLElement[] = [];
  for (const m of report.mutations) {
    const row = el("div", { class: "row", style: "padding:4px 0;gap:8px" });
    const dot = el("span");
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "50%";
    dot.style.background = MUTATION_TIER_META[m.tier].colour;
    dot.style.flex = "none";
    row.append(dot, el("div", { class: "grow" }, [el("div", { class: "small", style: "font-weight:600" }, [m.label]), el("div", { class: "tiny muted" }, [m.detail])]));
    mutList.appendChild(row);
    mutRows.push(row);
  }
  content.appendChild(mutList);

  // skills
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Chiêu thức"]));
  const skillRows: HTMLElement[] = [];
  for (const name of report.skillNames) {
    const row = el("div", { class: "card", style: "padding:9px;margin-bottom:6px;font-weight:600;font-size:13px" });
    row.textContent = name;
    content.appendChild(row);
    skillRows.push(row);
  }

  // packages & tradeoffs
  if (report.packages.length) {
    content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Gói gene & đánh đổi"]));
    const pk = el("div", { class: "card" });
    for (const name of report.packages) {
      pk.appendChild(el("div", { class: "small", style: "font-weight:700" }, [name]));
    }
    const dw = el("div", { class: "tiny", style: "margin-top:6px;color:var(--danger)" });
    dw.textContent = "Đánh đổi: " + report.drawbacks.map((d) => DRAWBACK_LABEL[d] ?? d).join(", ");
    pk.appendChild(dw);
    if (report.counters.length) {
      const ct = el("div", { class: "tiny", style: "margin-top:4px;color:#0d5f85" });
      ct.textContent = "Bị khắc bởi: " + report.counters.map((c) => COUNTER_TAG_LABEL[c] ?? c).join(", ");
      pk.appendChild(ct);
    }
    content.appendChild(pk);
  }

  // traits
  const chips = traitChips(plant);
  if (chips.length) {
    content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Đặc tính"]));
    content.appendChild(el("div", { class: "row wrap", style: "gap:6px" }, chips));
  }

  // strength / weakness
  const arch = dominantArchetype(plant.archetype);
  content.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Đánh giá"]));
  const assess = el("div", { class: "card row" });
  const radar = el("div");
  radar.innerHTML = archetypeRadar(plant, 130);
  const atext = el("div", { class: "grow" });
  atext.append(
    el("div", { class: "small", style: "font-weight:700" }, [`${arch.toUpperCase()} — ${ARCHETYPE_ROLE[arch]}`]),
    el("div", { class: "tiny", style: "color:#0d5f85;margin-top:4px" }, ["Mạnh: " + report.strengths[0]]),
    el("div", { class: "tiny", style: "color:#0d5f85" }, ["Mạnh: " + (report.strengths[1] ?? "")]),
    el("div", { class: "tiny", style: "color:var(--danger);margin-top:2px" }, ["Yếu: " + report.weaknesses[0]]),
  );
  assess.append(radar, atext);
  content.appendChild(assess);

  // est. sell
  const est = el("div", { class: "notice", style: "margin-top:10px" });
  est.textContent = `Giá bán ước tính: ~${fmt(sellPriceOf(plant))}🪙 · ECR ${plant.validation.ecr.toFixed(3)} · Thi đấu: ${plant.validation.rankedLegal ? "hợp lệ" : "không hợp lệ"}`;
  content.appendChild(est);

  const close = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["🌿 Đưa vào vườn"]);
  close.addEventListener("click", () => {
    overlay.remove();
    s.remove();
    onClose();
  });
  content.appendChild(close);

  s.appendChild(content);
  shell.append(overlay, s);

  // Mutations land first, then the skills that carry them, then the assessment.
  // The order is the reading order a player wants anyway.
  stagger(mutRows, 70);
  stagger(skillRows, 60, mutRows.length * 70 + 160);
  sfx.play("bloom", { gain: 0.55 });
}
