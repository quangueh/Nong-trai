/** Account sheet: sign in, sign up, and see the sync state. */

import { el, toast } from "./components";
import { sfx } from "../audio/audio";
import {
  GoogleSignInError,
  googleFailureMessage,
  googleSignInAvailable,
  renderGoogleButton,
  requestGoogleIdToken,
} from "../account/google";
import { AccountError, accountServiceAvailable } from "../account/api";
import { sessionKind } from "../account/kind";
import {
  accountStatus,
  isSignedIn,
  keepLocal,
  onAccountStatus,
  pull,
  push,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
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
/**
 * The open sheet's repaint function, or null when no sheet is open.
 *
 * A module-level hook because a Google sign-in finishes inside a promise chain outside
 * `openAccount`'s scope, and it still has to repaint the panel it did not build. Without
 * it, a successful Google sign-in left the sheet sitting on the signed-out form and the
 * player had no way to tell whether anything had happened.
 */
let repaint: (() => void) | null = null;

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

  const render = (): void => {
    body.replaceChildren();
    if (!accountServiceAvailable) {
      body.append(
        el("p", { class: "small" }, [
          "Chưa cấu hình dịch vụ tài khoản. Game vẫn chơi bình thường, vườn được lưu trên máy này.",
        ]),
        el("p", { class: "tiny muted", style: "margin-top:8px" }, [
          "Để bật: đặt VITE_ACCOUNT_API trong .env rồi dựng Worker theo worker/README.md.",
        ]),
      );
      return;
    }
    if (isSignedIn()) renderSignedIn(body, render);
    else renderSignedOut(body, render);
  };

  const off = onAccountStatus(() => {
    // The status strip updates in place rather than rebuilding the sheet, so a
    // sync finishing does not close the form the player is halfway through.
    const strip = body.querySelector(".account-sync");
    if (strip) strip.replaceWith(syncStrip(accountStatus()));
  });

  // Registered so a Google sign-in, which runs inside a promise and outside this
  // function's scope, can repaint the sheet when it succeeds.
  repaint = render;

  const close = (): void => {
    off();
    // Cleared, not left dangling. A stale repaint would write into a detached sheet if
    // a Google sign-in resolved after the player closed the sheet — harmless visually,
    // but it keeps the whole sheet alive in memory for as long as the promise lives.
    repaint = null;
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

function renderSignedOut(body: HTMLElement, render: () => void): void {
  const email = el("input", { class: "field", type: "email", placeholder: "Email", autocomplete: "email" }) as HTMLInputElement;
  const pass = el("input", { class: "field", type: "password", placeholder: "Mật khẩu (ít nhất 8 ký tự)", autocomplete: "current-password" }) as HTMLInputElement;
  const note = el("p", { class: "tiny muted" }, [
    "Không bắt buộc. Không đăng nhập thì vườn chỉ nằm trên máy này và mất nếu xoá dữ liệu trình duyệt.",
  ]);
  const err = el("p", { class: "account-err" });

  let mode: "in" | "up" = "in";
  const submit = el("button", { class: "btn primary wide" }, ["Đăng nhập"]);
  const swap = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Chưa có tài khoản? Đăng ký"]);

  const apply = (): void => {
    submit.textContent = mode === "in" ? "Đăng nhập" : "Đăng ký";
    swap.textContent = mode === "in" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập";
    pass.autocomplete = mode === "in" ? "current-password" : "new-password";
  };

  const run = async (): Promise<void> => {
    err.textContent = "";
    if (!email.value.trim()) {
      err.textContent = "Cần email.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Đang xử lý…";
    try {
      if (mode === "in") await signIn(email.value.trim(), pass.value);
      else await signUp(email.value.trim(), pass.value);
      sfx.play("levelUp");
      toast("Đã đăng nhập.");
      render();
    } catch (e) {
      err.textContent = explain(e);
      sfx.play("error");
    } finally {
      submit.disabled = false;
      apply();
    }
  };

  submit.addEventListener("click", () => void run());
  swap.addEventListener("click", () => {
    mode = mode === "in" ? "up" : "in";
    err.textContent = "";
    apply();
  });
  for (const input of [email, pass]) {
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") void run();
    });
  }

  body.append(
    syncStrip(accountStatus()),
    ...googleSection(err),
    el("div", { class: "account-sep tiny muted" }, ["hoặc — hoặc"],),
    el("div", { class: "account-fields" }, [email, pass]),
    err,
    submit,
    swap,
    note,
  );
  apply();
}

/**
 * The Google half of the signed-out panel.
 *
 * Rendered asynchronously because Google's script is, and it is allowed to fail. The
 * returned elements are appended immediately and filled in when the script arrives, so
 * the email form is usable the whole time rather than waiting on a third party.
 */
function googleSection(err: HTMLElement): HTMLElement[] {
  const slot = el("div", { class: "account-google" });
  const spinner = el("div", { class: "tiny muted", style: "text-align:center;padding:6px 0" }, [
    "Đảng tải đăng nhập Google…",
  ]);
  slot.appendChild(spinner);

  if (!googleSignInAvailable) {
    // Said plainly instead of hidden. A missing option with no explanation reads as
    // "this game does not support Google", which is a different and wrong statement.
    slot.replaceChildren(
      el("div", { class: "tiny muted", style: "text-align:center;padding:6px 0" }, [
        "Đăng nhập Google chưa bố trì đị bềt đếnh (VITE_GOOGLE_CLIENT_ID).",
      ]),
    );
    return [slot];
  }

  void renderGoogleButton(slot)
    .then((painted) => {
      if (painted) return;
      slot.replaceChildren(
        el("div", { class: "tiny muted", style: "text-align:center;padding:6px 0" }, [
          "Không tải được nùt đăng nhập Google. Bạn vẫn đăng nhập bằng email được dưới.",
        ]),
      );
    })
    .catch(() => {
      slot.replaceChildren(
        el("div", { class: "tiny muted", style: "text-align:center;padding:6px 0" }, [
          "Không tải được nùt đăng nhập Google.",
        ]),
      );
    });

  // The click path. Google's own button renders its own popup and calls the callback set
  // in initialize(), so this listener never fires — it is here for the case where the
  // script loaded but the button did not paint, which is otherwise a dead zone.
  slot.addEventListener("click", () => {
    if (slot.querySelector("iframe")) return;
    void runGoogle(err);
  });

  return [slot];
}

/** Ask Google, then hand the token to the Worker. Every failure is named. */
async function runGoogle(err: HTMLElement): Promise<void> {
  err.textContent = "";
  try {
    const idToken = await requestGoogleIdToken();
    const session = await signInWithGoogle(idToken);
    sfx.play("levelUp");
    toast(session.created ? "Đã chào mối. Đã đồng bộ." : "Đã quay lại. Đồng bộ xong.");
    repaint?.();
  } catch (e) {
    if (e instanceof GoogleSignInError) err.textContent = googleFailureMessage(e.code);
    else err.textContent = explain(e);
    sfx.play("error");
  }
}


function renderSignedIn(body: HTMLElement, render: () => void): void {
  const status = accountStatus();

  const sync = el("button", { class: "btn wide" }, ["Lưu lên tài khoản ngay"]);
  sync.addEventListener("click", () => void push());

  const pullBtn = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Tải vườn từ tài khoản"]);
  pullBtn.addEventListener("click", () => void pull());

  const out = el("button", { class: "btn ghost wide", style: "margin-top:8px" }, ["Đăng xuất"]);
  out.addEventListener("click", () => {
    signOut();
    render();
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
