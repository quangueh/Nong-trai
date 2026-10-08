/**
 * The leaderboard — a full screen in the bottom nav, like the shop. It used to
 * live behind a floating 🏆 button that opened a sheet, but a fixed-position
 * button floats at the viewport edge while the game shell sits centered — on a
 * wide monitor it ended up far from anything the player was looking at. A nav
 * item is where every other screen is reached, so it cannot be missed.
 *
 * Two boards share one card: strongest plant first, then breeder level — the two
 * numbers the save handler already extracts on every push. The player's own row is
 * pinned under each list, so a rank outside the top still answers "mình đang ở đâu".
 *
 * The data comes from `account/leaderboard.ts`; when there is no account service the
 * panel does not disappear — it shows the player's own numbers and says why the rest
 * of the board is missing, because a permanent empty card is worse than an honest one.
 */

import { el, fmt } from "./components";
import { store } from "./app";
import type { Navigate } from "./screens/types";
import { boardsSnapshot, onBoardsChange, refreshBoards, type Leaderboards } from "../account/leaderboard";
import { socialUnavailableBecause } from "../account/social";
import { accountStatus } from "../account/sync";
import { DEFAULT_PLAYER_NAME } from "../core/types";

/** Rows shown per board. The caller's own row is pinned separately, not counted here. */
const VISIBLE = 8;

/** Refresh cadence — saves are pushed on login and occasionally, not per mutation. */
const REFRESH_MS = 45_000;

let wired = false;
/** Repaint functions of every panel currently mounted — a store change repaints all. */
const liveRepaints = new Set<() => void>();

/**
 * What a row is called: the in-game name first.
 *
 * The email prefix answers only when the row has no real name — entries written
 * before names could be chosen, and saves still wearing the stock placeholder.
 * The full email stays on the tooltip, where a player can still check *which*
 * Minh this is without the whole column being addresses.
 */
function rowLabel(row: { name: string; email?: string }): string {
  const n = (row.name ?? "").trim();
  if (n && n !== DEFAULT_PLAYER_NAME) return n;
  return row.email?.split("@")[0] || n || "?";
}

/** What a "me" row looks like when there is no server to ask — the local truth. */
function localMe(): { name: string; email?: string; power: number; level: number } {
  const power = Math.max(0, ...store.state.plants.map((p) => p.powerRating ?? 0));
  const email = accountStatus().email ?? undefined;
  return {
    name: rowLabel({ name: store.state.name, email }),
    email,
    power: Math.round(power),
    level: store.state.breederLevel,
  };
}

function rowEl(rank: number, row: { name: string; email?: string }, value: string, me: boolean): HTMLElement {
  const label = rowLabel(row);
  const r = el("div", { class: "lb-row" + (me ? " me" : "") });
  r.append(
    el("span", { class: "lb-rank mono" }, [rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : `#${rank}`]),
    el("span", { class: "lb-name", title: row.email ?? label }, [me ? `${label} (bạn)` : label]),
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
    host.appendChild(rowEl(r.rank, r, kind === "power" ? `⚔ ${fmt(r.power)}` : `Lv ${r.level}`, r.me));
  }

  const me = data?.me;
  const local = localMe();
  const meRank = kind === "power" ? me?.powerRank : me?.levelRank;
  const mePower = me?.power ?? local.power;
  const meLevel = me?.level ?? local.level;
  const meRow = me ?? local;
  host.appendChild(el("div", { class: "lb-me" }, [
    rowEl(meRank ?? 0, meRow, kind === "power" ? `⚔ ${fmt(mePower)}` : `Lv ${meLevel}`, true),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [
      meRank ? `Hạng ${meRank}/${data?.total ?? "?"} của bảng này` : socialUnavailableBecause() ? "Đăng nhập để có hạng" : "Chưa có trên bảng — đồng bộ lưu để xuất hiện",
    ]),
  ]));
}

/**
 * The card the sheet hosts. Re-mounts with every open but keeps its data —
 * `boardsSnapshot` is module-cached, so a repaint is never a blank panel.
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
        rowEl(0, me, `⚔ ${fmt(me.power)}`, true),
        el("div", { class: "lb-sub", style: "margin-top:10px" }, ["🌱 Cấp nhà lai tạo"]),
        rowEl(0, me, `Lv ${me.level}`, true),
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

  /* The interval fetch only pays while someone can see the board — each GET
     is a server-side snapshot read, but polling a screen nobody is looking at
     is still a request every 45s for the life of the tab. A detached card
     also means a dead repaint, so it unregisters itself on next fire rather
     than accumulating one zombie per visit. */
  const liveRepaint = () => {
    if (!card.isConnected) {
      liveRepaints.delete(liveRepaint);
      off();
      return;
    }
    repaint();
  };
  liveRepaints.add(liveRepaint);

  repaint();
  void refreshBoards();

  if (!wired) {
    wired = true;
    window.setInterval(() => {
      if (document.hidden || !document.querySelector(".lb-panel")) return;
      void refreshBoards();
    }, REFRESH_MS);
    // The player's own row reads the live store, so a level-up or a new strongest
    // plant between fetches repaints instead of lying until the next poll.
    store.subscribe(() => {
      for (const fn of liveRepaints) fn();
    });
  }

  return card;
}

/** The board as a whole screen — what the 🏆 nav tab renders. */
export function renderLeaderboard(_nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  root.append(
    el("div", { class: "card", style: "margin-bottom:12px" }, [
      el("div", { style: "font-size:20px;font-weight:900" }, ["🏆 Bảng xếp hạng"]),
      el("div", { class: "tiny muted", style: "margin-top:3px" }, [
        "Hai bảng: cây mạnh nhất và cấp nhà lai tạo. Đồng bộ lưu lên để lên bảng.",
      ]),
    ]),
    leaderboardPanel(),
  );
  return root;
}
