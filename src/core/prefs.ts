/**
 * Player preferences: motion and volume, in one place.
 *
 * ## Why this file exists
 *
 * Two things were asked for and neither was real.
 *
 * `reducedMotion()` had been written three times — once each in `audio/audio.ts`,
 * `battle/juice.ts` and `battle/battleFx.ts` — each reading `matchMedia` itself. Three
 * answers to the same question, no way for a player to overrule any of them, and no way for
 * the game to answer consistently if the OS setting changed mid-session. A motion preference
 * that only the operating system can express is not a setting, it is a constraint.
 *
 * `AudioEngine.volume` was declared with the comment "exposed so the settings screen can drive
 * it without touching Web Audio", and then nothing ever drove it. There was no setter, no
 * persistence, and no control. A field kept in a hopeful state is worse than a missing one,
 * because it reads as done.
 *
 * So both live here, persisted, and both are editable by the player.
 *
 * ## Why motion is three states and not two
 *
 * A boolean cannot express "this player asked for less motion, and their OS says the same" in
 * a way that survives the player changing their OS setting later. Three states do: `system`
 * follows the OS and re-reads it, `full` overrides it upward, `reduce` overrides it downward.
 * A player who turns reduced motion on because it made them ill, and then changes their OS,
 * should not silently lose it — and under a plain boolean they would.
 */

/** `system` follows the operating system. `full`/`reduce` are the player's explicit choice. */
export type MotionPref = "system" | "full" | "reduce";

const MOTION_KEY = "nongtrai.motion";
const VOLUME_KEY = "nongtrai.volume";
const MUSIC_VOLUME_KEY = "nongtrai.musicVolume";

/**
 * Read a key without throwing.
 *
 * Private browsing throws on `localStorage` access rather than returning null, and a settings
 * screen that crashes on open is a settings screen nobody uses. Falling back to the default is
 * the right failure: preferences are conveniences, never a correctness requirement.
 */
function read(key: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage full or blocked. The preference applies to this session and is lost on reload,
       which is a far better outcome than refusing to open the settings screen. */
  }
}

/* -------------------------------------------------------------------------- motion */

/** What the OS asks for, ignoring any player override. */
function systemPrefersReduced(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let motion: MotionPref = "system";

/** An unrecognised stored value is treated as "follow the system" rather than trusted. */
(function loadMotion() {
  const raw = read(MOTION_KEY);
  if (raw === "full" || raw === "reduce" || raw === "system") motion = raw;
})();

export function motionPref(): MotionPref {
  return motion;
}

export function setMotionPref(next: MotionPref): void {
  motion = next;
  write(MOTION_KEY, next);
  applyMotion();
}

/**
 * Publish the resolved motion answer on `<html data-motion>` so CSS ambient
 * animation (leaf flutter, plot shimmer, route transitions) follows the
 * *player's* choice, not only the OS media query the stylesheet can see.
 */
export function applyMotion(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = reducedMotion() ? "reduce" : "full";
}

/**
 * The one answer to "should this be animated", honouring both the OS and the player.
 *
 * An explicit choice beats the OS in both directions: `reduce` turns motion off even where the
 * OS is happy with it, and `full` turns it on where the OS asked for less. Only `system`
 * defers.
 */
export function reducedMotion(): boolean {
  if (motion === "reduce") return true;
  if (motion === "full") return false;
  return systemPrefersReduced();
}

/**
 * Ask the OS again and tell anyone who cares.
 *
 * With the preference on `system`, a player who changes reduced motion in their OS settings
 * while the tab is open should see the change without reloading. Returns true when the
 * resolved answer differs from before.
 */
/** Re-publish the resolved answer when the OS flips while pref is `system`. */
export function watchSystemMotion(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const q = matchMedia("(prefers-reduced-motion: reduce)");
  const handler = (): void => onChange();
  // Safari below 14 only has the deprecated form. Both are feature-tested rather than
  // version-tested, because the version that ships is not the version that is deployed.
  if (typeof q.addEventListener === "function") {
    q.addEventListener("change", handler);
    return () => q.removeEventListener("change", handler);
  }
  q.addListener(handler);
  return () => q.removeListener(handler);
}

/* ------------------------------------------------------------------------- volume */

/**
 * Clamp to a range the player can actually land on.
 *
 * Exported because the audio engine owns the gain node and needs the same bounds — two
 * clamps would be two chances for a dragged slider to store a number the engine will not
 * honour.
 */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0.75;
  return Math.min(1, Math.max(0, v));
}

