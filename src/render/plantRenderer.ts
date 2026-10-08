/**
 * Procedural plant renderer (docs/07, docs/06 §11).
 *
 * A plant is never stored as a bitmap — only its visual genes are saved and it is
 * re-rendered from them. This is what lets near-infinite variants each look
 * distinct with zero asset cost.
 *
 * Construction order mirrors how a plant actually builds itself, so growth reads
 * as growth: ground shadow, aura, roots, stem, leaves, thorns, bloom, fruit,
 * fungus, then markings. Everything is a path from `plantGeometry`; nothing is
 * an ellipse standing in for a leaf.
 */

import type { Plant, VisualGenes } from "../core/types";
import { dominantElement } from "../config/elements";
import { Rng } from "../core/rng";
import {
  blobPath,
  along,
  angleOf,
  branchCount,
  cubicSamples,
  dist,
  grassBlades,
  habitFor,
  leafFamilyFor,
  leafFamilyPath,
  leafMidrib,
  leafPath,
  leafVeins,
  petalPath,
  pt,
  quadSamples,
  r2,
  rotate,
  rootPath,
  shardPath,
  soilMound,
  taperedOutline,
  type Habit,
  type Pt,
} from "./plantGeometry";

export interface PlantPalette {
  stem: string;
  stemShade: string;
  stemLight: string;
  leaf: string;
  leafDark: string;
  leafLight: string;
  accent: string;
  bloom: string;
  bloomShade: string;
  shadow: string;
  ground: string;
}

/**
 * Palette with a real value structure.
 *
 * The previous version mapped the `lightness` gene straight onto HSL lightness
 * at 44–92%, so every plant came out pale: leaves read as wireframe outlines on
 * a cream card and the stem was the only thing with any weight. Screenshots
 * showed exactly that.
 *
 * So the hue and saturation genes drive the colour, and lightness only nudges
 * within a narrow band around fixed anchors. Leaves sit in the mid range with a
 * genuinely dark underside, the stem is always the darkest note, and blooms pop
 * because they are the only high-chroma light note on the plant.
 */
export function plantPalette(visual: VisualGenes): PlantPalette {
  const { hue, hueSpread, saturation, accentHue } = visual;
  const sat = Math.round(Math.min(1, saturation * 1.15) * 100);
  const leafHue = (hue + hueSpread / 2) % 360;
  // `lightness` now biases toward the middle of each anchor instead of being the
  // anchor itself: ±8 points, never enough to wash the form out.
  const bias = (visual.lightness - 0.5) * 16;
  const L = (anchor: number) => Math.max(8, Math.min(88, Math.round(anchor + bias)));

  return {
    // Stem is the darkest note on the plant — it anchors the silhouette.
    stem: `hsl(${hue} ${Math.round(sat * 0.8)}% ${L(36)}%)`,
    stemShade: `hsl(${hue} ${Math.round(sat * 0.86)}% ${L(24)}%)`,
    stemLight: `hsl(${hue} ${Math.round(sat * 0.7)}% ${L(50)}%)`,
    // Leaves occupy the mid range so they read as solid shapes.
    leaf: `hsl(${leafHue} ${sat}% ${L(47)}%)`,
    leafDark: `hsl(${hue} ${Math.round(sat * 0.9)}% ${L(33)}%)`,
    leafLight: `hsl(${(leafHue + hueSpread * 0.3) % 360} ${Math.round(sat * 0.86)}% ${L(61)}%)`,
    accent: `hsl(${accentHue} ${Math.round(sat * 1.05)}% ${L(64)}%)`,
    bloom: `hsl(${(accentHue + 25) % 360} ${Math.round(sat * 1.05)}% ${L(72)}%)`,
    bloomShade: `hsl(${(accentHue + 25) % 360} ${Math.round(sat * 1.1)}% ${L(52)}%)`,
    shadow: `hsl(${hue} 30% 18%)`,
    ground: `hsl(30 36% 52%)`,
  };
}

/**
 * How far from the centre line a plant may reach.
 *
 * 47 rather than 50: the bloom, the eyes and the fruit all sit a few units
 * outside the stem they hang off, and they are not scaled by anything the solver
 * can turn down.
 */
const SIDE_MARGIN = 47;

const STAGE_SCALE: Record<string, number> = {
  seed: 0.3,
  sprout: 0.48,
  young: 0.72,
  mature: 1,
  awakened: 1.12,
};

/** What the plant looks like right now, given stage and visual genes. */
function composition(plant: Plant) {
  const v = plant.visual;
  const body = plant.dna.bodyGenes;
  const stage = plant.growth.stage;
  const stageScale = STAGE_SCALE[stage] ?? 1;
  const scale = v.scale * stageScale;
  const complexity = v.complexity;

  // A seed stage shows only the sprout; a sprout shows stem and cotyledons.
  const leafBudget = Math.max(stage === "seed" ? 3 : stage === "young" ? 11 : 15, Math.round(complexity * 36) + (stage === "young" ? 3 : 0));
  const showVeins = complexity > 0.45;
  const showBloom = body.flower !== "none" && complexity > 0.3 && stage !== "seed" && stage !== "sprout";
  const showThorns = body.thorn !== "none" && stage !== "seed";
  const showFungus = body.fungus !== "none" && stage !== "seed" && stage !== "sprout";
  const showFruit = body.fruit !== "none" && complexity > 0.5 && (stage === "mature" || stage === "awakened");
  return { v, body, stage, scale, complexity, leafBudget, showVeins, showBloom, showThorns, showFungus, showFruit };
}

/**
 * Render a plant as an SVG string. `size` is the box size in px.
 * `anim` adds growth animation; it is off for static contexts (lists, exports).
 */
