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

describe("読み上げと焦点（客-08）", () => {
  const liveText = () => screen.getByTestId("live-status").textContent ?? "";

  it("結果が届くと件数を読み上げの領域へ入れ、焦点を結果の見出しへ移す（押したボタンは畳まれて消える）", async () => {
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => ({ json: homeFetch() }),
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [ITEM] } }),
    });
    render(<CustomerApp />);
    const live = await screen.findByTestId("live-status");
    expect(live.getAttribute("role")).toBe("status");
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await screen.findByTestId("result-o1");
    await waitFor(() => expect(liveText()).toMatch(/1\s*件/));
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/今入れるお店/));
  });

  it("受け取りが通ると確保番号を読み上げ、演出は aria-modal の画面として見出しに焦点を置き、Esc で閉じると確保番号へ焦点が移る", async () => {
    const reservation = reservationDto({ code: "55667788" });
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => ({ json: homeFetch() }),
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [ITEM] } }),
      "POST /api/customer/reservations": () => ({ json: { ok: true, reservation, home: homeFetch({ kind: "active", reservation }) } }),
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-fetch"));
    fireEvent.click(within(await screen.findByTestId("result-o1")).getByTestId("btn-receive"));
    const dialog = await screen.findByTestId("claimed-celebration");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toMatch(/受け取りました/);
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(liveText()).toMatch(/55667788/);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("claimed-celebration")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("reservation-code")));
  });

  it("取り直しで確保中から取り消しに変わったことを読み上げる", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let kind: "active" | "store_cancelled" = "active";
    api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: homeFetch({ kind, reservation: reservationDto({ status: kind }) }) }) });
    render(<CustomerApp />);
    await screen.findByTestId("view-active");
    kind = "store_cancelled";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("view-store_cancelled")).toBeTruthy();
    expect(liveText()).toMatch(/取り消されました/);
  });
});

describe("過去の受け取りの見返し（客-13 の案A）", () => {
  it("「最近行った店」を開くと、過去の受け取り（店名・状態・住所・ホームページ・コード）と「もう一度探す」が出る。押すと取得の画面へ", async () => {
    api = installFakeApi({
      "GET /api/config/public": CONFIG,
      "GET /api/customer/home": () => ({ json: homeFetch({ kind: "active", reservation: reservationDto() }) }),
      "GET /api/customer/recent": () => ({ json: { items: [] } }),
      "GET /api/customer/history": () => ({
        json: {
          items: [
            { id: "old-1", code: "87650000", status: "completed", storeId: "s9", storeName: "先月の店", storeAddress: "東京都新宿区西新宿1-1", storeUrl: "https://example.com/old", party: 2, receivedAt: "2026-08-20T10:00:00.000Z" },
          ],
        },
      }),
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-recent"));
    const row = await screen.findByTestId("history-row-old-1");
    expect(row.textContent).toContain("先月の店");
    expect(row.textContent).toContain("東京都新宿区西新宿1-1");
    expect(row.textContent).toContain("87650000");
    expect(row.querySelector("a[href='https://example.com/old']")).toBeTruthy();
    fireEvent.click(screen.getByTestId("btn-history-search"));
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("history-row-old-1")).toBeNull();
    // 確保を持ったままなので、確保中の表示へ戻る道がある
    expect(screen.getByTestId("btn-back-to-reservation")).toBeTruthy();
  });
});
