/** Arena screen: PvE, room create/join, lobby, result (docs/05 §7-§10). */

import { el, toast, elementTags, traitChips, fmt, plantThumb } from "../components";
import { store } from "../app";
import type { Plant } from "../../core/types";
import { canBattle } from "../../growth/stages";
import { BattleView, type BattleIntent, type BattleSummary } from "../../battle/battleView";
import { createSeedPlant, breedPlants, estimatePower, validateGenome } from "../../genetics/genomeGenerator";
import { Rng, seedToken, clamp } from "../../core/rng";
import { RoomClient, HostRoom, type RoomSnapshot, type RoomMessage } from "../../core/room";
import { addSkillXp } from "../../genetics/skillGenerator";
import { gainXp } from "../../growth/care";
import type { Stance } from "../../battle/engine";
import { advanceStreak, battleStreakBonus, streakCoinPreview, STREAK_CAP } from "../../core/streak";
import { plantDisplayName } from "../../core/plantNames";
import { SPECIES } from "../../config/species";
import type { Navigate } from "./types";

const STANCES: [Stance, string][] = [
  ["aggressive", "Công"],
  ["guard", "Thủ"],
  ["swift", "Nhanh"],
  ["focus", "Kỹ năng"],
];

const STATE_LABEL: Record<string, string> = {
  waiting: "Chờ người chơi",
  selecting_plants: "Chọn cây",
  ready_check: "Sẵn sàng",
  countdown: "Chuẩn bị",
  in_battle: "Đang đấu",
  completed: "Kết thúc",
  cancelled: "Đã huỷ",
  expired: "Đã hết hạn",
};

export function renderArena(nav: Navigate, params?: unknown): HTMLElement {
  const p = params as { plantId?: string } | undefined;
  if (p?.plantId) {
    const plant = store.get(p.plantId);
    if (plant && canBattle(plant)) return renderPickOpponent(nav, plant);
  }
  return renderMenu(nav);
}

// --- menu ---

