/** App shell: top bar, screen router, bottom nav. */

import { GameStore, resetSave, type Notice } from "../core/store";
import {
  applyGlass,
  applyMotion,
  glassPref,
  setGlassPref,
  watchSystemMotion,
  watchSystemTransparency,
  motionPref,
  setMotionPref,
  qualityPref,
  setQualityPref,
  applyQuality,
  type GlassPref,
  type MotionPref,
  type QualityPref,
} from "../core/prefs";
import { el, toast, seedIcon, dismissOnEscape } from "./components";
import { icon, type IconName } from "./icons";
import { renderGarden, gardenSidebars } from "./screens/garden";
import { renderCollection } from "./screens/collection";
import { renderBreeding } from "./screens/breeding";
import { renderArena, currentBattleView } from "./screens/arena";
import { renderAscent } from "./screens/ascent";
import { renderLab } from "./screens/lab";
import { renderLeaderboard } from "./leaderboard";
import { sfx } from "../audio/audio";
import { music, type MusicMood } from "../audio/music";
import {
  accountStatus,
  guestChoiceOffered,
  initAccount,
  isSignedIn,
  onAccountStatus,
  push,
  pull,
  resolveGuestChoice,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
} from "../account/sync";
import { showSignInGateIfNeeded } from "./signInGate";

/**
 * Show the sign-in gate, whoever is asking.
 *
 * Exported because signing out has to put the player back in front of it, and the gate is
 * otherwise only ever consulted once — at boot. Without this, "đăng xuất" cleared the
 * session and left the player playing an anonymous garden, and only the *next* reload put
 * the login screen up: which is not what signing out is supposed to do.
 */
export function showGate(): void {
  showSignInGateIfNeeded({
    onEnter: () => {
      // The garden is already rendered underneath; entering is a removal, not a navigation.
      navigate("garden");
    },
  });
}
import { gateState } from "../account/gate";
import { maybeAutoOpenCheckIn } from "./checkin";
import { accountServiceAvailable } from "../account/api";
import { openAccount } from "./accountSheet";
import { SPECIES_BY_ID } from "../config/species";
import { CURRENCIES, compactNumber, viNum, type CurrencyId } from "../core/currency";
import { onSlotChange, restoreActiveAccount } from "../core/saveSlot";
import {
  breederSnapshot,
  milestoneForLevel,
  plantMilestone,
  plantSnapshot,
  xpRemainingText,
  type Milestone,
} from "../progression/levels";

/** The plant-level milestones a grant crossed, for the celebration's reward list. */
function plantMilestonesBetween(from: number, to: number): Milestone[] {
  const out: Milestone[] = [];
  for (let l = Math.max(1, from); l <= Math.min(to, 100); l++) {
    const m = plantMilestone(l);
    if (m.unlocked.length) out.push({ level: l, shelves: [], plots: 0, unlocked: m.unlocked });
  }
  return out;
}
import { celebrateLevelUp, rewardsFromMilestones } from "./fx/levelUp";
import { celebrateExpGain, expGainSound } from "./fx/expGain";
import { markStageUp } from "./fx/gardenFx";

import type { Screen } from "./screens/types";

// Which garden this browser holds, decided *before* the store is constructed.
//
// The store's constructor reads the save, so there is no second chance to be in the
// right slot. Without this, a returning player boots into the anonymous garden, the gate
// lets them straight through on the grace period without a sign-in, and they watch their
// own account's plants get replaced by a stranger's - or their own, one key too late.
restoreActiveAccount();

export const store = new GameStore();

// The slot module announces a change; the store owns the save. One wiring point, so
// neither has to import the other and no call site has to remember to ask for a reload.
onSlotChange(() => store.reload());

/*
 * Five tabs, not seven.
 *
 * Arena, ascent and leaderboard are one verb — "Đấu" — so they share a tab and
 * pick their sub-view in a segmented row inside the screen. The routes stay
 * exactly as they were; `TAB_OF` is what makes a deep link to /ascent light
 * the right dock item rather than leaving the nav unlit.
 */
const TABS: { id: Screen; label: string; icon: IconName }[] = [
  { id: "garden", label: "Vườn", icon: "sprout" },
  { id: "collection", label: "Cây", icon: "trees" },
  { id: "breeding", label: "Lai", icon: "dna" },
  { id: "arena", label: "Đấu", icon: "swords" },
  { id: "lab", label: "Chợ", icon: "bag" },
];

const TAB_OF: Record<Screen, Screen> = {
  garden: "garden",
  collection: "collection",
  breeding: "breeding",
  arena: "arena",
  ascent: "arena",
  leaderboard: "arena",
  lab: "lab",
};

/** The three combat destinations, in the order they appear in the hub. */
const COMBAT_SUBS: { id: Screen; label: string; icon: IconName }[] = [
  { id: "arena", label: "Đấu trường", icon: "swords" },
  { id: "ascent", label: "Vượt ải", icon: "mountain" },
  { id: "leaderboard", label: "Xếp hạng", icon: "trophy" },
];

let levelBadge: HTMLElement | null = null;
let noticeHost: HTMLElement | null = null;

let current: Screen = "garden";
let lastRoute: Screen | null = null;
let screenHost: HTMLElement;
let navHost: HTMLElement;
/** The wide-layout rails beside the screen. Empty panels collapse in CSS. */
let sideLeft: HTMLElement;
let sideRight: HTMLElement;
let emberPill: HTMLElement;
let pairPill: HTMLElement;
/** The last balances updatePills wrote, so it can tell which pill changed. */
let lastBalances: { leafCoin: number; ember: number; nectar: number; pollen: number } | null = null;
let coinPill: HTMLElement;
let crystalPill: HTMLElement;
let itemPill: HTMLElement;

