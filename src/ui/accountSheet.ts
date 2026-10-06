/** Account sheet: sign in, sign up, and see the sync state. */

import { el, toast } from "./components";
import { showGate } from "./app";
import { googleSignInAvailable } from "../account/google";
import { googlePanel } from "./googlePanel";
import { buildEmailSignIn } from "./emailSignIn";
import { AccountError, accountServiceAvailable } from "../account/api";
import { sessionKind } from "../account/kind";
import {
  accountStatus,
  isSignedIn,
  keepLocal,
  onAccountStatus,
  pull,
  push,
  signOut,
  takeServer,
  updatePassword,
  type AccountStatus,
} from "../account/sync";

/**
 * Every message a player can be shown, keyed by the worker's error code.
 *
 * The worker returns codes rather than sentences so the text lives here, in the
 * game's language, and so a copy change does not mean a redeploy of the Worker.
 */
const WHY: Record<string, string> = {
  bad_email: "Email không hợp lệ.",
  weak_password: "Mật khẩu cần ít nhất 8 ký tự.",
  taken: "Email này đã có tài khoản. Thử đăng nhập.",
  bad_credentials: "Email hoặc mật khẩu không đúng.",
  too_many: "Thử quá nhiều lần. Chờ một phút rồi thử lại.",
  unauthorised: "Phiên đăng nhập hết hạn.",
  offline: "Không có mạng. Vườn vẫn được lưu trên máy này.",
  timeout: "Máy chủ không phản hồi.",
  not_configured: "Chưa cấu hình dịch vụ tài khoản.",
  server: "Máy chủ lỗi. Thử lại sau.",
  no_save: "Chưa có vườn nào trên tài khoản này.",
};

function explain(err: unknown): string {
  if (err instanceof AccountError) return WHY[err.code] ?? err.message;
  return "Có lỗi xảy ra. Thử lại.";
}

/**
 * The account sheet.
 *
 * Deliberately a sheet and not a screen: signing in is something a player does
 * occasionally, and turning it into a tab would put "manage your account" on the
 * same footing as "plant a seed". It opens from the settings button, which is
 * already the place for whole-account decisions like wiping the save.
 */
export function openAccount(): void {
  const body = el("div", { class: "account" });

  /*
   * A holder rather than a direct reference, because `close` is defined further down and is
   * called from listeners attached before `google` exists. `close` reading a `const google`
   * would be a temporal-dead-zone throw from a click handler, which is the least legible
   * way this file could fail.
   */
  let panelTeardown: (() => void) | null = null;

  /**
   * Hand a freshly built panel to whoever owns the sheet.
   *
   * Needed because `render` rebuilds the body on every account-status change, and each
   * build creates a Google panel — which registers a credential listener on a module-level
   * set. Without this, opening the sheet and watching the sync status change three times
   * leaves three listeners, and one token from Google completes three sign-ins at once.
   */
  const registerPanel = (teardown: () => void): void => {
    panelTeardown?.();
    panelTeardown = teardown;
  };

  const render = (): void => {
    body.replaceChildren();
    if (!accountServiceAvailable) {
      body.append(
        el("p", { class: "small" }, [
          "Chưa cấu hình dịch vụ tài khoản. Game vẫn chơi bình thường, vườn được lưu trên máy này.",
        ]),
        el("p", { class: "tiny muted", style: "margin-top:8px" }, [
          // Both variables are named, not just the first one. Sign-in needs the Worker,
          // so Google sign-in is unreachable without it too — and a message that
          // mentioned only VITE_ACCOUNT_API would have sent someone off to set that and
          // then wondered why no Google button appeared.
          "Để bật: đặt VITE_ACCOUNT_API trong .env rồi dựng Worker theo worker/README.md." +
            (googleSignInAvailable
              ? ""
              : " Ngoài ra cần VITE_GOOGLE_CLIENT_ID để bật đăng nhập Google."),
        ]),
      );
      return;
    }
    if (isSignedIn()) renderSignedIn(body, render);
    else renderSignedOut(body, render, registerPanel);
  };

  const off = onAccountStatus(() => {
    // The status strip updates in place rather than rebuilding the sheet, so a
    // sync finishing does not close the form the player is halfway through.
    const strip = body.querySelector(".account-sync");
    if (strip) strip.replaceWith(syncStrip(accountStatus()));
  });

  // See the note on `registerPanel` above.
  const close = (): void => {
    off();
    panelTeardown?.();
    panelTeardown = null;
    overlay.remove();
    s.remove();
  };

  render();

  const overlay = el("div", { class: "overlay" });
  const s = el("div", { class: "sheet" });
  s.append(
    el("div", { class: "row between" }, [
      el("h3", { class: "grow" }, ["Tài khoản"]),
      el("button", { class: "btn sm ghost", "aria-label": "Đóng" }, ["✕"]),
    ]),
    body,
  );
  s.querySelector("button")!.addEventListener("click", close);
  overlay.addEventListener("click", close);

  document.querySelector(".shell")!.append(overlay, s);
}

