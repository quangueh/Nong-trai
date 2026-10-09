/** Breeding screen + mutation reveal (docs/05 §6, docs/02 §10). */

import { playFusion, stagger } from "../fusion";
import { sfx } from "../../audio/audio";
import {
  DEFAULT_PROTOCOL,
  PROTOCOLS,
  getProtocol,
  protocolUnlocked,
  type ProtocolId,
} from "../../genetics/protocols";
import { el, toast, oddsBar, probabilityRows, rarityTag, traitChips, plantThumb, archetypeRadar, fmt, dismissOnEscape, pickPlantSheet, breedBlock, confirmDialog } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";

import { MUTATION_TIER_META, MUTATION_TIERS, RARITY_META, RARITY_POINT } from "../../config/rarity";

import { dominantArchetype } from "../../core/types";
import { plantDisplayName } from "../../core/plantNames";
import { ARCHETYPE_ROLE } from "../../config/balance";
import { DRAWBACK_LABEL, COUNTER_TAG_LABEL } from "../../config/genePackages";
import type { BreedingResult } from "../../genetics/genomeGenerator";
import type { Navigate } from "./types";

export function renderBreeding(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });

  let slotA: string | null = null;
  let slotB: string | null = null;
  /** The protocol the breeder will run. Defaults to the free one. */
  let protocol: ProtocolId = DEFAULT_PROTOCOL;

  const title = el("div", { class: "sec-title" });
  title.append(el("span", {}, ["🧬 Phòng lai tạo"]));
  root.appendChild(title);

  const slots = el("div", { class: "breed-pair" });
  const slotElA = el("div", { class: "slot" });
  // data-bleed: the conduit pseudo-element reaches ±14px into the pods on
  // purpose — the link box is narrower than the channel it must draw.
  const link = el("div", { class: "breed-link", "data-bleed": "1" }, [
    /* docs/23 §7 — the gene flow: two motes ride the channel from each parent
       into the medallion while the pair stands ready. The channel itself is
       drawn by CSS (.breed-link::before); these are the moving pieces. */
    el("i", { class: "flow-dot a", "aria-hidden": "true", "data-bleed": "1" }),
    el("i", { class: "flow-dot b", "aria-hidden": "true", "data-bleed": "1" }),
    el("span", { class: "breed-link-ico" }, ["+"]),
    el("span", { class: "breed-link-lbl" }, ["lai"]),
  ]);
  const slotElB = el("div", { class: "slot" });
  slots.append(slotElA, link, slotElB);
  root.appendChild(slots);

  const info = el("div", { class: "card", style: "margin-top:12px" });
  root.appendChild(info);

  // The protocol picker sits directly above the button it modifies. Anything further
  // away and the odds bar below it stops being a readout of the thing being chosen.
  const protocolBox = el("div", { class: "proto-box" });
  root.appendChild(protocolBox);

  const breedBtn = el("button", { class: "btn primary block breed-cta" }, ["🧬 Lai tạo"]);
  root.appendChild(breedBtn);

  // The spend is irreversible, so it is named before it happens. Hidden until the
  // press, it is a trap; stated here, it is a rule.
  //
  // Placed *after* the button is appended. `breedBtn.after(cost)` on a parentless node
  // is a silent no-op, so an earlier version attached the notice right after the button
  // was constructed and it never entered the DOM at all — it rendered nowhere, and
  // because the call was not an error nothing said so.
  const cost = el("div", { class: "proto-cost" });
  breedBtn.after(cost);

  const candidates = store.state.plants.filter((p) => p.growth.stage === "mature" || p.growth.stage === "awakened");

  const paintSlots = () => {
    paintSlot(
      slotElA,
      slotA ? store.get(slotA) : undefined,
      () => openPicker("cây A", slotB, (id) => {
        slotA = id;
        paintSlots();
        paintCost();
      }),
      "cây A",
    );
    paintSlot(
      slotElB,
      slotB ? store.get(slotB) : undefined,
      () => openPicker("cây B", slotA, (id) => {
        slotB = id;
        paintSlots();
        paintCost();
      }),
      "cây B",
    );
    /* One slot filled turns the other into the invitation. */
    slotElA.classList.toggle("is-next", !slotA && Boolean(slotB));
    slotElB.classList.toggle("is-next", !slotB && Boolean(slotA));
    // The link medallion is the only piece of the screen that reads the pair as a
    // pair: empty "+", a live helix once both parents stand in their slots.
    const ready = Boolean(slotA && slotB);
    link.classList.toggle("is-ready", ready);
    (link.firstElementChild as HTMLElement).textContent = ready ? "🧬" : "+";
    paintInfo();
  };

  const paintProtocols = () => {
    protocolBox.replaceChildren();
    protocolBox.appendChild(el("div", { class: "sec-title", style: "font-size:12px;padding:0 0 6px" }, [
      el("span", {}, ["🧪 Phương lai"]),
    ]));

    const chips = el("div", { class: "scrollx", style: "gap:6px;padding-bottom:6px" });
    for (const p of PROTOCOLS) {
      const unlocked = protocolUnlocked(p.id, store.state.breederLevel);
      const on = protocol === p.id;
      const chip = el(
        "button",
        {
          class: "proto-chip" + (on ? " is-on" : "") + (unlocked ? "" : " is-locked"),
          title: unlocked ? p.blurb + " " + p.tradeoff : "Mở khi cấp nhà lai tạo " + p.levelRequired,
        },
        [
          el("span", { class: "proto-ico" }, [unlocked ? p.icon : "🔒"]),
          el("span", { class: "proto-name" }, [p.label]),
          el("span", { class: "proto-fee mono" }, [
            p.feeMultiplier === 1 ? "Miễn phí" : "x" + p.feeMultiplier,
          ]),
        ],
      );
      if (!unlocked) {
        chip.appendChild(el("span", { class: "proto-lock mono" }, ["cấp " + p.levelRequired]));
      }
      /*
       * Disabled as a *property*, after the element exists.
       *
       * `el`'s attribute map writes every value with `setAttribute`, so passing
       * `disabled: unlocked ? "" : "disabled"` produced `disabled=""` for the unlocked
       * case — which is a present boolean attribute, so every chip was disabled at
       * every level. An empty string is not the absence of a value to `setAttribute`,
       * and the failure is invisible until someone taps the chip.
       */
      chip.disabled = !unlocked;
      chip.addEventListener("click", () => {
        protocol = p.id;
        sfx.play("tap");
        paintProtocols();
        paintInfo();
      });
      chips.appendChild(chip);
    }
    protocolBox.appendChild(chips);

    // The selected protocol's benefit and its cost, both in full. Never abbreviated:
    // the tradeoff line is the only place the player learns that Đồn nhân can
    // produce a plant that is weird rather than strong.
    const chosen = getProtocol(protocol);
    const detail = el("div", { class: "card", style: "margin:2px 0 0;padding:9px 10px" });
    detail.append(
      el("div", { class: "small", style: "font-weight:700" }, [chosen.icon + " " + chosen.label]),
      el("div", { class: "tiny", style: "margin-top:3px" }, [chosen.blurb]),
      // The colour lives in the stylesheet: it was an inline `#b06a12` here that failed the
      // contrast audit at 3.50:1, and an inline value is not where anyone looks to fix a
      // contrast problem.
      el("div", { class: "tiny proto-tradeoff", style: "margin-top:3px" }, ["⚠ " + chosen.tradeoff]),
    );
    protocolBox.appendChild(detail);
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
      info.appendChild(el("div", { class: "callout bad" }, ["Không thể tự lai cùng một cây."]));
      breedBtn.disabled = true;
      return;
    }
    // Both of these follow the selected protocol. They used to be read straight off
    // the parent pair, which meant the screen showed the odds of a breeding the
    // player was never going to run.
    const weights = store.breedingPreview(a.plantId, b.plantId, protocol);
    if (!weights) return;
    info.append(
      el("div", { class: "small", style: "font-weight:800;margin-bottom:6px" }, ["🔮 Dự đoán cây con"]),
      el("div", { class: "tiny muted", style: "margin-bottom:6px" }, ["Xác suất độ hiếm của cây con:"]),
      oddsBar(weights),
    );
    const rows = el("div", { style: "margin-top:8px" });
    for (const r of probabilityRows(weights)) rows.appendChild(r);
    info.appendChild(rows);

    // meta
    const effLevel = Math.floor((a.growth.level + b.growth.level) / 2);
    const fee = store.breedingFee(a.plantId, b.plantId, protocol);
    /*
 * A plain container, preceded by an actual divider.
 *
 * This was `el("div", { class: "divider" })`. `divider` is a hairline rule in this
 * stylesheet — `height: 1px` — and using it as a wrapper put 70-odd pixels of meta
 * rows inside a one-pixel box. They still rendered, because the overflow is visible,
 * so nothing looked broken; they simply painted outside the card they belonged to.
 *
 * That went unnoticed for as long as nothing sat directly underneath. Adding the
 * protocol picker below made the spill land on it, and the two drew over each other.
 */
