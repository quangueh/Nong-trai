/**
 * Plant geometry helpers (docs/07, docs/06 §11).
 *
 * Shapes are built as path data rather than primitives. The old renderer drew
 * leaves as `<ellipse>` and the stem as a single cubic, so every plant read as
 * "a circle on a stick" — the geometry below builds a real silhouette: a leaf is
 * two mirrored quadratic arcs meeting at base and tip, with a midrib, and the
 * stem is a tapered ribbon that follows the curve of its own spine.
 */

export interface Pt {
  x: number;
  y: number;
}

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString();

export function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Distance between two points. */
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Rotate `p` around `o` by `deg` degrees (SVG y grows downward). */
export function rotate(p: Pt, o: Pt, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: o.x + dx * cos - dy * sin, y: o.y + dx * sin + dy * cos };
}

/** Point a given distance along the direction from `a` to `b`. */
export function along(a: Pt, b: Pt, dist_: number): Pt {
  const total = dist(a, b) || 1;
  const t = dist_ / total;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Angle in degrees of the direction a -> b. */
export function angleOf(a: Pt, b: Pt): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/**
 * Midpoint of a quadratic Bezier at t, and the point at parameter t.
 * Used to grow stems along their own curve so leaves can sit on the spine
 * rather than being positioned by hand.
 */
export function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

/** Quadratic Bezier as an SVG path segment (no leading moveto). */
export function quadPath(c: Pt, p1: Pt): string {
  return `Q ${r2(c.x)} ${r2(c.y)} ${r2(p1.x)} ${r2(p1.y)}`;
}

/** The quadratic Bezier spine as polyline points, for sampling. */
export function quadSamples(p0: Pt, c: Pt, p1: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) out.push(quadAt(p0, c, p1, i / steps));
  return out;
}

/**
 * A cubic Bezier as a filled tapered outline.
 *
 * `width0`/`width1` are the half-widths at each end, so a stem can be thick at
 * the base and fine at the tip. Offsetting both sides by the local normal and
 * joining them gives a closed ribbon with no seam at the join.
 */
export function taperedOutline(spine: Pt[], width0: number, width1: number): string {
  if (spine.length < 2) return "";
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    const w = width0 + (width1 - width0) * t;
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Normal is perpendicular to the tangent.
    const nx = -dy / len;
    const ny = dx / len;
    const p = spine[i];
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  // Right side is walked backwards so the outline closes smoothly.
  const back = right.slice().reverse();
  const all = [...left, ...back];
  return all.map((p, i) => `${i === 0 ? "M" : "L"} ${r2(p.x)} ${r2(p.y)}`).join(" ") + " Z";
}

export interface LeafOptions {
  /** Length along the leaf's own axis. */
  length: number;
  /** Widest point as a fraction of length. */
  width: number;
  /** Where along the leaf the widest point sits, 0 = base, 1 = tip. */
  belly: number;
  /** How far the tip droops, degrees. Positive curls downward. */
  curl: number;
  /** Nibble count along the edge; 0 gives a smooth margin. */
  serration: number;
  /** Randomness in the silhouette, 0..1. */
  jitter: number;
}

/**
 * A single leaf pointing along +x from the origin.
 *
 * Built as two cubic curves from base to tip, one for each margin. The margin
 * offset peaks at `belly` and pinches to zero at both ends, which is what makes
 * a leaf look like a leaf rather than an ellipse: the base and tip are points,
 * not rounded caps.
 */