function syncStrip(status: AccountStatus): HTMLElement {
  const strip = el("div", { class: "account-sync is-" + status.state });
  strip.append(
    el("span", { class: "account-dot" }),
    el("span", { class: "grow tiny" }, [status.message || "—"]),
  );

  // The two buttons appear only when there is genuinely something to decide. A
  // conflict resolution control that is always present is a question the player
  // has to learn to ignore.
  if (status.state === "conflict") {
    const row = el("div", { class: "account-row" });
    const theirs = el("button", { class: "btn xs" }, ["Dùng bản máy chủ"]);
    theirs.addEventListener("click", () => void takeServer());
    const mine = el("button", { class: "btn xs primary" }, ["Giữ bản máy này"]);
    mine.addEventListener("click", () => void keepLocal());
    row.append(theirs, mine);
    strip.appendChild(row);
  }
  return strip;
}

function renderSignedOut(body: HTMLElement, render: () => void, registerPanel: (teardown: () => void) => void): void {
  /*
   * Shared with the sign-in gate.
   *
   * Was written out inline here, which meant the gate and this sheet were two
   * implementations of the same form with no way to disagree loudly - and the divergence
   * would only ever show up on one of them. It is a real <form> so Chrome offers the
   * password manager and Enter-to-submit works without a hand-written keydown handler.
   */
  const email = buildEmailSignIn();
  email.form.addEventListener("signed-in", () => {
    toast("Đã đăng nhập.");
    render();
  });

  const note = el("p", { class: "tiny muted" }, [
    "Không bắt buộc. Không đăng nhập thì vườn chỉ nằm trên máy này và mất nếu xoá dữ liệu trình duyệt.",
  ]);

  const google = googlePanel(render, () => {
    // The panel writes its own message.
  });
  registerPanel(google.destroy);

  body.append(
    syncStrip(accountStatus()),
    ...google.nodes,
    el("div", { class: "account-sep tiny muted" }, ["hoặc — đăng nhập bằng email"]),
    email.form,
    note,
  );
}

function renderSignedIn(body: HTMLElement, render: () => void): void {
  const status = accountStatus();

  const sync = el("button", { class: "btn wide" }, ["Lưu lên tài khoản ngay"]);
  sync.addEventListener("click", () => void push());

  const pullBtn = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Tải vườn từ tài khoản"]);
  pullBtn.addEventListener("click", () => void pull());

  const out = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Đăng xuất"]);
  out.addEventListener("click", () => {
      /*
       * Sign out, then put the gate back up.
       *
       * `signOut` clears the session and the save slot; it does not consult the gate, which
       * is only ever checked at boot. So signing out used to drop the player into an
       * anonymous garden and leave them there, and the login screen only reappeared on the
       * next reload — which is not what "đăng xuất" means to somebody who just pressed it.
       *
       * Deferred by one turn because `signOut` finishes its final push asynchronously and
       * zeroes the token only once that settles; showing the gate first would paint a login
       * screen over a session that is still live for a few hundred milliseconds.
       */
      signOut();
      setTimeout(() => {
        render();
        showGate();
      }, 400);
    });

  // Password change, folded away. It is rare, it is irreversible, and putting it
  // next to "sign out" invites accidents.
  const details = el("details", { class: "account-more" });
  const current = el("input", { class: "field", type: "password", placeholder: "Mật khẩu hiện tại", autocomplete: "current-password" }) as HTMLInputElement;
  const next = el("input", { class: "field", type: "password", placeholder: "Mật khẩu mới", autocomplete: "new-password" }) as HTMLInputElement;
  const perr = el("p", { class: "account-err" });
  const change = el("button", { class: "btn sm" }, ["Đổi mật khẩu"]);
  change.addEventListener("click", () => {
    perr.textContent = "";
    void updatePassword(current.value, next.value)
      .then(() => {
        perr.textContent = "";
        toast("Đã đổi mật khẩu.");
      })
      .catch((e: unknown) => {
        perr.textContent = explain(e);
      });
  });
  details.append(
    el("summary", { class: "tiny muted", style: "cursor:pointer;margin-bottom:8px" }, ["Đổi mật khẩu"]),
    el("div", { class: "account-fields" }, [current, next]),
    perr,
    change,
  );

  /*
   * A Google account has no password behind it, and the Worker answers
   * `/api/password` with `no_password` for such a session. Showing the form anyway
   * would offer an action that cannot work, so it is replaced with a statement of the
   * fact. The alternative — showing it and failing — is worse than either, because
   * "my password does not work" reads as a bug rather than as an explanation.
   */
  // The kind was recorded at sign-in time rather than guessed from the address; see
  // src/account/kind.ts for why the client cannot work it out from the token itself.
  const passwordRow: HTMLElement[] = sessionKind() === "google"
    ? [
        el("p", { class: "tiny muted", style: "margin:8px 0 0" }, [
          "Tài khoản Google không có mật khẩu. Đổi đăng nhập bằng Google để quay lại đây.",
        ]),
      ]
    : [details];

  const when = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString("vi-VN")
    : "chưa đồng bộ lần nào";

  body.append(
    el("div", { class: "account-id" }, [
      el("div", { class: "small", style: "font-weight:700" }, [status.email ?? ""]),
      el("div", { class: "tiny muted" }, [`Đồng bộ gần nhất: ${when}`]),
    ]),
    syncStrip(status),
    sync,
    pullBtn,
    el("div", { class: "account-warn tiny" }, [
      "Vườn của bạn được lưu ở cả máy này lẫn tài khoản. Nếu chơi trên hai máy cùng lúc, hãy bấm “Lưu lên tài khoản” trước khi chuyển.",
    ]),
    out,
    ...passwordRow,
  );
}
