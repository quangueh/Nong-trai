/**
 * The planting ceremony (docs/05 §2).
 *
 * Planting used to be: click an empty plot, a toast says "Da gieo X", the whole
 * screen re-renders. Nothing showed *what* was rolled, so the moment that
 * decides the plant's whole life read as a button press.
 *
 * Three parts:
 *
 *   1. A soil ritual on the plot itself - the ground opens, the seed drops in,
 *      the soil closes over it, then the sprout grows out using the same
 *      growUp/unfurl/bloom vocabulary the rest of the game already uses. No new
 *      animation language.
 *   2. A reveal of the roll. The important part is `mutationGenes` - a fresh
 *      seed already has a hidden instability/purity/wildness roll that decides
 *      how it will grow for the rest of its life, and it used to be invisible.
 *   3. A "next step" so the player knows the loop continues into care rather
 *      than ending at planting.
 *
 * Everything is skippable: tapping anywhere, or the skip button, jumps straight
 * to the reveal. A ceremony you cannot interrupt is a ceremony you stop seeing.
 */

import { el } from "../components";
import type { Plant } from "../../core/types";
import { STAGE_LABEL, STAT_LABEL, dominantArchetype } from "../../core/types";
import { SPECIES_BY_ID, STAT_GENES } from "../../config/species";
import { ELEMENT_INFO, type ElementId } from "../../config/elements";
import { ARCHETYPE_ROLE, ARCHETYPE_STRENGTH, ARCHETYPE_WEAKNESS } from "../../config/balance";
import { sfx } from "../../audio/audio";

/** Vietnamese labels for the hidden mutation roll a fresh seed is dealt. */
const GENE_INFO: { key: keyof Plant["dna"]["mutationGenes"]; label: string; hint: string }[] = [
  { key: "instability", label: "Bất ổn", hint: "Cao = dễ đột biến, dễ nở đặc tính" },
  { key: "purity", label: "Độ thuần", hint: "Cao = ổn định, lai tạo dễ giữ gene" },
  { key: "wildness", label: "Hoang dã", hint: "Cao = chí mạng dễ trúng, khó kiểm soát" },
  { key: "rarityLuck", label: "May mắn hiếm", hint: "Cao = dễ lên độ hiếm cao hơn" },
];

/** A trait name for a gene key, so the reveal can name what it rolled. */
const INSTABILITY_TRAIT: Record<string, string> = {
  overgrowth: "Vượt Tầm",
  night_bloom: "Nở Đêm",
  moon_vein: "Mạch Trăng",
  spore_choke: "Bào Tử",
  venom_veins: "Gân Độc",
  static_bloom: "Tĩnh Điện",
  solar_hunger: "Khát Nắng",
  thick_bark: "Vỏ Dày",
  stone_heart: "Tim Đá",
  thorn_counter: "Phản Gai",
  conductive_vein: "Dẫn Sét",
  toxic_bloom: "Độc Nở",
  sleepy_pollen: "Phấn Hoang",
  dew_skin: "Da Sương",
};

/**
 * Play the ceremony, then show the reveal.
 *
 * `onPlanted` runs after the reveal is dismissed. The caller is responsible for
 * re-rendering; this only mutates the DOM in front of it.
 */
