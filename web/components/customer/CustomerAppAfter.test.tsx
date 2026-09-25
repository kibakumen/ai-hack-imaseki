// @vitest-environment jsdom
// 確保を取ったあとの客の画面（2026-09-25 監査の指摘 客-03・客-08・不具合-18）。
//
//   不具合-18 … 既定の幅を過ぎた完了済みは、取得の画面の「前回: ◯◯（完了済み）を開く」から開ける（基準 9.4）
//   客-03    … 確保を持ったまま探している間も、確保中の表示へ戻る道が常に在り、その間に確保が変わったら知らせる
//   客-08    … 結果の到着・確保の成立・状態の変化を読み上げで伝え、焦点を見失わせない

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, reservationDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";

vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => ({ ok: true, lat: 35.6, lng: 139.7 }) }));

const ITEM = { offerId: "o1", storeId: "s1", storeName: "店A", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "合います", partyMax: 4, coupons: [], storeUrl: null, storeAddress: null };
const CONFIG = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("前回の完了済み（不具合-18）", () => {
  it("取得の画面に「前回: 店名（完了済み）を開く」が出て、押すと完了済みの表示と通報の入口が出る。「ほかの店を探す」で取得の画面へ戻る", async () => {
    const previous = reservationDto({ status: "completed", storeName: "先週の店", code: "" });
    api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: homeFetch({ previousCompleted: previous } as never) }) });
    render(<CustomerApp />);
    const entry = await screen.findByTestId("btn-open-previous");
    expect(entry.textContent).toContain("先週の店");
    expect(entry.textContent).toMatch(/完了済み/);
    fireEvent.click(entry);
    const view = await screen.findByTestId("view-completed");
    expect(view.textContent).toContain("先週の店");
    expect(within(view).getByTestId("btn-report")).toBeTruthy();
    expect(screen.queryByTestId("btn-fetch")).toBeNull();
    fireEvent.click(within(view).getByTestId("btn-search-again"));
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("view-completed")).toBeNull();
  });

  it("前回の完了済みが無ければ入口は出ない", async () => {
    api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: homeFetch() }) });
    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("btn-open-previous")).toBeNull();
  });
});
