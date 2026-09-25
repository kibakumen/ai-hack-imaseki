// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 「向かっている客」の一覧を片手で速く使えるようにした直し（2026-09-25 監査の指摘）。
//   店-01 … 確かめは押したカードの中に出て、確定のボタンへ焦点が移る。送っている間は押せない。取り消しは枠が戻らないことを言う
//   店-02 … 期限切れでまだ完了にできる行は「遅れている客」として開いたまま出す（畳んだ「済んだぶん」に入れない）
//   店-11 … 人数は呼び名から切り離した札で出す（呼び名が長くても省かれない）
//   横断-08 … 客の取り消しは数分「客が取り消しました」として残り、人数の変更には「2→4 名」の印が付く
//   店-07 … 新しい客のカードは目立ち、タブのタイトルに件数が付く。画面の消灯を防ぐ
//   店-08 … 「今すぐ更新」と、最後に更新した時刻
// 本番の入口の部品（StoreHome）を偽の API で描いて見る。

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, offerDto, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { ARRIVALS_REFRESH_MS } from "../../lib/schemas/limits";
import { StoreHome } from "./StoreHome";

let api: FakeApi | null = null;

beforeEach(() => {
  document.title = "店のホーム";
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "wakeLock");
});

type Row = {
  reservationId: string;
  kind: "active" | "expired" | "completed" | "store_cancelled" | "customer_cancelled";
  nickname: string | null;
  phone: string | null;
  party: number;
  code: string;
  expiresAt: string;
  canComplete: boolean;
  canCancel: boolean;
};

const row = (over: Partial<Row> = {}): Row => ({
  reservationId: "r1",
  kind: "active",
  nickname: "たなか",
  phone: "09012345678",
  party: 2,
  code: "12345678",
  // 日本時間 15:20
  expiresAt: "2026-09-22T06:20:00.000Z",
  canComplete: true,
  canCancel: true,
  ...over,
});

const renderHome = async (arrivals: () => Row[], routes: Record<string, any> = {}) => {
  api = installFakeApi({
    "GET /api/store/home": () => ({ json: storeHomeDto({ offer: offerDto(), arrivals: arrivals() as any }) }),
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    ...routes,
  });
  render(<StoreHome />);
  await screen.findByTestId("arrivals");
};

const homeCalls = () => api!.calls.filter((c) => c.path === "/api/store/home").length;

describe("確かめの出し方（店-01）", () => {
  it("完了を押すと、確かめはそのカードの中に出て、確定のボタンへ焦点が移る", async () => {
    await renderHome(() => [row(), row({ reservationId: "r2", nickname: "すずき" })]);
    fireEvent.click(within(screen.getByTestId("row-r1")).getByTestId("btn-complete"));
    const confirm = within(screen.getByTestId("row-r1")).getByTestId("confirm-complete");
    expect(within(screen.getByTestId("row-r2")).queryByTestId("confirm-complete")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(confirm).getByTestId("btn-confirm")));
  });

  it("送っている間は確定のボタンを押せず、送っていることが出る。返ったら確かめは閉じる", async () => {
    let finish: (value: unknown) => void = () => undefined;
    await renderHome(() => [row()], {
      "POST /api/store/reservations/:id/complete": () => new Promise((resolve) => (finish = resolve)),
    });
    fireEvent.click(within(screen.getByTestId("row-r1")).getByTestId("btn-complete"));
    const confirm = screen.getByTestId("confirm-complete");
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    await waitFor(() => expect((within(confirm).getByTestId("btn-confirm") as HTMLButtonElement).disabled).toBe(true));
    expect(confirm.textContent).toMatch(/送っています/);
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    await act(async () => {
      finish({ json: { ok: true } });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("confirm-complete")).toBeNull());
    expect(api!.calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(1);
  });

  it("取り消しの確かめは、客に知らせが行くことに加えて、残りの枠が戻らないことと、来ない客は期限で枠が戻ることを言う", async () => {
    await renderHome(() => [row()]);
    fireEvent.click(within(screen.getByTestId("row-r1")).getByTestId("btn-store-cancel"));
    const confirm = within(screen.getByTestId("row-r1")).getByTestId("confirm-store-cancel");
    expect(confirm.textContent).toMatch(/知らせ/);
    expect(confirm.textContent).toMatch(/枠は戻りません/);
    expect(confirm.textContent).toMatch(/期限が来れば.*枠が戻/);
  });
});

