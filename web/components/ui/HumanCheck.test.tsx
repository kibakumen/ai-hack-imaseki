// @vitest-environment jsdom
// 人かどうかの確かめの部品が、入口ごとの用途（action）を Turnstile に名乗ること（2026-09-25 監査の指摘 安全-23）。
//
// 入口は答えの用途が自分の用途と合わなければ断る（http/defineRoute・adapters/turnstile）。部品が用途を名乗らないと、
// 実物の Turnstile の答えの action が空になり、登録もログインも全部断られる。入口の側の期待は
// web/tests/humanCheckExpectation.test.ts が見る。

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { HUMAN_CHECK_ACTIONS } from "../../lib/schemas/limits";
import { LoginForm } from "../auth/LoginForm";
import { RegisterForm as CustomerRegisterForm } from "../customer/RegisterForm";
import { RegisterForm as StoreRegisterForm } from "../store/RegisterForm";
import { HumanCheck } from "./HumanCheck";

type RenderOptions = { sitekey: string; action?: string };

let api: FakeApi | null = null;
let rendered: RenderOptions[] = [];

const installTurnstile = () => {
  rendered = [];
  (window as unknown as { turnstile: unknown }).turnstile = {
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
  delete (window as unknown as { turnstile?: unknown }).turnstile;
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