/**
 * How present the bed is on each screen.
 *
 * Only `arena` and `ascent` are `battle`, and both are true fights. Everything else is
 * `calm`, and the two places a player goes to adjust sound are `silent` — the bed changing
 * while someone is changing it is the wrong moment for it to do anything.
 */
const SCREEN_MOOD: Record<string, MusicMood> = {
  arena: "battle",
  ascent: "battle",
  account: "silent",
  settings: "silent",
};

/** The screen the player is looking at — for callers that must not act off-screen. */
export function currentScreen(): Screen {
  return current;
}

export function navigate(screen: Screen, params?: unknown) {
  closeOverlays();
  current = screen;

  /*
   * The music follows the screen.
   *
   * One continuous bed that changes character, rather than a track per screen: switching
   * tracks means a gap or a fade at every tab change, and a player who moves between two tabs
   * hears the transition more than the music. Changing intensity has neither problem, and it
   * means a fight can raise the stakes without the bed ever stopping.
   *
   * A screen not in the table gets `calm`, deliberately: a new screen should have music, and
   * the failure mode of forgetting an entry is silence rather than the wrong mood.
   */
  music.setMood(SCREEN_MOOD[screen] ?? "calm");

  paint(params);
  const tab = TAB_OF[screen] ?? screen;
  for (const b of navHost.querySelectorAll(".navitem")) {
    b.classList.toggle("active", (b as HTMLElement).dataset.screen === tab);
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
    ascent: renderAscent,
    lab: renderLab,
    leaderboard: renderLeaderboard,
  }[current];
  let node = view(navigate, params);
  /*
   * The combat hub: arena, ascent and leaderboard share one dock tab, so any
   * of the three gets a segmented row on top that moves between them without
   * touching the routes themselves. Battle views mount inside the same host,
   * so the row doubles as a visible way back out of a fight.
   */
  if (COMBAT_SUBS.some((s) => s.id === current)) {
    const wrap = el("div", { class: "combat-hub" });
    const seg = el("div", { class: "seg", role: "tablist", "aria-label": "Khu vực chiến đấu" });
    for (const s of COMBAT_SUBS) {
      const b = el("button", {
        class: s.id === current ? "on" : "",
        role: "tab",
        "aria-selected": String(s.id === current),
      });
      b.append(icon(s.icon, 17), s.label);
      b.addEventListener("click", () => {
        if (s.id !== current) navigate(s.id);
      });
      seg.appendChild(b);
    }
    wrap.append(seg, node);
    node = wrap;
  }
  /*
   * A route change gets a soft entrance; a same-route repaint must stay
   * instant. Every care action re-navigates to "garden", so animating those
   * too would make the garden breathe once per watering can — motion that
   * means nothing teaches the eye to ignore motion that does.
   */
  if (current !== lastRoute) node.classList.add("route-enter");
  lastRoute = current;
  screenHost.appendChild(node);

  /*
   * The desktop rails. Only the garden fills them — quests on the left, the
   * day's weather and the seed bag on the right — because it is the screen the
   * player lives on. Everywhere else they stay empty, and `:empty` collapses
   * the column so a narrower screen is not paying rent for space it does not
   * use. Below 1024px the stylesheet hides the panels entirely, so filling
   * them here costs the phone nothing.
   */
  sideLeft?.replaceChildren();
  sideRight?.replaceChildren();
  if (current === "garden" && sideLeft && sideRight) {
    const { left, right } = gardenSidebars(navigate);
    sideLeft.appendChild(left);
    sideRight.appendChild(right);
  }
  /*
   * The leaderboard is a nav tab like every other screen — not a rail fixture,
   * which would cost a column of screen space all day, and not a floating
   * button, which on a wide desktop ended up at the viewport edge far outside
   * the centred shell.
   */
  updatePills();
}

/**
 * Settings sheet: account, sound, and the reset.
 *
 * The reset names what it destroys and refuses to run when an account is signed
 * in without saying so — wiping the local copy of a garden that is also on the
 * server is recoverable, but the player should not have to discover that.
 */
