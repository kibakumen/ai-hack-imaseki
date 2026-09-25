// @vitest-environment jsdom
// 確保を取ったあとの客の画面（2026-09-25 監査の指摘 客-03・客-08・不具合-18）。
//
//   不具合-18 … 既定の幅を過ぎた完了済みは、取得の画面の「前回: ◯◯（完了済み）を開く」から開ける（基準 9.4）
//   客-03    … 確保を持ったまま探している間も、確保中の表示へ戻る道が常に在り、その間に確保が変わったら知らせる
//   客-08    … 結果の到着・確保の成立・状態の変化を読み上げで伝え、焦点を見失わせない

import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("取り直しの古い応答（不具合-17）", () => {
  it("取り直しの通信中に受け取ると、押す前に送った取り直しの応答（確保なし）が後から届いても確保中の表示のまま", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let held = false;
    let release: (() => void) | null = null;
    const reservation = reservationDto({ code: "24681357" });
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => {
        // 押す前の取り直し: 確保が無い時点の中身を、受け取りが通るまで返さずに持つ
        if (!held && release === null && api!.calls.filter((c) => c.path === "/api/customer/home").length > 1) {
          return new Promise((resolve) => {
            release = () => resolve({ json: homeFetch() });
          });
        }
        return { json: held ? homeFetch({ kind: "active", reservation }) : homeFetch() };
      },
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [ITEM] } }),
      "POST /api/customer/reservations": () => {
        held = true;
        return { json: { ok: true, reservation, home: homeFetch({ kind: "active", reservation }) } };
      },
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-fetch"));
    const card = await screen.findByTestId("result-o1");
    // 10秒ごとの取り直しを1回走らせ、その応答を持ったまま受け取る
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(release).not.toBeNull();
    fireEvent.click(within(card).getByTestId("btn-receive"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId("view-active")).toBeTruthy();
    await act(async () => {
      release!();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("view-active").textContent).toContain("24681357");
    expect(screen.queryByTestId("btn-fetch")).toBeNull();
  });
});

describe("確保を持ったまま探しているとき（客-03）", () => {
  const holdingApp = (home: () => unknown) => {
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => ({ json: home() }),
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [ITEM] } }),
    });
    render(<CustomerApp />);
  };

  it("「ほかの店を探す」のあと、探す前から「確保中の表示へ戻る」が在り、押すと確保中の表示へ戻る。結果が出たあとも在る", async () => {
    holdingApp(() => homeFetch({ kind: "active", reservation: reservationDto() }));
    fireEvent.click(await screen.findByTestId("btn-search-more"));
    fireEvent.click(await screen.findByTestId("btn-back-to-reservation"));
    await screen.findByTestId("view-active");
    fireEvent.click(screen.getByTestId("btn-search-more"));
    fireEvent.click(await screen.findByTestId("btn-fetch"));
    await screen.findByTestId("result-o1");
    expect(screen.getAllByTestId("btn-back-to-reservation")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("btn-back-to-reservation"));
    await screen.findByTestId("view-active");
  });

  it("探している間に店が確保を取り消したら、取得の画面を離れて取り消しの表示を出す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let kind: "active" | "store_cancelled" = "active";
    holdingApp(() => homeFetch({ kind, reservation: reservationDto({ status: kind }) }));
    fireEvent.click(await screen.findByTestId("btn-search-more"));
    expect(screen.getByTestId("btn-fetch")).toBeTruthy();
    kind = "store_cancelled";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("view-store_cancelled")).toBeTruthy();
    expect(screen.queryByTestId("btn-back-to-reservation")).toBeNull();
  });

  it("端末の戻る操作で、確保を持ったまま探している取得の画面を閉じて確保中の表示へ戻る（/me の外へ出ない）", async () => {
    holdingApp(() => homeFetch({ kind: "active", reservation: reservationDto() }));
    fireEvent.click(await screen.findByTestId("btn-search-more"));
    await screen.findByTestId("btn-fetch");
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await screen.findByTestId("view-active");
  });

  it("端末の戻る操作で、受け取った直後の演出を閉じる（下の確保中の表示が残る）", async () => {
    const reservation = reservationDto({ code: "11223344" });
    let held = false;
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => ({ json: held ? homeFetch({ kind: "active", reservation }) : homeFetch() }),
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [ITEM] } }),
      "POST /api/customer/reservations": () => {
        held = true;
        return { json: { ok: true, reservation, home: homeFetch({ kind: "active", reservation }) } };
      },
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-fetch"));
    fireEvent.click(within(await screen.findByTestId("result-o1")).getByTestId("btn-receive"));
    await screen.findByTestId("claimed-celebration");
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.queryByTestId("claimed-celebration")).toBeNull();
    expect(screen.getByTestId("view-active").textContent).toContain("11223344");
  });
});
