/**
 * Friends, in the arena.
 *
 * Replaces "create a room and read six characters out loud" with "press a button next to
 * your friend". That is the whole point of the feature and it is worth being clear about
 * what changed underneath: a challenge is a letter, not a socket. It arrives in the
 * defender's inbox on their next poll, they answer with a fighter of their own choosing,
 * and the Worker fights it and both sides watch the same event log. Nobody needs to be
 * online at the same moment, which is the only way asynchronous duels work between two
 * people with lives.
 *
 * Three states on one card, because they are three different conversations:
 *
 *   - **Signed out.** Says why the feature is dark rather than showing an empty list. A
 *     friend list that renders as "no friends yet" when the truth is "you are not signed
 *     in" is a lie that costs the player a support request.
 *   - **The inbox.** Pending challenges first, with the challenger's fighter and power on
 *     the line, because deciding whether to accept is a question about that fight.
 *   - **The list.** Each friend with a challenge button and a way to drop them.
 *
 * Accepting opens the fighter sheet rather than a second bespoke chooser. One way to pick a
 * plant in the whole game is one fewer thing to get wrong, and the sheet already knows how
 * to explain that a plant has to be ready.
 */

import { el, toast, fmt, plantThumb } from "../components";
import { store } from "../app";
import { canBattle } from "../../growth/stages";
import type { Plant } from "../../core/types";
import {
  REFUSAL_TEXT,
  acceptChallenge,
  addFriend,
  declineChallenge,
  duelInbox,
  listFriends,
  readDuel,
  removeFriend,
  sendChallenge,
  socialUnavailableBecause,
  sinceWords,
  type DuelInvite,
  type DuelResult,
  type Friend,
} from "../../account/social";

/** State that has to outlive a repaint, because the arena re-renders on every tick. */
let friends: Friend[] = [];
let invites: DuelInvite[] = [];
let loadedAt = 0;
let loading = false;
/** Set when a duel has been fetched and is waiting to be shown, so a repaint cannot lose it. */
let pendingResult: { result: DuelResult; iAm: "a" | "b" } | null = null;

/** The inbox is polled, not pushed, so it is not read on every single paint. */
const INBOX_FRESH_MS = 20_000;

export interface FriendsPanel {
  el: HTMLElement;
  /** Called by the arena after a battle, so a finished duel can surface itself. */
  check: () => void;
}

/**
 * Build the panel.
 *
 * `onWatch` receives a finished duel and is expected to hand it to the arena's battle
 * view, because that is the only thing on screen that knows how to play a battle back.
 */