info.appendChild(el("div", { class: "divider", style: "margin:10px 0 8px" }));
const meta = el("div");
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Cấp cha mẹ trung bình"]), el("span", { class: "mono" }, [String(effLevel)])]));
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Phí lai (hệ số ×" + getProtocol(protocol).feeMultiplier + ")"]), el("span", { class: "mono" }, [`${fee}🪙`])]));
    {
      // The two promises the protocol makes, stated numerically. A ceiling of
      // "no higher than major" is easier to trust than "mutates less", and it is
      // what the code actually does.
      const ceilingIndex = Math.min(3, Math.max(0, 3 + getProtocol(protocol).tierCeilingShift));
      const ceiling = MUTATION_TIER_META[MUTATION_TIERS[ceilingIndex]].label + " cao nhất";
      meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Đột biến cao nhất"]), el("span", { class: "mono" }, [ceiling])]));
    }
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Độ đa dạng gene"]), el("span", { class: "mono" }, [diversityLabel(a, b)])]));
    meta.appendChild(el("div", { class: "row between tiny muted" }, [el("span", {}, ["Chu kỳ lai"]), el("span", { class: "mono" }, [String(store.state.pity.totalBreeds)])]));
    info.appendChild(meta);
  };

  breedBtn.addEventListener("click", () => {
    if (!slotA || !slotB) return;
    const a = store.get(slotA);
    const b = store.get(slotB);
    if (!a || !b) return;
    /*
     * Breeding is irreversible — both parents are consumed the moment the
     * store settles it. The fee and the consequence are on the card above the
     * button already; this dialog is the last deliberate step, not the first
     * place the player learns the cost.
     */
    confirmDialog({
      title: "Lai hai cây này?",
      body: `${a.name} và ${b.name} sẽ được tiêu hao để tạo một cây con mới — kinh nghiệm của cha mẹ chuyển sang con. Không thể hoàn tác.`,
      confirmLabel: "🧬 Lai tạo",
      onConfirm: () => runBreed(),
    });
  });

  const runBreed = () => {
    if (!slotA || !slotB) return;
    const res = store.breed(slotA, slotB, protocol);
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
  };

  const paintCost = () => {
    const a = slotA ? store.get(slotA) : undefined;
    const b = slotB ? store.get(slotB) : undefined;
    if (!a || !b || a.plantId === b.plantId) {
      cost.className = "proto-cost";
      cost.replaceChildren(el("div", { class: "tiny muted" }, ["Chọn hai cây trưởng thành để lai. Cây con sẽ là cây mới."]));
      return;
    }
    cost.className = "proto-cost is-live";
    cost.replaceChildren(
      el("div", { class: "tiny", style: "font-weight:700" }, ["⚠ Cây cha mẹ sẽ mất đến vào vốn"]),
      el("div", { class: "tiny" }, [a.name]),
      el("div", { class: "tiny" }, [b.name]),
      el("div", { class: "tiny muted", style: "margin-top:3px" }, ["Kinh nghiệm cha mẹ sẽ chuyển thành kinh nghiệm của cây con."]),
    );
  };

  // Protocols first: the odds bar and the fee in `paintInfo` both read the selected
  // protocol, so the picker has to be painted before the slots it is priced against.
  paintProtocols();
  paintCost();
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
    // The slot takes the plant's rarity colour on its rim — the same signal the
    // arena avatar carries, so a rare parent reads as rare before any odds text.
    slot.style.setProperty("--rarc", RARITY_META[plant.rarity]?.colour ?? "transparent");
    const thumb = el("div");
    thumb.innerHTML = plantThumb(plant, 132).innerHTML;
    thumb.style.width = "132px";
    thumb.style.height = "132px";
    // Both parent slots print against the whole garden, because that is the set the
    // player is choosing from and breeding destroys both of these plants. Two slots
    // reading "Rễ Gai hạt" is a way to destroy the wrong plant.
    const name = el("div", { class: "small", style: "font-weight:700;line-height:1.2" }, [
      plantDisplayName(plant, store.state.plants),
    ]);
    const meta = el("div", { class: "tiny muted" }, [`Đời ${plant.generation} · Cấp ${plant.growth.level}`]);
    slot.append(thumb, rarityTag(plant.rarity), name, meta);
  } else {
    slot.classList.remove("filled");
    slot.style.removeProperty("--rarc");
    slot.append(
      el("div", { class: "slot-pod" }, ["🥚"]),
      // The label is parameterised: both slots used to read "Chọn cây A", so the
      // player could not tell which parent they were picking.
      el("div", { class: "small", style: "font-weight:800" }, [`Chọn ${label}`]),
      el("div", { class: "tiny muted" }, ["Cha mẹ sẽ chuyển gene cho con"]),
    );
  }
  slot.onclick = onClick;
}