function openSettings(): void {
  const body = el("div", { class: "account" });

  const accountRow = el("button", { class: "account-rowbtn" });
  const paintAccount = (): void => {
    const st = accountStatus();
    accountRow.replaceChildren(
      el("span", { class: "grow" }, [
        el("b", {}, ["Tài khoản"]),
        el("div", { class: "tiny muted" }, [st.email ?? "Chưa đăng nhập — vườn chỉ lưu trên máy này"]),
      ]),
      el("span", { class: "account-chevron" }, ["›"]),
    );
  };
  paintAccount();
  const offAccount = onAccountStatus(paintAccount);
  accountRow.addEventListener("click", () => {
    offAccount();
    close();
    openAccount();
  });

  const soundRow = el("button", { class: "account-rowbtn" });
  const paintSound = (): void => {
    soundRow.replaceChildren(
      el("span", { class: "grow" }, [
        el("b", {}, ["Âm thanh"]),
        el("div", { class: "tiny muted" }, [sfx.muted ? "Đang tắt" : "Đang bật"]),
      ]),
      el("span", { class: "account-chevron" }, [sfx.muted ? "○" : "●"]),
    );
  };
  paintSound();
  soundRow.addEventListener("click", () => {
    sfx.setMuted(!sfx.muted);
    if (!sfx.muted) sfx.play("tap");
    toast(sfx.muted ? "Đã tắt âm thanh." : "Đã bật âm thanh.");
    paintSound();
    // Both sliders caption themselves as "Đang tắt" while muted, so both have to be told about the
    // mute or the three controls disagree about the state of the same thing.
    paintVolume();
    paintMusic();
  });

  const wipe = el("button", { class: "btn ghost wide", style: "margin-top:14px;color:#8a3a2a" }, [
    "Xoá vườn và bắt đầu lại",
  ]);
  wipe.addEventListener("click", () => {
    const signedIn = isSignedIn();
    const extra = signedIn
      ? "\n\nBản trên tài khoản vẫn còn, nên đăng nhập lại là vườn quay lại."
      : "";
    if (!confirm(`Xoá toàn bộ vườn trên máy này? Cây, xu, nhiệm vụ và tiến trình đều mất.${extra}`)) return;
    sfx.setMuted(true);
    resetSave();
    location.reload();
  });

  /**
   * Volume.
   *
   * A slider rather than another on/off row, because "sound" is not a yes/no question: a
   * player who finds the fight effects loud wants them quieter, not gone. Mute stays as its
   * own row above for the player who wants silence.
   *
   * Wired through `sfx.setVolume`, which persists and ramps the live gain. Assigning
   * `sfx.volume` directly would move the handle and change nothing you can hear — which is the
   * specific failure this control is here to not have.
   */
  const volumeWrap = el("div", { class: "account-volume" });
  const volumeLabel = el("span", { class: "tiny muted" }, []);
  const volumeInput = el("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "5",
    class: "volumeslider",
    "aria-label": "Âm lượng hiệu ứng",
  }) as HTMLInputElement;
  const paintVolume = (): void => {
    volumeInput.value = String(Math.round(sfx.volume * 100));
    volumeLabel.textContent = sfx.muted ? "Đang tắt" : `${Math.round(sfx.volume * 100)}%`;
  };
  volumeInput.addEventListener("input", () => {
    // Apply live rather than on release: dragging should be audible as it happens, or the
    // player is adjusting a number rather than a volume.
    sfx.setVolume(Number(volumeInput.value) / 100);
    paintVolume();
  });
  volumeInput.addEventListener("change", () => {
    // One sample at the settled value, so unmuting later has something to come back to.
    sfx.play("tap");
  });
  volumeWrap.append(
    el("div", { class: "row between" }, [el("b", {}, ["Âm lượng hiệu ứng"]), volumeLabel]),
    volumeInput,
  );
  paintVolume();

  /**
   * Music volume, on its own slider.
   *
   * Effects and music are mixed by ear, not by one knob — a player who finds the fight effects
   * loud needs those down without losing the bed, and a player who finds the bed busy needs it
   * down without going silent. One slider forces one of them to give something up.
   *
   * Defaulted below the effects level, because a bed is continuous and an effect is a moment,
   * and at equal level the continuous thing is always the tiring one.
   */
  const musicWrap = el("div", { class: "account-volume" });
  const musicLabel = el("span", { class: "tiny muted" }, []);
  const musicInput = el("input", {
    type: "range",
    min: "0",
    max: "100",
    step: "5",
    class: "volumeslider",
    "aria-label": "Âm lượng nhạc nền",
  }) as HTMLInputElement;
  const paintMusic = (): void => {
    musicInput.value = String(Math.round(sfx.musicVolume * 100));
    musicLabel.textContent = sfx.muted ? "Đang tắt" : `${Math.round(sfx.musicVolume * 100)}%`;
  };
  musicInput.addEventListener("input", () => {
    sfx.setMusicVolume(Number(musicInput.value) / 100);
    paintMusic();
  });
  musicWrap.append(
    el("div", { class: "row between" }, [el("b", {}, ["Âm lượng nhạc nền"]), musicLabel]),
    musicInput,
  );
  paintMusic();

  /**
   * Motion.
   *
   * Three states rather than a switch, because "follow the system" and "no, I want it on"
   * are different answers and a boolean cannot hold both. The label says which one is in
   * force, and naming the current value is the whole difference between a setting the player
   * understands and one they toggle hopefully.
   */
  const MOTION_CYCLE: Array<{ pref: MotionPref; label: string; hint: string }> = [
    { pref: "system", label: "Theo hệ thống", hint: "Tự theo thiết lập của thiết bị." },
    { pref: "full", label: "Đầy đủ", hint: "Luôn có hiệu ứng chuyển động." },
    { pref: "reduce", label: "Giảm chuyển động", hint: "Tắt rung màn hình và các chuyển động lớn." },
  ];
  const motionRow = el("button", { class: "account-rowbtn" });
  const paintMotion = (): void => {
    const cur = MOTION_CYCLE.find((m) => m.pref === motionPref()) ?? MOTION_CYCLE[0];
    motionRow.replaceChildren(
      el("span", { class: "grow" }, [
        el("b", {}, ["Chuyển động"]),
        el("div", { class: "tiny muted" }, [cur.hint]),
      ]),
      el("span", { class: "account-value" }, [cur.label]),
    );
  };
  motionRow.addEventListener("click", () => {
    const now = motionPref();
    const i = MOTION_CYCLE.findIndex((m) => m.pref === now);
    setMotionPref(MOTION_CYCLE[(i + 1) % MOTION_CYCLE.length].pref);
    paintMotion();
    // A confirmation sound rather than a preview of the motion itself: a motion preference
    // read by *moving* things would be the wrong moment to start moving them.
    sfx.play("tap");
    toast(`Chuyển động: ${MOTION_CYCLE[(i + 1) % MOTION_CYCLE.length].label.toLowerCase()}.`);
  });
  paintMotion();

  /**
   * Transparency — the same three-state shape as motion.
   *
   * `solid` is a designed mode, not a degraded one: surfaces go opaque and the
   * border does the separating work that blur was doing, so nothing reads as
   * "the version for people who can't have the nice one".
   */
  const GLASS_CYCLE: Array<{ pref: GlassPref; label: string; hint: string }> = [
    { pref: "system", label: "Theo hệ thống", hint: "Tự theo thiết lập của thiết bị." },
    { pref: "glass", label: "Kính", hint: "Thanh công cụ mờ nổi trên nội dung." },
    { pref: "solid", label: "Đặc", hint: "Nền đặc không mờ — rõ nét trên máy yếu." },
  ];
  const glassRow = el("button", { class: "account-rowbtn" });
  const paintGlass = (): void => {
    const cur = GLASS_CYCLE.find((g) => g.pref === glassPref()) ?? GLASS_CYCLE[0];
    glassRow.replaceChildren(
      el("span", { class: "grow" }, [
        el("b", {}, ["Độ trong suốt"]),
        el("div", { class: "tiny muted" }, [cur.hint]),
      ]),
      el("span", { class: "account-value" }, [cur.label]),
    );
  };
  glassRow.addEventListener("click", () => {
    const i = GLASS_CYCLE.findIndex((g) => g.pref === glassPref());
    const next = GLASS_CYCLE[(i + 1) % GLASS_CYCLE.length];
    setGlassPref(next.pref);
    paintGlass();
    sfx.play("tap");
    toast(`Độ trong suốt: ${next.label.toLowerCase()}.`);
  });
  paintGlass();

  /**
   * Quality — an art budget, not an accessibility mode.
   *
   * "Nhẹ" stops continuous ambient loops (flutter, shimmer, aura) for weak
   * hardware and long sessions. It deliberately does NOT dim the world or
   * strip materials — that answer belongs to "Độ trong suốt", and reduced
   * motion is its own row above.
   */
  const QUALITY_CYCLE: Array<{ pref: QualityPref; label: string; hint: string }> = [
    { pref: "beauty", label: "Đẹp", hint: "Đầy đủ hiệu ứng và chuyển động nền." },
    { pref: "balanced", label: "Cân bằng", hint: "Giữ chất lượng, tiết kiệm pin." },
    { pref: "lite", label: "Nhẹ", hint: "Tắt chuyển động nền — cho máy yếu." },
  ];
  const qualityRow = el("button", { class: "account-rowbtn" });
  const paintQuality = (): void => {
    const cur = QUALITY_CYCLE.find((q) => q.pref === qualityPref()) ?? QUALITY_CYCLE[1];
    qualityRow.replaceChildren(
      el("span", { class: "grow" }, [
        el("b", {}, ["Chất lượng hình ảnh"]),
        el("div", { class: "tiny muted" }, [cur.hint]),
      ]),
      el("span", { class: "account-value" }, [cur.label]),
    );
  };
  qualityRow.addEventListener("click", () => {
    const i = QUALITY_CYCLE.findIndex((q) => q.pref === qualityPref());
    const next = QUALITY_CYCLE[(i + 1) % QUALITY_CYCLE.length];
    setQualityPref(next.pref);
    paintQuality();
    sfx.play("tap");
    toast(`Chất lượng: ${next.label.toLowerCase()}.`);
  });
  paintQuality();

  body.append(accountRow, soundRow, volumeWrap, musicWrap, motionRow, glassRow, qualityRow, wipe);

  const close = (): void => {
    offAccount();
    overlay.remove();
    s.remove();
  };

  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet" });
  s.append(
    el("div", { class: "row between" }, [
      el("h3", { class: "grow" }, ["Cài đặt"]),
      el("button", { class: "btn sm ghost", "aria-label": "Đóng" }, ["✕"]),
    ]),
    body,
  );
  s.querySelector("button")!.addEventListener("click", close);
  overlay.addEventListener("click", close);
  dismissOnEscape(s, close);
  document.querySelector(".shell")!.append(overlay, s);
}