export function friendsPanel(onWatch: (result: DuelResult, iAm: "a" | "b") => void): FriendsPanel {
  const host = el("div", { class: "friends" });

  const paint = () => {
    const blocked = socialUnavailableBecause();

    if (blocked) {
      host.replaceChildren(
        el("div", { class: "card" }, [
          el("div", { class: "small", style: "font-weight:700;margin-bottom:6px" }, ["👥 Bạn bè"]),
          el("div", { class: "callout" }, [blocked]),
        ]),
      );
      return;
    }

    const bits: HTMLElement[] = [];

    // --- inbox ------------------------------------------------------------
    const pending = invites.filter((i) => i.state === "pending");
    if (pending.length) {
      const box = el("div", { class: "card inbox" });
      box.appendChild(
        el("div", { class: "sec-title" }, [
          `📩 Lời mời đấu${pending.length > 1 ? ` (${pending.length})` : ""}`,
        ]),
      );
      for (const invite of pending) bits.push(inviteRow(invite, paint, onWatch));
      box.append(...bits.splice(0, bits.length));
      bits.push(box);
    }

    // --- the list ---------------------------------------------------------
    const list = el("div", { class: "card" });
    list.appendChild(el("div", { class: "sec-title" }, [`👥 Bạn bè${friends.length ? ` (${friends.length})` : ""}`]));

    // The add field. A real <form> so the Enter key works and so Chrome's own heuristics
    // about what a text field is for apply - the same reason the sign-in sheet uses one.
    const form = el("form", { class: "add-friend" });
    const input = el("input", {
      class: "grow",
      placeholder: "Tên hoặc email của bạn",
      maxlength: "80",
      autocomplete: "off",
      spellcheck: "false",
    }) as HTMLInputElement;
    const addBtn = el("button", { class: "btn sm primary", type: "submit" }, ["Kết bạn"]);
    form.append(input, addBtn);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void doAdd(input.value, paint);
    });
    list.appendChild(form);
    list.appendChild(
      el("div", { class: "tiny muted", style: "margin-top:4px;line-height:1.45" }, [
        "Tên phải là duy nhất. Nếu nhiều người cùng tên, hãy nhập email.",
      ]),
    );

    if (!friends.length) {
      list.appendChild(
        el("div", { class: "empty" }, ["Chưa có bạn nào. Thêm một người để giao đấu thẳng, không cần mã phòng."]),
      );
    } else {
      const rows = el("div", { class: "friend-rows" });
      for (const f of friends) rows.appendChild(friendRow(f, paint));
      list.appendChild(rows);
    }
    bits.push(list);

    host.replaceChildren(...bits);
  };

  const check = () => {
    if (pendingResult) {
      const { result, iAm } = pendingResult;
      pendingResult = null;
      onWatch(result, iAm);
      return;
    }
    if (!socialUnavailableBecause()) void refresh();
  };

  const refresh = async () => {
    if (loading) return;
    const now = Date.now();
    // The list is cheap and changes rarely; the inbox is the part worth re-reading, and
    // only often enough that a challenge does not sit unseen for a minute.
    if (now - loadedAt < INBOX_FRESH_MS) return;
    loading = true;
    try {
      const [f, d] = await Promise.all([listFriends(), duelInbox()]);
      if (f.ok) friends = f.value;
      if (d.ok) invites = d.value;
      loadedAt = now;
      paint();
    } finally {
      loading = false;
    }
  };

  paint();
  void refresh();

  return { el: host, check };
}

/* --- rows ----------------------------------------------------------------- */

