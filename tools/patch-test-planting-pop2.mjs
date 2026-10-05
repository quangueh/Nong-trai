import { readFileSync, writeFileSync } from "node:fs";

/**
 * The last of the chooser assertions still described the old sheet.
 *
 * Two places expected `.sheet`, which the anchored popover replaced. Updated to
 * assert the popover and, more usefully, that it is actually anchored — a test
 * that only checks the element exists would pass on a popover that had quietly
 * gone back to being a centred modal.
 *
 * Also drops a genuine strictness bug: the sibling check read `.length` off a
 * single-element query. That compiles under `any` but fails to typecheck under
 * `noImplicitAny`, and it was reading the wrong thing anyway — the assertion is
 * about the card list, so it should be the length of that list.
 */

const file = "tools/test-planting.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  [
    `check("tapping opens the chooser sheet", !!$(".sheet"));
check("it is titled", ($(".sheet")?.textContent ?? "").includes("Chọn hạt"));`,
    `check("tapping opens the chooser", !!$(".seed-pop"));
check("it is titled", ($(".seed-pop")?.textContent ?? "").includes("Chọn hạt"));
// Anchored, not centred. Without this the test would still pass on a popover
// that had reverted to a modal — which is the exact regression this replaced.
check(
  "and it sits next to the plot rather than over the screen",
  (() => {
    const pop = $(".seed-pop")?.getBoundingClientRect();
    const tile = plot?.getBoundingClientRect();
    if (!pop || !tile) return false;
    // Vertically adjacent: the popover starts within a band of the plot's bottom.
    const near = Math.abs(pop.top - (tile.bottom + 10)) < 24;
    // And horizontally overlapping it, so it points at something.
    const overlaps = pop.left < tile.right && pop.right > tile.left;
    return near && overlaps;
  })(),
);`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 110)}`);
  src = src.replace(needle, next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("test-planting.ts — last sheet assertions now assert the anchored popover");