// @vitest-environment jsdom
// 運営のアカウントの画面の、メールアドレスの確認の案内（2026-09-26 本人選択（AI提示））。
// 店のホームの帯（components/store/EmailVerifyBanner）と同じ作りで、確認の状態を読む入口 GET /api/admin/email/verify が
// verified:false を返したときだけ出す。メールを送る口が無い公開先（入口が 404）と確認済みでは出さない。
// 送るのは運営の入口 POST /api/admin/email/verify。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { AdminEmailVerify } from "./AdminEmailVerify";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("運営のアカウントの画面の確認の案内", () => {
  it("まだ確認していなければ、店と同じ帯が出て、送ると運営の入口へ登録したアドレスが送られる", async () => {
    api = installFakeApi({
      "GET /api/admin/email/verify": () => ({ json: { ok: true, verified: false } }),
      "POST /api/admin/email/verify": () => ({ json: { ok: true } }),
    });
    render(<AdminEmailVerify />);
    const banner = await screen.findByTestId("email-verify-banner");
    expect(banner.textContent).toMatch(/まだ確認されていません/);
    fireEvent.change(screen.getByTestId("field-email-verify"), { target: { value: "unei@example.com" } });
    fireEvent.click(screen.getByTestId("btn-email-verify"));
    await waitFor(() => expect(api!.calls.filter((c) => c.method === "POST" && c.path === "/api/admin/email/verify")).toHaveLength(1));
    expect(api!.calls.find((c) => c.method === "POST")?.body).toEqual({ email: "unei@example.com" });
    expect(await screen.findByTestId("email-verify-sent")).toBeTruthy();
  });

  it("確認済みなら帯を出さない", async () => {
    api = installFakeApi({ "GET /api/admin/email/verify": () => ({ json: { ok: true, verified: true } }) });
    render(<AdminEmailVerify />);
    await waitFor(() => expect(api!.calls.some((c) => c.path === "/api/admin/email/verify")).toBe(true));
    expect(screen.queryByTestId("email-verify-banner")).toBeNull();
  });

  it("メールを送る口が無い公開先（入口が 404）では帯を出さない", async () => {
    api = installFakeApi({ "GET /api/admin/email/verify": () => ({ status: 404, json: { ok: false, error: { kind: "not_found" } } }) });
    render(<AdminEmailVerify />);
    await waitFor(() => expect(api!.calls.some((c) => c.path === "/api/admin/email/verify")).toBe(true));
    expect(screen.queryByTestId("email-verify-banner")).toBeNull();
  });
});
