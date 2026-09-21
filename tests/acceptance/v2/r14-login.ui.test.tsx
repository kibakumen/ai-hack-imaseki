// @vitest-environment jsdom
// 要件14（画面）: 14.2 ログインの断り（タスク4）、14.15・14.17 パスワードの変更と運営の連絡先（タスク31）。
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, refusal, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("4", "ログインのフォーム", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("14.2 login_failed で「ログイン」の直下に文が出て、文にどちらが違うかが無く、入れたメールアドレスが残り、フォームのまま", async () => {
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "POST /api/auth/login": () => refusal("login_failed") });
    const LoginForm = await componentOf("components/auth/LoginForm", "LoginForm");
    render(<LoginForm />);
    await screen.findByTestId(TID.field("email"));
    fireEvent.change(screen.getByTestId(TID.field("email")), { target: { value: "s@example.com" } });
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "wrong-pass-1234" } });
    fireEvent.click(screen.getByTestId(TID.btn("login")));
    const msg = await screen.findByTestId(TID.msgForm);
    expect(msg.textContent!.length).toBeGreaterThan(0);
    expect(msg.textContent).not.toMatch(/メールアドレスが違|パスワードが違|存在しません|登録されていません/);
    expect(screen.queryByTestId(TID.msg("email"))).toBeNull();
    expect(screen.queryByTestId(TID.msg("password"))).toBeNull();
    expect((screen.getByTestId(TID.field("email")) as HTMLInputElement).value).toBe("s@example.com");
    expect(screen.getByTestId(TID.btn("login"))).toBeTruthy();
  });
});

describeTask("31", "【最終日】パスワードの変更のフォームと、ログインの画面の運営の連絡先", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("14.15 invalid_input（password too_short／too_long）で欄の直下に文が出て、変更のフォームのまま。通ると文が無い", async () => {
    let response: any = invalidInput([{ name: "password", reason: "too_short" }]);
    api = installFakeApi({ "POST /api/store/password": () => response });
    const PasswordForm = await componentOf("components/store/PasswordForm", "PasswordForm");
    render(<PasswordForm />);
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "short" } });
    fireEvent.click(screen.getByTestId(TID.btn("change-password")));
    const a = (await screen.findByTestId(TID.msg("password"))).textContent;
    response = invalidInput([{ name: "password", reason: "too_long" }]);
    fireEvent.click(screen.getByTestId(TID.btn("change-password")));
    await new Promise((r) => setTimeout(r, 20));
    const b = screen.getByTestId(TID.msg("password")).textContent;
    expect(a).not.toBe(b);
    expect(screen.getByTestId(TID.field("password"))).toBeTruthy();
    response = { json: { ok: true } };
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "brand-new-password-9" } });
    fireEvent.click(screen.getByTestId(TID.btn("change-password")));
    await screen.findByTestId("password-changed");
    expect(screen.queryByTestId(TID.msg("password"))).toBeNull();
  });

  it("14.17 ログインの画面に、公開値の入口が返した運営の連絡先が出て、値を変えると表示も変わる", async () => {
    for (const email of ["unei@example.com", "help@example.org"]) {
      api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: email } }) });
      const LoginForm = await componentOf("components/auth/LoginForm", "LoginForm");
      const { container } = render(<LoginForm />);
      await screen.findByText(new RegExp(email.replace(".", "\\.")));
      expect(container.textContent).toMatch(/忘れ/);
      expect(container.textContent).toMatch(/メール/);
      cleanup();
      api.restore();
    }
  });
});
