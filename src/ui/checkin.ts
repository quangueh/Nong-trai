/**
 * Check-in UI — the attendance sheet plus the gardener row that sits under the
 * garden's quest tracker.
 *
 * `gardenerRow` is the always-on strip: điểm danh on the left, the hired
 * gardener on the right. `openCheckInSheet` is the daily ritual itself. The
 * ad button only exists when a rewarded network is configured (or in dev,
 * where a labelled simulation stands in) — a button that can never pay is a
 * promise the game should not print.
 */

import { el, toast, sheet } from "./components";
import { sfx } from "../audio/audio";
import { store, currentScreen } from "./app";
import { dayKey } from "../core/store";
import { giftFor, dayInCycle, MILESTONE_DAYS, type GiftLine } from "../core/checkin";
import { currencyInfo } from "../core/currency";
import { SPECIES_BY_ID } from "../config/species";
import { adsConfigured, showRewardedAd } from "../ads/ads";

/** Milliseconds of buff one claim or one ad buys. */
const BUFF_MINUTES = 15;

/** Render one gift line as the sheet prints it. */
function giftLabel(line: GiftLine): string {
  if (line.kind === "autocare") return `🤖 Người làm vườn ×${line.amount} phút`;
  if (line.kind === "items") return `🧰 Vật tư ×${line.amount}`;
  if (line.kind === "crystal") return `💎 GeneCrystal ×${line.amount}`;
  if (line.kind === "seed" && line.species) {
    const def = SPECIES_BY_ID[line.species];
    return `🌱 Hạt ${def?.name ?? line.species} ×${line.amount}`;
  }
  if (line.kind === "currency" && line.currency) {
    const c = currencyInfo(line.currency);
    return `${c.icon} ${c.name} ×${line.amount.toLocaleString("vi-VN")}`;
  }
  return "🎁 Quà";
}

/**
 * The 30-day strip: every cell a day of the cycle, milestones crowned, the
 * claimed days filled. Drawn inside the sheet, so it costs nothing on the
 * garden screen itself.
 */
function milestoneStrip(claimStreak: number, claimedToday: boolean): HTMLElement {
  const strip = el("div", { class: "ci-strip", role: "img", "aria-label": `Chuỗi ${claimStreak} ngày trong chu kỳ 30` });
  const day = dayInCycle(claimStreak);
  // The strip shows the cycle the streak is currently inside.
  const cycleBase = claimStreak - day;
  for (let i = 1; i <= 30; i++) {
    const absolute = cycleBase + i;
    const done = absolute < claimStreak || (absolute === claimStreak && claimedToday);
    const cell = el("span", {
      class: "ci-day" + (done ? " done" : "") + (absolute === claimStreak ? " today" : "") + ((MILESTONE_DAYS as readonly number[]).includes(i) ? " ms" : ""),
      title: (MILESTONE_DAYS as readonly number[]).includes(i) ? `Ngày ${i}: rương đặc biệt` : `Ngày ${i}`,
    }, [(MILESTONE_DAYS as readonly number[]).includes(i) ? "🎁" : String(i)]);
    strip.appendChild(cell);
  }
  return strip;
}

/** The attendance sheet — open it from the row, or once a day on boot. */
export function openCheckInSheet(onDone?: () => void): void {
  const content = el("div", { class: "ci-sheet" });
  const shell = document.querySelector(".shell") ?? document.body;
  const { overlay, sheet: s } = sheet(content, () => close());
  function close(): void {
    overlay.remove();
    s.remove();
    onDone?.();
  }

  const status = store.checkInStatus();
  const gift = giftFor(store.state.playerId, todayKey(), status.claimStreak);

  content.appendChild(el("h3", { class: "ci-title" }, ["📅 Điểm danh"]));
  content.appendChild(
    el("div", { class: "ci-streak" }, [
      el("span", { class: "ci-flame" }, ["🔥"]),
      el("b", {}, [`${status.claimStreak} ngày liên tiếp`]),
      status.streak > 0 ? el("span", { class: "muted small" }, [`kỷ lục ${Math.max(store.state.checkIn.best, status.claimStreak)}`]) : null,
    ]),
  );
  content.appendChild(milestoneStrip(status.claimStreak, status.claimed));

  // What today pays — deterministic, so the preview is the truth, not a tease.
  const list = el("div", { class: "ci-gifts" + (gift.milestone ? " vip" : "") });
  if (gift.milestone) list.appendChild(el("div", { class: "ci-vip-tag" }, [`✨ RƯƠNG MỐC ${gift.dayInCycle} NGÀY`]));
  for (const line of gift.lines) {
    list.appendChild(el("div", { class: "ci-gift" }, [giftLabel(line)]));
  }
  content.appendChild(list);

  if (status.claimed) {
    content.appendChild(el("div", { class: "ci-claimed muted" }, ["Đã điểm danh hôm nay — quay lại vào ngày mai nhé."]));
    const b = el("button", { class: "btn ghost" }, ["Đóng"]);
    b.addEventListener("click", close);
    content.appendChild(b);
  } else {
    const b = el("button", { class: "btn primary ci-claim" }, [status.claimStreak === 1 && status.streak > 0 ? "Điểm danh — bắt đầu chuỗi mới" : "Điểm danh"]);
    b.addEventListener("click", () => {
      const res = store.claimCheckIn();
      if (!res.ok || !res.gift) {
        toast(res.reason ?? "Chưa điểm danh được");
        return;
      }
      sfx.play("reward");
      // Swap the sheet to the reward readout rather than closing outright —
      // a claim that vanishes in a blink reads as nothing happening.
      content.replaceChildren();
      content.appendChild(el("h3", { class: "ci-title" }, [res.gift.milestone ? "🎁 Rương mốc mở ra!" : "🎉 Điểm danh thành công!"]));
      content.appendChild(el("div", { class: "ci-streak" }, [el("span", { class: "ci-flame" }, ["🔥"]), el("b", {}, [`Chuỗi ${res.gift.streak} ngày`])]));
      content.appendChild(milestoneStrip(res.gift.streak, true));
      const got = el("div", { class: "ci-gifts" + (res.gift.milestone ? " vip" : "") });
      for (const line of res.gift.lines) got.appendChild(el("div", { class: "ci-gift pop" }, [giftLabel(line)]));
      content.appendChild(got);
      const done = el("button", { class: "btn primary" }, ["Tuyệt vời"]);
      done.addEventListener("click", close);
      content.appendChild(done);
    });
    content.appendChild(b);
    content.appendChild(el("div", { class: "muted small", style: "margin-top:8px;text-align:center" }, ["Mỗi ngày một đặc ân ngẫu nhiên + 15 phút người làm vườn. Quà mốc 7/14/21/30 ngày càng lớn — đừng đứt chuỗi!"]));
  }

  shell.append(overlay, s);
}

