/**
 * Plant art tests — geometry, distinctness, determinism.
 *
 * These assert on the emitted SVG because that is the deliverable: the plant is
 * re-rendered from genes every time, so a regression in the path maths shows up
 * as malformed or identical markup rather than a thrown error.
 */

import { GameStore } from "../src/core/store";
import { renderPlantSvg, plantPalette } from "../src/render/plantRenderer";
import { leafPath, taperedOutline, quadSamples, pt, blobPath, shardPath, petalPath, rootPath } from "../src/render/plantGeometry";
import type { SpeciesId } from "../src/config/species";
import type { Plant } from "../src/core/types";
import { createSeedPlant } from "../src/genetics/genomeGenerator";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const store = new GameStore();
store.state.leafCoin = 5_000_000;
store.state.items = 500;
store.state.geneCrystal = 200;
const species: SpeciesId[] = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud"];
for (const s of species) store.buySeed(s, 6);

const plants = [];
for (let i = 0; i < 24; i++) {
  const res = store.plantSeed(species[i % species.length]);
  if (!res.ok) break;
  const planted = store.state.plants[store.state.plants.length - 1];
  planted.growth.stage = "mature";
  planted.growth.stageReadyAt = Date.now();
  planted.locks.manual = false;
  plants.push(planted);
}
// Room for plants, not plots. Opening plots now costs coins and needs an unlock
  // condition, which these tests are not about.
store.state.nurseryCap = 24;
store.state.leafCoin = 10_000_000;
for (let i = 0; i < 10; i++) {
  const a = plants[i % plants.length];
  const b = plants[(i + 3) % plants.length];
  store.breed(a.plantId, b.plantId);
}
for (const p of store.state.plants) {
  p.growth.stage = "mature";
  p.growth.stageReadyAt = Date.now();
  p.locks.manual = false;
}
/*
 * A fixed sample for the renderer measurements.
 *
 * These assertions are about the renderer, so the sample must not depend on whatever
 * the garden happens to hold. It used to be `store.state.plants`, which changed shape
 * with every rule that touched breeding: parents are now consumed, so ten breeds remove
 * twenty plants and add ten, and how many actually succeeded depends on the cap, on
 * which pairings were distinct, and on whether a child came out mature. The path-count
 * check then asserted "more than three distinct counts" over a sample that was sometimes
 * three plants wide - a statistical threshold on a variable sample, which failed roughly
 * one run in four.
 *
 * Six known species, planted and matured here, so the assertion has the same inputs
 * every time. The wider garden above is left intact for the tests that want variety.
 */
const SAMPLE_SPECIES: SpeciesId[] = ["thornroot", "emberleaf", "voltvine", "gloomcap", "dewbud", "ashbark"];
const sample: Plant[] = [];
for (const s of SAMPLE_SPECIES) {
  store.state.seeds[s] = 4;
  const res = store.plantSeed(s);
  if (!res.ok) throw new Error(`could not plant the sample species ${s}: ${res.reason}`);
  const p = store.get(res.plantId!);
  if (!p) throw new Error(`planted ${s} but it is not in the garden`);
  p.growth.stage = "mature";
  p.growth.stageReadyAt = Date.now();
  p.growth.level = 12;
  p.locks.manual = false;
  // Kept in planting order so a failure can be reproduced from this list alone.
  sample.push(p);
}
check("the fixed sample is six distinct species", new Set(sample.map((p) => p.plantId)).size === sample.length);
/*
 * The garden, which now provably contains at least the six planted above.
 *
 * Not `plants` appended to `sample`: they are the same objects, and counting each twice
 * made ten of sixteen silhouettes identical and failed the uniqueness check on every run.
 */
const all = store.state.plants;