function updatePills() {
  for (const id of ["leafCoin", "ember"] as const) {
    const pill = id === "leafCoin" ? coinPill : emberPill;
    if (pill) pill.classList.remove("bump");
  }
  coinPill.replaceChildren(el("span", {}, ["🪙"]), el("span", { class: "mono" }, [compactNumber(store.state.leafCoin)]));
  emberPill.replaceChildren(el("span", {}, ["🔥"]), el("span", { class: "mono" }, [compactNumber(store.state.ember)]));
  pairPill.replaceChildren(
    el("span", {}, ["🍯"]),
    el("span", { class: "mono" }, [compactNumber(store.state.nectar)]),
    el("span", { class: "pair-sep" }, ["/"]),
    el("span", {}, ["🌼"]),
    el("span", { class: "mono" }, [compactNumber(store.state.pollen)]),
  );

  // A brief lift on the pill that changed, so earning a currency is felt rather than
  // read. Skipped on the first call, when there is no previous value to compare against.
  if (lastBalances) {
    for (const [id, pill] of [["leafCoin", coinPill], ["ember", emberPill]] as const) {
      if (lastBalances[id] !== store.state[id]) {
        pill.classList.remove("bump");
        // Reflow, so removing and re-adding restarts the animation rather than being
        // coalesced away.
        void pill.offsetWidth;
        pill.classList.add("bump");
      }
    }
  }
  lastBalances = { leafCoin: store.state.leafCoin, ember: store.state.ember, nectar: store.state.nectar, pollen: store.state.pollen };
  crystalPill.replaceChildren(el("span", {}, ["💎"]), el("span", { class: "mono" }, [String(store.state.geneCrystal)]));
  itemPill.replaceChildren(el("span", {}, ["🧺"]), el("span", { class: "mono" }, [String(store.state.items)]));
}

