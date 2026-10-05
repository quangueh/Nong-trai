import { readFileSync, writeFileSync } from "node:fs";

/**
 * The screenshot helper defaults to full-page, and that default hid a total layout
 * failure for the whole session.
 *
 * The shell was 2,299px tall with the navigation bar anchored to its bottom, so the
 * nav sat 2,299px down a 820px viewport and every sheet opened below the fold.
 * Tapping a plant did nothing a player could see. Every capture was
 * `fullPage: true`, which produced a 2,299px image in which the nav appeared
 * exactly where it was supposed to be — at the bottom of the picture, not the
 * bottom of the screen.
 *
 * So the default flips. A capture is now the size of the viewport, which is the
 * only size that answers the question a screenshot is asked. Full-page is still
 * available for the one thing it is genuinely good at, which is a contact sheet of
 * many small specimens that would otherwise need scrolling to assemble.
 *
 * It also asserts rather than assumes: the helper checks the document is not
 * taller than the viewport, and says so if it is. That is the single measurement
 * that would have caught this.
 */

const file = "tools/shot.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  [
    `async function shot(page: import("playwright-core").Page, name: string, full = true): Promise<void> {
  const path = \`\${OUT}/\${name}.png\`;
  await page.screenshot({ path, fullPage: full });
  console.log(\`  \${name}.png\`);
}`,
    `/**
 * Capture what a player actually sees: the viewport, not the document.
 *
 * The old default was \`fullPage: true\` and it concealed a complete layout
 * failure — the shell was 2,299px tall with the navigation bar and every sheet
 * anchored to its bottom, so on an 820px screen none of them were visible and
 * tapping a plant did nothing. Every screenshot looked correct because a
 * full-page image is as tall as the bug.
 *
 * \`full\` is now opt-in, for contact sheets where the point is to see many
 * specimens at once.
 */
async function shot(page: import("playwright-core").Page, name: string, full = false): Promise<void> {
  const path = \`\${OUT}/\${name}.png\`;

  if (!full) {
    // The one measurement that would have caught the bug above. Worth paying a
    // round trip for on every capture.
    const metrics = await page.evaluate(\`(() => ({
      doc: document.documentElement.scrollHeight,
      view: window.innerHeight,
    }))\`);
    const m = metrics as { doc: number; view: number };
    if (m.doc > m.view + 2) {
      console.log(
        \`  \x1b[31mWARN\x1b[0m \${name}: the document is \${m.doc}px tall in a \${m.view}px viewport — ` +
          \`something is positioned against the page instead of the shell.\`,
      );
    }
  }

  await page.screenshot({ path, fullPage: full });
  console.log(\`  \${name}.png\`);
}`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 90)}`);
  src = src.replace(needle, next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");

// The tab and account captures were whole-page for the same reason; the garden is
// now viewport-sized with the tabs pinned, so full-page adds nothing.
for (const f of ["tools/shot-tabs.ts"]) {
  const orig = readFileSync(f, "utf8");
  const fe = orig.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(f, orig.replace(/, fullPage: true \}/g, " }").replace(/\{\s*path: ([^,]+), fullPage: true \}/g, "{ path: $1 }"), fe === "\r\n" ? orig.replace(/, fullPage: true \}/g, " }").replace(/\{\s*path: ([^,]+), fullPage: true \}/g, "{ path: $1 }").replace(/\r\n/g, "\r\n") : orig.replace(/, fullPage: true \}/g, " }").replace(/\{\s*path: ([^,]+), fullPage: true \}/g, "{ path: $1 }"), "utf8");
}

console.log("shot.ts — viewport by default, and it measures the document height");