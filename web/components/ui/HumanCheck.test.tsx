// @vitest-environment jsdom
// 人かどうかの確かめ（Turnstile）の部品の検査。2つの指摘をまとめて見る。
//
// 1. 入口ごとの用途（action）を Turnstile に名乗ること（2026-09-25 監査の指摘 安全-23）。
//    入口は答えの用途が自分の用途と合わなければ断る（http/defineRoute・adapters/turnstile）。部品が用途を名乗らないと、
//    実物の Turnstile の答えの action が空になり、登録もログインも全部断られる。入口の側の期待は
//    web/tests/humanCheckExpectation.test.ts が見る。
//
// 2. 部品の片付けと失敗の知らせ（2026-09-25 監査の指摘 客-02）。見るのは3つ:
//   - 画面から外れたら、描いた部品を Turnstile から外す（外さないと、同じ要素へ描き直したときに2つ重なる・
//     開発時の StrictMode の「描く→片付け→描く」で1つ目が残る）
//   - 部品が失敗を知らせたら（読み込めない・ホスト名が合わない等）、呼ぶ側へ onError で渡す
//   - 読み込みの札そのものが読み込めなかったときも onError で渡す

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { HUMAN_CHECK_ACTIONS } from "../../lib/schemas/limits";
import { LoginForm } from "../auth/LoginForm";
import { RegisterForm as CustomerRegisterForm } from "../customer/RegisterForm";
import { RegisterForm as StoreRegisterForm } from "../store/RegisterForm";
import { HumanCheck } from "./HumanCheck";

type RenderOptions = { sitekey: string; action?: string };
type TurnstileOptions = { sitekey: string; action?: string; callback: (token: string) => void; "error-callback"?: () => void };
type TurnstileWindow = Window & {
  turnstile?: { render: (el: HTMLElement, opts: TurnstileOptions) => string; reset: (id?: string) => void; remove?: (id: string) => void };
};

let api: FakeApi | null = null;
let rendered: RenderOptions[] = [];

const installTurnstile = () => {
  rendered = [];
  (window as TurnstileWindow).turnstile = {
    render: (_el: HTMLElement, opts: RenderOptions) => {
      rendered.push(opts);
      return "widget-1";
    },
    reset: () => {},
  };
};

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  delete (window as TurnstileWindow).turnstile;
  document.head.querySelectorAll('script[data-turnstile="1"]').forEach((el) => el.remove());
});

describe("確かめの部品の用途（安全-23）", () => {
  it("渡された用途を Turnstile の render に名乗る", async () => {
    installTurnstile();
    render(<HumanCheck siteKey="site-key-test" action={HUMAN_CHECK_ACTIONS.login} onToken={() => {}} />);
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(rendered[0]).toMatchObject({ sitekey: "site-key-test", action: "login" });
  });

  it.each([
    ["ログイン", () => <LoginForm />, HUMAN_CHECK_ACTIONS.login],
    ["店の登録", () => <StoreRegisterForm />, HUMAN_CHECK_ACTIONS.registerStore],
    ["客の登録", () => <CustomerRegisterForm onRegistered={() => {}} />, HUMAN_CHECK_ACTIONS.registerCustomer],
  ])("%sのフォームは、入口と同じ用途を名乗る", async (_label, Form, action) => {
    installTurnstile();
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "v", contactEmail: null } }) });
    render(<Form />);
    await screen.findByTestId("human-check");
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(rendered[0].action).toBe(action);
  });
});

describe("人かどうかの確かめの部品の片付けと失敗の知らせ（客-02）", () => {
  it("画面から外れたら、描いた部品を Turnstile から外す", () => {
    const remove = vi.fn();
    (window as TurnstileWindow).turnstile = { render: () => "widget-7", reset: () => {}, remove };
    const { unmount } = render(<HumanCheck siteKey="s" action={HUMAN_CHECK_ACTIONS.registerCustomer} onToken={() => {}} />);
    expect(remove).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledWith("widget-7");
  });

  it("部品が失敗を知らせたら onError を呼ぶ", () => {
    const onError = vi.fn();
    (window as TurnstileWindow).turnstile = {
      render: (_el, opts) => {
        opts["error-callback"]?.();
        return "widget-1";
      },
      reset: () => {},
    };
    render(<HumanCheck siteKey="s" action={HUMAN_CHECK_ACTIONS.registerCustomer} onToken={() => {}} onError={onError} />);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("読み込みの札が読み込めなかったら onError を呼ぶ", () => {
    const onError = vi.fn();
    render(<HumanCheck siteKey="s" action={HUMAN_CHECK_ACTIONS.registerCustomer} onToken={() => {}} onError={onError} />);
    const script = document.head.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
    expect(script).toBeTruthy();
    script!.dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