export function leafPath(o: LeafOptions): string {
  const { length: L, width: W, belly, curl, serration, jitter } = o;
  const halfW = (L * W) / 2;
  const tip = rotate({ x: L, y: 0 }, { x: 0, y: 0 }, curl);
  // Control points sit above and below the axis; their y offset sets the bulge.
  const bulgeTop = -halfW * (1.15 - Math.abs(belly - 0.45) * 0.6);
  const bulgeBot = -bulgeTop * (0.86 + jitter * 0.2);
  const bx = L * belly;

  const wobble = (n: number): number => (n % 2 === 0 ? 1 : -1) * jitter * L * 0.045;
  const top = `C ${r2(bx * 0.34)} ${r2(bulgeTop + wobble(1))} ${r2(bx * 0.76)} ${r2(bulgeTop * 0.94 + wobble(2))} ${r2(tip.x)} ${r2(tip.y)}`;
  const bot = `C ${r2(bx * 0.76)} ${r2(bulgeBot * 0.94 - wobble(3))} ${r2(bx * 0.34)} ${r2(bulgeBot - wobble(4))} 0 0`;

  let edge = `M 0 0 ${top} ${bot} Z`;

  // Serration is added as a scalloped stroke on top of the smooth silhouette,
  // which reads as a toothed margin without breaking the closed outline.
  if (serration > 0) {
    const teeth: string[] = [];
    const count = 3 + Math.round(serration * 4);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const px = L * t;
      const py = bulgeTop * Math.sin(Math.PI * t) * 0.86;
      const d = serration * L * 0.03;
      teeth.push(`M ${r2(px - d)} ${r2(py * 0.86)} L ${r2(px)} ${r2(py)} L ${r2(px + d)} ${r2(py * 0.86)}`);
    }
    edge += ` ${teeth.join(" ")}`;
  }
  return edge;
}

/** Central midrib, drawn as a curve that follows the leaf's droop. */
export function leafMidrib(length: number, curl: number): string {
  const tip = rotate({ x: length, y: 0 }, { x: 0, y: 0 }, curl);
  return `M 0 0 Q ${r2(length * 0.5)} ${r2(-length * 0.04)} ${r2(tip.x)} ${r2(tip.y)}`;
}

/** Lateral veins fanning off the midrib toward the margin. */
export function leafVeins(length: number, width: number, belly: number, count: number): string {
  const halfW = (length * width) / 2;
  const bulge = -halfW * (1.15 - Math.abs(belly - 0.45) * 0.6);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const mx = length * t * 0.82;
    const my = bulge * Math.sin(Math.PI * t) * 0.2;
    const reach = length * 0.3;
    const spread = Math.sin(Math.PI * t) * bulge * 0.86;
    out.push(`M ${r2(mx)} ${r2(my)} Q ${r2(mx + reach * 0.45)} ${r2(my + spread * 0.42)} ${r2(mx + reach * 0.8)} ${r2(my + spread * 0.9)}`);
    out.push(`M ${r2(mx)} ${r2(my)} Q ${r2(mx + reach * 0.45)} ${r2(my - spread * 0.42)} ${r2(mx + reach * 0.8)} ${r2(my - spread * 0.9)}`);
  }
  return out.join(" ");
}

/**
 * Petal as a teardrop pointing along -y from the flower centre.
 * Narrow at the base, round at the tip, which is the opposite of a circle.
 */
export function petalPath(length: number, width: number, curl: number): string {
  const halfW = (length * width) / 2;
  const tip = rotate({ x: 0, y: -length }, { x: 0, y: 0 }, curl);
  return `M 0 0 C ${r2(halfW)} ${r2(-length * 0.22)}, ${r2(halfW * 0.72)} ${r2(-length * 0.82)}, ${r2(tip.x)} ${r2(tip.y)} C ${r2(-halfW * 0.72)} ${r2(-length * 0.82)}, ${r2(-halfW)} ${r2(-length * 0.22)}, 0 0 Z`;
}

/** Root that tapers to a point, growing downward and outward. */
export function rootPath(from: Pt, dirDeg: number, length: number, curl: number): string {
  const end = rotate({ x: from.x, y: from.y + length }, from, dirDeg);
  const ctrl = along(from, end, length * 0.5);
  const mid = rotate(ctrl, from, curl);
  const spine = quadSamples(from, mid, end, 8);
  return taperedOutline(spine, length * 0.13, length * 0.02);
}

