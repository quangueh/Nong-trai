import "./styles.css";
// The level-up celebration. Its own file because it is the only thing in the game built
// around an animation rather than a layout, and 400 lines of keyframes inside the
// main sheet is how a stylesheet stops being readable.
import "./ui/fx/levelUp.css";
import "./ui/fx/levelStrip.css";
import "./ui/fx/stageOverlay.css";
// Garden feel: watering, stage pops, unlock veils and reward flights. Own file
// for the same reason as the level-up celebration — it is animation, not layout.
import "./ui/fx/gardenFx.css";
import { boot } from "./ui/app";
import { sfx } from "./audio/audio";
import { music } from "./audio/music";

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
  /*
   * The bed starts here, and not one line earlier.
   *
   * Browsers refuse to run an AudioContext before a gesture, and scheduling notes into a
   * suspended context means every one of them is queued and delivered at once the moment it
   * resumes — which is not music, it is a chord. So the bed waits for exactly the same gesture
   * that unlocks the context, and the two are started together.
   *
   * A no-op if audio is unavailable or the context is still suspended; the bed checks for
   * itself and does nothing rather than queueing.
   */
  music.start();
  document.removeEventListener("pointerdown", unlock, true);
  document.removeEventListener("keydown", unlock, true);
};
document.addEventListener("pointerdown", unlock, true);
document.addEventListener("keydown", unlock, true);

// Browsers suspend audio when a tab is hidden. Without this, returning to the tab
// leaves every later sound silent until something happens to resume the context.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    /*
     * Stop scheduling, and not just suspend.
     *
     * Suspending the context pauses the audio clock, so a scheduler that kept running would
     * fill its lookahead with notes that all land at once when the player comes back. Stopping
     * is what makes the return sound like the game picked up where it was.
     */
    music.stop();
    sfx.suspend();
  } else {
    sfx.resume();
    // Only if a gesture ever unlocked audio in the first place; `start` is a no-op otherwise.
    if (sfx.available) music.start();
  }
});