import { readFileSync, writeFileSync } from "node:fs";

/**
 * Remove the CSS grass fringe, and make the beds join into one field.
 *
 * The fringe was a failure and it failed visibly. Two `repeating-linear-gradient`s
 * at 76 and 102 degrees are diagonal hatching, not grass: the screenshot showed
 * green and reddish stripes running across every bed like a scribble. Three
 * masks were composited to try to confine it to the edges and none of them did
 * what was intended, because CSS gradients cannot make blades of grass — they can
 * only make stripes.
 *
 * The idea underneath it was right, though: a hard edge between two surfaces reads
 * as a card, and something has to cross that edge. So the fix is the other way
 * round. Instead of grass crossing between beds, the beds are made to *join*:
 * the gap shrinks to a furrow, the bed loses the heavy rim that made it a discrete
 * blob, and what is left is one continuous piece of turned earth with the plants
 * standing in it — which is what a planted bed actually looks like from above.
 *
 * The lawn stays, but only as the frame around the whole field rather than a strip
 * between every row, which is also how a real plot is laid out: beds inside a
 * border, not beds each with their own lawn.
 */

const gardenGround = "tools/_patch/garden-ground.css.txt";
let css = readFileSync(gardenGround, "utf8").replace(/\r\n/g, "\n");

// Replace the bed surface: no rim, no blade attempt, furrow-separated.
const bedStart = css.indexOf(".plot {");
if (bedStart < 0) throw new Error(".plot block not found in the patch file");
const bedEnd = css.indexOf("\n}\n", bedStart) + 3;

const newBed = `.plot {
  position: relative;
  z-index: 1;
  /* A bed in a field is rectangular. The heavy blob radius this had was the other
     half of what made twenty-four of them read as separate objects. */
  border-radius: 8px;
  padding: 10px 10px 11px;
  cursor: pointer;
  overflow: visible;
  border: none;
  background-image:
    /* Furrows. Soil that has been raked has a direction, and a flat fill reads as
       a paint swatch rather than as earth. */
    repeating-linear-gradient(
      180deg,
      rgba(122, 88, 52, 0.08) 0 3px,
      rgba(255, 250, 235, 0.1) 3px 7px
    ),
    /* Pale sand at the crown, warmer loam at the edges. */
    radial-gradient(86% 74% at 50% 30%, #eddcb6 0%, #e0c99b 48%, #c9a877 82%, #b08a58 100%);
  /* No rim, no outer glow: the only separation is the furrow of darker soil the
     grid gap leaves between neighbours. */
  box-shadow: inset 0 3px 8px rgba(74, 48, 22, 0.2);
  transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

/* Contact shadow only. A bed dug into soil has no hard rim; what separates it
   from its neighbour is the shadow the rim of earth casts into the furrow. */
.plot::before {
  content: "";
  position: absolute;
  left: 3%;
  right: 3%;
  top: 6%;
  bottom: -4px;
  border-radius: 10px;
  background: rgba(46, 62, 24, 0.16);
  filter: blur(6px);
  z-index: -1;
  pointer-events: none;
}

/* The furrow: a darker line of turned earth around each bed, which is what the
   eye uses to count the beds instead of a card border. */
.plot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(104, 74, 42, 0.22);
}
`;

css = css.slice(0, bedStart) + newBed;

// Drop the .plot-grass rule entirely.
const grassAt = css.indexOf("/* Grass tufts breaking the bed's edge.");
if (grassAt > 0) css = css.slice(0, grassAt).trimEnd() + "\n";

writeFileSync(gardenGround, css, "utf8");

// --- put it back into styles.css -------------------------------------------
const file = "src/styles.css";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const start = src.indexOf("/* The lawn the beds are dug into.");
if (start < 0) throw new Error("garden ground block not found in styles.css");
// Ends where the old `.plot-grass {` rule ended.
const marker = ".plot-grass {";
const at = src.indexOf(marker, start);
if (at < 0) throw new Error(".plot-grass rule not found");
let depth = 0;
let end = -1;
for (let i = src.indexOf("{", at); i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}

src = src.slice(0, start) + css + src.slice(end);
writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("grass fringe removed; beds now join into one field");
