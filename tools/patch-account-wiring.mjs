import { readFileSync, writeFileSync } from "node:fs";

/**
 * app.ts — wire the account layer to the store and to the settings button.
 *
 * Three touches, and the ordering matters:
 *
 *   `initAccount` runs *after* `boot` has built the store, because the sync layer
 *   reads and writes through it. Before, there is nothing to read.
 *
 *   The settings button opens the account sheet rather than only offering "wipe
 *   everything". Wiping is a whole-account decision and signing in is too, so they
 *   belong behind the same door — and a player who cannot find their account has no
 *   reason to look there at all.
 *
 *   The settings button keeps its existing behaviour. It was doing two unrelated
 *   things — toggling sound and, after confirming, deleting the save — which is a
 *   trap: the destructive one was a single tap away from the mute. They are now
 *   separate rows, so neither is one tap from the other.
 */

const file = "src/ui/app.ts";
const original = readFileSync(file, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r\n/g, "\n");

const edits = [
  // --- imports -----------------------------------------------------------
  [
    `import { sfx } from "../audio/audio";`,
    `import { sfx } from "../audio/audio";
import { initAccount } from "../account/sync";
import { openAccount } from "./accountSheet";`,
  ],

  // --- the settings button stops being a trap ------------------------------
  [
    `  const settings = el("button", { class: "btn sm ghost", title: "Cài đặt" }, ["⚙"]);
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
  });`,
    `  /**
   * Settings.
   *
   * This used to be a single button whose first tap decided whether you wanted
   * sound, and whose confirmation prompt then offered only "lose everything or
   * nothing" — so the destructive path was one tap from the mute, and cancelling
   * it turned the sound off as a side effect. Both rows are separate now: account,
   * sound, and a wipe that says plainly what it erases.
   */
  const settings = el("button", { class: "btn sm ghost", title: "Cài đặt" }, ["⚙"]);
  settings.addEventListener("click", () => {
    sfx.play("tap");
    openSettings();
  });`,
  ],

  // --- the settings sheet --------------------------------------------------
  [
    `function updatePills() {`,
    `/**
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
  });

  const wipe = el("button", { class: "btn ghost wide", style: "margin-top:14px;color:#8a3a2a" }, [
    "Xoá vườn và bắt đầu lại",
  ]);
  wipe.addEventListener("click", () => {
    const signedIn = isSignedIn();
    const extra = signedIn
      ? "\\n\\nBản trên tài khoản vẫn còn, nên đăng nhập lại là vườn quay lại."
      : "";
    if (!confirm(\`Xoá toàn bộ vườn trên máy này? Cây, xu, nhiệm vụ và tiến trình đều mất.\${extra}\`)) return;
    sfx.setMuted(true);
    resetSave();
    location.reload();
  });

  body.append(accountRow, soundRow, wipe);

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
  document.querySelector(".shell")!.append(overlay, s);
}

function updatePills() {`,
  ],

  // --- start the sync once the store exists ---------------------------------
  [
    `  // Growth polling.`,
    `  // The account layer reads and writes through the store, so it starts only once
  // the store exists. Running it earlier would find nothing to sync.
  initAccount({
    read: () => ({ state: store.exportState(), savedAt: store.savedAt }),
    write: (next, savedAt) => {
      store.importState(next);
      store.savedAt = savedAt;
    },
  });

  // Growth polling.`,
  ],

  // --- the settings sheet needs the status helpers --------------------------
  [
    `import { initAccount } from "../account/sync";`,
    `import { accountStatus, initAccount, isSignedIn, onAccountStatus } from "../account/sync";`,
  ],
];

for (const [needle, next] of edits) {
  if (!src.includes(needle)) throw new Error(`needle not found:\n---\n${needle.slice(0, 110)}\n---`);
  src = src.replace(needle, next);
}

writeFileSync(file, eol === "\r\n" ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("app.ts — settings sheet, account sheet and sync wired");