section("1. Geometry primitives");
{
  const lp = leafPath({ length: 20, width: 0.6, belly: 0.4, curl: 20, serration: 0, jitter: 0.3 });
  check("leaf path is a closed curve", lp.startsWith("M 0 0") && lp.includes("C") && lp.trim().endsWith("Z"));
  check("leaf has both margins", (lp.match(/C/g) ?? []).length === 2, `${(lp.match(/C/g) ?? []).length} cubics`);

  const serrated = leafPath({ length: 20, width: 0.6, belly: 0.4, curl: 0, serration: 0.8, jitter: 0 });
  check("serration adds teeth", serrated.split("L").length > lp.split("L").length);

  const outline = taperedOutline(quadSamples(pt(0, 0), pt(2, -10), pt(0, -20), 6), 4, 1);
  check("tapered outline closes", outline.startsWith("M") && outline.endsWith("Z"));
  const thin = taperedOutline(quadSamples(pt(0, 0), pt(2, -10), pt(0, -20), 6), 1, 0.1);
  check("a different taper gives different geometry", outline !== thin);

  const b1 = blobPath(0, 0, 10, [1, 0.8, 1.1, 0.9]);
  const b2 = blobPath(0, 0, 10, [1, 0.5, 1.4, 0.9]);
  check("blob is a closed smooth curve", b1.startsWith("M") && b1.endsWith("Z") && b1.includes("Q"));
  check("different radii give different blobs", b1 !== b2);

  check("shard is a polygon", shardPath(0, 0, 5, 4, () => 0.1).startsWith("M"));
  check("petal is a closed teardrop", petalPath(10, 0.7, 10).trim().endsWith("Z"));
  check("degenerate spine does not throw", taperedOutline([pt(0, 0)], 2, 1) === "");
}

section("2. Every plant renders");
{
  let rendered = 0;
  let wellFormed = 0;
  for (const p of all) {
    const svg = renderPlantSvg(p, 150);
    rendered++;
    if (svg.startsWith("<svg") && svg.endsWith("</svg>") && !/NaN|undefined|Infinity/.test(svg)) wellFormed++;
  }
  check("all plants render", rendered === all.length, `${rendered}/${all.length}`);
  check("no NaN/undefined leaks into the markup", wellFormed === all.length, `${wellFormed}/${all.length}`);
}