function renderMenu(nav: Navigate): HTMLElement {
  const root = el("div", { class: "fadein" });
  root.appendChild(el("div", { class: "sec-title" }, ["⚔ Đại chiến"]));

  const ready = store.state.plants.filter((p) => canBattle(p));

  // A wide button: the label and its explanation are stacked in one column beside the
  // icon. As three sibling flex items they sat in a row, and on a phone the label was
  // the one that gave way - "Đấu với AI" broke across two lines while the explanation it
  // was explaining stayed on one. The label is the thing being read.
  function wideAction(icon: string, label: string, note: string, primary: boolean): HTMLButtonElement {
    const btn = el("button", {
      class: `btn block${primary ? " primary" : ""}`,
      style: "margin-bottom:10px;text-align:left",
    });
    const text = el("div", { class: "btn-stack" });
    text.append(
      el("div", { class: "btn-stack-label" }, [label]),
      el("div", { class: "btn-stack-note" }, [note]),
    );
    btn.append(el("div", { class: "btn-stack-icon" }, [icon]), text);
    return btn;
  }

  const pve = wideAction("🎯", "Đấu với AI", "Hệ thống tìm đối thủ cùng cấp độ lực chiến", true);
  pve.disabled = !ready.length;
  pve.addEventListener("click", () => pickPlant(nav, (plant) => nav("arena", { plantId: plant.plantId })));
  root.appendChild(pve);

  const create = wideAction("🏠", "Tạo phòng", "Sinh mã 6 ký tự để mời đối thủ", false);
  create.addEventListener("click", () => pickPlant(nav, (plant) => renderRoomHost(nav, plant)));
  root.appendChild(create);

  const joinBox = el("div", { class: "card" });
  joinBox.appendChild(el("div", { class: "small", style: "font-weight:700;margin-bottom:8px" }, ["🔑 Nhập mã phòng"]));
  // A 20px monospace placeholder, letter-spaced, read as a broken field rather than as a
  // hint - the eye took it for rendered content. Small and quiet now, with the box
  // carrying the spacing instead.
  const input = el("input", { class: "codeinput", placeholder: "ABC123", maxlength: "6" }) as HTMLInputElement;
  input.style.textTransform = "uppercase";
  input.style.textAlign = "center";
  input.style.fontFamily = "JetBrains Mono, monospace";
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  const joinBtn = el("button", { class: "btn primary block", style: "margin-top:8px" }, ["Vào phòng"]);
  joinBtn.addEventListener("click", () => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 6) {
      toast("Mã phòng cần đúng 6 ký tự");
      return;
    }
    pickPlant(nav, (plant) => renderRoomGuest(nav, code, plant));
  });
  joinBox.append(input, joinBtn, el("div", { class: "callout", style: "margin-top:8px" }, ["Mở game ở tab hoặc cửa sổ khác rồi nhập mã để vào phòng. Máy chủ quyết định toàn bộ kết quả trận."]));
  root.appendChild(joinBox);

  // --- the fighters, and what fighting is worth --------------------------
  //
  // The screen used to be three buttons, a code box and a table of zeros. Nothing on
  // it answered the two questions a player actually arrives with - who am I taking into
  // this, and what do I get for it - and the table of zeros is the least motivating
  // thing a screen can show someone on their first visit.
  //
  // So: the roster first, with each fighter's power and streak, and the payout printed
  // before the fight rather than only on the receipt afterwards.
  const record = store.state.plants.reduce(
    (acc, p) => {
      acc.w += p.battleRecord.wins;
      acc.l += p.battleRecord.losses;
      acc.d += p.battleRecord.draws;
      return acc;
    },
    { w: 0, l: 0, d: 0 },
  );
  const total = record.w + record.l + record.d;

  if (ready.length) {
    const best = ready.slice().sort((a, b) => b.powerRating - a.powerRating)[0];
    const bestStreak = ready.reduce((m, p) => Math.max(m, p.battleRecord.streak), 0);
    const base = 60;
    const now = Math.round(base * battleStreakBonus(bestStreak));

    root.appendChild(el("div", { class: "sec-title", style: "margin-top:14px" }, ["Đội hình"]));

    const roster = el("div", { class: "roster" });
    for (const p of ready.slice(0, 6)) {
      const card = el("button", { class: "roster-card" });
      const thumb = el("div", { class: "roster-thumb" });
      thumb.innerHTML = plantThumb(p, 54).innerHTML;
      card.append(
        thumb,
        // Resolved against the whole garden, not the battle-ready subset shown here, so
        // a plant carries the same name here as it does in the shop. Two rows reading
        // "Rễ Gai hạt" is a choice made blind, and this strip is where it is made.
        el("div", { class: "roster-name" }, [plantDisplayName(p, store.state.plants)]),
        el("div", { class: "tiny muted mono" }, [`Lực ${fmt(p.powerRating)}`]),
      );
      // A live streak is the one thing on this card that changes between visits, so it
      // is the one thing that gets a badge.
      if (p.battleRecord.streak > 0) {
        card.appendChild(el("div", { class: "roster-streak" }, [`🔥${p.battleRecord.streak}`]));
      }
      card.addEventListener("click", () => nav("arena", { plantId: p.plantId }));
      roster.appendChild(card);
    }
    root.appendChild(roster);

    const pay = el("div", { class: "card", style: "margin-top:10px" });
    pay.append(
      el("div", { class: "kv" }, [
        el("span", { class: "kv-k" }, ["Thắng với " + plantDisplayName(best, store.state.plants)]),
        el("span", { class: "kv-v mono", style: "color:var(--accent-2);font-weight:700" }, [`+${now}🪙 +5🧺`]),
      ]),
      el("div", { class: "kv", style: "margin-top:5px" }, [
        el("span", { class: "kv-k" }, ["Chuỗi thắng hiện tại"]),
        el(
          "span",
          { class: "kv-v mono", style: bestStreak > 0 ? "color:var(--accent)" : "" },
          [bestStreak > 0 ? `${bestStreak}/${STREAK_CAP} · ×${battleStreakBonus(bestStreak).toFixed(2)}` : "0 — thắng liên tiếp để nhân thưởng"],
        ),
      ]),
    );
    root.appendChild(pay);
  }

  const hist = el("div", { class: "card", style: "margin-top:14px" });
  hist.append(
    el("div", { class: "sec-title" }, ["Thành tích"]),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Tổng trận"]), el("span", { class: "mono" }, [String(total)])]),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Thắng"]), el("span", { class: "mono", style: "color:var(--accent)" }, [String(record.w)])]),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Thua"]), el("span", { class: "mono", style: "color:var(--danger)" }, [String(record.l)])]),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Tỉ lệ thắng"]), el("span", { class: "mono" }, [total ? `${Math.round((record.w / total) * 100)}%` : "—"])]),
    // The record of the best run, which is the number worth showing a cold player: it
    // says the thing exists before they have done anything.
    el("div", { class: "row between small" }, [
      el("span", { class: "muted" }, ["Chuỗi tốt nhất"]),
      el("span", { class: "mono" }, [String(ready.reduce((m, p) => Math.max(m, p.battleRecord.bestStreak), 0))]),
    ]),
  );
  root.appendChild(hist);

  if (!ready.length) {
    root.appendChild(el("div", { class: "callout warn", style: "margin-top:12px" }, ["Chưa có cây trưởng thành. Chăm cây cho tới khi lớn rồi đem đi đấu."]));
  }
  return root;
}