export function renderPlantSvg(plant: Plant, size = 120, opts: { anim?: boolean } = {}): string {
  const anim = opts.anim ?? false;
  const { v, body, stage, scale, complexity, leafBudget, showVeins, showBloom, showThorns, showFungus, showFruit } =
    composition(plant);
  const pal = plantPalette(v);

  // Deterministic per-plant RNG: the same plant always renders identically, but
  // two plants never share a silhouette.
  const rng = new Rng(`render:${plant.plantId}`);
  // Geometry decisions get their own stream. The frame solver has to reproduce
  // the exact same lean, sway and curl, and sharing one RNG meant the solver (which
  // draws a different number of values) produced a different stem than the one
  // actually rendered.
  const geoRng = new Rng(`geometry:${plant.plantId}`);
  const gid = `p${plant.plantId.replace(/[^a-z0-9]/gi, "")}`;

  const cx = 50;

  // The 100x100 box is the entire budget — anything outside it is clipped away.
  const SOIL_TOP = 84;

  const baseY = SOIL_TOP;
  const soilY = SOIL_TOP + 2;
  const lean = stemLean(body.stem, v, geoRng);
  const sway = geoRng.float(-4, 4) + (body.stem === "vine" ? 6 : 0);

  /**
   * Solve the whole growth ladder for this plant, in one pass.
   *
   * Each stage is solved against the frame *and* against the stage below it.
   * Solving stages independently produced two opposite bugs: the solver shrank
   * the awakened stage below the mature one, so a plant visibly lost height as it
   * reached its final form; and enforcing a floor to prevent that pushed some
   * young plants straight out of the top of the frame. Carrying the solved height
   * forward satisfies both at once.
   */
  const solved = solveGrowthLadder(plant);
  const plan = solved[stage] ?? solved.mature;
  const { height, fitX, bloomScale, leafScale } = plan;

  const base: Pt = pt(cx, baseY);
  const habit = habitFor(body, complexity);
  const skeleton = buildHabit(habit, cx, baseY, height, lean, sway, complexity, geoRng);
  const spine = skeleton.main;
  // The tip curls over on itself. A straight quadratic always ends pointing the
  // same way it grew, so every plant was a pole with a prop on top; a third
  // control point gives the stem a growing tip.
  const curl = stemCurl(body.stem, v, geoRng);
  spine.push(...curledTip(spine, curl));
  const top: Pt = spine[spine.length - 1];

  // Everything below is authored in unit space and multiplied by this.
  const s = scale * fitX;
  const leafS = s * leafScale;

  // --- layers -----------------------------------------------------------
  // The aura follows the plant's mass, not the frame's centre line. A circle
  // pinned at x=50 looks correct only while a plant stands upright; on a leaning
  // or arching one it sat beside the crown, reading as a separate object.
  const canopyCx = (() => {
    const pts = skeleton.branches.length > 0 ? [...skeleton.main, ...skeleton.branches.flatMap((b) => b.spine)] : skeleton.main;
    const mid = Math.floor(pts.length / 2);
    const c = pts[Math.min(pts.length - 1, mid)].x;
    // A glow must not be pushed out of frame by the plant it belongs to.
    return Math.max(12, Math.min(88, c));
  })();
  const aura = auraLayer(v, canopyCx, baseY, s, pal, gid, rng);
  const ground = groundLayer(cx, soilY, s, pal, gid, rng);
  const roots = rootLayer(base, s, body.stem, rng);
  const stemWidth = stemWidthFor(body.stem, s);
  let stem = stemLayer(spine, stemWidth, body.stem, pal, gid);
  // Branches are narrower than the trunk and drawn with the same tapered ribbon,
  // so they read as the same plant rather than as glued-on sticks.
  for (const br of skeleton.branches) {
    stem += stemLayer(br.spine, stemWidth * 0.52, body.stem, pal, gid);
  }
  const { leaves, petioles } = leafLayer(spine, leafBudget, leafS, complexity, showVeins, pal, rng, body, stage, gid, skeleton);
  const thorns = showThorns ? thornLayer(spine, s, complexity, body.thorn, pal, rng) : "";
  const bloom = showBloom ? bloomLayer(top, s * bloomScale, body.flower, pal, gid, rng) : "";
  const fruit = showFruit ? fruitLayer(spine, s, body.fruit, pal, rng) : "";
  const fungus = showFungus ? fungusLayer(base, s, body.fungus, pal, rng) : "";
  const marking = v.pattern !== "plain" ? patternLayer(v, spine, s, complexity, pal, rng) : "";
  // A face and a bloom occupy the same space on the tip, so eyes are skipped when
  // the plant flowers - otherwise they ended up sitting on top of the petals.
  const eyes = v.eyeCount > 0 && !showBloom ? eyeLayer(top, s, v.eyeCount, pal, top.x - spine[spine.length - 3].x) : "";

  // --- animation classes ------------------------------------------------
  // `anim` gates the keyframes in styles.css; without it the same markup is
  // static, which is what the garden grid and battle avatars want.
  const cls = anim ? " anim" : "";
  const g = (child: string, extra = ""): string => (child ? `<g class="${extra}${cls}" style="--d:${rng.float(0, 0.5).toFixed(2)}s">${child}</g>` : "");

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="plantart${anim ? " is-anim" : ""}" role="img" aria-label="${escapeAttr(plant.name)}">
  <defs>
    
    <linearGradient id="${gid}stem" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="${pal.stemShade}"/><stop offset="60%" stop-color="${pal.stem}"/><stop offset="100%" stop-color="${pal.stemLight}"/></linearGradient>
    <linearGradient id="${gid}leaf-lit" x1="0" y1="0" x2="1" y2="0.15"><stop offset="0%" stop-color="${pal.leafDark}"/><stop offset="42%" stop-color="${pal.leaf}"/><stop offset="100%" stop-color="${pal.leafLight}"/></linearGradient>
    <linearGradient id="${gid}leaf-shade" x1="0" y1="0" x2="1" y2="0.15"><stop offset="0%" stop-color="${shadeHex(pal.leafDark, -8)}"/><stop offset="50%" stop-color="${pal.leafDark}"/><stop offset="100%" stop-color="${pal.leaf}"/></linearGradient>
    <radialGradient id="${gid}bloomCore" cx="38%" cy="32%" r="75%"><stop offset="0%" stop-color="${pal.bloom}"/><stop offset="55%" stop-color="${pal.accent}"/><stop offset="100%" stop-color="${pal.bloomShade}"/></radialGradient>
    <radialGradient id="${gid}occl"><stop offset="0%" stop-color="${pal.stemShade}" stop-opacity="0.55"/><stop offset="70%" stop-color="${pal.stemShade}" stop-opacity="0.18"/><stop offset="100%" stop-color="${pal.stemShade}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${gid}glow"><stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.5"/><stop offset="55%" stop-color="${pal.accent}" stop-opacity="0.16"/><stop offset="100%" stop-color="${pal.accent}" stop-opacity="0"/></radialGradient>
    <filter id="${gid}soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
    <linearGradient id="${gid}bloom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${pal.bloom}"/><stop offset="100%" stop-color="${pal.bloomShade}"/></linearGradient>
    <radialGradient id="${gid}haze"><stop offset="0%" stop-color="${pal.shadow}" stop-opacity="0.3"/><stop offset="70%" stop-color="${pal.shadow}" stop-opacity="0.1"/><stop offset="100%" stop-color="${pal.shadow}" stop-opacity="0"/></radialGradient>
  </defs>
  ${ground}
  ${g(aura, "l-aura")}
  ${g(roots, "l-roots")}
  ${g(stem, "l-stem")}
  ${petioles ? `<g class="l-petioles${cls}">${petioles}</g>` : ""}
  ${leaves ? `<g class="l-leaves${cls}">${leaves}</g>` : ""}
  ${g(thorns, "l-thorns")}
  ${g(fungus, "l-fungus")}
  ${g(fruit, "l-fruit")}
  ${g(bloom, "l-bloom")}
  ${g(marking, "l-marking")}
  ${g(eyes, "l-eyes")}
</svg>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Darken/lighten an hsl() string by a percentage of lightness. */
function shadeHex(color: string, deltaL: number): string {
  const m = color.match(/hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)/);
  if (!m) return color;
  const l = Math.max(0, Math.min(100, parseFloat(m[3]) + deltaL));
  return `hsl(${m[1]} ${m[2]}% ${l}%)`;
}

/**
 * The final stretch of the stem, curling over.
 *
 * Returned as extra samples to append to the spine, so every downstream layer
 * (leaves, thorns, pattern, fruit) keeps working off one continuous curve. Without
 * this the tip pointed in exactly the same direction it grew from, which is what
 * made the plants read as poles with props on top.
 */
function curledTip(spine: Pt[], curl: number): Pt[] {
  if (Math.abs(curl) < 1) return [];
  const tip = spine[spine.length - 1];
  const prev = spine[Math.max(0, spine.length - 3)];
  const dirX = tip.x - prev.x;
  const dirY = tip.y - prev.y;
  const len = Math.hypot(dirX, dirY) || 1;
  // Perpendicular to the direction of travel, which is where a curl bends.
  const nx = -dirY / len;
  const ny = dirX / len;
  const reach = len * 0.42;
  const side = Math.sign(curl) || 1;
  const ctrl = { x: tip.x + nx * curl * side, y: tip.y + ny * curl * side };
  const end = { x: tip.x + (dirX / len) * reach + nx * curl * side * 0.8, y: tip.y + (dirY / len) * reach + ny * curl * side * 0.8 };
  return cubicSamples(tip, { x: tip.x + nx * curl * side * 0.4, y: tip.y + ny * curl * side * 0.4 }, ctrl, end, 5);
}

/** How far the stem tip curls over, in units. Positive curls toward the +normal. */
function stemCurl(stem: string, v: VisualGenes, rng: Rng): number {
  const base =
    { thin: 1.1, slender: 1.3, normal: 1.6, thick: 0.9, vine: 3, lean: 2, braided: 1.8 }[stem] ?? 1.6;
  return base * (0.5 + v.complexity * 0.8) * (rng.bool() ? 1 : -1);
}

/**
 * Solve the stem height and horizontal fit for every growth stage at once.
 *
 * Each stage is fitted to the frame *and* to the stage below it. The two
 * constraints pull against each other: fitting each stage independently made the
 * awakened stage shorter than the mature one, so a plant lost height as it
 * reached its final form; and enforcing a height floor to prevent that pushed
 * young plants out of the top of the frame. Solving the ladder in order with the
 * previous stage as a floor satisfies both.
 */