/** A rounded polygon, used for angular seeds and crystal shards. */
export function shardPath(cx: number, cy: number, r: number, sides: number, jitter: (i: number) => number, squash = 1): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const rr = r * (1 + jitter(i));
    pts.push(`${r2(cx + Math.cos(a) * rr)} ${r2(cy + Math.sin(a) * rr * squash)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

/** Smooth closed blob through the given radii — used for dew and spores. */
export function blobPath(cx: number, cy: number, r: number, radii: number[]): string {
  const n = radii.length;
  const pts: Pt[] = radii.map((rr, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * r * rr, y: cy + Math.sin(a) * r * rr };
  });
  const mid = (i: number): Pt => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  let d = `M ${r2(mid(0).x)} ${r2(mid(0).y)}`;
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const m = mid(i + 1);
    d += ` Q ${r2(next.x)} ${r2(next.y)} ${r2(m.x)} ${r2(m.y)}`;
  }
  return d + " Z";
}

// ---------------------------------------------------------------------------
// Growth habit
// ---------------------------------------------------------------------------

/**
 * A cubic Bezier point at `t`, and the sampled polyline for it.
 *
 * Lives here rather than in the renderer because both the habit builder and the
 * frame solver need the same curve — if they sampled it differently the solver
 * would fit a plant that was not the one drawn.
 */
export function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y,
  };
}

export function cubicSamples(p0: Pt, c1: Pt, c2: Pt, p1: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) out.push(cubicAt(p0, c1, c2, p1, i / steps));
  return out;
}

/**
 * How a plant holds itself.
 *
 * This is the single biggest lever on whether two plants look like two plants.
 * Every plant used to be one spine rising from one point, so the `lean` and
 * `vine` stem genes moved the silhouette by a few degrees and a contact sheet of
 * twelve plants read as three. The habit changes where the mass is — the base,
 * the middle, or the crown — which is what actually distinguishes a rosette from
 * a spire at thumbnail size.
 */
export type Habit = "spire" | "bush" | "rosette" | "arch" | "spiral";

/**
 * Pick a habit from the genes.
 *
 * Deliberately *not* uniform: a rosette has no tall stem to hang leaves on, so
 * making it common everywhere would have broken the frame solver as well as
 * looking wrong. Branches and stems are also gated on complexity, because a
 * low-complexity plant with three branches reads as a mistake rather than as a
 * simple plant.
 */
export function habitFor(body: { stem: string; size: string; leaf: string; root: string }, complexity: number): Habit {
  const roll = (complexity * 37.1 + body.stem.length * 11.3 + body.leaf.length * 5.7 + body.size.length * 3.1) % 100;
  if (body.stem === "vine") return roll < 42 ? "spiral" : "arch";
  if (body.size === "colossal" && roll < 30) return "rosette";
  if (complexity < 0.34) return roll < 55 ? "spire" : "rosette";
  if (roll < 26) return "rosette";
  if (roll < 52) return "bush";
  if (roll < 76) return "arch";
  return "spire";
}

/** How many side branches a habit carries at a given complexity. */
export function branchCount(habit: Habit, complexity: number): number {
  if (habit !== "bush") return 0;
  if (complexity < 0.4) return 1;
  if (complexity < 0.66) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Leaf families
// ---------------------------------------------------------------------------

/**
 * Outline families for a leaf, all authored along +x from the origin.
 *
 * The renderer previously used one almond shape for everything, so `lance` and
 * `round` leaves were indistinguishable. The families differ in where the widest
 * point sits, how fast the base narrows, and whether the tip is a point or a
 * round cap — which is what the eye actually uses to read a leaf.
 */
export type LeafFamily = "oval" | "lance" | "round" | "arrow" | "lobed";

const LEAF_PROFILE: Record<LeafFamily, { belly: number; baseTight: number; tipSharp: number }> = {
  // Widest at the middle, pointed tip: the generic leaf.
  oval: { belly: 0.45, baseTight: 1, tipSharp: 1 },
  // Widest below the middle, drawn out into a long point.
  lance: { belly: 0.34, baseTight: 1.15, tipSharp: 1.35 },
  // Widest above the middle, blunt round tip — the "paddle" leaf.
  round: { belly: 0.58, baseTight: 0.86, tipSharp: 0.5 },
  // Shoulders below the middle, drawn in to a narrow waist then out again.
  arrow: { belly: 0.38, baseTight: 1.05, tipSharp: 0.8 },
  // Deeply waisted, for the compound-looking leaves.
  lobed: { belly: 0.4, baseTight: 0.95, tipSharp: 1.1 },
};

export interface LeafShapeOptions {
  length: number;
  width: number;
  family: LeafFamily;
  curl: number;
  serration: number;
  jitter: number;
}

/**
 * A leaf in the given outline family.
 *
 * `lobed` and `arrow` are not drawn with extra sub-paths — they are built from
 * the same two margin curves with a pinched belly, because a real lobed margin
 * read as a saw blade when it was drawn as separate teeth hanging off the edge.
 */
export function leafFamilyPath(o: LeafShapeOptions): string {
  const { length: L, family, curl, serration, jitter } = o;
  const prof = LEAF_PROFILE[family];
  const halfW = (L * o.width) / 2;
  const tip = rotate({ x: L, y: 0 }, { x: 0, y: 0 }, curl);
  const belly = prof.belly;

  // How much of the belly sits above vs below the axis. An asymmetric leaf
  // catches light on one side and reads as a surface rather than a sticker.
  const upper = -halfW * prof.baseTight;
  const lower = Math.abs(upper) * (0.82 + jitter * 0.22);

  // The tip lands short of `L` for a blunt family, which is what makes a round
  // leaf round rather than just a wide oval.
  const tipX = L * prof.tipSharp;
  const tipPt = rotate({ x: tipX, y: 0 }, { x: 0, y: 0 }, curl);
  const bx = tipX * belly;

  const wobble = (n: number): number => (n % 2 === 0 ? 1 : -1) * jitter * L * 0.05;

  // For a lobed margin the control points pull in toward the axis, carving the
  // waist; for an arrow leaf they overshoot, giving the shoulders.
  const waist = prof.baseTight * (family === "lobed" ? 0.52 : family === "arrow" ? 1.24 : 1);

  const top = `C ${r2(bx * 0.3)} ${r2(upper * waist + wobble(1))} ${r2(bx * 0.78)} ${r2(upper * 0.9 * waist + wobble(2))} ${r2(tipPt.x)} ${r2(tipPt.y)}`;
  const bot = `C ${r2(bx * 0.78)} ${r2(lower * 0.9 * waist - wobble(3))} ${r2(bx * 0.3)} ${r2(lower * waist - wobble(4))} 0 0`;

  let d = `M 0 0 ${top} ${bot} Z`;

  if (serration > 0) {
    const teeth: string[] = [];
    const count = 3 + Math.round(serration * 4);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const px = tipX * t;
      const py = upper * waist * Math.sin(Math.PI * t) * 0.86;
      const tooth = serration * L * 0.032;
      teeth.push(`M ${r2(px - tooth)} ${r2(py * 0.84)} L ${r2(px)} ${r2(py)} L ${r2(px + tooth)} ${r2(py * 0.84)}`);
    }
    d += ` ${teeth.join(" ")}`;
  }
  void tip;
  return d;
}

/** Map a `leaf` body gene onto an outline family. */
export function leafFamilyFor(gene: string): LeafFamily {
  switch (gene) {
    case "narrow":
    case "arrow":
      return "lance";
    case "round":
      return "round";
    case "lobed":
    case "pinnate":
      return "lobed";
    case "serrated":
      return "arrow";
    default:
      return "oval";
  }
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/**
 * A bed of soil: a mounded rim, a lit crown, loose grit, and a tight contact
 * shadow under the stem.
 *
 * The old version was two flat grey ellipses at 0.55 and 0.2 opacity, which read
 * as a shadow sticker rather than as ground — every plant appeared to float on a
 * grey lozenge. Soil has a warm top face and a dark front face; the difference
 * between those two values is what makes it read as a mound.
 */
export interface SoilOptions {
  cx: number;
  y: number;
  rx: number;
  ry: number;
  /** Warm top colour. */
  top: string;
  /** Dark front-face colour. */
  face: string;
  /** Rim highlight along the top edge. */
  rim: string;
  grit: { x: number; y: number; r: number; o: number }[];
  blades: string;
  shadow: string;
}

export function soilMound(o: SoilOptions): string {
  const { cx, y, rx, ry, top, face, rim, grit, blades, shadow } = o;
  // Front face: an arc from the left rim, bulging down, to the right rim.
  const facePath =
    `M ${r2(cx - rx)} ${r2(y)} ` +
    `A ${r2(rx)} ${r2(ry)} 0 0 0 ${r2(cx + rx)} ${r2(y)} Z`;
  // Top face: a shallower arc, so the two together form a dome.
  const topPath =
    `M ${r2(cx - rx)} ${r2(y)} ` +
    `A ${r2(rx)} ${r2(ry * 0.86)} 0 0 1 ${r2(cx + rx)} ${r2(y)} Z`;

  const gritSvg = grit
    .map(
      (g) =>
        `<ellipse cx="${r2(g.x)}" cy="${r2(g.y)}" rx="${r2(g.r)}" ry="${r2(g.r * 0.72)}" fill="${face}" opacity="${g.o.toFixed(2)}"/>`,
    )
    .join("");

  return `<g class="l-ground">
    <ellipse cx="${r2(cx)}" cy="${r2(y + ry * 0.62)}" rx="${r2(rx * 0.94)}" ry="${r2(ry * 0.5)}" fill="${face}" opacity="0.5"/>
    <path d="${facePath}" fill="${face}"/>
    <path d="${topPath}" fill="${top}"/>
    <path d="M ${r2(cx - rx * 0.86)} ${r2(y - ry * 0.1)} A ${r2(rx * 0.86)} ${r2(ry * 0.66)} 0 0 1 ${r2(cx + rx * 0.5)} ${r2(y - ry * 0.22)}" fill="none" stroke="${rim}" stroke-width="${r2(Math.max(0.5, ry * 0.16))}" stroke-linecap="round" opacity="0.7"/>
    ${gritSvg}
    ${blades}
    <ellipse cx="${r2(cx)}" cy="${r2(y + ry * 0.12)}" rx="${r2(rx * 0.2)}" ry="${r2(ry * 0.3)}" fill="${shadow}" opacity="0.26"/>
  </g>`;
}

/** Small blades of grass at the mound's edge — breaks the perfect ellipse. */
export function grassBlades(cx: number, y: number, rx: number, ry: number, colour: string, n: number, seedRng: () => number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const t = 0.12 + seedRng() * 0.76;
    const x = cx - rx + t * rx * 2;
    const lean = (seedRng() - 0.5) * ry * 1.1;
    const h = ry * (0.7 + seedRng() * 1.1);
    const base = y + ry * 0.16;
    s +=
      `<path d="M ${r2(x)} ${r2(base)} Q ${r2(x + lean * 0.4)} ${r2(base - h * 0.6)} ${r2(x + lean)} ${r2(base - h)}" ` +
      `fill="none" stroke="${colour}" stroke-width="${r2(Math.max(0.45, ry * 0.11))}" stroke-linecap="round" opacity="${(0.45 + seedRng() * 0.3).toFixed(2)}"/>`;
  }
  return s;
}

export { r2 };