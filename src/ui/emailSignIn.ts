/**
 * The email-and-password half of sign-in, shared by the account sheet and the gate.
 *
 * Built once because it was written twice. Two copies of a sign-in form drift in ways
 * nobody notices: one gets a disabled-while-submitting state and the other does not, one
 * clears the error and the other does not. Sharing it also means a fix lands in both.
 *
 * A real `<form>`, not a div with a click handler, for three reasons that all matter:
 *
 *   Chrome refuses to offer a password manager for a password field that is not inside
 *   a form, and logs a DOM warning about it. That is a security feature degrading into a
 *   console complaint, which is the worst of both.
 *
 *   Enter-to-submit, focus behaviour and label association come from the form rather than
 *   from hand-written keydown handlers, which is why the handlers are gone.
 *
 *   The submit button becomes `type="submit"`, so a mouse press, a keyboard press and
 *   the on-screen keyboard all take the same path.
 */

import { el } from "./components";
import { sfx } from "../audio/audio";
import { signIn, signUp } from "../account/sync";

export interface EmailSignIn {
  /** The `<form>`. Append this, not its children. */
  form: HTMLFormElement;
  /** Where the form's own error message goes. */
  error: HTMLParagraphElement;
  /** The submit button, so a host can disable it around its own work. */
  submit: HTMLButtonElement;
  /** Sign in (false) or register (true). */
  setMode: (register: boolean) => void;
  readonly registering: boolean;
}

function describe(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Không đăng nhập được. Thử lại.";
}

export function buildEmailSignIn(): EmailSignIn {
  const email = el("input", {
    class: "field",
    type: "email",
    placeholder: "Email",
    autocomplete: "email",
    required: "required",
  }) as HTMLInputElement;

  const pass = el("input", {
    class: "field",
    type: "password",
    placeholder: "Mật khẩu (ít nhất 8 ký tự)",
    autocomplete: "current-password",
    required: "required",
  }) as HTMLInputElement;

  /*
   * The in-game name, asked only at registration.
   *
   * Optional: an empty answer falls back to the email prefix once the session
   * exists, and the account sheet can rename it later — so this is a chance to
   * be named, never a wall between the player and their first garden.
   */
  const ign = el("input", {
    class: "field",
    type: "text",
    placeholder: "Tên trong game (tuỳ chọn)",
    autocomplete: "nickname",
    maxlength: "24",
  }) as HTMLInputElement;
  ign.hidden = true;

  const submit = el("button", { class: "btn primary wide", type: "submit" }, ["Đăng nhập"]);
  const swap = el("button", { class: "btn ghost wide", type: "button", style: "margin-top:8px" }, [
    "Chưa có tài khoản? Đăng ký",
  ]);
  const error = el("p", { class: "account-err" });

  let registering = false;

  const form = el("form", { class: "account-fields", autocomplete: "on" }) as HTMLFormElement;
  form.append(email, ign, pass, error, submit, swap);
  form.noValidate = true;

  const apply = (): void => {
    submit.textContent = registering ? "Đăng ký" : "Đăng nhập";
    swap.textContent = registering ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký";
    // The browser's own manager keys off this, so getting it wrong saves a password to
    // the wrong form.
    pass.autocomplete = registering ? "new-password" : "current-password";
    ign.hidden = !registering;
  };

  form.addEventListener("submit", (e) => {
    // Not a page form: submitting would reload the game and lose the garden.
    e.preventDefault();
    void (async () => {
      error.textContent = "";
      if (!email.value.trim()) {
        error.textContent = "Cần email.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Đang xử lý…";
      try {
        if (registering) await signUp(email.value.trim(), pass.value, ign.value.trim() || undefined);
        else await signIn(email.value.trim(), pass.value);
        sfx.play("levelUp");
        form.dispatchEvent(new CustomEvent("signed-in", { bubbles: true }));
      } catch (err) {
        error.textContent = describe(err);
        sfx.play("error");
      } finally {
        submit.disabled = false;
        apply();
      }
    })();
  });

  swap.addEventListener("click", () => {
    registering = !registering;
    error.textContent = "";
    apply();
  });

  apply();

  return {
    form,
    error,
    submit,
    setMode: (register) => {
      registering = register;
      apply();
    },
    get registering() {
      return registering;
    },
  };
}