/**
 * Opens a sheet listing battle-ready plants. `onPick` receives the chosen
 * plant and may return a view, which is mounted in place of the current screen.
 * Returning nothing leaves the screen as-is; without this, creating a room
 * would silently do nothing because the callback's result was discarded.
 */
function pickPlant(nav: Navigate, onPick: (plant: Plant) => HTMLElement | void) {
  const shell = document.querySelector(".shell")!;
  const screenHost = document.querySelector(".screen") as HTMLElement | null;
  const content = el("div");
  content.appendChild(el("h3", { style: "font-size:16px;margin-bottom:10px" }, ["Chọn cây chiến đấu"]));
  const list = el("div", { class: "scrollx" });
  const ready = store.state.plants.filter((p) => canBattle(p));
  if (!ready.length) content.appendChild(el("div", { class: "empty" }, ["Chưa có cây trưởng thành."]));
  for (const p of ready) {
    const card = el("div", { class: "plantcard", style: "flex:none;width:118px" });
    card.appendChild(plantThumb(p, 68));
    const n = el("div", { class: "name", style: "font-size:11px" });
    // An unresolvable "Rễ Gai hạt" here is a choice made blind, so the name is resolved
    // against the whole garden - the same name the arena roster showed a moment ago.
    n.textContent = plantDisplayName(p, store.state.plants);
    card.append(n, el("div", { class: "tiny muted mono" }, [`Lực ${fmt(p.powerRating)}`]));
    card.addEventListener("click", () => {
      overlay.remove();
      s.remove();
      const view = onPick(p);
      if (view && screenHost) {
        screenHost.replaceChildren(view);
        screenHost.scrollTop = 0;
      }
    });
    list.appendChild(card);
  }
  content.appendChild(list);
  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet" });
  s.append(el("div", { class: "handle" }), content);
  overlay.addEventListener("click", () => {
    overlay.remove();
    s.remove();
  });
  shell.append(overlay, s);
  void nav;
}
// --- PvE ---

function buildOpponent(player: Plant): Plant {
  const rng = new Rng(`ai:${player.plantId}:${Date.now()}`);
  const ids = SPECIES.map((s) => s.id);
  const a = createSeedPlant(rng.pick(ids), "ai", seedToken(rng.next()), Date.now());
  const b = createSeedPlant(rng.pick(ids), "ai", seedToken(rng.next()), Date.now());
  for (const s of [a, b]) {
    s.growth.stage = "mature";
    s.growth.level = Math.max(1, Math.round(player.growth.level * rng.float(0.85, 1.1)));
  }
  const result = breedPlants(
    a,
    b,
    {
      playerId: "ai",
      nonce: seedToken(rng.next()),
      attempt: 1,
      tier: player.tier,
      targetRarity: rng.pick(["B", "A", "A", "S"] as const),
      // The AI rolls mutations at the player's own breeder level. Pinning this
      // to 1 meant a level-40 player's opponents could never produce a tier-3
      // mutation, which quietly softened the late game.
      breederLevel: store.state.breederLevel,
    },
    Date.now(),
  );
  const foe = result.plant;
  foe.ownerId = "ai";
  // The bred child starts as a seed. Only the parents were matured above, so
  // without this the opponent fought as a sprout and rendered a third of the size
  // of the player's plant in the arena.
  foe.growth.stage = "mature";
  foe.growth.stageReadyAt = Date.now();
  foe.name = `Đối Thủ ${rng.pick(["Rừng", "Đồi", "Ao", "Núi", "Bãi", "Hang"])}${rng.int(1, 99)}`;
  foe.locks.manual = true;
  const ratio = (player.powerRating * rng.float(0.9, 1.12)) / Math.max(1, foe.powerRating);
  for (const k of ["hp", "attack", "defense", "speed", "skillPower"] as const) {
    foe.stats[k] = Math.round(foe.stats[k] * clamp(ratio, 0.7, 1.4));
  }
  foe.validation = validateGenome(foe);
  foe.powerRating = Math.round(estimatePower(foe));
  return foe;
}

