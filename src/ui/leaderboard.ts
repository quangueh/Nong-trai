/**
 * The leaderboard panel — pinned to the right rail on wide screens, and a floating
 * 🏆 button that opens the same board as a sheet on phones.
 *
 * Two boards share one card: strongest plant first, then breeder level — the two
 * numbers the save handler already extracts on every push. The player's own row is
 * pinned under each list, so a rank outside the top still answers "mình đang ở đâu".
 *
 * The data comes from `account/leaderboard.ts`; when there is no account service the
 * panel does not disappear — it shows the player's own numbers and says why the rest
 * of the board is missing, because a permanent empty card is worse than an honest one.
 */

import { el, fmt, dismissOnEscape } from "./components";
import { store } from "./app";
import { boardsSnapshot, onBoardsChange, refreshBoards, type Leaderboards } from "../account/leaderboard";
import { socialUnavailableBecause } from "../account/social";

/** Rows shown per board. The caller's own row is pinned separately, not counted here. */
const VISIBLE = 8;

/** Refresh cadence — saves are pushed on login and occasionally, not per mutation. */
const REFRESH_MS = 45_000;

let wired = false;
/** Repaint functions of every panel currently mounted — a store change repaints all. */
const liveRepaints = new Set<() => void>();

/** What a "me" row looks like when there is no server to ask — the local truth. */
function localMe(): { name: string; power: number; level: number } {
  const power = Math.max(0, ...store.state.plants.map((p) => p.powerRating ?? 0));
  return { name: store.state.name || "Bạn", power: Math.round(power), level: store.state.breederLevel };
}

function rowEl(rank: number, name: string, value: string, me: boolean): HTMLElement {
  const r = el("div", { class: "lb-row" + (me ? " me" : "") });
  r.append(
    el("span", { class: "lb-rank mono" }, [rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : `#${rank}`]),
    el("span", { class: "lb-name" }, [me ? `${name} (bạn)` : name]),
    el("span", { class: "lb-val mono" }, [value]),
  );
  return r;
}

function paintBoard(host: HTMLElement, rows: Leaderboards["power"], kind: "power" | "level", data: Leaderboards | null): void {
  host.replaceChildren();
  const title = kind === "power" ? "⚔ Sức mạnh cây" : "🌱 Cấp nhà lai tạo";
  host.appendChild(el("div", { class: "lb-sub" }, [title]));

  const shown = rows.slice(0, VISIBLE);
  if (shown.length === 0) {
    host.appendChild(el("div", { class: "tiny muted", style: "padding:6px 0" }, ["Chưa có ai trên bảng."]));
  }
  for (const r of shown) {
    host.appendChild(rowEl(r.rank, r.name, kind === "power" ? `⚔ ${fmt(r.power)}` : `Lv ${r.level}`, r.me));
  }

  const me = data?.me;
  const local = localMe();
  const meRank = kind === "power" ? me?.powerRank : me?.levelRank;
  const mePower = me?.power ?? local.power;
  const meLevel = me?.level ?? local.level;
  const meName = me?.name ?? local.name;
  host.appendChild(el("div", { class: "lb-me" }, [
    rowEl(meRank ?? 0, meName, kind === "power" ? `⚔ ${fmt(mePower)}` : `Lv ${meLevel}`, true),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [
      meRank ? `Hạng ${meRank}/${data?.total ?? "?"} của bảng này` : socialUnavailableBecause() ? "Đăng nhập để có hạng" : "Chưa có trên bảng — đồng bộ lưu để xuất hiện",
    ]),
  ]));
}

/**
 * The card that lives in the right rail. Re-mounts with every screen change but keeps
 * its data — `boardsSnapshot` is module-cached, so a repaint is never a blank panel.
 */
export function leaderboardPanel(): HTMLElement {
  const card = el("div", { class: "card lb-panel" });
  const body = el("div");
  card.append(
    el("div", { class: "row between", style: "margin-bottom:6px" }, [
      el("div", { class: "small", style: "font-weight:700" }, ["🏆 Xếp hạng"]),
      el("button", { class: "lb-refresh", "aria-label": "Làm mới", title: "Làm mới" }, ["⟳"]),
    ]),
    body,
  );

  let everMounted = false;
  const repaint = (): void => {
    // The panel remounts on every navigation. A repaint reaching a card that was once
    // mounted and is now detached is the signal to drop it from both listener sets —
    // a dead panel removes itself on the next event rather than accumulating.
    if (card.isConnected) everMounted = true;
    else if (everMounted) {
      off();
      liveRepaints.delete(repaint);
      return;
    }
    const { data, status } = boardsSnapshot();
    body.replaceChildren();
    if (status === "unavailable") {
      // No server: still show the player's own numbers, and say why the rest is absent.
      const me = localMe();
      body.append(
        el("div", { class: "lb-sub" }, ["⚔ Sức mạnh cây"]),
        rowEl(0, `${me.name} (bạn)`, `⚔ ${fmt(me.power)}`, true),
        el("div", { class: "lb-sub", style: "margin-top:10px" }, ["🌱 Cấp nhà lai tạo"]),
        rowEl(0, `${me.name} (bạn)`, `Lv ${me.level}`, true),
        el("div", { class: "tiny muted", style: "margin-top:8px" }, [
          socialUnavailableBecause() ?? "Máy chủ xếp hạng chưa sẵn sàng.",
        ]),
      );
      return;
    }
    if (!data) {
      body.appendChild(el("div", { class: "tiny muted" }, [status === "error" ? "Không tải được bảng — sẽ thử lại." : "Đang tải bảng xếp hạng…"]));
      return;
    }
    const powerHost = el("div");
    const levelHost = el("div", { style: "margin-top:10px" });
    paintBoard(powerHost, data.power, "power", data);
    paintBoard(levelHost, data.level, "level", data);
    body.append(powerHost, levelHost);
  };

  card.querySelector(".lb-refresh")!.addEventListener("click", () => void refreshBoards(true));
  const off = onBoardsChange(repaint);
  liveRepaints.add(repaint);

  repaint();
  void refreshBoards();

  if (!wired) {
    wired = true;
    window.setInterval(() => void refreshBoards(), REFRESH_MS);
    // The player's own row reads the live store, so a level-up or a new strongest
    // plant between fetches repaints instead of lying until the next poll.
    store.subscribe(() => {
      for (const fn of liveRepaints) fn();
    });
  }

  return card;
}

/** The floating phone button — CSS hides it once the side rail is wide enough to show. */
export function leaderboardFab(onOpen: () => void): HTMLElement {
  const fab = el("button", { class: "lb-fab", "aria-label": "Bảng xếp hạng", title: "Bảng xếp hạng" }, ["🏆"]);
  fab.addEventListener("click", onOpen);
  return fab;
}

/** The same board, as a bottom sheet — the phone has no rail to pin it to. */
export function openLeaderboardSheet(): void {
  const overlay = el("div", { class: "overlay" });
  const sheet = el("div", { class: "sheet" });
  const close = (): void => {
    overlay.remove();
    sheet.remove();
  };
  const closeBtn = el("button", { class: "btn sm ghost", "aria-label": "Đóng" }, ["✕"]);
  closeBtn.addEventListener("click", close);
  sheet.append(
    el("div", { class: "row between" }, [el("h3", { class: "grow" }, ["🏆 Bảng xếp hạng"]), closeBtn]),
    leaderboardPanel(),
  );
  overlay.addEventListener("click", close);
  dismissOnEscape(sheet, close);
  document.querySelector(".shell")!.append(overlay, sheet);
}
