import { readFileSync, writeFileSync } from "node:fs";

/**
 * store.ts — expose what the cloud sync needs, and nothing more.
 *
 * Three additions and they are all deliberately small:
 *
 *   `savedAt`      a timestamp the sync compares against the server's. It was
 *                  missing, which is why "last write wins" had nothing to decide
 *                  with; `Date.now()` at the moment of the push would have made
 *                  every push look newer than a save the player made yesterday on
 *                  another device.
 *   `exportState` / `importState`  so a cloud copy can be moved in and out without
 *                  the sync module reaching into the store's fields.
 *
 * The store does not import the account module. That direction matters: the sync
 * layer needs the store, and a store that needed the sync layer would be a cycle
 * and would also mean the game could not run without the account code being
 * loaded.
 */

const file = "src/core/store.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  // --- the timestamp on the save ------------------------------------------
  [
    `  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore quota / privacy mode
    }
  }`,
    `  /**
   * When this save was last written, in epoch milliseconds.
   *
   * Carried on the state rather than in a wrapper object so the save in
   * localStorage stays exactly the shape it always was — a save from before this
   * field existed loads with it undefined and is treated as "older than anything".
   */
  savedAt = 0;

  save() {
    this.savedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore quota / privacy mode
    }
  }

  /** The whole save, for the cloud copy. */
  exportState(): unknown {
    return this.state;
  }

  /**
   * Replace the save with one from the cloud.
   *
   * Loaded through \`loadOrCreate\`'s repair path rather than assigned blindly, so a
   * save written by an older build — or one that lost a field to a partial write —
   * comes back with its pity counters, garden day and discovery lists repaired
   * rather than crashing the first screen that touches them.
   */
  importState(next: unknown): void {
    if (!next || typeof next !== "object") return;
    const repaired = loadOrCreate.call(null, JSON.stringify(next));
    this.state = repaired;
    this.savedAt = Date.now();
    this.emit();
  }`,
  ],

  // --- restore the timestamp on load --------------------------------------
  [
    `  constructor() {
    this.state = loadOrCreate();
  }`,
    `  constructor() {
    this.state = loadOrCreate();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const at = (JSON.parse(raw) as { savedAt?: number }).savedAt;
        if (typeof at === "number") this.savedAt = at;
      } catch {
        // A save that will not parse is rebuilt by loadOrCreate; the timestamp is
        // simply unknown, which loses nothing but conflict resolution.
      }
    }
  }`,
  ],

  // --- loadOrCreate has to accept an injected string ----------------------
  [
    `function loadOrCreate(): PlayerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);`,
    `function loadOrCreate(rawOverride?: string): PlayerState {
  try {
    const raw = rawOverride ?? localStorage.getItem(STORAGE_KEY);`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n${needle.slice(0, 100)}`);
  src = src.replace(needle, next);
}

// `loadOrCreate` writes back when it creates a fresh save; that must not fire when
// it is repairing an injected one, or importing a cloud save would immediately
// overwrite it with the result of the repair.
src = src.replace(
  /  localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(fresh\)\);/,
  `  if (rawOverride === undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));`,
);

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("store.ts — savedAt, exportState and importState");