// @vitest-environment jsdom
// 要件20（画面）: 20.4 取り直し、20.8 確かめ、20.10・20.11・20.17 無い操作、20.18 0件、20.20・20.21 断られた時、20.23・20.25（タスク21）。要件21 の 21.2・21.3（タスク18）。
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, offerDto, storeHomeDto, type FakeApi } from "./_fakes";
import { TID, type ArrivalRow } from "./_types";

const row = (over: Partial<ArrivalRow> = {}): ArrivalRow => ({ reservationId: "r1", kind: "active", nickname: "たなか", phone: "09012345678", party: 2, code: "12345678", expiresAt: "2026-09-22T06:20:00.000Z", canComplete: true, canCancel: true, ...over });
const publicConfig = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

describeTask("17", "向かっている客の一覧（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    vi.useRealTimers();
  });

  const renderHome = async (home: () => any, routes: Record<string, any> = {}) => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: home() }), "GET /api/config/public": publicConfig, ...routes });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    render(<StoreHome />);
    await screen.findByTestId("arrivals");
  };

  it("20.18 0件なら向かっている客がいないことが出る。20.10・20.11・20.17 完了済みを戻す・取り消す操作、コードの入力、使われたクーポンの欄が無い", async () => {
    await renderHome(() => storeHomeDto({ offer: offerDto(), arrivals: [] }));
    expect(screen.getByTestId("arrivals").textContent).toMatch(/いません|ありません/);
    cleanup();
    api.restore();
    await renderHome(() => storeHomeDto({ offer: offerDto(), arrivals: [row(), row({ reservationId: "r2", kind: "completed", canComplete: false, canCancel: false })] }));
    const list = screen.getByTestId("arrivals");
    expect(list.querySelectorAll("input")).toHaveLength(0);
    expect(list.textContent).not.toMatch(/クーポン/);
    const done = within(list).getByTestId(TID.row("r2"));
    expect(done.textContent).toMatch(/完了/);
    expect(within(done).queryByTestId(TID.btn("complete"))).toBeNull();
    expect(within(done).queryByTestId(TID.btn("store-cancel"))).toBeNull();
    expect(list.textContent).not.toMatch(/戻す|未完了に/);
  });

  it("20.8 押すと呼び名・人数・コードの確かめが出て、確かめてから完了済みの要求が出る", async () => {
    await renderHome(() => storeHomeDto({ offer: offerDto(), arrivals: [row()] }), { "POST /api/store/reservations/:id/complete": () => ({ json: { ok: true } }) });
    fireEvent.click(within(screen.getByTestId(TID.row("r1"))).getByTestId(TID.btn("complete")));
    expect(api.calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(0);
    const confirm = await screen.findByTestId("confirm-complete");
    expect(confirm.textContent).toContain("たなか");
    expect(confirm.textContent).toMatch(/2\s*名/);
    expect(confirm.textContent).toContain("12345678");
    fireEvent.click(within(confirm).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(1));
  });

  it("20.20・20.21 断られたら今の状態が行に出て、一覧を取り直す", async () => {
    let arrivals = [row()];
    await renderHome(() => storeHomeDto({ offer: offerDto(), arrivals }), { "POST /api/store/reservations/:id/complete": () => ({ status: 409, json: { ok: false, current: { state: "customer_cancelled" } } }) });
    const before = api.calls.filter((c) => c.path === "/api/store/home").length;
    arrivals = [];
    fireEvent.click(within(screen.getByTestId(TID.row("r1"))).getByTestId(TID.btn("complete")));
    fireEvent.click(within(await screen.findByTestId("confirm-complete")).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(screen.getByTestId("arrivals").textContent).toMatch(/客が取り消し|取り消され/));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/store/home").length).toBeGreaterThan(before));
  });

  it("20.4 偽の時計で、確保の追加と状態の変化が30秒以内に一覧へ映る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let arrivals = [row()];
    await renderHome(() => storeHomeDto({ offer: offerDto(), arrivals }));
    expect(screen.getAllByTestId(/^row-r/)).toHaveLength(1);
    arrivals = [row(), row({ reservationId: "r2", nickname: "すずき" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getAllByTestId(/^row-r/)).toHaveLength(2);
    arrivals = [row({ kind: "expired", canCancel: false }), row({ reservationId: "r2", nickname: "すずき" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId(TID.row("r1")).textContent).toMatch(/期限切れ/);
  });
});

describeTask("18", "店の取り消し（画面）: 21.2 確かめ、21.3 理由の欄が無い", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("21.2・21.3 取り消しを押すと客に知らせが送られることの確かめが出て、理由の欄が無く、確かめてから要求が出る", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ offer: offerDto(), arrivals: [row()] }) }), "GET /api/config/public": publicConfig, "POST /api/store/reservations/:id/cancel": () => ({ json: { ok: true } }) });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    render(<StoreHome />);
    await screen.findByTestId("arrivals");
    fireEvent.click(within(screen.getByTestId(TID.row("r1"))).getByTestId(TID.btn("store-cancel")));
    const confirm = await screen.findByTestId("confirm-store-cancel");
    expect(confirm.textContent).toMatch(/知らせ|通知/);
    expect(confirm.querySelectorAll("input, textarea")).toHaveLength(0);
    expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(0);
    fireEvent.click(within(confirm).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(1));
    expect(api.calls.find((c) => c.path.endsWith("/cancel"))!.body ?? {}).not.toHaveProperty("reason");
  });
});

describeTask("21", "止められている店の一覧（画面）: 20.23・20.25", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("20.23 canComplete が false の期限切れの行に「完了済み」が無い。20.25 断られると、運営に止められているための文が出る", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ status: "banned", arrivals: [row({ kind: "expired", canComplete: false, canCancel: false }), row({ reservationId: "r2", canComplete: true, canCancel: true })] }) }), "GET /api/config/public": publicConfig, "POST /api/store/reservations/:id/complete": () => ({ status: 409, json: { ok: false, error: { kind: "store_banned" } } }) });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    render(<StoreHome />);
    await screen.findByTestId("arrivals");
    expect(within(screen.getByTestId(TID.row("r1"))).queryByTestId(TID.btn("complete"))).toBeNull();
    fireEvent.click(within(screen.getByTestId(TID.row("r2"))).getByTestId(TID.btn("complete")));
    fireEvent.click(within(await screen.findByTestId("confirm-complete")).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(screen.getByTestId("arrivals").textContent).toMatch(/止められて/));
  });
});
