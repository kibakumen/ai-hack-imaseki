// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 店の画面の上部（2026-09-25 監査の指摘 店-14）。
//
// 本人の第2回の指摘「上部の方に不要な情報が多いので整理したい。店舗の情報は店舗情報タブで見られるから上部に出さなくていい」
// に反して、「店の画面」の札と見出しが残り、承認済みの店にも毎回「承認済みです」の帯が出ていた。帯とチェックリストの
// クラスには見た目が無く、3つの状態も色で見分けられなかった。

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import StoreAccountPage from "../../app/store/account/page";
import { CouponEditor } from "./CouponEditor";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner } from "./StatusBanner";
import { StoreHome } from "./StoreHome";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const renderHome = async (home: Record<string, unknown>) => {
  api = installFakeApi({
    "GET /api/store/home": () => ({ json: storeHomeDto(home as any) }),
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    "GET /api/store/coupons": () => ({ json: { ok: true, items: [] } }),
  });
  const view = render(<StoreHome />);
  await screen.findByTestId("status-banner");
  return view;
};

describe("店の画面の上部（店-14）", () => {
  it("「店の画面」の札を出さない（店のホーム・クーポン・アカウントの3か所）", async () => {
    const home = await renderHome({ status: "approved" });
    expect(home.container.textContent).not.toMatch(/店の画面/);
    cleanup();
    const coupons = render(<CouponEditor />);
    await screen.findByText(/クーポンはまだありません/);
    expect(coupons.container.textContent).not.toMatch(/店の画面/);
    cleanup();
    const account = render(<StoreAccountPage />);
    expect(account.container.textContent).not.toMatch(/店の画面/);
  });

  it("承認済みの店には長い帯を出さず、小さな札「承認済み」だけ。状態は data-status で見分けられる", async () => {
    await renderHome({ status: "approved" });
    const banner = screen.getByTestId("status-banner");
    expect(banner.getAttribute("data-status")).toBe("approved");
    expect(banner.textContent).toMatch(/承認済み/);
    expect(banner.textContent).not.toMatch(/オファーを公開できます/);
  });

  it("未承認と止められているときは色つきの帯（data-status で色を分ける）", () => {
    for (const status of ["pending", "banned"] as const) {
      render(<StatusBanner status={status} />);
      expect(screen.getByTestId("status-banner").getAttribute("data-status")).toBe(status);
      cleanup();
    }
  });

  it("チェックリストの各行に、済み（✓）と未済（!）の印が付く", () => {
    render(<SetupChecklist checklist={{ license: true, card: false }} missingProfile={[]} />);
    const rows = [...screen.getByTestId("setup-checklist").querySelectorAll("li")];
    const marks = rows.map((row) => row.querySelector(".setup-checklist__mark")?.textContent);
    expect(marks).toEqual(["✓", "!", "✓"]);
  });
});