function renderPickOpponent(nav: Navigate, plant: Plant): HTMLElement {
  const root = el("div", { class: "fadein" });
  const foe = buildOpponent(plant);

  root.appendChild(el("div", { class: "sec-title" }, ["Đối thủ"]));
  const preview = el("div", { class: "card" });
  const row = el("div", { class: "row" });
  const thumb = el("div");
  thumb.style.width = "88px";
  thumb.style.height = "88px";
  thumb.innerHTML = plantThumb(foe, 88).innerHTML;
  const info = el("div", { class: "grow" });
  info.append(
    el("div", { class: "small", style: "font-weight:700" }, [foe.name]),
    el("div", { class: "row wrap", style: "gap:4px;margin-top:5px" }, elementTags(foe)),
    el("div", { class: "tiny muted", style: "margin-top:5px" }, [`Cấp ${foe.growth.level} · Đời ${foe.generation} · ${foe.rarity}`]),
  );
  row.append(thumb, info);
  preview.appendChild(row);

  const diff = foe.powerRating - plant.powerRating;
  preview.append(
    el("div", { class: "divider" }),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Lực chiến của bạn"]), el("span", { class: "mono" }, [fmt(plant.powerRating)])]),
    el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Lực chiến đối thủ"]), el("span", { class: "mono" }, [fmt(foe.powerRating)])]),
    el("div", { class: "row between small" }, [
      el("span", { class: "muted" }, ["Chênh lệch"]),
      el("span", { class: "mono", style: `color:${Math.abs(diff) < plant.powerRating * 0.15 ? "var(--accent)" : "var(--accent-2)"}` }, [`${diff >= 0 ? "+" : ""}${fmt(diff)}`]),
    ]),
  );
  if (Math.abs(diff) > plant.powerRating * 0.25) {
    preview.appendChild(el("div", { class: "callout warn", style: "margin-top:8px" }, ["Chênh lệch lực chiến lớn — trận này có thể không công bằng."]));
  }
  root.appendChild(preview);

  const chips = traitChips(foe);
  if (chips.length) {
    root.appendChild(el("div", { class: "sec-title", style: "margin-top:12px" }, ["Đặc tính công khai"]));
    root.appendChild(el("div", { class: "row wrap", style: "gap:6px" }, chips));
  }

  const go = el("button", { class: "btn primary block", style: "margin-top:16px" }, ["⚔ Bắt đầu trận"]);
  go.addEventListener("click", () => {
    root.replaceChildren();
    const view = new BattleView({
      container: root,
      plantA: plant,
      plantB: foe,
      mySide: "a",
      interactive: true,
      onFinish: ({ winner, a }) => {
        const won = winner === "a";
        const draw = winner === "draw";
        const payout = reward(plant, won, draw, won ? 60 : draw ? 25 : 18, won ? 18 : draw ? 12 : 10, a.damageDealt);
        showResult(root, nav, plant, foe, winner, a, () => nav("arena"), payout);
      },
    });
    // A local, not the module-level `activeView`: this one belongs to the modal
    // that opens and closes with the quick-match button, and has no business
    // being the view the dev handle reports as "the battle on screen".
    view.start();
  });
  root.appendChild(go);

  const back = el("button", { class: "btn ghost block", style: "margin-top:8px" }, ["← Quay lại"]);
  back.addEventListener("click", () => nav("arena"));
  root.appendChild(back);
  return root;
}

/**
 * Pay out a finished fight.
 *
 * The coin figure scales with the plant's win streak, paid on the streak *already held*,
 * so the first win of a run pays the base rate and each one after it pays more. Both
 * numbers are computed here rather than by the caller, because the result screen prints
 * what was paid, and a payout and its own receipt computed in different places is how
 * they come to disagree.
 */
function reward(plant: Plant, won: boolean, draw: boolean, coins: number, xp: number, damage: number) {
  const bonus = battleStreakBonus(plant.battleRecord.streak);
  const paid = Math.round(coins * bonus);
  advanceStreak(plant.battleRecord, won ? "win" : draw ? "draw" : "loss");
  const items = won ? 5 : draw ? 3 : 2;
  store.state.leafCoin += paid;
  store.state.items += items;
  store.state.discovery.battles++;
  store.state.ledger.push({
    at: Date.now(),
    delta: paid,
    reason:
      (won ? "Thắng trận" : draw ? "Hòa" : "Tham gia trận") +
      // Only noted when there was one. A ledger line reading "chuỗi x1.00" is noise.
      (bonus > 1 ? " · chuỗi ×" + bonus.toFixed(2) : ""),
  });
  gainXp(plant, xp);
  plant.battleRecord[won ? "wins" : draw ? "draws" : "losses"]++;
  for (const s of plant.skills) addSkillXp(s, 6 + Math.round(damage / 45));
  if (Math.random() < 0.15) plant.battleRecord.scars++;
  store.addBreederXp(6);
  store.save();

  // Returned so the result screen shows what was actually paid. It used to print the
  // base figure from its own table, which was correct only while the payout was the base
  // figure — the moment a streak could change it, the receipt stopped matching.
  return { paid, items, bonus, streak: plant.battleRecord.streak };
}

