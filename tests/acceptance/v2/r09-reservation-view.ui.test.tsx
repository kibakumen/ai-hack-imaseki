// @vitest-environment jsdom
// 要件9 確保中の表示（画面）: 9.1〜9.7・9.13 の表示、9.8・9.9 取り直し、9.10・9.11 端末に残す。9.12 は段5（本人）。
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, reservationDto, type FakeApi } from "./_fakes";
import { TID, type HomeDto } from "./_types";

const publicConfig = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

describeTask("14", "確保中の表示と取り直し", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const renderApp = async (home: () => { status?: number; json?: any }) => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": home });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    return render(<CustomerApp />);
  };
  const homeCalls = () => api.calls.filter((c) => c.path === "/api/customer/home");

  it("9.1・9.2・9.13 確保中: コード・店名・住所・人数・期限の時刻・クーポン。URL の有無。クーポン0個は欄が空", async () => {
    const reservation = reservationDto({ expiresAt: "2026-09-22T06:20:00.000Z" });
    await renderApp(() => ({ json: { ...homeFetch(), kind: "active", reservation } }));
    const view = await screen.findByTestId(TID.view("active"));
    expect(view.textContent).toContain("12345678");
    expect(view.textContent).toContain("受け取りの店");
    expect(view.textContent).toContain("東京都渋谷区道玄坂1-1");
    expect(view.textContent).toMatch(/2\s*名/);
    expect(view.textContent).toMatch(/15:20/);
    expect(view.textContent).toContain("生ビール1杯");
    expect(view.textContent).toContain("1組1回");
    expect(view.querySelector("a[href='https://example.com/store']")).toBeTruthy();
    cleanup();
    api.restore();
    await renderApp(() => ({ json: { ...homeFetch(), kind: "active", reservation: reservationDto({ storeUrl: null, coupons: [], code: "00000001" }) } }));
    const v2 = await screen.findByTestId(TID.view("active"));
    expect(v2.querySelector("a[href^='http']")).toBeNull();
    expect(v2.querySelector("[data-testid='coupon-list']")!.textContent!.trim()).toBe("");
    expect(v2.textContent).toContain("00000001");
  });

  it("9.3・9.4・9.5・9.6・9.7 完了済み・取得の画面・店が取り消した・運営に取り消された、の表示と取得し直す入口", async () => {
    const reservation = reservationDto();
    const kinds: Array<[HomeDto["kind"], RegExp]> = [
      ["completed", /完了/],
      ["store_cancelled", /店の都合/],
      ["admin_cancelled", /運営/],
    ];
    for (const [kind, re] of kinds) {
      await renderApp(() => ({ json: { ...homeFetch(), kind, reservation: { ...reservation, status: kind === "completed" ? "completed" : kind } } }));
      const view = await screen.findByTestId(TID.view(kind));
      expect(view.textContent).toMatch(re);
      expect(view.textContent).toMatch(/取り消され|完了/);
      if (kind !== "completed") expect(screen.getByTestId(TID.btn("search-again"))).toBeTruthy();
      expect(screen.queryByTestId(TID.view("active"))).toBeNull();
      cleanup();
      api.restore();
    }
    await renderApp(() => ({ json: homeFetch() }));
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.queryByTestId(/^view-/)).toBeNull();
  });

  it("9.8・9.9 開いた時に1回取り直し、状態の変化が30秒以内に映る。隠れている間は止まり、戻ると取り直す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let kind: HomeDto["kind"] = "active";
    const reservation = reservationDto();
    await renderApp(() => ({ json: { ...homeFetch(), kind, reservation: { ...reservation, status: kind === "active" ? "active" : "completed" } } }));
    await screen.findByTestId(TID.view("active"));
    expect(homeCalls().length).toBeGreaterThanOrEqual(1);
    kind = "completed";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId(TID.view("completed"))).toBeTruthy();
    const n = homeCalls().length;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(homeCalls().length).toBe(n);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(homeCalls().length).toBeGreaterThan(n);
  });

  it("9.10・9.11 取り直しの成功で端末に残り、通信の失敗で残した内容と「確かめられていません」が出る。401 では出ない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let mode: "ok" | "fail" | "unauthorized" = "ok";
    const reservation = reservationDto({ code: "55556666" });
    await renderApp(() => {
      if (mode === "fail") throw new TypeError("Failed to fetch");
      if (mode === "unauthorized") return { status: 401, json: { ok: false } };
      return { json: { ...homeFetch(), kind: "active", reservation } };
    });
    await screen.findByTestId(TID.view("active"));
    expect(JSON.stringify(window.localStorage)).toContain("55556666");
    mode = "fail";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const view = screen.getByTestId(TID.view("active"));
    expect(view.textContent).toContain("55556666");
    expect(screen.getByTestId("stale-notice").textContent).toMatch(/確かめられていません/);
    mode = "ok";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByTestId("stale-notice")).toBeNull();
    mode = "unauthorized";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByTestId("stale-notice")).toBeNull();
    expect(screen.queryByTestId(TID.view("active"))).toBeNull();
  });
});