function solveGrowthLadder(plant: Plant): Record<string, GrowthPlan> {
  const SOIL_TOP = 84;
  // A few units of slack absorbs the residual error in the canopy estimate; without
  // it, one strongly-curled plant in ~120 could still overhang by a pixel.
  const TOP_MARGIN = 8;
  const cx = 50;
  const v = plant.visual;
  const body = plant.dna.bodyGenes;
  const complexity = v.complexity;
  const geoRng = new Rng(`geometry:${plant.plantId}`);
  const lean = stemLean(body.stem, v, geoRng);
  const sway = geoRng.float(-4, 4) + (body.stem === "vine" ? 6 : 0);
  // Shorter and fuller rather than tall and sparse: a stem half-empty of
  // foliage reads as a stick, and the contact sheet showed exactly that.
  const fill = Math.min(1.24, 0.8 + v.scale * 0.3);
  // The solver and the renderer must describe the same plant, so the habit and
  // its branches are decided once, here, from the same deterministic stream.
  const habit = habitFor(body, complexity);

  const out: Record<string, GrowthPlan> = {};
  let prev = 0;

  for (const stage of STAGE_ORDER) {
    const comp = compositionFor(plant, stage);
    const baseScale = v.scale * (STAGE_SCALE[stage] ?? 1);
    const bloomR = (body.flower === "bud" ? 7 : 16) * baseScale;
    const hasBloom = body.flower !== "none" && complexity > 0.3 && stage !== "seed" && stage !== "sprout";

    let height = Math.max(prev, (SOIL_TOP - 12) * (STAGE_SCALE[stage] ?? 1) * fill);
    let fitX = 1;
    let bloomScale = 1;
  // Bigger leaves: with the count raised, each leaf also has to carry more of the
  // silhouette, or a full plant reads as clutter instead of foliage.
    let leafScale = 1.3;

    // The spine must include the curled tip: the renderer appends the curl before
    // any layer is drawn, so leaves hang off it and the bloom sits above it.
    // Solving against a straight spine under-measured the canopy by ~9 units.
    const curl = stemCurl(body.stem, v, geoRng);

// Both axes have to fit, and they are constrained by different things:
    // height decides whether the canopy clears the top of the frame, while the
    // skeleton decides how far the plant reaches sideways. An arch throws its
    // tip 0.55x its height out to one side, so a plant can clear the top
    // comfortably and still poke out of the right edge.
    //
    // `fitX` cannot solve the horizontal case: it only scales the decoration -
    // leaves, bloom, aura, roots - and the stem is drawn at its solved
    // coordinates. The only thing that narrows an arch is a shorter height, so
    // the horizontal overflow is folded into the same shrink step as the
    // vertical one and the tighter of the two wins.
    for (let attempt = 0; attempt < 10; attempt++) {
      const skeleton = buildHabit(habit, cx, SOIL_TOP, height, lean, sway, complexity, geoRng);
      skeleton.main.push(...curledTip(skeleton.main, curl));

      const partScale0 = baseScale * leafScale;
      const top = canopyTop(skeleton, comp.leafBudget, partScale0, complexity, body, stage, hasBloom ? bloomR * bloomScale : 0);

      // Horizontal fit, in two parts because there are two levers.
      //
      // The stem is drawn at its solved coordinates: nothing except a shorter
      // height narrows it. So its extent is measured on its own and is what the
      // shrink step reacts to.
      const stemSpread = skeleton.main.reduce((m, p) => Math.max(m, Math.abs(p.x - cx)), 0);
      const branchSpread = skeleton.branches.reduce(
        (m, b) => m + b.spine.reduce((n, p) => Math.max(n, Math.abs(p.x - cx)), 0),
        0,
      );
      // The bloom sits at the tip and reaches bloomR past it, and the eyes sit
      // beside the tip. A flat allowance covered small flowers and under-covered
      // large ones, which is how a 0.8-unit bloom overhang survived.
      const tipAllowance = Math.max(4, bloomR * bloomScale + 2);
      const stemSide = Math.max(stemSpread, branchSpread) + Math.abs(sway) + tipAllowance;
      // The leaves *are* scaled by fitX, so they are fitted from whatever room is
      // left over. A leaf is (15 + 2.6k) x baseScale x sizeVariation with a petiole
      // of 0.34x the blade, and sizeVariation runs to 1.34 — hence 26.
      const leafReach = (stage === "seed" || stage === "sprout" ? 11 : 26) * baseScale;

      // Take the tighter of the two vertical/horizontal constraints. Both are
      // "available / used", so they compose.
      const vRatio = top >= TOP_MARGIN ? 1 : (SOIL_TOP - TOP_MARGIN) / Math.max(1, SOIL_TOP - top);
      const hRatio = stemSide <= SIDE_MARGIN ? 1 : SIDE_MARGIN / Math.max(1, stemSide);
      const ratio = Math.min(vRatio, hRatio);
      // Floor at 0.55, not 1 and not 0. See `fitFromRoom`.
      fitX = fitFromRoom(stemSide, leafReach);

      if (ratio >= 1) break;
      const next = height * Math.max(0.62, Math.min(0.97, ratio));
      if (next >= prev) {
        height = next;
      } else {
        // The floor wins. What still has to fit is taken out of the bloom and the
        // leaves first — both are decoration — rather than out of the plant's
        // height, because reversing growth is worse than a smaller flower.
        height = prev;
        bloomScale = Math.max(0.55, bloomScale * Math.max(0.62, Math.min(0.95, ratio)));
        leafScale = Math.max(0.5, leafScale * Math.max(0.66, Math.min(0.97, ratio)));
        attempt += 10;
      }
    }
    out[stage] = { height, fitX, bloomScale, leafScale };
    prev = height;
  }

  // Final clamp. The loop above can run out of attempts with the canopy still
  // poking out — most often on a plant whose floor height is already close to
  // the frame limit. Rather than let it clip, take the remainder out of the
  // decorative parts. Measured by `tools/shot.ts --bounds`.
  for (const stage of STAGE_ORDER) {
    const comp = compositionFor(plant, stage);
    const baseScale = v.scale * (STAGE_SCALE[stage] ?? 1);
    const bloomR = (body.flower === "bud" ? 7 : 16) * baseScale;
    const hasBloom = body.flower !== "none" && complexity > 0.3 && stage !== "seed" && stage !== "sprout";
    const plan = out[stage];
    for (let guard = 0; guard < 40; guard++) {
      const skeleton = buildHabit(habit, cx, SOIL_TOP, plan.height, lean, sway, complexity, geoRng);
      skeleton.main.push(...curledTip(skeleton.main, stemCurl(body.stem, v, geoRng)));
      const top = canopyTop(skeleton, comp.leafBudget, baseScale * plan.fitX * plan.leafScale, complexity, body, stage, hasBloom ? bloomR * plan.bloomScale : 0);

      // Same horizontal check as the solve loop. The loop above can exit on its
      // iteration budget with the plant still wide, and `--bounds` showed that
      // leaving both axes unverified here is what let stems out of the frame.
      //
      // Height is the only lever that narrows a stem, so this is the one place a
      // width problem gets fixed even when the monotonic-growth floor has already
      // spent the shrink budget. Clipping is worse.
      const tipAllowance = Math.max(4, (body.flower === "bud" ? 7 : 16) * baseScale * plan.bloomScale + 2);
      const stemSide = horizontalStemExtent(skeleton) + Math.abs(sway) + tipAllowance;
      if (stemSide > SIDE_MARGIN) plan.height *= Math.max(0.88, SIDE_MARGIN / stemSide);
      plan.fitX = Math.min(plan.fitX, fitFromRoom(stemSide, leafReachFor(stage, baseScale)));
      if (top >= TOP_MARGIN && stemSide <= SIDE_MARGIN) break;
      // Take it out of the leaves first, then the bloom: both are decoration, the
      // stem height is what carries the plant's identity.
      if (plan.leafScale > 0.45) plan.leafScale *= 0.9;
      else if (plan.bloomScale > 0.4) plan.bloomScale *= 0.9;
      else {
        // Last resort: shave the height. It violates the monotonic-growth floor,
        // but a few units of clipped stem is far less noticeable than a crown
        // hanging outside the frame. Kept looping rather than breaking after one
        // shave — a single step was not always enough to close the gap.
        plan.height *= Math.max(0.9, (SOIL_TOP - TOP_MARGIN) / Math.max(1, SOIL_TOP - top));
      }
    }
  }
  return out;
}

/** Fitted geometry for one growth stage. */
export interface GrowthPlan {
  /** Stem height above the soil line. */
  height: number;
  /** Horizontal squeeze for wide or leaning plants, 0..1. */
  fitX: number;
  /** Bloom size multiplier; reduced only when the frame cannot fit it otherwise. */
  bloomScale: number;
  /** Leaf size multiplier, same reasoning as bloomScale. */
  leafScale: number;
}

const STAGE_ORDER = ["seed", "sprout", "young", "mature", "awakened"] as const;

/** Stage-specific parts, so the ladder can solve a stage other than the current one. */
function compositionFor(plant: Plant, stage: string) {
  const complexity = plant.visual.complexity;
  const stageScale = STAGE_SCALE[stage] ?? 1;
  const scale = plant.visual.scale * stageScale;
  const leafBudget = Math.max(stage === "seed" ? 3 : stage === "young" ? 11 : 15, Math.round(complexity * 36) + (stage === "young" ? 3 : 0));
  return { scale, complexity, leafBudget };
}

/** The stem's spine as sample points, from soil line to tip. */
function buildSpine(cx: number, baseY: number, height: number, lean: number, sway: number): Pt[] {
  const base = pt(cx, baseY);
  const top = pt(cx + lean + sway, baseY - height);
  const ctrl = pt(cx + lean * 0.35 + sway * 0.4, baseY - height * 0.55);
  return quadSamples(base, ctrl, top, 14);
}

export interface Skeleton {
  habit: Habit;
  /** The main stem. Always present, even for a rosette (it is short). */
  main: Pt[];
  /** Side branches, each with the point on the main stem where it leaves. */
  branches: { spine: Pt[]; at: number; dir: number }[];
}

/**
 * Build the plant's skeleton for a habit.
 *
 * The main stem is solved for every habit so the frame solver and the renderer
 * are still describing the same plant; what changes is the *shape* of that stem
 * and whether it carries branches:
 *
 *   spire    a tall, near-straight stem — the classic silhouette
 *   bush     a short stem with side branches; mass sits in the middle
 *   rosette  a very short stem; the leaves are the plant
 *   arch     the stem leans hard and the tip comes back down
 *   spiral   a vine that winds, so the silhouette has a rhythm
 *
 * Branch count comes from complexity, so a deliberately simple plant does not
 * sprout three branches and read as an error.
 */