/**
 * Open the sheet once per session per day — the habit nudge, not a nag.
 *
 * Polled rather than immediate: at boot the sign-in gate can still be up, and a
 * sheet that lands on top of a gate traps the "chơi không cần tài khoản" tap
 * behind two overlays. Wait for a clear deck, briefly — a gate that stays up
 * for half a minute wins, and the nudge yields rather than fights for focus.
 */
export function maybeAutoOpenCheckIn(): void {
  const flag = `ci-shown:${todayKey()}`;
  let tries = 12;
  const attempt = (): void => {
    if (tries-- <= 0) return;
    if (store.checkInStatus().claimed) return;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      /* private mode: treat as unset */
    }
    // Any overlay on screen — sign-in gate, another sheet, a battle overlay —
    // wins the right to stay on top.
    if (document.querySelector(".overlay, .sheet, .gate-skip")) {
      window.setTimeout(attempt, 2500);
      return;
    }
    // And only on the garden: a fight mounts inside the screen host rather
    // than an overlay, so the overlay check alone let the sheet land on top
    // of a live battle — modal over combat, intercepting taps and blurring
    // the whole scene behind it. Off-garden means retry until a garden paint
    // or the attempt budget runs out.
    if (currentScreen() !== "garden") {
      window.setTimeout(attempt, 2500);
      return;
    }
    try {
      sessionStorage.setItem(flag, "1");
    } catch {
      /* flag storage failing still allows the sheet */
    }
    openCheckInSheet();
  };
  window.setTimeout(attempt, 900);
}

/**
 * "Today" must be the store's day, not a second definition of it — when this
 * file computed its own local day while the store used the UTC date, the
 * sheet previewed one gift and the claim paid a different one for the whole
 * 0:00–7:00 window. `dayKey` is local now, so preview, claim and the
 * shown-once flag can never disagree again.
 */
function todayKey(): string {
  return dayKey(Date.now());
}

/**
 * The strip under the quest tracker: attendance on the left, the gardener on
 * the right. Re-created with each garden paint, so the countdown is as fresh
 * as the paint that drew it.
 */
export function gardenerRow(nav: (screen: "garden") => void): HTMLElement {
  const row = el("div", { class: "gardener-row" });
  const status = store.checkInStatus();

  const ciBtn = el("button", { class: "gardener-btn ci-btn" + (status.claimed ? " done" : "") }, [
    el("span", { class: "gico" }, ["📅"]),
    el("span", { class: "glbl" }, [status.claimed ? `Chuỗi ${status.streak} ngày` : "Điểm danh"]),
    status.claimed ? null : el("span", { class: "dot" }),
  ]);
  ciBtn.addEventListener("click", () => {
    sfx.play("tap");
    openCheckInSheet(() => nav("garden"));
  });
  row.appendChild(ciBtn);

  const left = store.autoCareLeft();
  if (left > 0) {
    const chip = el("div", { class: "gardener-btn active" });
    chip.append(el("span", { class: "gico" }, ["🤖"]), el("span", { class: "glbl" }, [`Người làm vườn · ${Math.ceil(left / 60000)}p`]));
    row.appendChild(chip);
  } else if (adsConfigured || (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    const adBtn = el("button", { class: "gardener-btn ad" });
    adBtn.append(
      el("span", { class: "gico" }, ["🤖"]),
      el("span", { class: "glbl" }, [`Thuê ${BUFF_MINUTES}p`]),
      el("span", { class: "qa-ad" }, ["📺 QC"]),
    );
    adBtn.addEventListener("click", async () => {
      adBtn.setAttribute("aria-disabled", "true");
      adBtn.classList.add("busy");
      const watched = await showRewardedAd("gardener-15m");
      adBtn.removeAttribute("aria-disabled");
      adBtn.classList.remove("busy");
      if (watched) {
        store.grantAutoCare(BUFF_MINUTES * 60 * 1000);
        sfx.play("reward");
        toast("🤖 Người làm vườn đã tới — chăm cây tự động trong 15 phút!", 3000);
        nav("garden");
      } else if (adsConfigured) {
        toast("Chưa xem xong quảng cáo — chưa thuê được người làm vườn", 2600);
      } else {
        toast("Quảng cáo chưa khả dụng trên bản này", 2200);
      }
    });
    row.appendChild(adBtn);
  }
  return row;
}