export function playPlanting(opts: {
  plant: Plant;
  onPlanted: () => void;
}): void {
  const { plant, onPlanted } = opts;

  const overlay = el("div", { class: "plant-overlay", role: "dialog", "aria-label": `Gieo ${plant.name}` });
  const stage = el("div", { class: "plant-stage" });
  const pot = el("div", { class: "plant-pot" });
  const dirt = el("div", { class: "plant-dirt" });
  const seed = el("div", { class: "plant-seedviz" });
  seed.append(el("span", { class: "plant-seedglow" }));
  const sprout = el("div", { class: "plant-sprout" });
  const dust = el("div", { class: "plant-dust" });
  for (let i = 0; i < 7; i++) dust.appendChild(el("span", { style: `--i:${i}` }));

  pot.append(dirt, seed, sprout);
  stage.append(dust, pot);

  const skip = el("button", { class: "plant-skip", "aria-label": "Bỏ qua" }, ["Bỏ qua ⏭"]);
  overlay.append(stage, skip);
  document.body.appendChild(overlay);

  // Reveal is built once, up front, and held offscreen until the sprout is done.
  let ritualDone = false;

  /** Tear the overlay down for good and hand the screen back. */
  const dismiss = () => {
    overlay.classList.add("plant-overlay--leaving");
    document.body.classList.remove("planting");
    window.setTimeout(() => overlay.remove(), 260);
    onPlanted();
  };

  /**
   * Ritual finished: swap the stage for the reveal and wait.
   *
   * The reveal stays until the player acts. An earlier version tore itself down
   * 320ms after showing, which meant the one screen carrying the actual
   * information flashed past unread — the exact complaint this was built to fix.
   */
  const showReveal = () => {
    if (ritualDone) return;
    ritualDone = true;
    for (const t of pending) window.clearTimeout(t);
    overlay.removeEventListener("click", skipToReveal);
    skip.remove();
    document.body.classList.remove("planting");

    // If the ritual was skipped before the sprout emerged, the stage is an empty
    // bowl of soil with nothing in it. Keeping it would just be a brown smudge
    // behind the panel, so drop it — the panel is the payload either way.
    if (!sprout.classList.contains("is-growing")) stage.remove();

    const reveal = plantReveal(plant, dismiss);
    overlay.classList.add("plant-overlay--reveal");
    overlay.appendChild(reveal);
    reveal.classList.add("plant-reveal--enter");

    // Tapping the backdrop still continues, because a player who already read it
    // should not have to find the button.
    overlay.addEventListener("click", dismiss);
  };

  const skipToReveal = () => showReveal();

  document.body.classList.add("planting");
  overlay.addEventListener("click", skipToReveal);
  skip.addEventListener("click", (e) => {
    e.stopPropagation();
    showReveal();
  });

  // Drive the ritual off explicit class flips rather than keyframe delays, so the
  // skip handler and the timeline cannot disagree about where the animation is.
  // Timelines are held in a list rather than a single handle: an earlier version
  // kept one `timer` variable, so each beat overwrote the previous handle and
  // `showReveal` could only cancel the last one.
  const pending: number[] = [];
  const beat = (ms: number, fn: () => void) => {
    pending.push(window.setTimeout(fn, ms));
  };

  // Sounds ride the same beats as the animation, so the soil opening and the
  // seed landing are one event rather than a picture with noise beside it.
  beat(120, () => {
    pot.classList.add("is-open");
    sfx.play("dig", { gain: 0.7 });
  });
  beat(420, () => {
    seed.classList.add("is-dropped");
    sfx.play("plant");
  });
  beat(1160, () => {
    pot.classList.add("is-closed");
    // Driven from here rather than by a CSS sibling selector: `.plant-dust` is
    // inserted *before* `.plant-pot`, so `.plant-pot.is-closed ~ .plant-dust`
    // can never match and the puff silently never ran.
    dust.classList.add("is-puff");
    sfx.play("dig", { gain: 0.5, pitch: -5 });
  });
  beat(1500, () => {
    // Inject the art at the moment of emergence, not up front. A finished plant
    // sitting invisible for a second and a half, then fading in, reads as a
    // transition between two states; art that arrives as the soil opens reads
    // as the soil producing it.
    sprout.innerHTML = renderRevealArt(plant, 240);
    sprout.classList.add("is-growing");
    sfx.play("sprout");
  });
  beat(2800, showReveal);

  // Safety net: if anything above is throttled into never firing (background tab,
  // reduced motion interacting badly), still land on the reveal.
  window.setTimeout(showReveal, 6000);
}

/**
 * The reveal card: what the seed actually rolled, and what to do next.
 *
 * Every number here is read off the plant, never invented — the panel is a
 * readout of the roll, not a second opinion about it.
 */
