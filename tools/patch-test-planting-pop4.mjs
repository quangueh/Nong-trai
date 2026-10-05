import { readFileSync, writeFileSync } from "node:fs";

/**
 * One more dismissal site, further down the file.
 *
 * Same change as the others: there is no `.overlay` when the chooser is anchored,
 * so `click($(".overlay"))` threw. Dismissal is a `pointerdown` on the document.
 */

const file = "tools/test-planting.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const needle = `// Opening and dismissing the chooser must not leave a sheet behind.
click($(".empty-plot"));
await wait(30);
click($(".overlay"));
await wait(20);
check("closing the chooser leaves nothing behind", !$(".sheet") && !$(".seed-picker"));`;

const next = `// Opening and dismissing the chooser must leave nothing behind. Dismissal is a
// pointerdown outside the popover — there is no overlay to click.
click($(".empty-plot"));
await wait(30);
document.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
await wait(20);
check("closing the chooser leaves nothing behind", !$(".seed-pop") && !$(".seed-picker"));`;

if (!src.includes(needle)) throw new Error("the section-9 dismissal block was not found");
src = src.replace(needle, next);

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("test-planting.ts — section 9 dismissal updated");