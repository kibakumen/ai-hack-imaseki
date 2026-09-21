// @vitest-environment jsdom
// 要件12（画面）: 12.2〜12.5 の断りの表示（タスク4）、12.6〜12.9 の帯とチェックリスト（タスク7）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, refusal, storeHomeDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const publicConfig = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

describeTask("4", "店の登録のフォーム（断りの表示）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("email_taken／invalid_input（password・email・name を1つずつと同時）で、その欄の直下にだけ文が出て、店名とメールアドレスが残り、パスワードは残さず、フォームのまま、送るボタンは押せる", async () => {
    let response: any = refusal("email_taken", { fields: [{ name: "email", reason: "not_allowed" }] });
    api = installFakeApi({ "GET /api/config/public": publicConfig, "POST /api/register/store": () => response });
    const RegisterForm = await componentOf("components/store/RegisterForm", "RegisterForm");
    render(<RegisterForm />);
    await screen.findByTestId(TID.field("name"));
    fireEvent.change(screen.getByTestId(TID.field("name")), { target: { value: "検査の店" } });
    fireEvent.change(screen.getByTestId(TID.field("email")), { target: { value: "dup@example.com" } });
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "store-pass-1234" } });
    const submit = screen.getByTestId(TID.btn("register")) as HTMLButtonElement;
    fireEvent.click(submit);
    await screen.findByTestId(TID.msg("email"));
    expect(screen.queryByTestId(TID.msg("name"))).toBeNull();
    expect(screen.queryByTestId(TID.msg("password"))).toBeNull();
    expect((screen.getByTestId(TID.field("name")) as HTMLInputElement).value).toBe("検査の店");
    expect((screen.getByTestId(TID.field("email")) as HTMLInputElement).value).toBe("dup@example.com");
    expect((screen.getByTestId(TID.field("password")) as HTMLInputElement).value).toBe("");
    expect(submit.disabled).toBe(false);

    for (const field of ["password", "email", "name"]) {
      response = invalidInput([{ name: field, reason: field === "password" ? "too_short" : field === "email" ? "bad_format" : "too_long" }]);
      fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "x" } });
      fireEvent.click(submit);
      await screen.findByTestId(TID.msg(field));
      for (const other of ["password", "email", "name"].filter((f) => f !== field)) await waitFor(() => expect(screen.queryByTestId(TID.msg(other))).toBeNull());
    }
    response = invalidInput([
      { name: "name", reason: "too_long" },
      { name: "email", reason: "bad_format" },
      { name: "password", reason: "too_short" },
    ]);
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "x" } });
    fireEvent.click(submit);
    await screen.findByTestId(TID.msg("password"));
    expect(screen.getByTestId(TID.msg("name"))).toBeTruthy();
    expect(screen.getByTestId(TID.msg("email"))).toBeTruthy();
  });
});

describeTask("7", "店のホームの帯とチェックリスト", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderHome = async (home: any) => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: home }), "GET /api/config/public": publicConfig });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    return render(<StoreHome />);
  };

  it("12.6・12.7・12.8 未承認: 承認待ちと公開できないこと、足りないもの（許可書・カード）が出る。登録済みのものは足りないものに出ない", async () => {
    const { container } = await renderHome(storeHomeDto({ status: "pending", checklist: { license: false, card: false } }));
    await screen.findByTestId("status-banner");
    expect(screen.getByTestId("status-banner").textContent).toMatch(/未承認|承認を待って/);
    expect(screen.getByTestId("status-banner").textContent).toMatch(/公開できません|公開できない/);
    const checklist = screen.getByTestId("setup-checklist");
    expect(checklist.textContent).toMatch(/営業許可書/);
    expect(checklist.textContent).toMatch(/カード/);
    expect(container.querySelector(`[data-testid="${TID.btn("publish")}"]`)).toBeNull();
    cleanup();
    api.restore();
    await renderHome(storeHomeDto({ status: "pending", checklist: { license: true, card: false } }));
    await screen.findByTestId("setup-checklist");
    expect(screen.getByTestId("setup-checklist").querySelectorAll('[data-missing="true"]')).toHaveLength(1);
    expect(screen.getByTestId("setup-checklist").querySelector('[data-missing="true"]')!.textContent).toMatch(/カード/);
  });

  it("12.9 止められている: 運営に止められているため公開できないことが出て、公開のフォームが無い", async () => {
    await renderHome(storeHomeDto({ status: "banned" }));
    await screen.findByTestId("status-banner");
    expect(screen.getByTestId("status-banner").textContent).toMatch(/止められて/);
    expect(screen.getByTestId("status-banner").textContent).toMatch(/公開できません|公開できない/);
    expect(screen.queryByTestId(TID.btn("publish"))).toBeNull();
  });

  it("12.6 承認済み: 承認済みと出て、公開のフォームが在る", async () => {
    await renderHome(storeHomeDto({ status: "approved" }));
    await screen.findByTestId("status-banner");
    expect(screen.getByTestId("status-banner").textContent).toMatch(/承認済み/);
    expect(await screen.findByTestId(TID.btn("publish"))).toBeTruthy();
  });
});