function plantReveal(plant: Plant, onPlanted: () => void): HTMLElement {
  const card = el("div", { class: "plant-reveal" });
  // Readout scrolls, confirm button does not. On a 640px-tall phone the readout
  // is roughly 560px, so an all-in-one card pushed its own button off screen.
  const body = el("div", { class: "plant-reveal-body" });
  card.appendChild(body);
  const arch = dominantArchetype(plant.archetype);
  const species = SPECIES_BY_ID[plant.baseLineage[0]];

  // --- header ---
  const head = el("div", { class: "plant-reveal-head" });
  const art = el("div", { class: "plant-reveal-art" });
  art.innerHTML = renderRevealArt(plant, 96);
  const headText = el("div", { class: "grow" });
  headText.append(
    el("div", { class: "tiny muted" }, [`Dòng ${species.name} · thế hệ ${plant.generation}`]),
    el("div", { class: "plant-reveal-name" }, [plant.name]),
    el("div", { class: "tiny", style: `color:${ELEMENT_INFO[dominantElementOf(plant)].ink}` }, [
      `${ARCHETYPE_ROLE[arch]} · ${STAGE_LABEL[plant.growth.stage]}`,
    ]),
  );
  head.append(art, headText);
  body.appendChild(head);

  // --- the hidden roll: the reason this plant is the way it is ---
  const roll = el("div", { class: "plant-roll" });
  roll.append(el("div", { class: "plant-roll-title" }, ["Lô gen ẩn — cây này sẽ vận đành thế nào"]));
  const geneRows = el("div", { class: "plant-gene-grid" });
  for (const g of GENE_INFO) {
    const v = plant.dna.mutationGenes[g.key] ?? 0;
    const chip = el("div", { class: "plant-gene" });
    const bar = el("div", { class: "plant-gene-bar" });
    bar.append(el("i", { style: `width:${Math.round(v * 100)}%` }));
    chip.append(
      el("div", { class: "plant-gene-top" }, [el("b", {}, [g.label]), el("span", { class: "mono" }, [String(Math.round(v * 100))])]),
      bar,
      el("small", {}, [g.hint]),
    );
    geneRows.appendChild(chip);
  }
  roll.appendChild(geneRows);
  const traitHint = INSTABILITY_TRAIT[plant.traits[0]];
  roll.append(
    el("div", { class: "plant-roll-foot" }, [
      plant.traits.length
        ? `Đặc tính sẵn có: ${traitHint ?? plant.traits[0]}`
        : "Chưa có đặc tính. Chăm cây hoặc lai tạo để mở khóa đặc tính.",
    ]),
  );
  body.appendChild(roll);

  // --- elements ---
  const elems = el("div", { class: "plant-facts" });
  elems.appendChild(el("div", { class: "plant-fact-title" }, ["Thành phần hệ"]));
  const eRow = el("div", { class: "row wrap", style: "gap:5px" });
  const entries = (Object.entries(plant.dna.elementGenes) as [ElementId, number][])
    .filter(([, v]) => v > 0.12)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  for (const [id, share] of entries) {
    const info = ELEMENT_INFO[id];
    const tag = el("span", { class: "tag" }, [`${info.name} ${Math.round(share * 100)}%`]);
    tag.style.color = info.ink;
    tag.style.borderColor = info.tint;
    tag.style.background = info.tint;
    eRow.appendChild(tag);
  }
  elems.appendChild(eRow);
  body.appendChild(elems);

  // --- starting numbers and the ceiling they can reach ---
  const nums = el("div", { class: "plant-facts" });
  nums.appendChild(el("div", { class: "plant-fact-title" }, ["Chỉ số lúc gieo và trần tăng trưởng"]));
  const statGrid = el("div", { class: "plant-stat-grid" });
  for (const g of STAT_GENES) {
    const value = Math.round(plant.stats[g] ?? 0);
    const cap = plant.potential[g]?.softCap ?? 0;
    const cell = el("div", { class: "plant-stat" });
    cell.append(
      el("small", {}, [STAT_LABEL[g]]),
      el("b", { class: "mono" }, [String(value)]),
      el("i", {}, [`→ ${cap}`]),
    );
    statGrid.appendChild(cell);
  }
  nums.appendChild(statGrid);
  body.appendChild(nums);

  // --- what this build is and is not ---
  const build = el("div", { class: "plant-build" });
  build.append(
    el("div", { class: "tiny" }, [el("b", {}, ["Mạnh: "]), ARCHETYPE_STRENGTH[arch]]),
    el("div", { class: "tiny" }, [el("b", {}, ["Yếu: "]), ARCHETYPE_WEAKNESS[arch]]),
  );
  body.appendChild(build);

  // --- next step ---
  const next = el("div", { class: "plant-next" });
  next.append(
    el("div", { class: "tiny" }, [
      `Lớn lên sau ${Math.round((plant.growth.stageReadyAt - Date.now()) / 1000)} giây, rồi cứ mỗi lần chăm là thêm tăng trưởng.`,
    ]),
    el("div", { class: "tiny muted" }, ["Bước kế: chăm cây để mở đặc tính, hoặc đợi trưởng thành rồi đấu và lai tạo."]),
  );
  body.appendChild(next);

  const foot = el("div", { class: "plant-reveal-foot" });
  const go = el("button", { class: "btn primary", style: "width:100%" }, ["Vào vườn"]);
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    onPlanted();
  });
  foot.appendChild(go);
  card.appendChild(foot);

  return card;
}

function dominantElementOf(plant: Plant): ElementId {
  return (Object.entries(plant.dna.elementGenes) as [ElementId, number][]).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * The sprout art for the reveal header.
 *
 * A setter rather than an import because `renderPlantSvg` pulls in the whole
 * procedural renderer, and this module is only ever loaded from the garden
 * screen, which already has it. No cycle, no eager cost.
 */
let renderRevealArt: (plant: Plant, size: number) => string = () => "";

export function setRevealArt(fn: (plant: Plant, size: number) => string): void {
  renderRevealArt = fn;
}