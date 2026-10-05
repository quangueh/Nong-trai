import { readFileSync, writeFileSync } from "node:fs";

/**
 * test-planting.ts — fix two assertions that could not have passed.
 *
 * One read `.length` off a single-element query: `$$` is the plural helper and `$`
 * returns one element. It happened to compile because the query helpers are typed
 * loosely, and it would have thrown the moment the element existed.
 *
 * The other measured geometry, which is the mistake worth recording. jsdom has no
 * layout engine, so `getBoundingClientRect()` returns zeros for everything and any
 * assertion about whether the popover is *near* the plot is asserting that 0 is
 * near 0. It cannot be made to pass here at all.
 *
 * So the placement claim is asserted from what the code actually did — the inline
 * `left`/`top` that `placePopover` writes — and the geometric claim is left to the
 * Playwright harness, which runs a real browser. Splitting it that way is not a
 * workaround: it is the only honest split, because only one of the two
 * environments can see position at all.
 */

const file = "tools/test-planting.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  // The plural helper, as the assertion always meant.
  [
    `check("the chooser lists the seeds held", $(".picker-card").length > 0);`,
    `check("the chooser lists the seeds held", $$(".picker-card").length > 0, \`\${$$(".picker-card").length}\`);`,
  ],

  // Placement: assert the measurement was taken, not the result of it.
  [
    `// And it can be reopened, so the dismissal did not leave the plot dead.
click(emptyPlots[0]);
await wait(20);
check("the plot still opens the chooser again", !!$(".seed-pop"));`,
    `// And it can be reopened, so the dismissal did not leave the plot dead.
click(emptyPlots[0]);
await wait(30);
// Placement is asserted from the inline left/top that placePopover writes, not from
// getBoundingClientRect — jsdom has no layout engine, so every rect is zero and a
// distance check here would be comparing 0 to 0. Whether the popover actually
// lands next to the plot is verified in tools/shot-picker.ts, which runs a real
// browser and can see position.
const positioned = (): boolean => {
  const pop = $(".seed-pop");
  return Boolean(pop && pop.style.left && pop.style.top);
};
check("the plot still opens the chooser again", !!$(".seed-pop"));
check("and it was positioned from the anchor", positioned(), \`left="\${$(".seed-pop")?.style.left ?? ""}"\`);`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 100)}`);
  src = src.replace(needle, next);
}

// Drop the geometry assertion from the other place too.
const geomStart = src.indexOf("// Anchored, not centred. Without this the test would still pass on a popover");
if (geomStart >= 0) {
  const geomEnd = src.indexOf(");", src.indexOf("return near && overlaps;", geomStart)) + 3;
  src = src.slice(0, geomStart) + src.slice(geomEnd);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("test-planting.ts — plural helper fixed, geometry assertion removed");