describe("遅れている客（店-02）", () => {
  it("期限切れでまだ完了にできる行は、畳んだ「済んだぶん」ではなく「遅れている客」に開いたまま出て、何時まで完了にできるかが出る", async () => {
    await renderHome(() => [row({ reservationId: "late", kind: "expired", canCancel: false }), row({ reservationId: "done", kind: "completed", canComplete: false, canCancel: false })]);
    const late = screen.getByTestId("row-late");
    expect(late.closest("details")).toBeNull();
    expect(screen.getByTestId("arrivals-late").textContent).toMatch(/遅れている客/);
    expect(late.textContent).toMatch(/15:40\s*まで完了にできます/);
    expect(within(late).getByTestId("btn-complete")).toBeTruthy();
    // 済んだぶんに畳むのは、完了済みと取り消しの行だけ
    expect(screen.getByTestId("row-done").closest("details")).not.toBeNull();
  });

  it("止められていて完了にできない期限切れの行は、遅れている客に出さない（済んだぶんへ）", async () => {
    await renderHome(() => [row({ reservationId: "late", kind: "expired", canComplete: false, canCancel: false })]);
    expect(screen.queryByTestId("arrivals-late")).toBeNull();
    expect(screen.getByTestId("row-late").closest("details")).not.toBeNull();
  });
});

describe("人数の札（店-11）", () => {
  it("人数は呼び名と別の札で出る（呼び名がどれだけ長くても、札の中の人数は省かれない）", async () => {
    await renderHome(() => [row({ nickname: "とても長い呼び名のお客さまとても長い呼び名", party: 4 })]);
    const card = screen.getByTestId("row-r1");
    expect(within(card).getByTestId("arrival-party").textContent).toMatch(/4\s*名/);
    expect(card.querySelector(".store-arrival__name")!.textContent).not.toMatch(/名）/);
  });
});

describe("客の変更の合図（横断-08）", () => {
  it("A: 客が取り消した行は「客が取り消しました」として済んだぶんに出て、操作も電話番号も出ない", async () => {
    await renderHome(() => [row({ kind: "customer_cancelled", phone: null, canComplete: false, canCancel: false })]);
    const card = screen.getByTestId("row-r1");
    expect(card.textContent).toMatch(/客が取り消しました/);
    expect(within(card).queryByTestId("btn-complete")).toBeNull();
    expect(within(card).queryByTestId("btn-store-cancel")).toBeNull();
    expect(card.textContent).not.toMatch(/電話番号の登録なし/);
  });

  it("B: 前に見た人数から変わった行に「人数が変わりました 2→4 名」の印が付く。初めて見た行には付かない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let party = 2;
    await renderHome(() => [row({ party }), row({ reservationId: "r2", nickname: "すずき", party: 3 })]);
    expect(screen.queryByTestId("party-changed-r1")).toBeNull();
    party = 4;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRIVALS_REFRESH_MS);
    });
    await waitFor(() => expect(screen.getByTestId("party-changed-r1").textContent).toMatch(/人数が変わりました\s*2\s*→\s*4\s*名/));
    expect(screen.queryByTestId("party-changed-r2")).toBeNull();
  });
});

describe("新しい客の知らせ（店-07）", () => {
  it("新しく来た客のカードは目立つ印が付き、タブのタイトルに件数が付く。画面に触れるとタイトルは戻る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let rows = [row()];
    await renderHome(() => rows);
    expect(document.title).toBe("店のホーム");
    rows = [row(), row({ reservationId: "r2", nickname: "すずき" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRIVALS_REFRESH_MS);
    });
    await waitFor(() => expect(screen.getByTestId("row-r2").className).toMatch(/store-arrival--new/));
    expect(screen.getByTestId("row-r1").className).not.toMatch(/store-arrival--new/);
    expect(document.title).toBe("(1) 店のホーム");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(document.title).toBe("店のホーム"));
  });

  it("開いている間は画面の消灯を防ぐ（Wake Lock を取る）", async () => {
    const request = vi.fn(async () => ({ released: false, release: vi.fn(async () => undefined), addEventListener: vi.fn() }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    await renderHome(() => [row()]);
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
  });
});

describe("取り直し（店-08）", () => {
  it("取り直しの間隔は基準の上限（30秒）より短い", () => {
    expect(ARRIVALS_REFRESH_MS).toBeLessThanOrEqual(15_000);
  });

  it("「今すぐ更新」で取り直し、最後に更新した時刻が出る", async () => {
    await renderHome(() => [row()]);
    expect(screen.getByTestId("arrivals-updated").textContent).toMatch(/最終更新\s*\d{1,2}:\d{2}/);
    const before = homeCalls();
    fireEvent.click(screen.getByTestId("btn-refresh-arrivals"));
    await waitFor(() => expect(homeCalls()).toBeGreaterThan(before));
  });
});