function buildHabit(
  habit: Habit,
  cx: number,
  baseY: number,
  height: number,
  lean: number,
  sway: number,
  complexity: number,
  rng: Rng,
): Skeleton {
  const base = pt(cx, baseY);
  let main: Pt[];
  let branches: Skeleton["branches"] = [];

  switch (habit) {
    case "rosette": {
      // Barely a stem: a low mound of growth the leaves sit on.
      main = quadSamples(base, pt(cx + lean * 0.2, baseY - height * 0.6), pt(cx + lean * 0.3, baseY - height), 10);
      break;
    }
    case "arch": {
      // Leans out and over. Two control points are needed or the tip keeps going
      // in the same direction it grew.
      const reach = height * 0.55;
      const drop = height * 0.34;
      main = cubicSamples(
        base,
        pt(cx + lean * 0.2, baseY - height * 0.8),
        pt(cx + reach + lean * 0.5, baseY - height * 0.98),
        pt(cx + reach * 1.15 + lean * 0.4, baseY - height + drop),
        14,
      );
      break;
    }
    case "spiral": {
      // A winding vine: the control point orbits, so the stem reads as twisting.
      const turns = 1.1 + complexity * 0.7;
      const amp = Math.min(7, height * 0.13);
      const pts: Pt[] = [];
      const steps = 22;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = baseY - height * t;
        const a = t * Math.PI * 2 * turns + sway * 0.4;
        // The amplitude tapers to zero at the tip so the vine ends, not stops.
        const taper = Math.sin(Math.PI * Math.min(1, t * 1.06));
        pts.push({ x: cx + lean * t + Math.cos(a) * amp * taper, y });
      }
      main = pts;
      break;
    }
    case "bush": {
      // Short trunk, then the mass moves out to the sides.
      main = quadSamples(base, pt(cx + lean * 0.3, baseY - height * 0.62), pt(cx + lean * 0.6, baseY - height), 12);
      break;
    }
    default: {
      main = buildSpine(cx, baseY, height, lean, sway);
      break;
    }
  }

  const n = branchCount(habit, complexity);
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      // Branches leave the trunk between 30% and 85% of its height, alternating
      // sides, so they never stack into a symmetrical candelabra.
      const t = 0.3 + (i / Math.max(1, n)) * 0.55 + rng.float(-0.05, 0.05);
      const idx = Math.round(t * (main.length - 1));
      const from = main[Math.min(main.length - 1, idx)];
      const dir = i % 2 === 0 ? 1 : -1;
      const len = height * rng.float(0.42, 0.68);
      const rise = height * rng.float(0.5, 0.78);
      const tip = { x: from.x + dir * len, y: from.y - rise };
      const ctrl = { x: from.x + dir * len * 0.32, y: from.y - rise * 0.72 };
      branches.push({ spine: quadSamples(from, ctrl, tip, 10), at: t, dir });
    }
  }

  return { habit, main, branches };
}

/**
 * Highest y a plant reaches above the soil line.
 *
 * Mirrors the geometry in `leafLayer` so the solver reserves exactly the right
 * amount, and now also takes the skeleton: a rosette throws its leaves out from
 * the base at their own angles, and a bush puts leaves on branches that reach
 * somewhere else entirely. Ignoring both let a rosette's crown sit nine units
 * outside the top of the frame — caught by `test-art`.
 */
function canopyTop(
  skeleton: Skeleton,
  leafCount: number,
  s: number,
  complexity: number,
  body: Record<string, string>,
  stage: string,
  bloomR: number,
): number {
  const spine = skeleton.main;
  const stemTop = spine[spine.length - 1].y;
  let top = stemTop;
  if (bloomR > 0) top = Math.min(top, stemTop - bloomR * 2.1);

  const cotyledon = stage === "sprout" || stage === "seed";
  const rosette = skeleton.habit === "rosette" && !cotyledon;
  const branchShare = skeleton.habit === "bush" ? skeleton.branches.length : 0;
  const total = dist(spine[0], spine[spine.length - 1]);
  const stemAngle = angleOf(spine[0], spine[spine.length - 1]);

  for (let i = 0; i < leafCount; i++) {
    let a: Pt;
    let leafAngle: number;
    let size: number;
    let t = 0;

    if (rosette) {
      // Radiating leaves: the anchor is the base and the angle sweeps past
      // vertical, so the topmost leaf points up rather than out.
      a = { x: spine[0].x, y: spine[0].y - 1 };
      leafAngle = -150 + (i / Math.max(1, leafCount)) * 120;
      size = 23 * s;
    } else {
      t = cotyledon ? 0.12 + i * 0.1 : 0.22 + (i / Math.max(1, leafCount)) * 0.68;
      const onBranch = branchShare > 0 && i >= leafCount - branchShare * 2;
      let baseAngle: number;
      if (onBranch) {
        const br = skeleton.branches[(i - (leafCount - branchShare * 2)) % skeleton.branches.length];
        const brLen = dist(br.spine[0], br.spine[br.spine.length - 1]);
        const bt = 0.35 + ((i * 0.37) % 0.55);
        a = along(br.spine[0], br.spine[br.spine.length - 1], brLen * bt);
        baseAngle = angleOf(br.spine[0], br.spine[br.spine.length - 1]);
        t = bt;
      } else {
        a = along(spine[0], spine[spine.length - 1], total * Math.min(0.98, t));
        baseAngle = stemAngle;
      }
      const side = i % 2 === 0 ? -1 : 1;
      const droop = cotyledon ? 12 : 8 + t * 34;
      leafAngle = baseAngle + side * (52 - t * 14) + droop * (side > 0 ? 1 : 0.6);
      size = (cotyledon ? 11 : 18 + (i % 3) * 3.4) * s * (1 - t * 0.25);
    }

    const side = i % 2 === 0 ? -1 : 1;
    // Distance from the anchor to the leaf tip is the petiole PLUS the blade, not
    // half the blade — underestimating this by ~0.8x the leaf length is what let
    // three plants poke out of the top of the frame.
    const petiole = size * 0.34;
    const blade = size;
    const reach = petiole + blade;
    // The blade curls, which swings its tip up or down away from its own axis.
    // `leafLayer` picks curl from its own RNG, so the worst case is used here.
    const worstCurl = cotyledon ? 24 : 40;
    const tipAngle = leafAngle - side * worstCurl;
    const d = rotate(pt(reach, 0), pt(0, 0), tipAngle);
    top = Math.min(top, a.y + d.y);
    // The blade's widest point sits off its axis and can be higher than the tip.
    const halfWidth = (size * (0.62 + complexity * 0.26)) / 2;
    const midAngle = leafAngle - side * worstCurl * 0.4;
    const m = rotate(pt(petiole + blade * 0.45, 0), pt(0, 0), midAngle);
    top = Math.min(top, a.y + m.y - halfWidth);
  }
  void body;
  return top;
}

function groundLayer(cx: number, soilY: number, scale: number, pal: PlantPalette, gid: string, rng: Rng): string {
  // Cap the mound so the bottom of the box is never overrun.
  const moundRy = Math.min(5.5 * scale, Math.max(2, 99 - soilY) * 0.5);
  const rx = Math.min(22 * scale + 6, 42);
  void gid;

  // Warm, saturated soil. The old `pal.ground` was hsl(26 30% 42%) — nearly grey.
  const top = shadeHex(pal.ground, 10);
  const face = shadeHex(pal.ground, -12);
  const rim = shadeHex(pal.ground, 26);

  const grit: { x: number; y: number; r: number; o: number }[] = [];
  const pebbles = 3 + Math.round(scale * 3);
  for (let i = 0; i < pebbles; i++) {
    const a = rng.float(0, Math.PI * 2);
    const d = rng.float(0.15, 0.9);
    grit.push({
      x: cx + Math.cos(a) * rx * d,
      y: soilY + moundRy * (0.25 + Math.sin(a) * d * 0.42),
      r: rng.float(0.5, 1.5) * scale,
      o: rng.float(0.16, 0.34),
    });
  }

  // A soft cast shadow pooling under the mound and stretching away from the
  // light. It is what grounds the plant — without it the mound floats.
  const cast = `<ellipse cx="${r2(cx + rx * 0.28)}" cy="${r2(soilY + moundRy * 1.35)}" rx="${r2(rx * 1.22)}" ry="${r2(moundRy * 0.6)}" fill="${pal.shadow}" opacity="0.22"/>`;

  return (
    cast +
    soilMound({
      cx,
      y: soilY,
      rx,
      ry: moundRy,
      top,
      face,
      rim,
      grit,
      blades: grassBlades(cx, soilY, rx, moundRy, pal.stemShade, Math.round(2 + scale * 3), () => rng.next()),
      shadow: pal.shadow,
    })
  );
}