function showResult(
  container: HTMLElement,
  nav: Navigate,
  mine: Plant,
  foe: Plant,
  winner: string,
  a: BattleSummary,
  onExit: () => void,
  payout: { paid: number; items: number; bonus: number; streak: number },
) {
  container.replaceChildren();
  const won = winner === "a";
  const draw = winner === "draw";
  const card = el("div", { class: "card pop", style: "text-align:center" });
  card.append(
    el("div", { style: "font-size:34px;font-weight:900;margin-top:6px" }, [draw ? "🤝 HÒA" : won ? "🏆 THẮNG!" : "💀 THUA"]),
    el("div", { class: "tiny muted", style: "margin-top:4px" }, [`${mine.name} VS ${foe.name}`]),
    el(
      "div",
      { class: "row", style: "justify-content:center;gap:22px;margin-top:14px" },
      [
        statBlock("ST gây ra", Math.round(a.damageDealt)),
        statBlock("ST nhận", Math.round(a.damageTaken)),
        statBlock("HP còn lại", `${Math.round(a.hpPct)}%`),
      ],
    ),
    el("div", { class: "divider" }),
    el("div", { class: "row between small" }, [
      el("span", { class: "muted" }, ["Phần thưởng"]),
      el("span", { class: "mono", style: "color:var(--accent-2)" }, [`+${payout.paid}🪙 +${payout.items}🧺`]),
    ]),
  );

  // The streak, said either way. A win names what the run is now worth; a loss says what
  // it was, so the number the player just lost is on screen rather than gone.
  if (won && payout.streak > 0) {
    card.appendChild(
      el("div", { class: "streak-note" }, [
        `🔥 Chuỗi ${payout.streak}${payout.streak >= STREAK_CAP ? " · tối đa" : ""} — trận sau +${streakCoinPreview(60, payout.streak)}🪙`,
      ]),
    );
  } else if (!won) {
    card.appendChild(el("div", { class: "streak-note is-lost" }, ["Chuỗi thắng đã đứt. Thắng lại để lấy lại."]));
  }
  const top = mine.skills.slice().sort((x, y) => y.level - x.level)[0];
  if (top) {
    card.appendChild(el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Chiêu mạnh nhất"]), el("span", { class: "mono" }, [`${top.name} Lv${top.level}`])]));
  }
  card.appendChild(el("div", { class: "tiny muted", style: "margin-top:6px" }, [`Kết quả: ${winner === "draw" ? "hòa" : winner === "a" ? "bạn thắng" : "bạn thua"}`])); 
  container.appendChild(card);

  const again = el("button", { class: "btn primary block", style: "margin-top:14px" }, ["⚔ Đấu lại"]);
  again.addEventListener("click", () => nav("arena", { plantId: mine.plantId }));
  const home = el("button", { class: "btn block", style: "margin-top:8px" }, ["🌿 Về vườn"]);
  home.addEventListener("click", onExit);
  container.append(again, home);
  void nav;
}

function statBlock(label: string, value: string | number): HTMLElement {
  const b = el("div");
  b.append(
    el("div", { class: "mono", style: "font-size:20px;font-weight:700" }, [String(value)]),
    el("div", { class: "tiny muted" }, [label]),
  );
  return b;
}

// --- room: host ---

function renderRoomHost(nav: Navigate, myPlant: Plant): HTMLElement {
  const root = el("div", { class: "fadein" });
  const client = new RoomClient(store.state.playerId, store.state.name);
  const code = client.create();
  const host = new HostRoom(code, store.state.playerId, store.state.name);
  host.registerPlant(myPlant);
  host.setPlant(store.state.playerId, myPlant.plantId);
  client.broadcastState(host.snapshot);

  root.appendChild(el("div", { class: "sec-title" }, ["Phòng đấu"]));
  root.appendChild(el("div", { class: "codebox" }, [code]));

  const copy = el("button", { class: "btn block", style: "margin-top:10px" }, ["📋 Sao chép mã phòng"]);
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Đã sao chép mã phòng");
    } catch {
      toast(`Mã phòng: ${code}`);
    }
  });
  root.appendChild(copy);

  const lobby = el("div", { class: "card", style: "margin-top:12px" });
  root.appendChild(lobby);
  const status = el("div", { class: "tiny muted", style: "margin-top:10px;line-height:1.6" }, ["Đang chờ người chơi thứ hai. Mở game ở tab/cửa sổ khác rồi nhập mã phòng."]);
  root.appendChild(status);

  const readyBtn = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["✅ Sẵn sàng"]);
  const startBtn = el("button", { class: "btn gold block", style: "margin-top:8px" }, ["🚀 Bắt đầu trận"]);
  startBtn.style.display = "none";
  root.append(readyBtn, startBtn);

  const battleHost = el("div", { style: "margin-top:12px" });
  root.appendChild(battleHost);

  let myReady = false;
  readyBtn.addEventListener("click", () => {
    myReady = !myReady;
    host.setReady(store.state.playerId, myReady);
    readyBtn.textContent = myReady ? "✅ Đã sẵn sàng" : "✅ Sẵn sàng";
    client.broadcastState(host.snapshot);
    paintLobby();
  });

  startBtn.addEventListener("click", () => {
    const players = host.snapshot.players;
    const me = players.find((p) => p.isHost)!;
    const guest = players.find((p) => !p.isHost);
    if (!guest?.plantId) {
      toast("Đối thủ chưa chọn cây");
      return;
    }
    const guestPlant = host.plant(guest.plantId);
    if (!guestPlant) {
      toast("Chưa nhận được dữ liệu cây đối thủ");
      return;
    }
    host.markInBattle();
    host.snapshot.battleSeed = host.makeBattleSeed(myPlant.plantId, guestPlant.plantId);
    client.broadcastState(host.snapshot);
    setButtonsDisabled(root, true);

    const view = new BattleView({
      container: battleHost,
      plantA: myPlant,
      plantB: guestPlant,
      mySide: "a",
      interactive: true,
      onIntent: (intent) => client.sendIntent(intent),
      onFinish: ({ winner, a, b }) => {
        const won = winner === "a";
        const draw = winner === "draw";
        reward(myPlant, won, draw, won ? 80 : draw ? 30 : 20, won ? 20 : 12, a.damageDealt);
        host.finishBattle();
        client.sendResult(winner, a, b);
        client.broadcastState(host.snapshot);
        battleHost.replaceChildren();
        const card = el("div", { class: "card pop", style: "text-align:center" });
        card.append(
          el("div", { style: "font-size:32px;font-weight:900" }, [draw ? "🤝 HÒA" : won ? "🏆 THẮNG!" : "💀 THUA"]),
          el("div", { class: "tiny muted", style: "margin-top:4px" }, [`${myPlant.name} VS ${guestPlant.name}`]),
          el("div", { class: "row", style: "justify-content:center;gap:20px;margin-top:12px" }, [
            statBlock("ST gây ra", Math.round(a.damageDealt)),
            statBlock("ST nhận", Math.round(a.damageTaken)),
            statBlock("HP", `${Math.round(a.hpPct)}%`),
          ]),
        );
        battleHost.appendChild(card);
        const rematch = el("button", { class: "btn block", style: "margin-top:12px" }, ["🔁 Trận mới"]);
        rematch.addEventListener("click", () => {
          host.resetToLobby();
          client.broadcastState(host.snapshot);
          battleHost.replaceChildren();
          setButtonsDisabled(root, false);
          paintLobby();
        });
        battleHost.appendChild(rematch);
      },
    });

    client.onIntent((intent) => view.applyRemoteIntent(intent));
    view.start();
    void me;
  });

  function paintLobby() {
    lobby.replaceChildren();
    for (const p of host.snapshot.players) {
      const row = el("div", { class: "row", style: "padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)" });
      const info = el("div", { class: "grow" });
      const meta = p.plantId ? host.snapshot.plants[p.plantId] : undefined;
      info.append(
        el("div", { class: "small", style: "font-weight:600" }, [`${p.name}${p.isHost ? " 👑 (chủ phòng)" : ""}`]),
        el("div", { class: "tiny muted" }, [meta ? `${meta.name} · ⚔${fmt(meta.power)} · ${meta.rarity}` : "Chưa chọn cây"]),
      );
      const readyTag = el("span", { class: "tag" }, [p.ready ? "✅" : "⏳"]);
      readyTag.style.color = p.ready ? "var(--accent)" : "var(--muted)";
      row.append(info, readyTag);
      lobby.appendChild(row);
    }
    const players = host.snapshot.players;
    if (players.length >= 2 && players.every((p) => p.plantId)) {
      startBtn.style.display = "";
      status.textContent = players.every((p) => p.ready) ? "Cả hai đã sẵn sàng! Bắt đầu trận." : "Chờ cả hai người bấm Sẵn sàng.";
    } else {
      startBtn.style.display = "none";
    }
  }

  client.onMessage((m: RoomMessage) => {
    if (m.code !== code) return;
    switch (m.kind) {
      case "join":
        host.addGuest(m.playerId, m.name);
        client.broadcastState(host.snapshot);
        paintLobby();
        toast(`${m.name} đã vào phòng`);
        break;
      case "plant_data":
        host.registerPlant(m.plant);
        host.setPlant(m.playerId, m.plant.plantId);
        client.broadcastState(host.snapshot);
        paintLobby();
        break;
      case "select":
        host.setPlant(m.playerId, m.plantId);
        client.broadcastState(host.snapshot);
        paintLobby();
        break;
      case "ready":
        host.setReady(m.playerId, m.ready);
        client.broadcastState(host.snapshot);
        paintLobby();
        break;
      case "stance":
        host.setStance(m.playerId, m.stance);
        break;
      case "leave":
        host.removePlayer(m.playerId);
        client.broadcastState(host.snapshot);
        paintLobby();
        break;
      case "req_state":
        client.broadcastState(host.snapshot);
        break;
      default:
        break;
    }
  });

  const leaveBtn = el("button", { class: "btn ghost block", style: "margin-top:12px" }, ["← Rời phòng"]);
  leaveBtn.addEventListener("click", () => {
    client.destroy();
    nav("arena");
  });
  root.appendChild(leaveBtn);

  paintLobby();
  return root;
}