function fmtInt(n: number): string {
  return viNum(Math.round(n));
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
  const snap = breederSnapshot(store.state.breederLevel, store.state.breederXp);

  /*
   * The XP figures are on the badge, not only in its tooltip.
   *
   * They used to exist only as the `title` attribute, which is a hover target — invisible on
   * a phone entirely, since tapping a button does not hover it. So the one screen that
   * shows progression showed a bare integer and a 3px bar, and a player could not tell
   * whether they were a tenth or nine tenths of the way to the next level.
   *
   * `aria-valuenow` is on the bar so the whole badge reads as one progress control to a
   * screen reader rather than three loose numbers.
   */
  levelBadge.replaceChildren(
    el("span", { class: "levelbadge-num" }, [`${snap.level}`]),
    el("span", { class: "levelbadge-label" }, ["Cấp"]),
    el(
      "span",
      {
        class: "levelbadge-bar",
        role: "progressbar",
        "aria-valuenow": String(Math.round(snap.pct)),
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-label": `Cấp ${snap.level}, ${xpRemainingText(snap)}`,
      },
      [el("i", { style: `transform:scaleX(${(snap.pct / 100).toFixed(3)})` })],
    ),
    el("span", { class: "levelbadge-xp mono" }, [
      snap.capped
        ? "MAX"
        : `${viNum(Math.round(snap.xp))} / ${viNum(Math.round(snap.need))}`,
    ]),
  );
  levelBadge.title = snap.capped
    ? "Cấp nhà lai tạo tối đa"
    : `Cấp nhà lai tạo ${snap.level} — ${viNum(Math.round(snap.xp))}/${viNum(Math.round(snap.need))} EXP cấp ${snap.level + 1}`;
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
  quest: 3200,
  plot: 3000,
  milestone: 4000,
  warn: 6000,
};