function auraLayer(v: VisualGenes, auraCx: number, baseY: number, scale: number, pal: PlantPalette, gid: string, rng: Rng): string {
  if (v.aura === "none") return "";
  // Clamp to the frame on BOTH axes: an aura is decoration, so it yields to the
  // bounds rather than pushing the plant's bounding box outside the viewBox. It
  // used to be clamped vertically only, which left a wide aura poking out of the
  // side of the frame — the last layer still doing so, per `--bounds`.
  const cy = Math.max(6, Math.min(94, baseY - 28 * scale));
  // Clamp on both axes *and* against the horizontal room from the aura's own
  // centre. The centre moves with the plant now, so a radius that only respected
  // the frame's top and bottom could still run off the side: a 39-unit glow at
  // x=88 reaches 127.
  const r = Math.max(4, Math.min(30 * scale, 94, cy, 100 - cy, auraCx, 100 - auraCx) * 0.98);
  switch (v.aura) {
    case "halo": {
      // A rim of light around the plant, not a disc over it. A filled radial
      // gradient behind the crown reads as a smudge and flattens the silhouette;
      // a ring with a soft inner falloff still glows without covering anything.
      return `<g>
        <circle cx="${r2(auraCx)}" cy="${r2(cy)}" r="${r2(r)}" fill="url(#${gid}glow)" opacity="0.45"/>
        <circle cx="${r2(auraCx)}" cy="${r2(cy)}" r="${r2(r * 0.94)}" fill="none" stroke="${pal.accent}" stroke-width="${r2(Math.max(0.6, r * 0.07))}" opacity="0.5"/>
      </g>`;
    }
    case "spark": {
      const n = 5;
      let s = "";
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.float(0, 1);
        const d = r * rng.float(0.7, 1);
        const x = auraCx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d * 0.9;
        const l = 3 * scale;
        s += `<path d="M ${r2(x)} ${r2(y - l)} L ${r2(x + l * 0.4)} ${r2(y)} L ${r2(x)} ${r2(y + l)} L ${r2(x - l * 0.4)} ${r2(y)} Z" fill="${pal.accent}" opacity="0.85"/>`;
      }
      return s;
    }
    case "spore_dust": {
      let s = "";
      for (let i = 0; i < 9; i++) {
        const x = auraCx + rng.float(-r, r);
        const y = cy + rng.float(-r * 0.8, r * 0.8);
        const rr = rng.float(0.8, 2.1) * scale;
        s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(rr)}" fill="${pal.accent}" opacity="${rng.float(0.25, 0.6).toFixed(2)}"/>`;
      }
      return s;
    }
    case "dew": {
      let s = "";
      for (let i = 0; i < 6; i++) {
        const x = auraCx + rng.float(-r * 0.8, r * 0.8);
        const y = cy + rng.float(-r * 0.7, r * 0.7);
        const rr = rng.float(1.6, 3.2) * scale;
        s += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(rr)}" fill="${pal.leafLight}" opacity="0.5"/><circle cx="${r2(x - rr * 0.3)}" cy="${r2(y - rr * 0.35)}" r="${r2(rr * 0.3)}" fill="#fff" opacity="0.7"/>`;
      }
      return s;
    }
    case "shadow_haze": {
      // Haze sits *on the ground* and creeps outward from the base. An earlier
      // version drew it `28 * scale` units up the stem, which put a grey disc
      // across the middle of the plant and read as a rendering fault.
      //
      // Widening it past the aura radius is what makes it read as ground haze
      // rather than as an aura, but the result has to be clamped to the frame:
      // rx = 1.5 x r reached -9..109 on a 100-unit box and was the last layer
      // still leaving the viewBox.
      const rx = Math.min(r * 1.5, auraCx, 100 - auraCx);
      const ry = Math.min(r * 0.42, (100 - baseY) * 0.9);
      // Sit on the soil line, not at the canopy. Taking this from the aura's
      // vertical centre left the haze floating beside the stem of a tall plant,
      // which read as a grey smudge in mid-air.
      //
      // Clamp on the *bottom* edge, not the centre: `100 - ry * 0.6` keeps the
      // middle of the ellipse in frame while letting it reach 100 + 0.4 * ry.
      const gy = Math.max(ry, Math.min(100 - ry, baseY + ry * 0.3));
      return `<g class="l-haze">
        <ellipse cx="${r2(auraCx)}" cy="${r2(gy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="url(#${gid}haze)"/>
        <ellipse cx="${r2(auraCx)}" cy="${r2(gy)}" rx="${r2(rx * 0.76)}" ry="${r2(ry * 0.7)}" fill="${pal.shadow}" opacity="0.12"/>
      </g>`;
    }
    default:
      return `<circle cx="${r2(auraCx)}" cy="${r2(cy)}" r="${r2(r)}" fill="url(#${gid}glow)"/>`;
  }
}

/**
 * Roots must stay inside the frame. They grow downward from the stem base, so
 * the available depth is the distance to the bottom of the box — otherwise an
 * awakened plant's roots were reaching 104 units in a 100 unit box.
 */
function rootLayer(base: Pt, scale: number, stem: string, rng: Rng): string {
  const room = Math.max(3, 99 - base.y);
  // Normalise so the drawn length never exceeds the space below the stem.
  const maxLen = room * 0.94;
  const wanted = 9 + rng.float(0, 6);
  const len = Math.min(wanted * scale, maxLen);
  const n = stem === "vine" ? 3 : 4;
  let out = "";
  for (let i = 0; i < n; i++) {
    const spread = (i / Math.max(1, n - 1) - 0.5) * 46;
    out += `<path d="${rootPath(base, spread, len * rng.float(0.72, 1), rng.float(-26, 26))}" fill="${shadeHex(plantGround(), -12)}" opacity="0.72"/>`;
  }
  return out;
}

function plantGround(): string {
  return "hsl(30 34% 50%)";
}

/**
 * The stem as a tapered ribbon following its own spine, with a shaded flank and
 * a lit edge.
 *
 * The old version drew the sides as one straight highlight line all the way up,
 * which made a thick stem look like a flat plank. The shaded side now follows the
 * spine's curve, so a leaning or vine stem reads as round and bent.
 */
function stemLayer(spine: Pt[], width: number, stem: string, pal: PlantPalette, gid: string): string {
  const outline = taperedOutline(spine, width, width * 0.34);
  let out = `<path d="${outline}" fill="url(#${gid}stem)"/>`;

  // Shaded flank: the spine offset along its own normal, clipped to the ribbon.
  const flank = spine.map((p, i) => {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (spine.length - 1);
    const w = (width + (width * 0.34 - width) * t) * 0.62;
    return { x: p.x + (-dy / len) * w, y: p.y + (dx / len) * w };
  });
  out += `<path d="${taperedOutline(flank, width * 0.2, width * 0.06)}" fill="${pal.stemShade}" opacity="0.55"/>`;

  // Lit edge on the opposite flank.
  const lit = spine.map((p, i) => {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (spine.length - 1);
    const w = (width + (width * 0.34 - width) * t) * 0.26;
    return { x: p.x - (-dy / len) * w, y: p.y - (dx / len) * w };
  });
  out += `<path d="${taperedOutline(lit, width * 0.22, width * 0.05)}" fill="${pal.stemLight}" opacity="0.5"/>`;

  if (stem === "braided") {
    for (const off of [-width * 0.5, width * 0.5]) {
      const shifted = spine.map((p) => ({ x: p.x + off, y: p.y }));
      out += `<path d="${taperedOutline(shifted, width * 0.26, width * 0.1)}" fill="${pal.stemShade}" opacity="0.4"/>`;
    }
  }
  if (stem === "vine") {
    // Tendrils spiralling off the main stem.
    const curls: string[] = [];
    for (let i = 4; i < spine.length - 2; i += 4) {
      const a = spine[i];
      const r = width * 1.5;
      curls.push(
        `<path d="M ${r2(a.x)} ${r2(a.y)} c ${r2(r)} ${r2(-r * 0.4)} ${r2(r * 1.5)} ${r2(-r * 1.1)} ${r2(r * 0.6)} ${r2(-r * 1.4)}" fill="none" stroke="${pal.stemShade}" stroke-width="${r2(0.9 * width)}" stroke-linecap="round" opacity="0.75"/>`,
      );
    }
    out += curls.join("");
  }
  return out;
}

/**
 * Leaves on the stem spine, alternating sides and climbing toward the tip.
 *
 * Two things were wrong before and screenshots showed both:
 *  - `width` was a fraction of the leaf's own length at 0.42–0.76, which made
 *    long thin slivers. Real leaves are broad relative to their length, so this
 *    is measured as a width-to-length *ratio* and lands in 0.62–0.95.
 *  - every leaf got a light `stroke` outline on top of a pale gradient fill,
 *    which read as wireframe rather than as a solid form. The darker note is
 *    now *inside* the leaf as an underside shape, and there is no outline.
 */
