/**
 * First-run coach: three steps, each one attached to real state.
 *
 * ## Why this exists
 *
 * A new account opened onto twenty-three identical "Chọn hạt để gieo" tiles. That is the first
 * thing the game ever says, and it says nothing — not what to do, not what it is for, not
 * where the rest of the game lives. Every player had to already know in order to start.
 *
 * ## Why three steps and not a tutorial
 *
 * A modal that interrupts teaches less and annoys more. These sit above the plots as a strip,
 * answer three real questions — how do I grow something, how do I fight, how do I progress —
 * and then get out of the way permanently once all three are true. Nothing is hidden and
 * nothing has to be dismissed: the strip is simply not there any more.
 *
 * ## Why no new state
 *
 * Every step is derived from progress that already exists and is already saved. Adding a
 * "seen the tutorial" flag would mean a save migration, a field that can disagree with the
 * progress it describes, and a player who clears stage 1 by accident still being shown a
 * coach mark. A new player who has already cleared a stage does not need to be told to clear a
 * stage.
 */

import { el } from "../components";
import { store } from "../app";

/** One step, and the state that makes it true. */
export interface CoachStep {
  /** Shown as the step's verb. */
  title: string;
  /** What to do, in the imperative. Short enough to read in a glance. */
  how: string;
  /** Where to go, named the way the player will find it. */
  where: string;
  done: boolean;
}

export function coachSteps(): CoachStep[] {
  const st = store.state;
  return [
    {
      title: "Gieo hạt",
      how: "Chạm một ô đất trống rồi chọn hạt để gieo cây đầu tiên.",
      where: "Ô đất trống trong vườn",
      // The starting account ships with one plant already, so the threshold is two. A player
      // who bought or bred their way to several never sees this step at all.
      done: st.plants.length >= 2,
    },
    {
      title: "Đấu ải đầu tiên",
      how: "Chọn cây mạnh nhất rồi vượt ải 1. Ải mở khoá tuần tự.",
      where: "Tab Đại chiến",
      done: st.ascent.highest >= 1,
    },
    {
      title: "Lên cấp",
      how: "Cấp nhà lai tăng mở thêm loài cây và ô đất. Vượt ải để lên cấp.",
      where: "Màn hình Tiến trình",
      done: st.breederLevel >= 2,
    },
  ];
}

/**
 * Render the strip, or nothing.
 *
 * Returns `null` once every step is true, so the caller can append it unconditionally and the
 * whole thing disappears without a saved flag to clear.
 */
export function coachStrip(): HTMLElement | null {
  const steps = coachSteps();
  if (steps.every((s) => s.done)) return null;

  const firstOpen = steps.find((s) => !s.done);
  const done = steps.filter((s) => s.done).length;

  const root = el("div", { class: "coach" });
  root.setAttribute("role", "note");
  root.setAttribute("aria-label", "Cách chơi: các bước còn lại");

  root.appendChild(
    el("div", { class: "row between" }, [
      el("b", {}, ["Bắt đầu thôi"]),
      // Progress, so a player returning mid-way can see they are not starting over.
      el("span", { class: "tiny muted" }, [`${done}/${steps.length} xong`]),
    ]),
  );

  const list = el("ol", { class: "coach-list" });
  for (const s of steps) {
    const li = el("li", { class: "coach-item" + (s.done ? " done" : "") });
    li.append(
      // A real check for a finished step rather than a dimmed row: the marker is the part that
      // reads at a glance from across the room.
      el("span", { class: "coach-mark" }, [s.done ? "✓" : ""]),
      el("span", { class: "coach-body" }, [
        el("span", { class: "coach-title" }, [s.title]),
        el("span", { class: "coach-how" }, [s.how]),
        el("span", { class: "coach-where" }, [s.where]),
      ]),
    );
    list.appendChild(li);
  }
  root.appendChild(list);

  /*
   * The one step still open gets the pointer.
   *
   * Showing three equally-weighted steps when one is unfinished is how a coach strip becomes
   * wallpaper. Only the next action is marked, and only the next action is worth the player's
   * first click.
   */
  if (firstOpen) {
    root.classList.add("has-next");
    root.setAttribute("data-next", firstOpen.title);
  }

  return root;
}