const NOTICE_SOUND: Partial<Record<Notice["kind"], Parameters<typeof sfx.play>[0]>> = {
  level: "levelUp",
  unlock: "buy",
  quest: "questProgress",
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
/**
 * Cards on screen, by dedup key. A burst of ticks on one quest refreshes its
 * banner in place instead of stacking identical cards over the garden.
 */
const liveNotices = new Map<string, { card: HTMLElement; refresh: (n: Notice) => void; dismiss: () => void }>();

function showNotice(notice: Notice): void {
  if (!noticeHost) return;
  const host = noticeHost;

  /* Level-ups carry no key of their own — each is a distinct event — but a
     reward that levels five plants at once should be one banner that counts,
     not five cards walling off the garden. The modal queue still plays each
     celebration in full; the banner is only the ambient ping. */
  const key = notice.key ?? (notice.levelUp ? "lvlup" : undefined);
  if (key) {
    const live = liveNotices.get(key);
    if (live && live.card.isConnected) {
      live.refresh(notice);
      return;
    }
    liveNotices.delete(key);
    /* A completion retires the same quest's in-progress banner — "928/10000"
       hanging on under "Hoàn thành!" is last tick's news. */
    if (key.startsWith("quest-done:")) {
      const progress = liveNotices.get(`quest:${key.slice(11)}`);
      if (progress && progress.card.isConnected) progress.dismiss();
    }
  }

  const card = el("div", { class: `notice notice-${notice.kind}` });
  const titleEl = el("div", { class: "notice-title" }, [notice.title]);
  card.append(titleEl);

  // The body line is only worth printing when there are no chips to carry the
  // names. With chips it says the same three words twice.
  let bodyEl: HTMLElement | null = null;
  if (notice.body && !(notice.species && notice.species.length > 0)) {
    bodyEl = el("div", { class: "notice-body" }, [notice.body]);
    card.append(bodyEl);
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
          el("b", {}, [`+${viNum(notice.moreCount)}`]),
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
  let timer = setTimeout(() => dismiss(), life);
  // A hidden tab throttles timers, so the banner would sit there when the player
  // came back. The animation-end path is the primary one; this is the backstop.
  function dismiss(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (key) liveNotices.delete(key);
    card.classList.remove("is-in");
    card.classList.add("is-out");
    card.addEventListener("animationend", () => card.remove(), { once: true });
    // If the animation never fires (reduced motion kills it), the node must still
    // go away or it accumulates for the rest of the session.
    setTimeout(() => card.remove(), 600);
  }

  /*
   * A keyed notice that is already on screen refreshes rather than duplicates:
   * the body line moves to the new value, the life timer restarts so the player
   * can still read it, and a small pulse marks that something changed — the same
   * information a second card would have carried, without the pile.
   */
  if (key) {
    let merged = 0;
    liveNotices.set(key, {
      card,
      dismiss,
      refresh(next) {
        if (done || !card.isConnected) return;
        /* A level-up refresh shows the newest subject and how many more the
           same banner has absorbed — "X lên cấp 2 · +2 nữa". */
        if (next.levelUp) {
          merged += 1;
          titleEl.textContent = next.title;
          if (bodyEl) bodyEl.textContent = `${next.body ?? ""}${merged > 0 ? ` · +${merged} nữa` : ""}`;
        } else if (bodyEl && next.body) {
          bodyEl.textContent = next.body;
        }
        clearTimeout(timer);
        timer = setTimeout(() => dismiss(), life);
        card.classList.remove("is-bump");
        void card.offsetWidth;
        card.classList.add("is-bump");
      },
    });
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

  /*
   * Transparency lands before first paint so a `solid` player never sees the
   * shell flash translucent. The OS watch only matters while the pref is
   * `system`, and `applyGlass` resolves that itself.
   */
  applyGlass();
  applyMotion();
  applyQuality();
  watchSystemTransparency(applyGlass);
  watchSystemMotion(applyMotion);

  /*
   * Hover, in one listener rather than one per button.
   *
   * There are hundreds of buttons in a session and they are created and destroyed constantly, so
   * a listener on each is the same mistake as rebuilding the skill bar ten times a second.
   *
   * `relatedTarget` is what makes this correct rather than merely quiet: when the pointer moves
   * from a button onto a label *inside* that button, the browser fires another `pointerover`
   * whose `relatedTarget` is inside the same control. That is not the player arriving at a
   * new control and does not get a sound — without this check, hovering any button with text
   * fires two ticks instead of one.
   *
   * Delegated to `root` and gated on the pointer actually having moved, so a scroll-driven
   * reflow under a stationary pointer does not tick either.
   */
  let lastHover: Element | null = null;
  root.addEventListener("pointerover", (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType && e.pointerType !== "mouse") return;
    const t = e.target as Element | null;
    const control = t?.closest("button, .tab, .navitem, .wideaction, .plot, .chip");
    if (!control) return;
    if (control === lastHover) return;
    const from = e.relatedTarget as Node | null;
    if (from && control.contains(from)) return;
    lastHover = control;
    sfx.play("hover");
  });
  // `pointerout` to the void clears it, so coming back to a control is a fresh arrival.
  root.addEventListener("pointerout", (ev) => {
    const e = ev as PointerEvent;
    const from = e.target as Element | null;
    if (!from?.closest("button, .tab, .navitem, .wideaction, .plot, .chip")) return;
    if (lastHover && !lastHover.contains(e.relatedTarget as Node | null)) lastHover = null;
  });

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
  crystalPill = el("div", { class: "pill crystal material" });
  /**
     * Gene crystals and supplies are care *materials*, not shop currencies. They are the
     * two pills the narrow layout drops, because each is already printed as a cost on the
     * action that spends it.
     */
    itemPill = el("div", { class: "pill material" });
  emberPill = el("div", { class: "pill ember", title: "Mảnh lửa — rớt khi đấu, tối đa 3 mỗi ngày" });
  /** Nectar and Pollen share one pill, because seven pills do not fit a phone. */
  pairPill = el("div", { class: "pill pair", title: "Mật ong và Phấn hoa — bấm để xem nguồn" });
  /**
   * Settings.
   *
   * This used to be a single button whose first tap decided whether you wanted
   * sound, and whose confirmation prompt then offered only "lose everything or
   * nothing" — so the destructive path was one tap from the mute, and cancelling
   * it turned the sound off as a side effect. Both rows are separate now: account,
   * sound, and a wipe that says plainly what it erases.
   */
  const settings = el("button", { class: "iconbtn", title: "Cài đặt", "aria-label": "Cài đặt" }, [
    icon("gear", 20),
  ]);
  settings.addEventListener("click", () => {
    sfx.play("tap");
    openSettings();
  });
  /**
   * The currency pills sit in their own scroller, between the brand and the
   * settings gear. A full late-game wallet (coin + ember + the nectar/pollen
   * pair) is wider than a phone minus level badge and gear, and the gear used
   * to be the thing that paid for it — pushed past the right edge and clipped
   * by the shell's overflow:hidden, unreachable on every screen. Scrolling the
   * pill cluster keeps the gear pinned; the balances swipe under it.
   */
  const toppills = el("div", { class: "toppills" });
  toppills.append(coinPill, emberPill, pairPill, crystalPill, itemPill);
  topbar.append(levelBadge, brand, toppills, settings);

  // Tapping the shared pill says what each half is for and where it comes from, since a
  // two-number pill is not self-explanatory and the shop's cards now name currencies.
  pairPill.addEventListener("click", () => {
    const rows = CURRENCIES.filter((c) => c.id === "nectar" || c.id === "pollen").map(
      (c) => `${c.icon} ${c.name}: ${fmtInt(store.state[c.id as CurrencyId])} — ${c.source}`,
    );
    toast(rows.join("  ·  "), 4200);
  });

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

  /*
   * The workspace: screen plus two side panels in a flex row.
   *
   * At phone widths this is indistinguishable from the old direct append —
   * the panels are `display:none` and the screen takes the whole row. At
   * 1024px and up the shell widens and the rails open, which is what makes
   * the desktop layout a game screen rather than a stretched phone.
   */
  sideLeft = el("aside", { class: "side-panel left", "aria-label": "Nhiệm vụ" });
  sideRight = el("aside", { class: "side-panel right", "aria-label": "Túi hạt và thời tiết" });
  const workspace = el("div", { class: "workspace" }, [sideLeft, screenHost, sideRight]);

  // --- nav ---
  navHost = el("div", { class: "bottomnav" });
  // Published so the stylesheet can size its columns from the tab count. Hard-coding the
  // number in CSS meant adding a sixth screen left the nav one column short, which put the
  // last item on a second row with no indication of it in either file.
  navHost.style.setProperty("--tab-count", String(TABS.length));
  for (const tab of TABS) {
    const b = el("button", {
      class: "navitem" + (tab.id === (TAB_OF[current] ?? current) ? " active" : ""),
      "data-screen": tab.id,
    });
    b.append(el("span", { class: "ico" }, [icon(tab.icon)]), el("span", {}, [tab.label]));
    b.addEventListener("click", () => navigate(tab.id));
    navHost.appendChild(b);
  }

  // Notices live on the shell, never on the screen: the screen re-renders as a
  // direct result of the notice firing, and a banner rebuilt mid-animation
  // flickers instead of arriving.
  noticeHost = el("div", { class: "notice-host", role: "status", "aria-live": "polite" });

  shell.append(topbar, noticeHost, workspace, navHost);
  root.appendChild(shell);

  store.subscribe(() => {
    updatePills();
    updateLevelBadge();
  });

  /*
   * Level notices become a celebration; everything else stays a banner.
   *
   * The split is the point. An unlock, a quest or a plot is a different kind of fact and
   * reads fine as a banner — so promoting those to full-screen celebrations would train the
   * player to dismiss them without reading, and the one that matters (a level going up) would
   * be one banner among many. Only a level is celebrated.
   *
   * Serialised, because a stage clear can cross three levels and three celebrations stacking
   * on one another is the single most reliable way to make a reward feel cheap.
   *
   * Queued, not dropped: the celebration that arrived while one was on screen used to be
   * discarded outright — the level went up, the banner said so, and the modal that owes the
   * player the new unlocks never came. And held, not just queued: a fusion ceremony or a
   * stage-result overlay is already the screen's event, so a level-up fired mid-ceremony
   * waits for the stage to clear rather than covering the thing the player is watching.
   */
  let celebrating = false;
  const levelUpQueue: Array<() => void> = [];
  let queuePoll: number | undefined;

  const celebrationBlocked = (): boolean =>
    Boolean(document.querySelector(".fusion-overlay, .breed-report, .stagelive, .fight-live"));

  const pumpLevelUps = (): void => {
    if (celebrating || celebrationBlocked() || levelUpQueue.length === 0) {
      // A blocker is transient — poll it away rather than hanging a listener off
      // every overlay that could be up. The interval stops when the queue drains.
      if (levelUpQueue.length > 0 && queuePoll == null) {
        queuePoll = window.setInterval(() => {
          if (levelUpQueue.length === 0) {
            window.clearInterval(queuePoll!);
            queuePoll = undefined;
            return;
          }
          pumpLevelUps();
        }, 400);
      }
      return;
    }
    const next = levelUpQueue.shift()!;
    celebrating = true;
    /*
     * Deferred one frame: the notice fires synchronously inside the action that
     * earned it (breed, settle), and the ceremony that should hold it mounts in
     * the same tick — a pump that checked only now would start the celebration
     * just before the overlay it was meant to wait for exists. The re-check on
     * the frame catches the mount and hands the job back to the queue.
     */
    requestAnimationFrame(() => {
      if (celebrationBlocked()) {
        celebrating = false;
        levelUpQueue.unshift(next);
        pumpLevelUps();
        return;
      }
      next();
    });
  };

  /*
   * Held notices.
   *
   * A notice marked `hold` announces an outcome that an on-screen ceremony is
   * already showing — the stage result pushed the moment `runAscentStage`
   * settles, while the replay it describes is still swinging. Showing it then
   * spoils the fight. These wait in a queue until no `.fight-live` card is up,
   * then land as the receipt on the ladder — after the result overlay has had
   * its say, not instead of it.
   */
  const heldNotices: Notice[] = [];
  let holdTimer: number | undefined;
  const fightShowing = (): boolean => Boolean(document.querySelector(".fight-live"));
  const flushHeld = (): void => {
    if (fightShowing()) return;
    window.clearInterval(holdTimer);
    holdTimer = undefined;
    for (const n of heldNotices.splice(0)) routeNotice(n);
  };
  const routeNotice = (notice: Notice): void => {
    showNotice(notice);
    if (!notice.levelUp) return;

    const info = notice.levelUp;
    const plant = info.subjectId ? store.get(info.subjectId) : undefined;
    const isPlant = info.subject === "plant" && plant !== undefined;
    const snap = isPlant
      ? plantSnapshot(plant)
      : {
          level: info.level,
          xp: info.xpAfter,
          need: info.needAfter,
          pct: info.needAfter > 0 ? Math.min(100, (info.xpAfter / info.needAfter) * 100) : 100,
          capped: info.capped,
        };

    /*
     * Rewards come from the right table for the subject.
     *
     * A plant leveling and an account leveling are different progressions with different
     * rewards: one raises potential caps and can cross a combat tier, the other opens shop
     * shelves. Deriving both from `milestoneForLevel` had a plant levelling announce "kệ cấp
     * III", which is not true and which the shop would then contradict.
     *
     * The plant's levels are recovered from `level - levelsGained + 1`, because the notice
     * carries where it ended and how many it crossed. That is exact, not a guess: the store
     * walked them in order.
     */
    const milestones = isPlant
      ? plantMilestonesBetween(info.level - info.levelsGained + 1, info.level)
      : info.crossed.map((level) => milestoneForLevel(level));
    const rewards = rewardsFromMilestones(milestones);

    levelUpQueue.push(() => {
      void celebrateLevelUp({
        level: info.level,
        levelsGained: info.levelsGained,
        subject: info.subjectName,
        subjectIcon: info.subject === "plant" ? "🌱" : "🧑‍🌾",
        expGained: info.expGained,
        after: snap,
        rewards,
      }).then(() => {
        celebrating = false;
        pumpLevelUps();
      });
    });
    pumpLevelUps();
  };

  store.onNotice((notice) => {
    if (notice.hold && fightShowing()) {
      heldNotices.push(notice);
      if (holdTimer == null) holdTimer = window.setInterval(flushHeld, 400);
      return;
    }
    routeNotice(notice);
  });
  // Drawn once at boot: the subscription only fires on a change, so without this
  // the badge would be blank until the player happened to gain a coin.
  updateLevelBadge();

  // Dev-only handle for debugging and automated UI smoke tests. Guarded because
  // `import.meta.env` only exists under Vite, not in a plain Node/tsx run.
  /* Dev builds and `--mode test` preview builds both expose the seam — the
     test build is what performance suites measure (spec: numbers come from a
     production transform, not the dev transform); real production builds keep
     it stripped. */
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
  const isDev = typeof import.meta !== "undefined" && (env?.DEV === true || env?.MODE === "test");
  if (isDev && typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__game = {
      store,
      navigate,
      /**
       * The audio engine and the music bed, for tests.
       *
       * Both are reachable through the module graph but not from a page script, and without
       * them the only way to find out whether a sound played is to listen to it — which an
       * automated run cannot do. Exposing them lets a test wrap `play` and record what was
       * asked for, which is the difference between checking the game *requested* a level-up
       * sound and inferring it from a screenshot.
       *
       * Read these; do not rewire them.
       */
      sfx,
      music,
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
      /**
       * Sign-out, for tests.
       *
       * Exposed because clearing storage by hand would pass even if `signOut` forgot to
       * clear something — and the thing it must clear that matters most, the save slot, is
       * exactly the thing a hand-cleared test would miss.
       */
      signOut,
      /**
       * The raw sign-in functions, for tests.
       *
       * Google needs a real popup and a real account, so an automated test cannot drive
       * the whole flow through the browser. What it *can* drive is everything after the
       * token arrives — the Worker exchange, the save-slot switch, the pull, the teardown —
       * and that is where the save-destroying bugs lived. Reaching them through the public
       * module means the test exercises the same code the panel does rather than a
       * reimplementation of it, which would agree with itself forever.
       */
      sync: { signInWithGoogle, signIn, signUp, pull, push, resolveGuestChoice, guestChoiceOffered, accountStatus },
      /**
       * The experience-gain animation, for tests.
       *
       * Exposed because this is the one effect a test cannot reach through the game: the
       * real callers are a fifteen-second stage fight and a care sheet, and an animation that
       * lives about a second cannot be sampled reliably through either. Reaching it directly
       * means the suite exercises the same function the UI calls rather than a copy.
       */
      expGain: { celebrateExpGain, expGainSound },
      /** Whether the gate currently admits the player, and why. */
      authState: () => gateState(accountServiceAvailable),
      /** Sign out *and* put the player back in front of the login screen. Resolves when done. */
      signOutAndGate: async () => {
        // Awaited, because a gate raised before the token is gone stands itself down.
        // The previous version slept 400ms and hoped; the final push this waits on has an
        // 8s abort, so on any ordinary connection the hope failed silently and the player
        // stayed in the game, signed in, having pressed "đăng xuất".
        await signOut();
        showGate();
      },
    };
  }

  // The account layer reads and writes through the store, so it starts only once
  // the store exists. Running it earlier would find nothing to sync.
  initAccount({
    read: () => ({ state: store.exportState(), savedAt: store.savedAt }),
    /*
     * The server's timestamp goes in with the data, not `Date.now()`.
     *
     * `importState` needs it for two reasons that both bite on a second device: it writes
     * the pulled save to the slot so a reload finds it, and it must stamp it with the
     * server's own time or this device will believe it is newer than the cloud and refuse
     * every later sync as a conflict. See `importState`.
     */
    write: (next, savedAt) => {
      store.importState(next, savedAt);
    },
    // The in-game name lives inside the save, so renaming is a store mutation —
    // the sync layer turns it into a push, and the Worker repoints the
    // leaderboard and friend indexes from the same payload.
    renamePlayer: (name) => store.renamePlayer(name),
  });

  /*
   * The sign-in gate, before the first paint.
   *
   * Shown when there is no usable session and a Worker to authenticate against; it
   * stands down otherwise, including when no Worker is configured at all. Decided by the
   * gate rather than here, so the rule lives in one place instead of being a condition
   * someone has to remember to add.
   */
  showSignInGateIfNeeded({
    onEnter: () => {
      // The garden renders underneath the gate from the start, so entering is a removal
      // rather than a navigation. Re-rendering would throw away whatever the tick loop
      // has already done in the seconds the gate was up.
    },
  });

  /*
   * The hired gardener. Two parts:
   *
   * 1. Catch-up: `lastSeen` is the moment the save was last written — before
   *    close, by definition — so replaying buff ticks from then until now pays
   *    exactly the rounds that ran while the app was shut.
   * 2. The live tick: one round per AUTO interval while the buff is up, riding
   *    the existing growth poll rather than adding a timer of its own.
   */
  maybeAutoOpenCheckIn();

  // Growth polling.
  let lastAutoTick = 0;
  setInterval(() => {
    const now = Date.now();
    if (now - lastAutoTick >= 12_000) {
      lastAutoTick = now;
      store.autoCareTick(now);
    }
    const res = store.tickAll();
    for (const up of res.stageUps) {
      // Mark first, so the garden repaint the toast triggers below arrives
      // with the stage-pop waiting on the new card.
      markStageUp(up.plant.plantId);
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
    // A stage that turns over while the garden is on screen repaints it, so
    // the new stage art and the pop arrive without waiting for a tap.
    if (res.stageUps.length && current === "garden") paint();
  }, 2000).unref?.();

  paint();

  /*
   * Catch-up must run after the first paint: the Gardener actor mounts with
   * the garden and is the only subscriber to these work events. Firing them
   * before it exists published them to zero listeners — the whole overnight
   * summary and its one allowed illustration silently vanished.
   */
  store.autoCareCatchUp(store.state.lastSeen);
}
