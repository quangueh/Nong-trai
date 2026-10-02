/** App shell: top bar, screen router, bottom nav. */

import { GameStore, resetSave, xpForLevel, BREEDER_LEVEL_CAP, type Notice } from "../core/store";
import { el, toast, seedIcon } from "./components";
import { renderGarden } from "./screens/garden";
import { renderCollection } from "./screens/collection";
import { renderBreeding } from "./screens/breeding";
import { renderArena, currentBattleView } from "./screens/arena";
import { renderLab } from "./screens/lab";
import { sfx } from "../audio/audio";
import { SPECIES_BY_ID } from "../config/species";

import type { Screen } from "./screens/types";

export const store = new GameStore();

const TABS: { id: Screen; label: string; icon: string }[] = [
  { id: "garden", label: "Vườn", icon: "🌱" },
  { id: "collection", label: "Sưu tầm", icon: "📖" },
  { id: "breeding", label: "Lai tạo", icon: "🧬" },
  { id: "arena", label: "Đại chiến", icon: "⚔️" },
  { id: "lab", label: "Cửa hàng", icon: "🛒" },
];

let levelBadge: HTMLElement | null = null;
let noticeHost: HTMLElement | null = null;

let current: Screen = "garden";
let screenHost: HTMLElement;
let navHost: HTMLElement;
let coinPill: HTMLElement;
let crystalPill: HTMLElement;
let itemPill: HTMLElement;

export function navigate(screen: Screen, params?: unknown) {
  closeOverlays();
  current = screen;
  paint(params);
  for (const b of navHost.querySelectorAll(".navitem")) {
    b.classList.toggle("active", (b as HTMLElement).dataset.screen === screen);
  }
}

/**
 * Sheets and overlays are appended to the shell, not the screen, so a screen
 * change has to tear them down explicitly. Without this a player who opens a
 * plant sheet and then taps a bottom-nav tab is left stuck behind a stuck
 * modal.
 */
function closeOverlays() {
  const shell = document.querySelector(".shell");
  shell?.querySelectorAll(".overlay, .sheet").forEach((n) => n.remove());
}

function paint(params?: unknown) {
  screenHost.replaceChildren();
  const view = {
    garden: renderGarden,
    collection: renderCollection,
    breeding: renderBreeding,
    arena: renderArena,
    lab: renderLab,
  }[current];
  screenHost.appendChild(view(navigate, params));
  updatePills();
}

