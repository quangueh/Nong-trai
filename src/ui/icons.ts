/**
 * Inline SVG icon set, Lucide-style: 24×24 grid, 2px stroke, round caps.
 *
 * Why a hand-built set instead of a dependency: the game ships ~15 icons, a
 * library pulls in hundreds, and inline SVG inherits `currentColor` so one
 * path serves default/active/high-contrast states with zero extra markup.
 * Emoji stay only where they carry meaning (currency, weather, plant tools) —
 * chrome and navigation icons come from here.
 */

export type IconName =
  | "sprout"
  | "trees"
  | "dna"
  | "swords"
  | "bag"
  | "trophy"
  | "mountain"
  | "gear"
  | "x"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "arrow-left"
  | "droplet"
  | "sun"
  | "scissors"
  | "eye"
  | "zap"
  | "shield"
  | "plus"
  | "minus"
  | "check"
  | "users"
  | "play"
  | "pause"
  | "copy"
  | "clock"
  | "filter";

/** Path data per icon. Kept terse; every path was tuned to read at 18–20px. */
const PATHS: Record<IconName, string> = {
  sprout:
    '<path d="M7 20h10"/><path d="M12 20c0-4.5-.5-8-4-8"/><path d="M12 12c0-3 1.2-5.5 4-6.5C18.5 4.7 20 4 20 2c-3.5 0-6 1.3-7 3.5"/><path d="M8 12c-3.5 0-5-2-5-5 3.5 0 5.5 1.5 6.5 4"/><path d="M12 20v-6"/>',
  trees:
    '<path d="M10 21v-7"/><path d="M6.5 14h7l-3.5-5.5L6.5 14Z"/><path d="M7.5 8.5h5L10 4.5 7.5 8.5Z"/><path d="M17 21v-5"/><path d="M14.8 16h4.4L17 12.8l-2.2 3.2Z"/><path d="M15.7 12.8h2.6L17 10l-1.3 2.8Z"/>',
  dna:
    '<path d="M8 2c0 5.2 8 6 8 10.5S8 18 8 22"/><path d="M16 2c0 5.2-8 6-8 10.5S16 18 16 22"/><path d="M8.6 6.7h6.8"/><path d="M8.6 17.3h6.8"/>',
  swords:
    '<path d="M4 3l8.5 8.5"/><path d="M3 4l1-1 8.5 8.5-1 1z"/><path d="m14.5 12.5 2-2L21 15l-2 2z"/><path d="m17.5 20.5 1-1"/><path d="M20 3l-8.5 8.5"/><path d="m3.5 20.5 3-3"/><path d="M7 18l-1-1 2.5-2.5"/>',
  bag:
    '<path d="M6 7h12l1.5 13.5a1 1 0 0 1-1 1.1H5.5a1 1 0 0 1-1-1.1L6 7Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  trophy:
    '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2 1.5 3.5 4 3.5"/><path d="M17 6h3a1 1 0 0 1 1 1c0 2-1.5 3.5-4 3.5"/>',
  mountain:
    '<path d="m8 3 12 18H4L8 3Z"/><path d="m8 3 4 9"/><path d="M11.5 9.5 14 12l-2 1.5"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v2.5"/><path d="M12 19.5V22"/><path d="M4.9 4.9l1.8 1.8"/><path d="M17.3 17.3l1.8 1.8"/><path d="M2 12h2.5"/><path d="M19.5 12H22"/><path d="M4.9 19.1l1.8-1.8"/><path d="M17.3 6.7l1.8-1.8"/>',
  x: '<path d="M5 5l14 14"/><path d="M19 5 5 19"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.6-4.6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 6 6 6-6 6"/>',
  "arrow-left": '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  droplet:
    '<path d="M12 3.5S6 10 6 14a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5Z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5"/><path d="M12 19v2.5"/><path d="M4.9 4.9 6.7 6.7"/><path d="M17.3 17.3l1.8 1.8"/><path d="M2.5 12H5"/><path d="M19 12h2.5"/><path d="M4.9 19.1l1.8-1.8"/><path d="M17.3 6.7l1.8-1.8"/>',
  scissors:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 19"/><path d="M8 16.5 20 5"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  zap: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2Z"/>',
  shield:
    '<path d="M12 2.5 4.5 5.5v6c0 5 3.2 8.5 7.5 10 4.3-1.5 7.5-5 7.5-10v-6L12 2.5Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4.5 12.5 5 5L19.5 6.5"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 15.3c2 .7 3 2.4 3 4.7"/>',
  play: '<path d="M7 4.5 19 12 7 19.5V4.5Z"/>',
  pause: '<path d="M8.5 5v14"/><path d="M15.5 5v14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  filter: '<path d="M4 5h16l-6.2 7.2V19l-3.6 2v-8.8L4 5Z"/>',
};

/**
 * Build an `<svg>` icon node. Decorative by default (`aria-hidden`) — callers
 * give the *button* an accessible name, not the glyph.
 */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icn");
  svg.innerHTML = PATHS[name];
  return svg;
}