function leafLayer(
  spine: Pt[],
  count: number,
  scale: number,
  complexity: number,
  showVeins: boolean,
  pal: PlantPalette,
  rng: Rng,
  body: Record<string, string>,
  stage: string,
  gid: string,
  skeleton: Skeleton,
): { leaves: string; petioles: string } {
  const gradId = gid;
  const cotyledon = stage === "sprout" || stage === "seed";
  let leaves = "";
  let petioles = "";
  const stemAngle = angleOf(spine[0], spine[spine.length - 1]);
  const span = dist(spine[0], spine[spine.length - 1]);

  // The outline family comes from the leaf gene, so "lance" and "round" plants
  // stop looking like the same almond. Clamped at seed/sprout, where the blade
  // is a cotyledon and has no business being lobed.
  const family = cotyledon ? "oval" : leafFamilyFor(body.leaf);
  // A rosette's whole point is that the leaves are the plant: they radiate from
  // the base at their own angles instead of climbing a stem in two ranks.
  const rosette = skeleton.habit === "rosette" && !cotyledon;
  // A bush spreads its leaves across the branches too, or the branches are bare.
  const branchShare = skeleton.habit === "bush" ? skeleton.branches.length : 0;

  for (let i = 0; i < count; i++) {
    // Cotyledons sit at the base; true leaves climb the stem. A little jitter per
    // leaf breaks the ladder pattern — evenly spaced leaves at evenly scaled sizes
    // read as a diagram of a plant rather than a plant.
const jitterT = cotyledon ? 0 : (i % 2 === 0 ? 1 : -1) * rng.float(0.02, 0.07);

    // Where this leaf hangs, and what it hangs from.
    let anchor: Pt;
    let leafAngle: number;
    let t = 0;
    const side = i % 2 === 0 ? -1 : 1;

    if (rosette) {
      // Radiate from the base, sweeping a little past vertical so the plant
      // reads as a rosette rather than as a fan.
      anchor = { x: spine[0].x + rng.float(-1.6, 1.6), y: spine[0].y - 1 };
      leafAngle = -150 + (i / Math.max(1, count)) * 120 + rng.float(-9, 9);
    } else {
      t = cotyledon ? 0.14 + i * 0.12 : Math.min(0.94, 0.2 + (i / Math.max(1, count)) * 0.7 + jitterT);
      // The last few leaves move onto a side branch, so a bush is leafy across
      // its whole width instead of bare in the middle.
      const onBranch = branchShare > 0 && i >= count - branchShare * 2;
      let baseAngle: number;
      if (onBranch) {
        const pick = (i - (count - branchShare * 2)) % skeleton.branches.length;
        const br = skeleton.branches[pick];
        const brLen = dist(br.spine[0], br.spine[br.spine.length - 1]);
        const bt = 0.35 + ((i * 0.37) % 0.55);
        anchor = along(br.spine[0], br.spine[br.spine.length - 1], brLen * bt);
        baseAngle = angleOf(br.spine[0], br.spine[br.spine.length - 1]);
      } else {
        anchor = along(spine[0], spine[spine.length - 1], span * Math.min(0.98, t));
        baseAngle = stemAngle;
      }
      // Splay wide and low at the base, steeper near the tip. A stronger droop
      // folds the blade downward so the foliage covers the stem instead of
      // spiking out sideways like a bottle brush.
      const droop = cotyledon ? 18 : 12 + t * 40;
      leafAngle = baseAngle + side * (70 - t * 20) + droop * (side > 0 ? 1 : 0.62);
    }
const taper = rosette ? 1 : 1 - t * 0.3;
    const sizeVariation = cotyledon ? 1 : 0.78 + rng.float(0, 0.5) + (i % 3) * 0.06;
    // A rosette has no stem to climb, so its leaves carry the whole silhouette
    // and are drawn noticeably larger.
    const size = (cotyledon ? 14 : rosette ? 23 : 17 + (i % 3) * 3) * scale * taper * sizeVariation;

    const curl = (side > 0 ? 1 : -1) * rng.float(14, 38) + rng.float(-6, 6);
    // Ratio of full width to length. Broader blades overlap into a canopy
    // instead of reading as separate slivers.
    const width = 0.72 + complexity * 0.24 + rng.float(-0.05, 0.05);
    const belly = 0.4 + rng.float(-0.08, 0.12);
    const serration = body.pattern === "veined" ? 0 : rng.bool(0.3) ? rng.float(0.3, 1) : 0;
    const jitter = 0.18 + complexity * 0.3;

    const shape = { length: size, width, family, curl, serration, jitter };
    const d = family === "oval" ? leafPath({ length: size, width, belly, curl, serration, jitter }) : leafFamilyPath(shape);

    // Petiole: a short stalk lifting the blade clear of the stem.
    const reach = size * 0.34;
    const dirPt = rotate(pt(reach, 0), pt(0, 0), leafAngle);
    const px = anchor.x + dirPt.x;
    const py = anchor.y + dirPt.y;
    petioles += `<path d="M ${r2(anchor.x)} ${r2(anchor.y)} Q ${r2(anchor.x + dirPt.x * 0.45)} ${r2(anchor.y + dirPt.y * 0.9 - size * 0.12)} ${r2(px)} ${r2(py)}" stroke="${pal.stemShade}" stroke-width="${r2(2.1 * scale)}" fill="none" stroke-linecap="round"/>`;
    // Occlusion where the blade meets its stalk: a small soft shadow under the
    // leaf joint keeps each leaf reading as *attached* rather than floating by
    // the stem. Cheap stand-in for ambient occlusion.
    petioles += `<ellipse cx="${r2(px)}" cy="${r2(py + size * 0.16)}" rx="${r2(size * 0.3)}" ry="${r2(size * 0.12)}" fill="url(#${gradId}occl)"/>`;

    // The underside: the same silhouette shrunk and offset toward the lower
    // margin. This is what gives the blade a fold instead of a flat cut-out.
    const under = leafFamilyPath({ length: size * 0.94, width: width * 0.82, family, curl, serration: 0, jitter: 0 });
    const lift = size * 0.1;
    // Rim light: a thinner copy of the blade slid toward the lit edge. It only
    // shows where it lands on the dark under-margin, which is what makes the
    // edge catch light instead of the whole leaf glowing flat.
    const rim = leafFamilyPath({ length: size * 0.9, width: width * 0.66, family, curl: curl * 0.8, serration: 0, jitter: 0 });

    let detail = "";
    if (showVeins) {
      detail += `<path d="${leafMidrib(size, curl)}" stroke="${pal.leafDark}" stroke-width="${r2(1.1 * scale)}" fill="none" opacity="0.5" stroke-linecap="round"/>`;
      if (complexity > 0.6) {
        detail += `<path d="${leafVeins(size, width, belly, 2)}" stroke="${pal.leafDark}" stroke-width="${r2(0.6 * scale)}" fill="none" opacity="0.3"/>`;
      }
    }

    const lit = i % 2 === 0;
    leaves += `<g transform="translate(${r2(px)} ${r2(py)}) rotate(${r2(leafAngle)})">
      <g class="leaf ${lit ? "leaf-lit" : "leaf-shade"}" style="--d:${(i * 0.07).toFixed(2)}s">
        <path d="${under}" fill="${pal.leafDark}" opacity="0.5" transform="translate(0 ${r2(lift)})"/>
        <path d="${d}" fill="url(#${gradId}leaf-${lit ? "lit" : "shade"})"/>
        <path d="${rim}" fill="${pal.leafLight}" opacity="${lit ? 0.3 : 0.12}" transform="translate(${r2(size * 0.03)} ${r2(-size * 0.07)})"/>
        ${detail}
      </g>
    </g>`;
  }
  return { leaves, petioles };
}

function thornLayer(spine: Pt[], scale: number, complexity: number, thorn: string, pal: PlantPalette, rng: Rng): string {
  const n = Math.max(2, Math.round(complexity * 5));
  let out = "";
  for (let i = 0; i < n; i++) {
    const t = 0.22 + (i / n) * 0.62;
    const a = along(spine[0], spine[spine.length - 1], dist(spine[0], spine[spine.length - 1]) * t);
    const side = i % 2 === 0 ? -1 : 1;
    // Stubby and wide, not long and thin. At 2.2 units across and 8 units long
    // these rendered as whiskers poking off the stem; a thorn is a wedge.
    const len = (4.2 + rng.float(0, 1.6)) * scale * (thorn === "poison_spur" ? 1.2 : 1);
    const hook = thorn === "hooked" ? len * 0.7 : thorn === "barbed" ? 0 : len * 0.14;
    const wid = thorn === "barbed" ? 4.2 : 3.1;
    const base = wid / 2;
    const tip = rotate({ x: side * len, y: -len * 0.42 }, { x: 0, y: 0 }, hook * side);
    const out1 = rotate({ x: side * base * 0.5, y: -base * 0.9 }, { x: 0, y: 0 }, hook * side * 0.5);
    const out2 = rotate({ x: side * base * 0.5, y: base * 0.9 }, { x: 0, y: 0 }, hook * side * 0.5);
    // A lit edge along the upper margin so the wedge has a facet, rather than
    // reading as a flat dark triangle.
    const mid1 = rotate({ x: side * len * 0.34, y: -base * 0.72 }, { x: 0, y: 0 }, hook * side * 0.7);
    out += `<path d="M ${r2(a.x + out1.x)} ${r2(a.y + out1.y)} L ${r2(a.x + tip.x)} ${r2(a.y + tip.y)} L ${r2(a.x + out2.x)} ${r2(a.y + out2.y)} Z" fill="${pal.leafDark}"/>`;
    out += `<path d="M ${r2(a.x + out1.x)} ${r2(a.y + out1.y)} L ${r2(a.x + mid1.x)} ${r2(a.y + mid1.y)}" fill="none" stroke="${pal.leaf}" stroke-width="${r2(0.5 * scale)}" stroke-linecap="round" opacity="0.55"/>`;
    if (thorn === "poison_spur") {
      out += `<circle cx="${r2(a.x + tip.x)}" cy="${r2(a.y + tip.y)}" r="${r2(0.9 * scale)}" fill="${pal.accent}"/>`;
    }
  }
  return out;
}

/**
 * The bloom at the stem tip.
 *
 * It used to be a ring of petals centred exactly on the tip with nothing joining
 * it to the stem, so it read as a lollipop head. Now there is a calyx of small
 * sepals where the stem ends, petals start behind the calyx rather than at its
 * centre, and a short pedicel runs back down to the stem — so the flower is
 * attached to the plant instead of hovering over it.
 */