function openPicker(label: string, otherSlot: string | null, onPick: (id: string) => void) {
  // The shared sheet lists the whole garden with the reason each plant is out —
  // fusion spends both parents, so the choice deserves every detail on the row.
  // `otherSlot` keeps the plant already in the other parent slot visible but
  // unpickable: breeding a plant with itself is rejected at the store anyway,
  // so the row should say why before the tap rather than toast it after.
  pickPlantSheet({
    title: `Chọn ${label}`,
    plants: store.state.plants,
    blocked: (p) => (p.plantId === otherSlot ? "Đã chọn ở ô kia" : breedBlock(p)),
    emptyText: "Chưa có cây nào trong vườn.",
    onPick: (p) => onPick(p.plantId),
  });
}

// --- mutation reveal ---

export function openMutationReport(result: BreedingResult, onClose: () => void) {
  const shell = document.querySelector(".shell")!;
  const { plant, report } = result;
  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet breed-report", style: "max-height:92%" });
  /* The whole report is tinted by what it describes: the headline halo and the
     sheet's edge read the rarity colour, so "this one mattered" is visible
     before a single mutation row is read. */
  s.style.setProperty("--rar", RARITY_META[report.rarity].colour);
  s.classList.add("r-" + report.rarity.toLowerCase());
  s.appendChild(el("div", { class: "handle" }));

  const content = el("div", { class: "fadein" });
  content.appendChild(el("div", { class: "sec-title" }, ["Kết quả lai tạo"]));

  // headline
  const headline = el("div", { class: "row", style: "gap:12px;align-items:center" });
  const thumb = el("div", { class: "breed-report-thumb" + ((RARITY_POINT[report.rarity] ?? 0) >= 2 ? " is-rare" : "") });
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
  const est = el("div", { class: "callout", style: "margin-top:10px" });
  est.textContent = `Giá bán ước tính: ~${fmt(sellPriceOf(plant))}🪙 · ECR ${plant.validation.ecr.toFixed(3)} · Thi đấu: ${plant.validation.rankedLegal ? "hợp lệ" : "không hợp lệ"}`;
  content.appendChild(est);

  const dismiss = (): void => {
    overlay.remove();
    s.remove();
    onClose();
  };
  const close = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["🌿 Đưa vào vườn"]);
  close.addEventListener("click", dismiss);
  content.appendChild(close);

  s.appendChild(content);
  dismissOnEscape(s, dismiss);
  shell.append(overlay, s);

  // Mutations land first, then the skills that carry them, then the assessment.
  // The order is the reading order a player wants anyway.
  stagger(mutRows, 70);
  stagger(skillRows, 60, mutRows.length * 70 + 160);
  sfx.play("bloom", { gain: 0.55 });
}
