// @vitest-environment jsdom
// 店と運営の画面のログアウト（2026-09-25 監査の指摘 安全-09）。
//
// 入口 POST /api/auth/logout は在ったのに、画面から呼ぶ所が1つも無かった。セッションは使い続ける限り
// 延びるので、店の共用タブレットや会場の共用 PC では、次に触った人がそのまま客の電話番号を見られた。
// ここは3つを見る: 店の画面（店舗情報の「そのほか」）と運営の殻にボタンが在ること／押すと入口を呼んでから /login へ移ること／
// 入口が落ちたら移らずに文を出すこと（切れていないのに切れたように見せない）。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "../../app/admin/layout";
import { TEXTS } from "../../lib/domain/texts";
import { StoreMoreLinks } from "../store/StoreMoreLinks";
import { LogoutButton } from "./LogoutButton";

type Call = { method: string; path: string };

const installFetch = (status: number, json: unknown) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", path: new URL(String(input), "http://localhost").pathname });
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = previous) };
};

const stubLocation = () => {
  const replace = vi.fn();
  vi.stubGlobal("location", { ...window.location, replace });
  return replace;
};

let restoreFetch: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restoreFetch?.();
  restoreFetch = null;
  vi.unstubAllGlobals();
});

describe("ログアウトのボタン（安全-09）", () => {
  // 2026-10-08 本人選択「案C 片手の親指」: 店の下のナビは4つ（オファー・クーポン・実績・店舗情報）にまとめ、
  // ログアウトは書類・アカウントと一緒に店舗情報の画面の「そのほか」へ移した（StoreMoreLinks）。
  it("店舗情報の画面の「そのほか」と運営の殻のナビに在る", () => {
    restoreFetch = installFetch(401, { ok: false, error: { kind: "unauthorized" } }).restore;
    render(<StoreMoreLinks />);
    const more = screen.getByRole("heading", { name: "そのほか" }).closest("section");
    expect(more?.contains(screen.getByTestId("btn-logout"))).toBe(true);
    cleanup();
    render(<AdminLayout>{null}</AdminLayout>);
    expect(screen.getByTestId("admin-nav").querySelector('[data-testid="btn-logout"]')).not.toBeNull();
  });

  it("押すと入口 POST /api/auth/logout を呼んでから /login へ移る", async () => {
    const fake = installFetch(200, { ok: true });
    restoreFetch = fake.restore;
    const replace = stubLocation();
    render(<LogoutButton />);
    fireEvent.click(screen.getByTestId("btn-logout"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(fake.calls).toEqual([{ method: "POST", path: "/api/auth/logout" }]);
  });

  it("入口が落ちたら /login へ移らず、ボタンの近くに文を出して、押し直せる", async () => {
    const fake = installFetch(500, { ok: false, error: { kind: "internal" } });
    restoreFetch = fake.restore;
    const replace = stubLocation();
    render(<LogoutButton />);
    fireEvent.click(screen.getByTestId("btn-logout"));
    const message = await screen.findByTestId("logout-failed");
    expect(message.textContent).toBe(TEXTS.inputRefusal("internal"));
    expect(replace).not.toHaveBeenCalled();
    expect((screen.getByTestId("btn-logout") as HTMLButtonElement).disabled).toBe(false);
  });
});