function bloomLayer(top: Pt, scale: number, flower: string, pal: PlantPalette, gid: string, rng: Rng): string {
  const petals = PETALS[flower] ?? 5;
  const r = (flower === "bud" ? 7 : 16) * scale;
  let out = "";

  // Pedicel: a short stalk from the stem tip down into the calyx.
  const cy = top.y - r * 0.72;
  out += `<path d="M ${r2(top.x)} ${r2(top.y + r * 0.5)} L ${r2(top.x)} ${r2(cy)}" stroke="${pal.stem}" stroke-width="${r2(2.2 * scale)}" stroke-linecap="round"/>`;

  if (flower === "bud") {
    out += `<path d="${petalPath(r * 1.9, 0.85, 0)}" fill="url(#${gid}bloom)" transform="translate(${r2(top.x)} ${r2(cy + r * 1.7)}) rotate(180)"/>`;
    // Sepals clasping the bud.
    for (const side of [-1, 1]) {
      out += `<path d="${petalPath(r * 1.1, 0.5, 0)}" fill="${pal.leafDark}" transform="translate(${r2(top.x)} ${r2(cy + r * 0.9)}) rotate(${side > 0 ? 62 : -62})"/>`;
    }
    out += `<path d="M ${r2(top.x)} ${r2(cy)} L ${r2(top.x)} ${r2(cy - r * 0.5)}" stroke="${pal.leafLight}" stroke-width="${r2(0.9 * scale)}" opacity="0.7"/>`;
    return out;
  }

  // Back ring of petals first, slightly rotated, so petals overlap.
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * 360 + 18;
    const len = r * rng.float(0.88, 1.05);
    out += `<path d="${petalPath(len, flower === "star_flower" ? 0.36 : 0.8, flower === "spore_ring" ? 30 : 8)}" fill="${pal.bloomShade}" transform="translate(${r2(top.x)} ${r2(cy)}) rotate(${r2(a)}) scale(0.82)"/>`;
  }
  // Front ring.
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * 360;
    const len = r * rng.float(0.9, 1.12);
    out += `<path d="${petalPath(len, flower === "star_flower" ? 0.36 : 0.8, flower === "spore_ring" ? 30 : 8)}" fill="url(#${gid}bloom)" transform="translate(${r2(top.x)} ${r2(cy)}) rotate(${r2(a)})"/>`;
  }
  // Calyx drawn over the petal bases: the flower now visibly grows out of the stem.
  for (const side of [-1, 1]) {
    out += `<path d="${petalPath(r * 0.85, 0.6, 0)}" fill="${pal.leafDark}" transform="translate(${r2(top.x)} ${r2(cy + r * 0.35)}) rotate(${side > 0 ? 74 : -74}) scale(0.9)"/>`;
  }

  // Centre: a dished sphere (radial core) sitting inside the petal ring, with a
  // drop shadow under it so the petals read as wrapping a volume.
  out += `<ellipse cx="${r2(top.x)}" cy="${r2(cy + r * 0.22)}" rx="${r2(r * 0.4)}" ry="${r2(r * 0.16)}" fill="${pal.bloomShade}" opacity="0.5"/>`;
  out += `<circle cx="${r2(top.x)}" cy="${r2(cy)}" r="${r2(r * 0.38)}" fill="url(#${gid}bloomCore)"/>`;
  const stamens = flower === "ember_core" ? 9 : 6;
  for (let i = 0; i < stamens; i++) {
    const a = (i / stamens) * Math.PI * 2;
    const d = r * 0.24;
    out += `<circle cx="${r2(top.x + Math.cos(a) * d)}" cy="${r2(cy + Math.sin(a) * d)}" r="${r2(0.85 * scale)}" fill="${pal.bloom}"/>`;
  }
  // Catchlight on the core sphere — the single brightest dot, top-left.
  out += `<circle cx="${r2(top.x - r * 0.13)}" cy="${r2(cy - r * 0.15)}" r="${r2(r * 0.12)}" fill="#fff" opacity="0.75"/>`;
  out += `<circle cx="${r2(top.x)}" cy="${r2(cy)}" r="${r2(r * 0.15)}" fill="${pal.leafLight}" opacity="0.55"/>`;
  return out;
}

function fruitLayer(spine: Pt[], scale: number, fruit: string, pal: PlantPalette, rng: Rng): string {
  const total = dist(spine[0], spine[spine.length - 1]);
  // Anchored high on the stem. The old anchors at 0.5 and 0.72 put fruit at
  // mid-height, which on a short-stemmed rosette put it in the soil.
  const anchors = [0.58, 0.8].map((t) => along(spine[0], spine[spine.length - 1], total * t));
  let out = "";
  for (const a of anchors) {
    const r = 3.6 * scale;
    const side = rng.bool() ? 1 : -1;
    // Hangs off a stalk rather than sitting on the stem, so it reads as fruit
    // growing from the plant instead of a lump stuck to the trunk.
    const x = a.x + side * rng.float(4.5, 8) * scale;
    const y = a.y + rng.float(3.5, 7) * scale;

    if (fruit === "lantern") {
      out += `<path d="M ${r2(a.x)} ${r2(a.y)} Q ${r2((a.x + x) / 2)} ${r2(a.y + 1.5 * scale)} ${r2(x)} ${r2(y - r * 1.5)}" fill="none" stroke="${pal.stemShade}" stroke-width="${r2(0.8 * scale)}"/>`;
      out += `<path d="${petalPath(r * 1.7, 0.8, 0)}" fill="${pal.accent}" opacity="0.92" transform="translate(${r2(x)} ${r2(y + r * 0.4)}) rotate(180)"/>`;
      out += `<circle cx="${r2(x)}" cy="${r2(y + r * 0.5)}" r="${r2(r * 0.42)}" fill="${pal.leafLight}" opacity="0.85"/>`;
    } else if (fruit === "seedpod") {
      out += `<path d="M ${r2(a.x)} ${r2(a.y)} L ${r2(x)} ${r2(y - r * 1.1)}" stroke="${pal.stemShade}" stroke-width="${r2(0.8 * scale)}" fill="none"/>`;
      out += `<path d="${shardPath(x, y, r * 1.3, 4, (i) => (i % 2 ? 0.14 : -0.1), 2.1)}" fill="${pal.leafDark}"/>`;
      out += `<path d="${shardPath(x, y - r * 0.25, r * 1.05, 4, (i) => (i % 2 ? 0.1 : -0.08), 2)}" fill="${pal.leaf}" opacity="0.5"/>`;
    } else if (fruit === "berry") {
      // `blobPath` returns a `d` attribute, not an element. The old code
      // concatenated it straight into the output with a stray quote, which
      // produced malformed markup and left a coloured dome sitting at the base.
      out += `<path d="M ${r2(a.x)} ${r2(a.y)} L ${r2(x)} ${r2(y - r)}" stroke="${pal.stemShade}" stroke-width="${r2(0.8 * scale)}" fill="none"/>`;
      out += `<path d="${blobPath(x, y, r, [1, 0.9, 1.05, 0.94])}" fill="${pal.accent}"/>`;
      out += `<circle cx="${r2(x - r * 0.32)}" cy="${r2(y - r * 0.36)}" r="${r2(r * 0.26)}" fill="#fff" opacity="0.6"/>`;
    } else {
      out += `<path d="M ${r2(a.x)} ${r2(a.y)} L ${r2(x)} ${r2(y - r)}" stroke="${pal.stemShade}" stroke-width="${r2(0.8 * scale)}" fill="none"/>`;
      out += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}" fill="${pal.leafLight}" opacity="0.9"/>`;
      out += `<circle cx="${r2(x - r * 0.3)}" cy="${r2(y - r * 0.3)}" r="${r2(r * 0.3)}" fill="#fff" opacity="0.45"/>`;
    }
  }
  return out;
}

function fungusLayer(base: Pt, scale: number, fungus: string, pal: PlantPalette, rng: Rng): string {
  // Half the old radius, and pushed off to one side of the stem. A 20-unit cap
  // centred on the base of a short-stemmed plant became a purple dome that the
  // leaves grew out of, which read as a rendering fault.
  const r = 5.4 * scale;
  const offX = base.x + (base.x > 50 ? -1 : 1) * r * 0.9;
  base = { x: offX, y: base.y };
  const spots = fungus === "bloom_mold" ? 7 : fungus === "ring" ? 10 : 4;
  if (fungus === "shelf") {
    const y = base.y - 20 * scale;
    return `<path d="M ${r2(base.x - r)} ${r2(y)} Q ${r2(base.x)} ${r2(y + r * 0.9)} ${r2(base.x + r)} ${r2(y)} Q ${r2(base.x)} ${r2(y + r * 0.35)} ${r2(base.x - r)} ${r2(y)} Z" fill="${pal.bloomShade}" opacity="0.9"/>`;
  }
  let cap = `<path d="M ${r2(base.x - r)} ${r2(base.y)} a ${r2(r)} ${r2(r * 0.82)} 0 0 1 ${r2(r * 2)} 0 z" fill="${pal.bloom}"/>`;
  let dots = "";
  for (let i = 0; i < spots; i++) {
    const x = base.x + rng.float(-r * 0.8, r * 0.8);
    const y = base.y - rng.float(0, r * 0.5);
    dots += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(rng.float(0.8, 2) * scale)}" fill="${pal.bloomShade}" opacity="0.6"/>`;
  }
  if (fungus === "ring") {
    cap = `<path d="M ${r2(base.x - r)} ${r2(base.y)} a ${r2(r)} ${r2(r * 0.82)} 0 0 1 ${r2(r * 2)} 0" fill="none" stroke="${pal.bloom}" stroke-width="${r2(r * 0.34)}"/>`;
  }
  void dots;
  return cap;
}

