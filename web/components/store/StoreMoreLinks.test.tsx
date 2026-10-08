// @vitest-environment jsdom
// 店舗情報の画面の「そのほか」（2026-10-08 本人選択「案C 片手の親指」）。下のナビを4つにまとめたので、
// 書類・アカウント・ログアウトはここから辿る。ログアウトは共用の端末に客の情報を残さないための操作（安全-09）。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";

const PROFILE_FAILS = () => ({ status: 500, json: { ok: false, error: { kind: "internal" } } });
import StoreProfilePage from "../../app/store/profile/page";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("店舗情報の画面の「そのほか」", () => {
  it("書類・アカウントへの道とログアウトが出て、承認の状態が軽い入口（GET /api/store/status）から出る。店のホームは読まない", async () => {
    api = installFakeApi({
      "GET /api/store/status": () => ({ json: { ok: true, status: "approved" } }),
      "GET /api/store/home": () => ({ json: storeHomeDto({ status: "approved" }) }),
      "GET /api/store/profile": PROFILE_FAILS,
    });
    render(<StoreProfilePage />);
    const more = screen.getByRole("heading", { name: "そのほか" }).closest("section")!;
    expect(within(more).getByRole("link", { name: /書類/ }).getAttribute("href")).toBe("/store/documents");
    expect(within(more).getByRole("link", { name: /アカウント/ }).getAttribute("href")).toBe("/store/account");
    expect(within(more).getByTestId("btn-logout")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("status-banner").textContent).toMatch(/承認済み/));
    expect(api.calls.some((c) => c.path === "/api/store/home")).toBe(false);
  });

  // 2026-10-08 本人選択: それまでは読めなかったとき黙って何も出さなかった
  it("承認の状態が読めなかったら、読めなかったことと「もう一度読み込む」が出て、押すと読み直す", async () => {
    let fail = true;
    api = installFakeApi({
      "GET /api/store/status": () => (fail ? { status: 500, json: { ok: false, error: { kind: "internal" } } } : { json: { ok: true, status: "pending" } }),
      "GET /api/store/profile": PROFILE_FAILS,
    });
    render(<StoreProfilePage />);
    const failed = await screen.findByTestId("store-status-failed");
    expect(failed.textContent!.length).toBeGreaterThan(0);
    fail = false;
    fireEvent.click(within(failed).getByRole("button", { name: "もう一度読み込む" }));
    await waitFor(() => expect(screen.getByTestId("status-banner").textContent).toMatch(/承認を待って/));
    expect(screen.queryByTestId("store-status-failed")).toBeNull();
  });
});