function updatePills() {
  coinPill.replaceChildren(el("span", {}, ["🪙"]), el("span", { class: "mono" }, [fmtInt(store.state.leafCoin)]));
  crystalPill.replaceChildren(el("span", {}, ["💎"]), el("span", { class: "mono" }, [String(store.state.geneCrystal)]));
  itemPill.replaceChildren(el("span", {}, ["🧺"]), el("span", { class: "mono" }, [String(store.state.items)]));
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

/**
 * Draw the breeder level badge.
 *
 * The bar inside it is XP to the *next* level, not a lifetime bar: a bar that
 * only ever fills and never shows a ceiling tells you nothing about how close
 * you are. At the cap it shows a full bar instead of one that cannot move.
 */
function updateLevelBadge(): void {
  if (!levelBadge) return;
  const level = store.state.breederLevel;
  const capped = level >= BREEDER_LEVEL_CAP;
  // The store's own curve, imported rather than duplicated, so the badge cannot
  // disagree with the amount of XP actually needed to level.
  const need = capped ? 1 : xpForLevel(level);
  const have = capped ? 1 : store.state.breederXp;
  const pct = capped ? 100 : Math.max(0, Math.min(100, (have / Math.max(1, need)) * 100));

  levelBadge.replaceChildren(
    el("span", { class: "levelbadge-num" }, [`${level}`]),
    el("span", { class: "levelbadge-label" }, ["Cấp"]),
    el("span", { class: "levelbadge-bar", role: "progressbar", "aria-valuenow": String(Math.round(pct)) }, [
      el("i", { style: `width:${pct.toFixed(1)}%` }),
    ]),
  );
  levelBadge.title = capped
    ? "Cấp nhà lai tạo tối đa"
    : `Cấp nhà lai tạo ${level} — ${have.toLocaleString("vi-VN")}/${need.toLocaleString("vi-VN")} XP cấp ${level + 1}`;
}

/**
 * How long each notice kind stays up, in milliseconds.
 *
 * The level banner is the longest because it is the one a player might want to
 * read twice — "cấp 14" is also the number gating a hundred species. An unlock
 * is shorter because it is immediately actionable.
 */
const NOTICE_MS: Record<Notice["kind"], number> = {
  level: 4200,
  unlock: 5200,
  goal: 3000,
  plot: 3000,
  milestone: 4000,
};

const NOTICE_SOUND: Partial<Record<Notice["kind"], Parameters<typeof sfx.play>[0]>> = {
  level: "levelUp",
  unlock: "buy",
  goal: "tap",
  plot: "dig",
  milestone: "levelUp",
};

/**
 * Show a notice banner.
 *
 * Each kind gets its own entrance because they mean different things and a
 * single shared slide reads as one undifferentiated event:
 *
 *   level      rises with a spring and a light sweep across the badge, because
 *              the level number itself is what moved
 *   unlock     reveals the plants, staggered, because "you may now buy 40 new
 *              things" means nothing until you see three of them
 *   goal       slides in flat and small, the least urgent of the set
 *
 * Banners stack rather than replace. A level-up fires two notices back to back
 * and a queue that drops the first would show only the consequence, which is the
 * part the player did not cause.
 *
 * Removed on an animation event rather than a timer where possible: a timeout
 * that fires mid-animation leaves a half-faded banner, and the animation can be
 * skipped by the player tapping it away, which the timer cannot know about.
 */
function showNotice(notice: Notice): void {
  if (!noticeHost) return;
  const host = noticeHost;

  const card = el("div", { class: `notice notice-${notice.kind}` });
  card.append(el("div", { class: "notice-title" }, [notice.title]));

  // The body line is only worth printing when there are no chips to carry the
  // names. With chips it says the same three words twice.
  if (notice.body && !(notice.species && notice.species.length > 0)) {
    card.append(el("div", { class: "notice-body" }, [notice.body]));
  }

  if (notice.species && notice.species.length > 0) {
    const row = el("div", { class: "notice-species" });
    notice.species.forEach((id, i) => {
      const chip = el("div", { class: "notice-species-chip", style: `--i:${i}` });
      const icon = el("div", { class: "notice-species-icon" });
      icon.innerHTML = seedIcon(id);
      chip.append(icon, el("div", { class: "notice-species-name" }, [SPECIES_BY_ID[id]?.name ?? id]));
      row.appendChild(chip);
    });
    // "+1.160" on its own line when there is room, beside the chips when there
    // is not. Six thousand unlocked and three shown has to be legible as a fact.
    if (notice.moreCount && notice.moreCount > 0) {
      row.appendChild(
        el("div", { class: "notice-species-more" }, [
          el("b", {}, [`+${notice.moreCount.toLocaleString("vi-VN")}`]),
          el("small", {}, [" loài"]),
        ]),
      );
    }
    card.appendChild(row);
  }

  // Tap to dismiss. Also the escape hatch when the player wants the screen back.
  card.addEventListener("click", () => dismiss());

  host.appendChild(card);
  // Past five the stack becomes a wall; drop the oldest rather than grow forever.
  while (host.children.length > 5) host.firstElementChild?.remove();

  // The entrance class has to land after the node is in the document, or the
  // transition has nothing to transition from.
  requestAnimationFrame(() => card.classList.add("is-in"));

  const life = NOTICE_MS[notice.kind];
  let done = false;
  const timer = setTimeout(() => dismiss(), life);
  // A hidden tab throttles timers, so the banner would sit there when the player
  // came back. The animation-end path is the primary one; this is the backstop.
  function dismiss(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    card.classList.remove("is-in");
    card.classList.add("is-out");
    card.addEventListener("animationend", () => card.remove(), { once: true });
    // If the animation never fires (reduced motion kills it), the node must still
    // go away or it accumulates for the rest of the session.
    setTimeout(() => card.remove(), 600);
  }

  const sound = NOTICE_SOUND[notice.kind];
  if (sound) sfx.play(sound);

  if (notice.kind === "level") {
    levelBadge?.classList.remove("is-levelled");
    // Reflow so the class re-applies when two levels land back to back.
    void levelBadge?.offsetWidth;
    levelBadge?.classList.add("is-levelled");
  }
}

export function boot(root: HTMLElement) {
  const shell = el("div", { class: "shell" });

  // --- top bar ---
  const topbar = el("div", { class: "topbar" });
  const brand = el("div", { class: "brand" });
  brand.append(
    el("div", { class: "logo" }, ["🌿"]),
    el("div", {}, [
      el("div", {}, ["Đại Chiến Cây"]),
      el("small", { class: "tiny" }, ["Đấu Trường Cây Đột Biến"]),
    ]),
  );
  // Breeder level, always on screen.
  //
  // It gates species, plots and the shop tier, and until now the only place it
  // appeared was a footnote on one tab — a number the player had to go looking
  // for, which is not progression feedback. Level and the XP to the next one sit
  // in the top bar so the thing driving every unlock is visible from anywhere.
  levelBadge = el("button", { class: "levelbadge", title: "Cấp nhà lai tạo" });
  levelBadge.addEventListener("click", () => {
    sfx.play("tap");
    navigate("garden");
  });

  coinPill = el("div", { class: "pill coin" });
  crystalPill = el("div", { class: "pill crystal" });
  itemPill = el("div", { class: "pill" });
  const settings = el("button", { class: "btn sm ghost", title: "Cài đặt" }, ["⚙"]);
  settings.addEventListener("click", () => {
    if (sfx.muted) {
      sfx.setMuted(false);
      sfx.play("tap");
      toast("Đã bật âm thanh.");
      return;
    }
    const ok = confirm("Tắt âm thanh? Xoá toàn bộ tiến trình và bắt đầu lại vườn mới?");
    // "Cancel" means keep the sound without throwing the save away — a prompt
    // that offered only "lose everything or nothing" was not a useful question to
    // ask someone who came to turn a sound off.
    if (ok === false) {
      sfx.setMuted(true);
      toast("Đã tắt âm thanh.");
      return;
    }
    sfx.setMuted(true);
    resetSave();
    location.reload();
  });
  topbar.append(levelBadge, brand, coinPill, crystalPill, itemPill, settings);

  /**
   * Interface clicks, delegated.
   *
   * One listener on the document rather than a sound call in every handler: the
   * game has 40-odd buttons across 6 screens, and a per-handler call is 40 places
   * to forget one. Delegation also covers screens rendered after this runs.
   *
   * `pointerdown` rather than `click` — on touch, `click` fires up to 300ms late,
   * which puts the sound after the action instead of on it.
   */
  shell.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      const control = target.closest("button, .navitem, .tab, .chip, .seed-chip, [role='button']");
      if (!control || (control as HTMLButtonElement).disabled) return;
      // Screen changes already have their own, more characterful sounds; a nav tap
      // double-fired as a plain click underneath them.
      if (control.classList.contains("navitem")) return;
      sfx.play("tap");
    },
    true,
  );

  // --- screen ---
  screenHost = el("div", { class: "screen" });

  // --- nav ---
  navHost = el("div", { class: "bottomnav" });
  for (const tab of TABS) {
    const b = el("button", { class: "navitem" + (tab.id === current ? " active" : ""), "data-screen": tab.id });
    b.append(el("span", { class: "ico" }, [tab.icon]), el("span", {}, [tab.label]));
    b.addEventListener("click", () => navigate(tab.id));
    navHost.appendChild(b);
  }

  // Notices live on the shell, never on the screen: the screen re-renders as a
  // direct result of the notice firing, and a banner rebuilt mid-animation
  // flickers instead of arriving.
  noticeHost = el("div", { class: "notice-host", role: "status", "aria-live": "polite" });

  shell.append(topbar, noticeHost, screenHost, navHost);
  root.appendChild(shell);

  store.subscribe(() => {
    updatePills();
    updateLevelBadge();
  });

  store.onNotice(showNotice);
  // Drawn once at boot: the subscription only fires on a change, so without this
  // the badge would be blank until the player happened to gain a coin.
  updateLevelBadge();

  // Dev-only handle for debugging and automated UI smoke tests. Guarded because
  // `import.meta.env` only exists under Vite, not in a plain Node/tsx run.
  const isDev = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  if (isDev && typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__game = {
      store,
      navigate,
      /**
       * The live battle view, when one is running.
       *
       * A getter rather than a captured value: the view is created when a fight
       * starts and torn down when it ends, so a snapshot taken at boot would be
       * permanently null and a test seam that is always null is worse than none.
       */
      get battleView() {
        return currentBattleView();
      },
    };
  }

  // Growth polling.
  setInterval(() => {
    const res = store.tickAll();
    for (const up of res.stageUps) {
      if (up.stage === "mature") {
        toast(`${up.plant.name} đã trưởng thành! Có thể chiến đấu và lai tạo.`, 3200);
        // Growing is a pentatonic ladder, so repeated growth climbs instead of
        // repeating the same note.
        sfx.play("bloom");
      } else {
        toast(`${up.plant.name} lớn lên: ${up.stage}`, 2000);
        sfx.play("sprout");
      }
    }
  }, 2000).unref?.();

  paint();
}