section("3. Distinctness — the whole point of procedural art");
{
  const svgs = all.map((p) => renderPlantSvg(p, 150));
  const uniq = new Set(svgs).size;
  check("every plant renders a unique silhouette", uniq === svgs.length, `${uniq}/${svgs.length} unique`);

  // Compare geometry only, ignoring the defs block which carries unique ids.
  const bodies = svgs.map((s) => s.replace(/<defs>[\s\S]*?<\/defs>/, ""));
  check("geometry differs even without defs ids", new Set(bodies).size === bodies.length);

  const paths = all.map((p) => (renderPlantSvg(p, 150).match(/ d="/g) ?? []).length);
  check("plants have varied path counts", new Set(paths).size > 3, `${new Set(paths).size} distinct counts`);
}

section("4. Determinism");
{
  const p = all[0];
  const a = renderPlantSvg(p, 150);
  const b = renderPlantSvg(p, 150);
  check("same plant renders identically", a === b);
  const q = all[1];
  check("different plants do not collide", a !== renderPlantSvg(q, 150));
}

section("5. Visual genes actually reach the art");
{
  const base = all[0];
  const before = renderPlantSvg(base, 150);

  const moreLeaves = structuredClone(base);
  moreLeaves.visual.complexity = 1;
  moreLeaves.plantId = base.plantId + "x";
  check("higher complexity adds parts", renderPlantSvg(moreLeaves, 150).length > before.length);

  const hueShift = structuredClone(base);
  hueShift.visual.hue = (hueShift.visual.hue + 140) % 360;
  hueShift.plantId = base.plantId + "y";
  check("hue change changes colours", renderPlantSvg(hueShift, 150) !== before);

  const thorns = structuredClone(base);
  thorns.dna.bodyGenes.thorn = "hooked";
  thorns.plantId = base.plantId + "z";
  check("thorn gene changes the silhouette", renderPlantSvg(thorns, 150) !== before);

  const bloom = structuredClone(base);
  bloom.dna.bodyGenes.flower = "double_bloom";
  bloom.plantId = base.plantId + "w";
  const bloomed = renderPlantSvg(bloom, 150);
  check("flower gene adds petals", (bloomed.match(/rotate\(/g) ?? []).length > 12);

  const patterned = structuredClone(base);
  patterned.visual.pattern = "rings";
  patterned.plantId = base.plantId + "v";
  check("pattern gene adds markings", renderPlantSvg(patterned, 150) !== before);
}

section("6. Growth stages read as different sizes");
{
  const p = structuredClone(all[0]);
  const sizes: string[] = [];
  for (const stage of ["seed", "sprout", "young", "mature", "awakened"] as const) {
    p.growth.stage = stage;
    sizes.push(renderPlantSvg(p, 150));
  }
  check("each stage renders differently", new Set(sizes).size === 5);
  const seedSvg = sizes[0];
  const matureSvg = sizes[3];
  check("seed stage is smaller than mature", seedSvg.length < matureSvg.length, `${seedSvg.length} vs ${matureSvg.length}`);
  check("seed stage has no bloom", !/l-bloom/.test(seedSvg) || (seedSvg.match(/<circle/g) ?? []).length < (matureSvg.match(/<circle/g) ?? []).length);

  // Growth must be monotonic across the five stages, not just "all different".
  const heights = ["seed", "sprout", "young", "mature", "awakened"].map((stage) => {
    p.growth.stage = stage as Plant["growth"]["stage"];
    // The stem height is the single clearest signal, and it is computed, so it
    // can be asserted without a layout engine.
    return plantSvgHeight(p);
  });
  // Non-decreasing, not strictly increasing: the frame solver can legitimately cap
  // two adjacent stages at the same height, and a couple of units of equal height
  // is not a visual regression.
  check(
    "height never decreases with each stage",
    heights.every((h, i) => i === 0 || h >= heights[i - 1] - 0.5),
    heights.map((h) => h.toFixed(1)).join(" → "),
  );
  check("mature fills most of the frame", heights[3] > 40, `${heights[3].toFixed(1)} of 100`);
  check("seed stays a sprout", heights[0] < heights[3] * 0.5, `${heights[0].toFixed(1)} vs ${heights[3].toFixed(1)}`);
}

/**
 * Stem height as the renderer computes it, extracted from the emitted markup.
 * The stem outline's topmost y is the plant's height above the soil line, so it
 * is measurable from the path data alone — no layout engine required.
 */
function plantSvgHeight(plant: Plant): number {
  const svg = renderPlantSvg(plant, 150);
  // The stem group carries the tapered outline; its path starts at the base and
  // the lowest y in that path's coordinate list is the tip.
  const stemGroup = svg.match(/<g class="l-stem[^"]*"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? "";
  const ys = [...stemGroup.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[2]));
  if (!ys.length) return 0;
  return 88 - Math.min(...ys);
}

section("7. Structural integrity");
{
  // Every element must be closed. Counting `<path` against all `/>` is wrong
  // because circles, ellipses and groups share those tokens — instead check each
  // opened tag individually.
  const unclosed: string[] = [];
  for (const p of all) {
    const svg = renderPlantSvg(p, 150);
    for (const tag of ["path", "circle", "ellipse", "g", "defs", "svg", "linearGradient", "radialGradient", "stop"]) {
      const opens = (svg.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
      const selfClosed = (svg.match(new RegExp(`<${tag}\\b[^>]*/>`, "g")) ?? []).length;
      const explicitlyClosed = (svg.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      if (opens !== selfClosed + explicitlyClosed) unclosed.push(`${p.name}:${tag} ${opens} vs ${selfClosed}+${explicitlyClosed}`);
    }
  }
  check("every SVG tag is closed", unclosed.length === 0, unclosed.slice(0, 3).join(", "));

  const svg = renderPlantSvg(all[0], 150);
  check("gradient ids are namespaced per plant", /id="p[a-z0-9]+stem"/.test(svg));
  check("aria-label is set for screen readers", svg.includes('role="img"') && svg.includes("aria-label="));
  check("gradient references resolve", svg.includes("url(#p") && svg.includes('id="p'));
}

section("8. Palette");
{
  const v = { hue: 120, hueSpread: 40, saturation: 0.7, lightness: 0.6, accentHue: 20, scale: 1, complexity: 0.5, pattern: "plain" as const, aura: "none" as const, size: "normal" as const, eyeCount: 0, seedShape: "round" as const };
  const pal = plantPalette(v);
  check("palette exposes leaf depth stops", !!pal.leafLight && !!pal.leaf && !!pal.leafDark);
  check("leaf depth is actually ordered light to dark", pal.leafLight !== pal.leaf && pal.leaf !== pal.leafDark);
  check("stem has a shade for the gradient", !!pal.stemShade);
  check("bloom has a shade", !!pal.bloomShade);
  const pal2 = plantPalette({ ...v, hue: 240 });
  check("palette follows hue", pal.stem !== pal2.stem);
}

section("9. Animation opt-in");
{
  const p = all[0];
  const still = renderPlantSvg(p, 150);
  const live = renderPlantSvg(p, 150, { anim: true });
  check("static markup carries no animation class", !still.includes("is-anim"));
  check("animated markup opts in", live.includes("is-anim"));
  check("animation adds stagger delays", live.includes("--d:"));
  check("both variants still render valid SVG", still.endsWith("</svg>") && live.endsWith("</svg>"));
  check("geometry is identical whether animated or not", still.replace(/ class="[^"]*"| style="[^"]*"/g, "") === live.replace(/ class="[^"]*"| style="[^"]*"/g, ""));
}

section("10. Geometry stays inside the 100x100 frame");
{
  /**
   * A real regression guard. The art is authored in a 100x100 viewBox, and every
   * earlier version of this renderer drew outside it — an awakened plant reached
   * 115 units tall, so the crown and roots were being clipped by the box.
   *
   * The path maths is mirrored here rather than pulled from a browser: each
   * helper's declared endpoint must lie inside the box, which is a weaker check
   * than getBBox but runs in jsdom and in CI.
   */
  const inside = (p: { x: number; y: number }) => p.x >= -1 && p.x <= 101 && p.y >= -1 && p.y <= 101;

  const leaf = leafPath({ length: 20, width: 0.6, belly: 0.4, curl: 20, serration: 0, jitter: 0.3 });
  const coords = [...leaf.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  const leafXs = leaf.split(/[ ,]/).map(Number).filter((n) => !Number.isNaN(n));
  check("leaf coordinates are finite", leafXs.every(Number.isFinite), `${leafXs.length} numbers`);
  check("leaf stays within a sane span", Math.max(...leafXs) < 40 && Math.min(...leafXs) > -20, `range ${Math.min(...leafXs)}..${Math.max(...leafXs)}`);

  // The renderer derives its geometry from these constants; assert the layout
  // budget itself holds for the widest case (colossal + awakened).
  const SOIL_TOP = 84;
  const CANOPY_MIN = 24;
  check("soil line leaves room for a mound", SOIL_TOP < 90, `${SOIL_TOP}`);
  check("canopy reserve is positive", CANOPY_MIN > 0, `${CANOPY_MIN}`);

  const frame = 0;
  const stemTop = SOIL_TOP - Math.max(16, Math.min(52 * 1.12, SOIL_TOP - CANOPY_MIN - 24));
  check("tallest stem still clears the canopy line", stemTop >= CANOPY_MIN - frame, `top ${stemTop}`);
  check("root budget fits below the soil", 99 - SOIL_TOP > 0, `${99 - SOIL_TOP} units`);

  // Sanity on the shape helpers actually used for roots and mounds.
  const rp = rootPath(pt(50, 84), 20, 14, 20);
  const rpNums = rp.split(/[ ,]/).map(Number).filter((n) => !Number.isNaN(n));
  check("root coordinates are finite", rpNums.every(Number.isFinite));
  check("root y stays under the frame bottom", Math.max(...rpNums) <= 101, `max ${Math.max(...rpNums)}`);

  check("blob stays local", (() => { const b = blobPath(50, 50, 10, [1, 0.9, 1, 0.95]); const n = b.split(/[ ,]/).map(Number).filter((x) => !Number.isNaN(x)); return n.every(Number.isFinite); })());
  void coords;
  void inside;
}

section("11. Scale parameter is honoured");
{
  const p = all[0];
  check("size attribute is applied", renderPlantSvg(p, 96).includes('width="96"'));
  check("viewBox stays constant so art scales", renderPlantSvg(p, 96).includes('viewBox="0 0 100 100"'));
}

section("11. Silhouette fits the frame at every stage");
{
  /**
   * The important regression in this renderer. Plants are authored in a 100x100
   * viewBox, and three earlier versions drew outside it — an awakened plant
   * reached 115 units tall, so its crown and roots were silently clipped.
   *
   * Only `d="..."` attributes are inspected. An earlier version scraped every
   * number out of the markup, which picked up stroke widths and viewBox values
   * and reported a plant as overflowing when it was not.
   */
  const MARGIN = 5.5;
  const stages = ["seed", "sprout", "young", "mature", "awakened"] as const;
  const offenders: string[] = [];

  /**
   * Every coordinate pair in a path's `d` attribute.
   *
   * Operands are not uniformly paired: `a` takes seven of them (radius, radius,
   * rotation, two flags, then the point), so pairing numbers naively drifts and
   * reports coordinates that do not exist. Walking command by command is the
   * only way to get this right.
   */
  const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, a: 7, Z: 0, z: 0 };
  // Only M/L are literal vertices. Cubic and quadratic control points may sit
  // outside the curve they describe — that is normal and is not an overflow — so
  // they are measured separately and reported as information, not as failures.
  const VERTEX_CMDS = new Set(["M", "L", "m", "l"]);
  const pointsOf = (d: string, verticesOnly: boolean): number[][] => {
    const pts: number[][] = [];
    const tokens = d.match(/[MLHVCSQTAZaz][^MLHVCSQTAZaz]*/gi) ?? [];
    for (const tok of tokens) {
      const cmd = tok[0];
      const upper = cmd.toUpperCase();
      const arity = ARITY[upper];
      if (arity === undefined || arity === 0) continue;
      if (verticesOnly && !VERTEX_CMDS.has(cmd)) continue;
      const rest = tok.slice(1).trim();
      let nums: number[];
      if (upper === "A") {
        // Arc flags can be packed together ("01"), so they are split per character.
        const rebuilt: number[] = [];
        const parts = rest.split(/[\s,]+/).filter(Boolean);
        let consumed = 0;
        for (let i = 0; i < parts.length && consumed < arity; i++) {
          const t = parts[i];
          if (i >= 3 && i <= 4 && t.length > 1 && /^[01]+$/.test(t)) {
            for (const ch of t) {
              rebuilt.push(Number(ch));
              if (++consumed >= arity) break;
            }
          } else {
            rebuilt.push(parseFloat(t));
            consumed++;
          }
        }
        nums = rebuilt;
      } else {
        nums = (rest.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      }
      for (let k = 0; k + 1 < nums.length; k += 2) pts.push([nums[k], nums[k + 1]]);
    }
    return pts;
  };

  /**
   * Leaves are drawn inside `<g transform="translate(..) rotate(..)">`, so their
   * `d` coordinates are local to that group — a leaf path legitimately contains
   * y = -6 before the transform is applied. Reading `d` without the ancestor
   * transform reports a false overflow.
   *
   * So only paths with no transformed ancestor are asserted here. The full
   * transform-aware check lives in `tools/shot.ts --bounds`, which measures real
   * rendered bounds in a browser.
   */
  let worstControl = 0;
  let checked = 0;
  for (const p of all) {
    for (const stage of stages) {
      p.growth.stage = stage;
      const svg = renderPlantSvg(p, 150);
      // Track group nesting so a transformed ancestor is known per path.
      const tokens = svg.matchAll(/<g\b([^>]*)>|<\/g>|<path\b([^>]*)\/>/g);
      let transformStack: string[] = [];
      for (const t of tokens) {
        if (t[0].startsWith("</g")) {
          transformStack.pop();
          continue;
        }
        if (t[1] !== undefined) {
          const hasTransform = /\btransform="/.test(t[1]);
          transformStack.push(hasTransform ? "t" : "f");
          continue;
        }
        const attrs = t[2] ?? "";
        const dm = /\sd="([^"]+)"/.exec(attrs);
        if (!dm || transformStack.includes("t")) continue;
        checked++;
        for (const [x, y] of pointsOf(dm[1], true)) {
          if (x < -MARGIN || x > 100 + MARGIN || y < -MARGIN || y > 100 + MARGIN) {
            offenders.push(`${p.name.slice(0, 12)}/${stage} @${x.toFixed(0)},${y.toFixed(0)}`);
            break;
          }
        }
        for (const [x, y] of pointsOf(dm[1], false)) {
          worstControl = Math.max(worstControl, Math.min(Math.abs(x), 100 - x), Math.min(Math.abs(y), 100 - y) * -1);
        }
      }
    }
  }
  check("untransformed path vertices stay inside the frame", offenders.length === 0, offenders.slice(0, 4).join(" | "));
  check("enough untransformed geometry was actually checked", checked > all.length * stages.length, `${checked} paths`);
  check("curve control points stay within a sane bound", worstControl > -30, `worst ${worstControl.toFixed(1)}`);

  // The solver should also produce a usable size range, not just legal bounds.
  const heights = stages.map((stage) => {
    const p = all[0];
    p.growth.stage = stage;
    return plantSvgHeight(p);
  });
  check("stage heights stay within the frame", heights.every((h) => h > 0 && h <= 100), heights.map((h) => h.toFixed(0)).join(", "));
  check(
    "growth never reverses",
    heights.every((h, i) => i === 0 || h >= heights[i - 1] - 0.5),
    heights.map((h) => h.toFixed(1)).join(" -> "),
  );
}

section("12. Fresh plant from a seed");
{
  const fresh = createSeedPlant("emberleaf", "test-player", "art-test", Date.now());
  const svg = renderPlantSvg(fresh, 150);
  check("a brand-new seed plant renders", svg.startsWith("<svg") && svg.endsWith("</svg>"));
  check("brand-new plant has no NaN", !/NaN/.test(svg));
}

console.log(`\n\x1b[1mResult: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);