function friendRow(f: Friend, repaint: () => void): HTMLElement {
  const row = el("div", { class: "friend-row" });

  const who = el("div", { class: "grow", style: "min-width:0" });
  who.append(
    el("div", { class: "small", style: "font-weight:700" }, [f.name]),
    el("div", { class: "tiny muted", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, [
      `Bạn từ ${sinceWords(f.since)}`,
    ]),
  );

  const fight = el("button", { class: "btn sm primary" }, ["⚔ Kêu gọi"]);
  fight.addEventListener("click", () => void startChallenge(f, repaint));

  const drop = el("button", { class: "btn sm ghost", title: "Bỏ bạn" }, ["✕"]);
  drop.addEventListener("click", async () => {
    const r = await removeFriend(f.handle);
    if (r.ok) {
      friends = r.value.friends;
      toast(`Đã bỏ ${f.name}.`);
      repaint();
    } else toast(REFUSAL_TEXT[r.why]);
  });

  row.append(who, fight, drop);
  return row;
}

function inviteRow(invite: DuelInvite, repaint: () => void, onWatch: (r: DuelResult, iAm: "a" | "b") => void): HTMLElement {
  const row = el("div", { class: "friend-row invite" });

  const who = el("div", { class: "grow", style: "min-width:0" });
  who.append(
    el("div", { class: "small", style: "font-weight:700" }, [`${invite.fromName} kêu gọi`]),
    el("div", { class: "tiny muted", style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, [
      `${invite.plantName} · lực ${fmt(invite.plantPower)} · ${sinceWords(invite.at)}`,
    ]),
  );

  const accept = el("button", { class: "btn sm primary" }, ["Nhận"]);
  accept.addEventListener("click", () => void doAccept(invite, repaint, onWatch));

  const no = el("button", { class: "btn sm ghost" }, ["Từ chối"]);
  no.addEventListener("click", async () => {
    const r = await declineChallenge(invite.id);
    if (r.ok) {
      invites = r.value.invites;
      repaint();
    } else toast(REFUSAL_TEXT[r.why]);
  });

  row.append(who, accept, no);
  return row;
}

/* --- actions -------------------------------------------------------------- */

/**
 * Choose my fighter, then send.
 *
 * The plant is chosen before the request rather than after it, because the Worker checks
 * the id against the save it holds: sending first and picking second would mean picking a
 * plant the server might not accept.
 */
async function startChallenge(friend: Friend, repaint: () => void): Promise<void> {
  const ready = store.state.plants.filter((p) => canBattle(p));
  if (!ready.length) {
    toast("Chưa có cây trưởng thành để kêu gọi.");
    return;
  }
  pickFighter(ready, async (plant) => {
    const r = await sendChallenge(friend.handle, plant.plantId);
    if (r.ok) {
      toast(`Đã gửi lời mời cho ${friend.name}.`);
      repaint();
    } else toast(REFUSAL_TEXT[r.why]);
  });
}

async function doAccept(
  invite: DuelInvite,
  repaint: () => void,
  onWatch: (r: DuelResult, iAm: "a" | "b") => void,
): Promise<void> {
  const ready = store.state.plants.filter((p) => canBattle(p));
  if (!ready.length) {
    toast("Chưa có cây trưởng thành để nhận lời mời.");
    return;
  }
  pickFighter(ready, async (plant) => {
    const r = await acceptChallenge(invite.id, plant.plantId);
    if (!r.ok) {
      toast(REFUSAL_TEXT[r.why]);
      const again = await duelInbox();
      if (again.ok) invites = again.value;
      repaint();
      return;
    }
    // The Worker put the challenger on side a, because the challenge is theirs.
    onWatch(r.value.result, "b");
  });
}

async function doAdd(query: string, repaint: () => void): Promise<void> {
  const r = await addFriend(query.trim());
  if (!r.ok) {
    toast(REFUSAL_TEXT[r.why]);
    return;
  }
  friends = r.value.friends;
  toast(r.value.added ? `Đã kết bạn với ${r.value.added.name}.` : "Bạn đã có trong danh sách.");
  repaint();
}

/**
 * The fighter sheet.
 *
 * Deliberately the same shape as the arena's own chooser rather than a second one: one way
 * to pick a plant in the game is one fewer thing to get wrong, and this screen's job is
 * social, not another plant-picking tutorial.
 */
function pickFighter(ready: Plant[], onPick: (plant: Plant) => void | Promise<void>): void {
  const shell = document.querySelector(".shell");
  const overlay = el("div", { class: "overlay" });
  const sheet = el("div", { class: "sheet" });
  const content = el("div");

  content.appendChild(el("h3", { style: "font-size:16px;margin-bottom:10px" }, ["Chọn cây chiến đấu"]));
  const list = el("div", { class: "scrollx" });
  for (const p of ready) {
    const card = el("button", { class: "plantcard", style: "flex:none;width:118px" });
    // The same renderer the garden uses, so a plant looks like itself everywhere. Set as
    // innerHTML rather than built by hand because that renderer *is* the art.
    const thumb = plantThumb(p, 68);
    card.append(
      thumb,
      el("div", { class: "name", style: "font-size:11px" }, [p.name]),
      el("div", { class: "tiny muted mono" }, [`Lực ${fmt(p.powerRating)}`]),
    );
    card.addEventListener("click", () => {
      overlay.remove();
      sheet.remove();
      void onPick(p);
    });
    list.appendChild(card);
  }
  content.appendChild(list);

  // `append`, not `appendChild`: the handle and the body are two children, and
  // `appendChild` takes one. The arena's own sheet does the same thing.
  sheet.append(el("div", { class: "handle" }), content);
  overlay.addEventListener("click", () => {
    overlay.remove();
    sheet.remove();
  });
  (shell ?? document.body).append(overlay, sheet);
}

/* --- the duel replay ------------------------------------------------------ */

/**
 * Fetch a finished duel and hand it to the arena.
 *
 * Kept apart from the panel so the arena can ask for it on its own schedule - a duel
 * answered by the other player finishes without this client being told.
 */
export async function fetchDuel(id: string, onWatch: (r: DuelResult, iAm: "a" | "b") => void): Promise<void> {
  const r = await readDuel(id);
  if (!r.ok) {
    toast(REFUSAL_TEXT[r.why]);
    return;
  }
  onWatch(r.value.result, "b");
}

