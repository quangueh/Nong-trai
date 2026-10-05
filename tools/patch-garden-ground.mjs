import { readFileSync, writeFileSync } from "node:fs";

/**
 * styles.css — splice the garden ground in by line range.
 *
 * Not by matching the old text. Embedding the old CSS in a template literal meant
 * any backtick in its comments ended the literal early — which is the third time
 * this session that putting CSS or TS inside a template literal has cost more time
 * than the edit was worth. The replacement lives in a file and is spliced by line
 * number, so nothing has to be escaped at all.
 */

const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const lines = original.replace(/\r\n/g, "\n").split("\n");

/** Find the line index of a selector, 0-based. */
function find(needle) {
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith(needle)) return i;
  throw new Error(`selector not found: ${needle}`);
}

/** Find the closing brace of the block starting at `start`, brace-counted. */
function endOfBlock(start) {
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  throw new Error(`unbalanced block at line ${start + 1}`);
}

const replacement = readFileSync("tools/_patch/garden-ground.css.txt", "utf8")
  .replace(/\r\n/g, "\n")
  .trimEnd();

// Replace the later block first so the earlier index stays valid: the `.plot`
// block starts after `.plots`, so cutting the tail cannot shift the head.
const plotStart = find(".plot {");
const plotEnd = endOfBlock(plotStart);

const plotsStart = find(".plots {");
// `.plots` is followed by a media query that also has to go, since the new block
// carries its own copy.
let plotsEnd = endOfBlock(plotsStart);
if (/^@media \(min-width: 680px\)/.test(lines[plotsEnd + 2] ?? "")) plotsEnd = endOfBlock(plotsEnd + 2);

const out = [
  ...lines.slice(0, plotsStart),
  replacement,
  ...lines.slice(plotEnd + 1),
];

writeFileSync(file, eol === "\r\n" ? out.join("\n").replace(/\n/g, "\r\n") : out.join("\n"), "utf8");
console.log(`garden ground spliced: .plots ${plotsStart + 1}-${plotsEnd + 1}, .plot ${plotStart + 1}-${plotEnd + 1}`);