// --- room: guest ---

function renderRoomGuest(nav: Navigate, code: string, myPlant: Plant): HTMLElement {
  const root = el("div", { class: "fadein" });
  const client = new RoomClient(store.state.playerId, store.state.name);
  client.join(code);

  root.appendChild(el("div", { class: "sec-title" }, [`Phòng ${code}`]));

  const statusCard = el("div", { class: "card" });
  statusCard.appendChild(el("div", { class: "small muted" }, ["Đang kết nối với chủ phòng..."]));
  root.appendChild(statusCard);

  const stanceRow = el("div", { class: "row", style: "gap:6px;margin-top:12px;justify-content:center;flex-wrap:wrap" });
  for (const [id, label] of STANCES) {
    const b = el("button", { class: "stancebtn" + (id === "aggressive" ? " on" : "") }, [label]);
    b.addEventListener("click", () => {
      for (const other of stanceRow.querySelectorAll(".stancebtn")) other.classList.remove("on");
      b.classList.add("on");
      client.sendStance(id);
    });
    stanceRow.appendChild(b);
  }
  root.appendChild(stanceRow);

  const readyBtn = el("button", { class: "btn primary block", style: "margin-top:12px" }, ["✅ Sẵn sàng"]);
  let isReady = false;
  readyBtn.addEventListener("click", () => {
    isReady = !isReady;
    readyBtn.textContent = isReady ? "✅ Đã sẵn sàng" : "✅ Sẵn sàng";
    client.sendReady(isReady);
  });
  root.appendChild(readyBtn);

  const battleHost = el("div", { style: "margin-top:12px" });
  root.appendChild(battleHost);

  const note = el("div", { class: "callout", style: "margin-top:12px" }, [
    "Chủ phòng điều khiển mô phỏng trận. Bạn vẫn bấm chiêu và đổi stance — máy chủ kiểm tra và áp dụng, kết quả do máy chủ chốt.",
  ]);
  root.appendChild(note);

  let opponent: Plant | null = null;
  let mirrored = false;
  let pendingResult: { winner: string; mine: BattleSummary; theirs: BattleSummary } | null = null;

  // Announce ourselves and hand our full plant snapshot to the host, which is
  // the only side allowed to build the authoritative match.
  setTimeout(() => {
    client.sendPlant(myPlant);
    client.sendSelect(myPlant.plantId);
    client.requestState();
  }, 200);

  client.onMessage((m: RoomMessage) => {
    if (m.code !== code) return;
    if (m.kind === "plant_data" && m.playerId !== store.state.playerId) {
      opponent = m.plant;
      if (mirrored && !activeView && opponent) startMirror();
    }
    if (m.kind === "result" && m.playerId !== store.state.playerId) {
      pendingResult = { winner: m.winner, mine: m.mine, theirs: m.theirs };
      activeView?.stop();
      renderResult();
    }
  });

  client.onState((snap: RoomSnapshot) => {
    statusCard.replaceChildren();
    statusCard.appendChild(el("div", { class: "small", style: "font-weight:700;margin-bottom:6px" }, [`Trạng thái: ${STATE_LABEL[snap.state] ?? snap.state}`]));
    for (const p of snap.players) {
      const row = el("div", { class: "row", style: "padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)" });
      const info = el("div", { class: "grow" });
      const meta = p.plantId ? snap.plants[p.plantId] : undefined;
      info.append(
        el("div", { class: "small", style: "font-weight:600" }, [`${p.name}${p.isHost ? " 👑" : ""}`]),
        el("div", { class: "tiny muted" }, [meta ? `${meta.name} · ⚔${fmt(meta.power)} · ${meta.rarity}` : "Chưa chọn cây"]),
      );
      const rt = el("span", { class: "tag" }, [p.ready ? "✅" : "⏳"]);
      rt.style.color = p.ready ? "var(--accent)" : "var(--muted)";
      row.append(info, rt);
      statusCard.appendChild(row);
    }

    if (snap.state === "in_battle" && !mirrored) {
      mirrored = true;
      if (opponent) startMirror();
      else note.textContent = "Đang chờ dữ liệu cây đối thủ từ máy chủ...";
    }
  });

  function startMirror() {
    if (!opponent || activeView) return;
    activeView = new BattleView({
      container: battleHost,
      plantA: myPlant,
      plantB: opponent,
      mySide: "a",
      interactive: true,
      onIntent: (intent: BattleIntent) => client.sendIntent(intent),
      onFinish: () => {
        note.textContent = "Đang chờ máy chủ chốt kết quả...";
      },
    });
    activeView.start();
  }

  function renderResult() {
    if (!pendingResult) return;
    const r = pendingResult;
    const won = r.winner === "a";
    const draw = r.winner === "draw";
    const coins = draw ? 30 : won ? 80 : 20;
    const items = draw ? 3 : won ? 6 : 2;
    store.state.leafCoin += coins;
    store.state.items += items;
    store.state.discovery.battles++;
    store.state.ledger.push({ at: Date.now(), delta: coins, reason: won ? "Thắng trận phòng" : draw ? "Hòa" : "Thua trận phòng" });
    gainXp(myPlant, won ? 20 : 12);
    myPlant.battleRecord[won ? "wins" : draw ? "draws" : "losses"]++;
    store.addBreederXp(8);
    store.save();

    battleHost.replaceChildren();
    const card = el("div", { class: "card pop", style: "text-align:center" });
    card.append(
      el("div", { style: "font-size:32px;font-weight:900" }, [draw ? "🤝 HÒA" : won ? "🏆 THẮNG!" : "💀 THUA"]),
      el("div", { class: "tiny muted", style: "margin-top:4px" }, [`${myPlant.name} VS ${opponent?.name ?? "Đối thủ"}`]),
      el("div", { class: "row", style: "justify-content:center;gap:20px;margin-top:12px" }, [
        statBlock("ST gây ra", Math.round(r.mine.damageDealt)),
        statBlock("ST nhận", Math.round(r.mine.damageTaken)),
        statBlock("HP", `${Math.round(r.mine.hpPct)}%`),
      ]),
      el("div", { class: "divider" }),
      el("div", { class: "row between small" }, [el("span", { class: "muted" }, ["Phần thưởng"]), el("span", { class: "mono", style: "color:var(--accent-2)" }, [`+${coins}🪙 +${items}🧺`])]),
    );
    battleHost.appendChild(card);
    note.textContent = "Kết quả đã được máy chủ chốt.";
  }

  const leaveBtn = el("button", { class: "btn ghost block", style: "margin-top:12px" }, ["← Rời phòng"]);
  leaveBtn.addEventListener("click", () => {
    activeView?.destroy();
    client.destroy();
    nav("arena");
  });
  root.appendChild(leaveBtn);

  return root;
}

function setButtonsDisabled(root: HTMLElement, disabled: boolean) {
  root.querySelectorAll("button").forEach((b) => {
    const btn = b as HTMLButtonElement;
    if (btn.classList.contains("skillbtn") || btn.classList.contains("stancebtn")) return;
    btn.disabled = disabled;
  });
}

/**
 * The battle currently on screen, or null.
 *
 * Module-level because the view is rebuilt whenever a fight restarts, and a
 * caller that captured the first one would end up driving a detached object.
 * Exposed for the dev handle in `app.ts` and for nothing else: a screenshot script
 * has no other way to drive a specific skill at a specific frame, and a harness
 * that can only wait and hope the AI cooperates cannot answer the only question
 * that matters about an animation — whether it looks right.
 */
let activeView: BattleView | null = null;

export function currentBattleView(): BattleView | null {
  return activeView;
}
