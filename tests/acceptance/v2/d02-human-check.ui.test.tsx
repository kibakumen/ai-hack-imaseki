// @vitest-environment jsdom
// 設計の決め（画面）: 3つのフォームに確かめの部品が在り、サイトキーは公開値の入口から受け取る。断られたら決まった文が出て、入れた内容が残る。
// 部品が読み込めなくても送るボタンが押せて、押すと同じ決まった文が出る。
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, loadWeb, refusal, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const publicConfig = (siteKey: string) => () => ({ json: { turnstileSiteKey: siteKey, vapidPublicKey: "vapid-public-test", contactEmail: null } });

describeTask("3", "客の登録のフォームと人かどうかの確かめの部品", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("サイトキーは公開値の入口の値で、値を変えると部品に渡る値も変わる。断られると決まった文が出て入れた内容が残る。送り直すと新しい値を取る", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    // Turnstile の script の代わり（実物の API と同じ形）: render で値を1つ渡し、reset でまた新しい値を渡す
    let n = 0;
    let lastOpts: any = null;
    (window as any).turnstile = {
      render: (_el: HTMLElement, opts: any) => {
        lastOpts = opts;
        opts.callback(`tok-${++n}`);
        return "widget-1";
      },
      reset: () => lastOpts?.callback(`tok-${++n}`),
      remove: () => {},
    };
    for (const siteKey of ["site-key-A", "site-key-B"]) {
      api = installFakeApi({
        "GET /api/config/public": publicConfig(siteKey),
        "GET /api/customer/home": () => ({ status: 401, json: { ok: false } }),
        "POST /api/register/customer": () => refusal("human_check_failed"),
      });
      const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
      render(<CustomerApp />);
      const widget = await screen.findByTestId(TID.human);
      expect(widget.getAttribute("data-sitekey")).toBe(siteKey);
      fireEvent.change(screen.getByTestId(TID.field("nickname")), { target: { value: "たなか" } });
      fireEvent.change(screen.getByTestId(TID.field("phone")), { target: { value: "09012345678" } });
      fireEvent.click(screen.getByTestId(TID.btn("register")));
      const msg = await screen.findByTestId(TID.msgForm);
      expect(msg.textContent).toBe(TEXTS.inputRefusal("human_check_failed"));
      expect((screen.getByTestId(TID.field("nickname")) as HTMLInputElement).value).toBe("たなか");
      expect((screen.getByTestId(TID.field("phone")) as HTMLInputElement).value).toBe("09012345678");
      const first = api.calls.filter((c) => c.path === "/api/register/customer");
      expect(first.at(-1)!.body.humanToken).toMatch(/^tok-\d+$/);
      fireEvent.click(screen.getByTestId(TID.btn("register")));
      await new Promise((r) => setTimeout(r, 20));
      const second = api.calls.filter((c) => c.path === "/api/register/customer");
      expect(second.length).toBe(first.length + 1);
      expect(second.at(-1)!.body.humanToken).toMatch(/^tok-\d+$/);
      expect(second.at(-1)!.body.humanToken).not.toBe(first.at(-1)!.body.humanToken);
      cleanup();
      api.restore();
    }
  });

  it("公開値の入口が失敗すると部品は描かれず、送るボタンは押せて、押すと同じ決まった文が出る", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    api = installFakeApi({
      "GET /api/config/public": () => ({ status: 500, json: { ok: false } }),
      "GET /api/customer/home": () => ({ status: 401, json: { ok: false } }),
      "POST /api/register/customer": () => refusal("human_check_failed"),
    });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    const btn = (await screen.findByTestId(TID.btn("register"))) as HTMLButtonElement;
    expect(screen.queryByTestId(TID.human)).toBeNull();
    expect(btn.disabled).toBe(false);
    fireEvent.change(screen.getByTestId(TID.field("nickname")), { target: { value: "たなか" } });
    fireEvent.change(screen.getByTestId(TID.field("phone")), { target: { value: "09012345678" } });
    fireEvent.click(btn);
    expect((await screen.findByTestId(TID.msgForm)).textContent).toBe(TEXTS.inputRefusal("human_check_failed"));
  });
});

describeTask("4", "店の登録とログインのフォームの確かめの部品", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("店の登録: 部品が在り、断られると決まった文が出て店名とメールアドレスが残る", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    api = installFakeApi({ "GET /api/config/public": publicConfig("site-store"), "POST /api/register/store": () => refusal("human_check_failed") });
    const RegisterForm = await componentOf("components/store/RegisterForm", "RegisterForm");
    render(<RegisterForm />);
    expect((await screen.findByTestId(TID.human)).getAttribute("data-sitekey")).toBe("site-store");
    fireEvent.change(screen.getByTestId(TID.field("name")), { target: { value: "検査の店" } });
    fireEvent.change(screen.getByTestId(TID.field("email")), { target: { value: "s@example.com" } });
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "store-pass-1234" } });
    fireEvent.click(screen.getByTestId(TID.btn("register")));
    expect((await screen.findByTestId(TID.msgForm)).textContent).toBe(TEXTS.inputRefusal("human_check_failed"));
    expect((screen.getByTestId(TID.field("name")) as HTMLInputElement).value).toBe("検査の店");
    expect((screen.getByTestId(TID.field("email")) as HTMLInputElement).value).toBe("s@example.com");
  });

  it("ログイン: 部品が在り、断られると決まった文が出てメールアドレスが残る", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    api = installFakeApi({ "GET /api/config/public": publicConfig("site-login"), "POST /api/auth/login": () => refusal("human_check_failed") });
    const LoginForm = await componentOf("components/auth/LoginForm", "LoginForm");
    render(<LoginForm />);
    expect((await screen.findByTestId(TID.human)).getAttribute("data-sitekey")).toBe("site-login");
    fireEvent.change(screen.getByTestId(TID.field("email")), { target: { value: "s@example.com" } });
    fireEvent.change(screen.getByTestId(TID.field("password")), { target: { value: "store-pass-1234" } });
    fireEvent.click(screen.getByTestId(TID.btn("login")));
    expect((await screen.findByTestId(TID.msgForm)).textContent).toBe(TEXTS.inputRefusal("human_check_failed"));
    expect((screen.getByTestId(TID.field("email")) as HTMLInputElement).value).toBe("s@example.com");
  });
});