function patternLayer(v: VisualGenes, spine: Pt[], scale: number, complexity: number, pal: PlantPalette, rng: Rng): string {
  let out = "";
  const mid = spine[Math.floor(spine.length * 0.55)];
  switch (v.pattern) {
    case "veined":
      for (let i = 0; i < 5; i++) {
        const t = 0.2 + i * 0.15;
        const a = along(spine[0], spine[spine.length - 1], dist(spine[0], spine[spine.length - 1]) * t);
        const w = 8 * scale * Math.sin(Math.PI * t);
        out += `<path d="M ${r2(a.x - w)} ${r2(a.y)} Q ${r2(a.x)} ${r2(a.y - w * 0.7)} ${r2(a.x + w)} ${r2(a.y)}" stroke="${pal.leafDark}" stroke-width="${r2(0.6 * scale)}" fill="none" opacity="0.4"/>`;
      }
      break;
    case "mottled":
      for (let i = 0; i < 6; i++) {
        const t = rng.float(0.15, 0.9);
        const a = along(spine[0], spine[spine.length - 1], dist(spine[0], spine[spine.length - 1]) * t);
        out += `<circle cx="${r2(a.x + rng.float(-6, 6) * scale)}" cy="${r2(a.y)}" r="${r2(rng.float(1.4, 3) * scale)}" fill="${pal.leafDark}" opacity="0.3"/>`;
      }
      break;
    case "spotted":
      for (let i = 0; i < 8; i++) {
        const t = rng.float(0.1, 0.95);
        const a = along(spine[0], spine[spine.length - 1], dist(spine[0], spine[spine.length - 1]) * t);
        out += `<circle cx="${r2(a.x + rng.float(-7, 7) * scale)}" cy="${r2(a.y + rng.float(-3, 3) * scale)}" r="${r2(rng.float(0.9, 1.9) * scale)}" fill="${pal.accent}" opacity="0.55"/>`;
      }
      break;
    case "gradient": {
      // Constrain the wash to the stem's own span so it cannot bleed off frame.
      const lo = spine[Math.floor(spine.length * 0.3)];
      const hi = spine[Math.floor(spine.length * 0.8)];
      const hgt = Math.max(2, (hi.y - lo.y) / 2);
      out += `<ellipse cx="${r2((lo.x + hi.x) / 2)}" cy="${r2((lo.y + hi.y) / 2)}" rx="${r2(Math.min(11 * scale, 9))}" ry="${r2(hgt)}" fill="${pal.accent}" opacity="0.1"/>`;
      break;
    }
    case "rings": {
      // Bands that wrap the stem like growth rings. These used to be concentric
      // circles centred beside the stem, which read as a stray grey artefact
      // floating in the background rather than as part of the plant.
      for (let i = 1; i <= 3; i++) {
        const rr = (i / 3) * Math.min(9 * scale, 28);
        const ry = rr * 0.24;
        out += `<path d="M ${r2(mid.x - rr)} ${r2(mid.y - ry)} a ${r2(rr)} ${r2(ry)} 0 0 0 ${r2(rr * 2)} 0 a ${r2(rr)} ${r2(ry)} 0 0 0 ${r2(-rr * 2)} 0" fill="none" stroke="${pal.leafDark}" stroke-width="${r2(0.7 * scale)}" opacity="${(0.3 - i * 0.06).toFixed(2)}"/>`;
      }
      break;
    }
  }
  void complexity;
  return out;
}

/**
 * Eyes for personified plants, set into a bulb at the stem tip.
 *
 * Previously two black discs floated a few units above the tip with nothing
 * holding them, which read as a rendering bug rather than a face. They now sit on
 * a swollen node that is part of the plant, with a lid over the top of each eye
 * and a catchlight, so the pair reads at a glance.
 */
/**
 * Eyes, set into a swollen node at the stem tip.
 *
 * Drawn as small dark beads rather than the previous big white discs. On a
 * contact sheet the white version read as googly eyes glued onto the artwork —
 * two bright circles with two black dots, the one thing on the plant that looked
 * pasted on rather than grown. A plant's eye is a bead sunk into the stem, so
 * that is what this draws: the node, a dark bead, a lid arc over the top of it
 * and a small catchlight.
 */
function eyeLayer(top: Pt, scale: number, eyeCount: number, pal: PlantPalette, dirX: number): string {
  const n = Math.min(3, eyeCount);
  if (n <= 0) return "";
  const face = Math.sign(dirX || 1);
  const r = 1.5 * scale;
  const spread = 3.1 * scale;
  const nodeW = (n * spread) / 2 + r * 1.3;
  // The node sits just below the tip, on the inside of the curl.
  const nx = top.x - face * r * 0.5;
  const ny = top.y + r * 1.5;

  let out = `<ellipse cx="${r2(nx)}" cy="${r2(ny)}" rx="${r2(nodeW)}" ry="${r2(r * 1.5)}" fill="${pal.stem}"/>`;
  // Shade under the node so it reads as swelling out of the stem.
  out += `<ellipse cx="${r2(nx)}" cy="${r2(ny + r * 0.45)}" rx="${r2(nodeW * 0.88)}" ry="${r2(r * 0.7)}" fill="${pal.stemShade}" opacity="0.42"/>`;

  for (let i = 0; i < n; i++) {
    const x = nx + (i - (n - 1) / 2) * spread;
    // A dark bead, not a white ball.
    out += `<ellipse cx="${r2(x)}" cy="${r2(ny - r * 0.1)}" rx="${r2(r * 0.78)}" ry="${r2(r * 0.86)}" fill="${pal.stemShade}"/>`;
    out += `<ellipse cx="${r2(x)}" cy="${r2(ny - r * 0.12)}" rx="${r2(r * 0.66)}" ry="${r2(r * 0.74)}" fill="#1d2a17"/>`;
    // One catchlight, small and high — enough to give direction without
    // turning the bead back into a cartoon eye.
    out += `<circle cx="${r2(x - r * 0.22)}" cy="${r2(ny - r * 0.5)}" r="${r2(r * 0.2)}" fill="#fff" opacity="0.75"/>`;
    // The node itself creases over the top of the bead.
    out += `<path d="M ${r2(x - r * 0.85)} ${r2(ny - r * 0.62)} Q ${r2(x)} ${r2(ny - r * 1.5)} ${r2(x + r * 0.85)} ${r2(ny - r * 0.62)}" fill="none" stroke="${pal.stem}" stroke-width="${r2(r * 0.45)}" stroke-linecap="round" opacity="0.9"/>`;
  }
  return out;
}

/**
 * Half-widths at the base of the stem.
 *
 * Screenshots showed the stem reading as a fence post: `thick` was 4.6 units of
 * half-width, i.e. 9 units across in a 100 unit box, which dwarfed every leaf.
 * All values are roughly a third smaller so the foliage is the subject.
 */
function stemWidthFor(stem: string, scale: number): number {
  const map: Record<string, number> = { thin: 1.5, slender: 2, normal: 2.9, thick: 4.2, vine: 2.1, lean: 2.5, braided: 3.3 };
  return (map[stem] ?? 2.9) * Math.max(0.55, scale);
}

/**
 * How far the stem tip leans off vertical, in units.
 * Every stem leans a little; vines and leaning stems lean a lot, and the sign
 * varies per plant so a garden is not a row of identical poles.
 */
function stemLean(stem: string, v: VisualGenes, rng: Rng): number {
  const sign = rng.bool() ? 1 : -1;
  const base =
    {
      thin: rng.float(1.5, 4) * sign,
      slender: rng.float(2, 5) * sign,
      normal: rng.float(3, 7) * sign,
      thick: rng.float(1, 3) * sign,
      vine: rng.float(9, 16) * sign,
      lean: rng.float(12, 21) * sign,
      braided: rng.float(4, 8) * sign,
    }[stem] ?? 4;
  return base * (0.5 + v.complexity * 0.7);
}

const PETALS: Record<string, number> = { none: 0, bud: 1, ember_core: 5, dew_bloom: 6, spore_ring: 8, star_flower: 7, double_bloom: 10 };

export function elementBadgeColor(plant: Plant): string {
  const dom = dominantElement(plant.dna.elementGenes);
  return ELEMENT_BADGE[dom.id] ?? "#9ad6a0";
}

const ELEMENT_BADGE: Record<string, string> = {
  wood: "#6fd08c",
  fire: "#ff7a4d",
  water: "#5cc8ff",
  earth: "#c99a5b",
  electric: "#ffe45e",
  poison: "#b06cff",
  light: "#fff3c4",
  shadow: "#8f7bd8",
};
/**
 * How far the *stem* of a skeleton reaches sideways from the centre line.
 *
 * Deliberately excludes the leaves. The stem is drawn at its solved coordinates
 * and no scale factor narrows it, so this is the number that decides whether the
 * plant leaves the frame. The leaves are handled separately by `fitX`, which
 * does shrink them — folding them in here too would make the measurement
 * circular, because `fitX` is itself derived from this function's output.
 */
function horizontalStemExtent(skeleton: Skeleton): number {
  const stem = skeleton.main.reduce((m, p) => Math.max(m, Math.abs(p.x - 50)), 0);
  const branches = skeleton.branches.reduce(
    (m, b) => m + b.spine.reduce((n, p) => Math.max(n, Math.abs(p.x - 50)), 0),
    0,
  );
  return Math.max(stem, branches);
}

/**
 * Worst-case horizontal reach of one leaf from its anchor, at full size.
 *
 * A blade is (15 + 2.6k) long with sizeVariation up to 1.34, plus a petiole of
 * 0.34x the blade. Cotyledons are much smaller.
 */
function leafReachFor(stage: string, baseScale: number): number {
  return (stage === "seed" || stage === "sprout" ? 11 : 26) * baseScale;
}

/**
 * How much the decoration may be scaled to fit beside a stem of known width.
 *
 * The naive form, `(margin - stemSide) / leafReach`, returns 0 as soon as the
 * stem reaches the margin — and because `fitX` scales the whole plant, a leaning
 * plant then rendered as a bare speck with no soil under it. Six of twelve plants
 * on the contact sheet did exactly that.
 *
 * So: floor it at 0.55. Height shrinking pulls `stemSide` back inside the margin
 * on the next iteration of the solve loop, which lifts fitX again, so the floor is
 * only ever covering one iteration's overhang — it never becomes the resting
 * state. If a plant cannot fit even at the floor, the honest outcome is a plant
 * with slightly overhanging leaves, not an invisible one.
 */
function fitFromRoom(stemSide: number, leafReach: number): number {
  const room = SIDE_MARGIN - stemSide;
  const ideal = room / Math.max(1, leafReach);
  return Math.max(0.55, Math.min(1, ideal));
}
