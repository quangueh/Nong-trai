import "./styles.css";
import { boot } from "./ui/app";
import { sfx } from "./audio/audio";

boot(document.getElementById("app")!);

/**
 * Unlock audio on the first gesture.
 *
 * Browsers refuse to start an AudioContext before one, and the game has no start
 * button to hang this on — the first tap is usually a garden plot. So the unlock
 * goes on the document with `capture`, which fires before any screen handler runs
 * and therefore before the tap that triggered it reaches the game.
 *
 * `once` because after the first gesture there is nothing left to unlock. The
 * listener stays attached to `pointerdown` rather than `click` because on touch
 * devices `click` is delayed by up to 300ms, which would put the first sound
 * noticeably after the action it belongs to.
 */
const unlock = (): void => {
  sfx.unlock();
  document.removeEventListener("pointerdown", unlock, true);
  document.removeEventListener("keydown", unlock, true);
};
document.addEventListener("pointerdown", unlock, true);
document.addEventListener("keydown", unlock, true);

// Browsers suspend audio when a tab is hidden. Without this, returning to the tab
// leaves every later sound silent until something happens to resume the context.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) sfx.suspend();
  else sfx.resume();
});