let vol = 0.75;

/*
 * Read back in the units it was written in.
 *
 * `setVolume` stores a percentage ("50"), and this used to read the raw string as a fraction —
 * so `Number("50")` was 50, `clampVolume` capped it to 1, and **every stored volume came back as
 * either silent or full**. Music, being newer, had the same bug copied over with it.
 *
 * Both sides are pinned to whole-percent from here on, because a slider speaks in percent and
 * dividing by 100 in exactly one direction is how a preference quietly stops existing.
 */
function readPercent(key: string): number | null {
  const raw = read(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : null;
}

(function loadVolume() {
  const pct = readPercent(VOLUME_KEY);
  if (pct !== null) vol = clampVolume(pct);
})();

export function volume(): number {
  return vol;
}

export function setVolume(v: number): void {
  vol = clampVolume(v);
  write(VOLUME_KEY, String(Math.round(vol * 100)));
}

/* ------------------------------------------------------------------ music volume */

let musicVol = 0.4;

(function loadMusicVolume() {
  const pct = readPercent(MUSIC_VOLUME_KEY);
  if (pct !== null) musicVol = clampVolume(pct);
})();

export function musicVolume(): number {
  return musicVol;
}

export function setMusicVolume(v: number): void {
  musicVol = clampVolume(v);
  write(MUSIC_VOLUME_KEY, String(Math.round(musicVol * 100)));
}

/** The volume to start a fresh player at, lower if they asked for less motion. */
export function defaultVolume(): number {
  return systemPrefersReduced() ? 0.45 : 0.75;
}

/* ----------------------------------------------------------------- transparency */
/*
 * Reduced transparency is a separate axis from reduced motion: a player can
 * want blur-free solid surfaces without wanting every animation gone (visual
 * processing, low-end GPU, battery), or the reverse. The system media query
 * `prefers-reduced-transparency` exists but only Safari honours it — so the
 * player's explicit choice is the primary signal and the OS is a `system`
 * fallback, exactly like motion.
 */
export type GlassPref = "system" | "glass" | "solid";
const GLASS_KEY = "nongtrai.glass";

let glass: GlassPref = "system";

(function loadGlass() {
  const raw = read(GLASS_KEY);
  if (raw === "glass" || raw === "solid" || raw === "system") glass = raw;
})();

export function glassPref(): GlassPref {
  return glass;
}

export function setGlassPref(next: GlassPref): void {
  glass = next;
  write(GLASS_KEY, next);
  applyGlass();
}

function systemPrefersOpaque(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-transparency: reduce)").matches
  );
}

/** True when surfaces should render solid (no translucency, no backdrop blur). */
export function reduceTransparency(): boolean {
  if (glass === "solid") return true;
  if (glass === "glass") return false;
  return systemPrefersOpaque();
}

/**
 * Publish the resolved mode on `<html data-solid>` so the stylesheet reads one
 * attribute instead of every consumer re-running the media query. Called at
 * boot and whenever the preference changes.
 */
export function applyGlass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.solid = reduceTransparency() ? "1" : "0";
}

/** Follow the OS transparency query while the pref is `system`. */
export function watchSystemTransparency(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const q = matchMedia("(prefers-reduced-transparency: reduce)");
  const handler = (): void => onChange();
  if (typeof q.addEventListener === "function") {
    q.addEventListener("change", handler);
    return () => q.removeEventListener("change", handler);
  }
  q.addListener(handler);
  return () => q.removeListener(handler);
}

/* -------------------------------------------------------------------- hints */
/*
 * One-shot UI hints ("you can pause with Space") earn their pixels only until
 * the player has used the verb they teach. Once used, the hint has done its
 * job and should stop drawing — a tutorial that never leaves is just chrome.
 * Stored per hint id so future hints reuse the same pocket.
 */
const HINT_KEY = "nongtrai.hints";

function hintBag(): Set<string> {
  const raw = read(HINT_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function hintSeen(id: string): boolean {
  return hintBag().has(id);
}

export function markHintSeen(id: string): void {
  const bag = hintBag();
  if (bag.has(id)) return;
  bag.add(id);
  write(HINT_KEY, JSON.stringify([...bag]));
}