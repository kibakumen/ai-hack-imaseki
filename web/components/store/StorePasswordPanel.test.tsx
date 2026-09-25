// @vitest-environment jsdom
// 店のパスワードの変更の画面（2026-09-25 監査の指摘 安全-07・安全-21 の画面の側）。
//
// 入口が「仮のパスワードの直後でなければ今のパスワードを求める」ようになったので、画面もそれに合わせて
// 今のパスワードの欄を出し分ける（ホームの mustChangePassword で決める）。
// ログインの直後に仮のパスワードの店をこの画面へ直行させること（LoginForm）もここで見る。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, invalidInput, refusal, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { TEXTS } from "../../lib/domain/texts";
import { LoginForm } from "../auth/LoginForm";
import { StoreHome } from "./StoreHome";
import { StorePasswordPanel } from "./StorePasswordPanel";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.unstubAllGlobals();
});

const passwordCalls = () => api!.calls.filter((c) => c.path === "/api/store/password");

describe("店のパスワードの変更の画面", () => {
  it("仮のパスワードで入った店には、今のパスワードの欄を出さず、新しいパスワードだけを送る。決めたらホームへの道が出る", async () => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ mustChangePassword: true }) }),
      "POST /api/store/password": () => ({ json: { ok: true } }),
    });
    render(<StorePasswordPanel />);
    await screen.findByTestId("field-password");
    expect(screen.queryByTestId("field-currentPassword")).toBeNull();
    fireEvent.change(screen.getByTestId("field-password"), { target: { value: "brand-new-password-9" } });
    fireEvent.click(screen.getByTestId("btn-change-password"));
    await screen.findByTestId("password-changed");
    expect(passwordCalls().at(-1)!.body).toEqual({ password: "brand-new-password-9" });
    expect(screen.getByTestId("link-store-home").getAttribute("href")).toBe("/store");
  });

  it("自分で決め直す店には、今のパスワードの欄を出し、合わなければその欄の直下に文が出る", async () => {
    let response: unknown = refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] });
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ mustChangePassword: false }) }),
      "POST /api/store/password": () => response as never,
    });
    render(<StorePasswordPanel />);
    await screen.findByTestId("field-currentPassword");
    fireEvent.change(screen.getByTestId("field-currentPassword"), { target: { value: "wrong-password-1" } });
    fireEvent.change(screen.getByTestId("field-password"), { target: { value: "brand-new-password-9" } });
    fireEvent.click(screen.getByTestId("btn-change-password"));
    const message = await screen.findByTestId("msg-currentPassword");
    expect(message.textContent).toBe(TEXTS.inputRefusal("password_mismatch"));
    expect(passwordCalls().at(-1)!.body).toEqual({ currentPassword: "wrong-password-1", password: "brand-new-password-9" });

    response = invalidInput([{ name: "password", reason: "too_short" }]);
    fireEvent.click(screen.getByTestId("btn-change-password"));
    await screen.findByTestId("msg-password");
    expect(screen.queryByTestId("link-store-home")).toBeNull();
  });
});

describe("仮のパスワードのままの店のホーム（安全-21）", () => {
  it("決める画面への案内だけを出し、押しても断られる操作（状況の帯・公開・向かっている客）は出さない", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ mustChangePassword: true }) }) });
    render(<StoreHome />);
    const notice = await screen.findByTestId("must-change-password");
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("/store/password");
    expect(screen.queryByTestId("status-banner")).toBeNull();
    expect(screen.queryByTestId("btn-publish")).toBeNull();
  });
});

describe("ログインの直後の行き先（安全-21）", () => {
  const login = async (json: unknown) => {
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "", vapidPublicKey: "v", contactEmail: null } }),
      "POST /api/auth/login": () => ({ json }),
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<LoginForm />);
    fireEvent.change(screen.getByTestId("field-email"), { target: { value: "s@example.com" } });
    fireEvent.change(screen.getByTestId("field-password"), { target: { value: "temp-password-1" } });
    fireEvent.click(screen.getByTestId("btn-login"));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    return assign.mock.calls[0][0];
  };

  it("仮のパスワードで入った店は、ホームでなくパスワードを決める画面へ直行する", async () => {
    expect(await login({ ok: true, role: "store", mustChangePassword: true })).toBe("/store/password");
  });

  it("そうでない店はホーム、運営は運営の画面へ", async () => {
    expect(await login({ ok: true, role: "store", mustChangePassword: false })).toBe("/store");
    cleanup();
    api?.restore();
    vi.unstubAllGlobals();
    expect(await login({ ok: true, role: "admin", mustChangePassword: false })).toBe("/admin");
  });
});
