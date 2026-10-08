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
  coupons?: Array<{ name: string; note: string }>;
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

/**
 * 「⋮」を押してキャンセルのシートを開く（2026-10-08 案C: キャンセルの2つは「⋮」の奥）。閉じたシートの中は inert なので、
 * 押す前に必ず開き、押す部品が inert の中に無いことを確かめる。
 */
const openMore = (card: HTMLElement) => {
  fireEvent.click(within(card).getByRole("button", { name: /その他の操作/ }));
  const sheet = within(card).getByRole("dialog", { name: /その他の操作/ });
  expect(sheet.closest("[inert]")).toBeNull();
  return sheet;
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

  // 2026-10-08 のレビューの指摘: 確かめを「やめる」で閉じると焦点が body に落ちていた
  it("確かめを「やめる」で閉じると、押した操作のボタンへ焦点が戻る（完了済み・キャンセル）", async () => {
    await renderHome(() => [row()]);
    const card = screen.getByTestId("row-r1");
    fireEvent.click(within(card).getByTestId("btn-complete"));
    fireEvent.click(within(within(card).getByTestId("confirm-complete")).getByRole("button", { name: "やめる" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByTestId("btn-complete")));
    const sheet = openMore(card);
    fireEvent.click(within(sheet).getByTestId("btn-store-cancel"));
    fireEvent.click(within(within(card).getByTestId("confirm-store-cancel")).getByRole("button", { name: "やめる" }));
    await waitFor(() => expect(document.activeElement).toBe(within(card).getByTestId("btn-store-cancel")));
    expect(within(card).getByRole("dialog", { name: /その他の操作/ }).closest("[inert]")).toBeNull();
  });

  it("取り消しの確かめは、客に知らせが行くことに加えて、残りの枠が戻らないことと、来ない客は期限で枠が戻ることを言う", async () => {
    await renderHome(() => [row()]);
    fireEvent.click(within(openMore(screen.getByTestId("row-r1"))).getByTestId("btn-store-cancel"));
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
  it("A: 客が取り消した行は、畳んだ「済んだぶん」ではなく確保中の客と同じ開いた場所に薄く出て、「客が取り消しました」の印が付き、操作も電話番号も出ない", async () => {
    await renderHome(() => [row({ reservationId: "r0", nickname: "さとう" }), row({ kind: "customer_cancelled", phone: null, canComplete: false, canCancel: false })]);
    const card = screen.getByTestId("row-r1");
    // 畳んだ中に入れると、店から見れば確保中のカードが黙って消えたのと同じになる（横断-08 のレビュー）
    expect(card.closest("details")).toBeNull();
    expect(card.className).toMatch(/store-arrival--done/);
    expect(within(card).getByTestId("customer-cancelled-r1").textContent).toMatch(/客がキャンセルしました/);
    expect(within(card).queryByTestId("btn-complete")).toBeNull();
    expect(within(card).queryByTestId("btn-store-cancel")).toBeNull();
    expect(card.textContent).not.toMatch(/電話番号の登録なし/);
    // 確保中の客がいるので「向かっている客はいません」は出ない。取り消した行だけのときも、行は開いた場所に出る
    expect(screen.getByTestId("arrivals").textContent).not.toMatch(/向かっている客はいません/);
  });

  it("A: 確保中だった客が取り消すと、合図が鳴り（鳴らせなければ振動）、そのカードが目立つ。初めて開いたときの取り消し済みの行では鳴らない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    let rows = [row(), row({ reservationId: "old", kind: "customer_cancelled", phone: null, canComplete: false, canCancel: false })];
    await renderHome(() => rows);
    expect(vibrate).not.toHaveBeenCalled();
    rows = [row({ kind: "customer_cancelled", phone: null, canComplete: false, canCancel: false }), rows[1]];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRIVALS_REFRESH_MS);
    });
    await waitFor(() => expect(screen.getByTestId("row-r1").className).toMatch(/store-arrival--new/));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("row-old").className).not.toMatch(/store-arrival--new/);
    Reflect.deleteProperty(navigator, "vibrate");
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

describe("断られたときの文の場所（店-01 のレビュー）", () => {
  const refusedWith = (state: string) => ({
    "POST /api/store/reservations/:id/complete": () => ({ status: 409, json: { ok: false, current: { state } } }),
  });
  const pressComplete = async (id: string) => {
    fireEvent.click(within(screen.getByTestId(`row-${id}`)).getByTestId("btn-complete"));
    fireEvent.click(within(await screen.findByTestId("confirm-complete")).getByTestId("btn-confirm"));
  };

  it("押したカードが一覧に残っていれば、断りの文はそのカードの中に出る（一覧の最下部ではない）", async () => {
    await renderHome(() => [row(), row({ reservationId: "r2", nickname: "すずき" })], refusedWith("expired"));
    await pressComplete("r1");
    const message = await within(screen.getByTestId("row-r1")).findByTestId("msg-form");
    expect(message.getAttribute("role")).toBe("alert");
    expect(within(screen.getByTestId("row-r2")).queryByTestId("msg-form")).toBeNull();
  });

  it("押したカードが一覧から消えた・畳んだ済んだぶんへ移ったときは、一覧の先頭に出る", async () => {
    let rows = [row(), row({ reservationId: "r2", nickname: "すずき" })];
    await renderHome(() => rows, refusedWith("completed"));
    rows = [row({ kind: "completed", canComplete: false, canCancel: false }), rows[1]];
    await pressComplete("r1");
    await waitFor(() => expect(screen.getByTestId("row-r1").closest("details")).not.toBeNull());
    const message = await screen.findByTestId("msg-form");
    expect(message.closest("details")).toBeNull();
    // 先頭＝確保中の客のカードより前
    expect(message.compareDocumentPosition(screen.getByTestId("row-r2")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("タブのタイトル（店-07 のレビュー）", () => {
  it("件数を付けていないまま画面を離れても、次の画面のタイトルを書き戻さない", async () => {
    await renderHome(() => [row()]);
    // 次の画面が自分のタイトルを先に入れた（Next のメタデータ）
    document.title = "書類 | イマセキ";
    cleanup();
    expect(document.title).toBe("書類 | イマセキ");
  });

  it("件数を付けたまま画面を離れたら、付けた件数だけを外す（ほかの画面のタイトルに入れ替わっていれば触らない）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let rows = [row()];
    await renderHome(() => rows);
    rows = [row(), row({ reservationId: "r2", nickname: "すずき" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRIVALS_REFRESH_MS);
    });
    await waitFor(() => expect(document.title).toBe("(1) 店のホーム"));
    cleanup();
    expect(document.title).toBe("店のホーム");
  });
});

// 2026-09-26 本人選択（安全-06 の残り・要件21の基準 21.8・要件20の基準 20.16）: 店の取り消しに「来ない（枠を戻す）」を足した。
describe("「来ない（枠を戻す）」", () => {
  it("21.8 確保中の行に「来ない」が在り、確かめに枠が戻ることと知らせが送られることを出し、確かめてから noShow を送る", async () => {
    await renderHome(() => [row()], { "POST /api/store/reservations/:id/cancel": () => ({ json: { ok: true } }) });
    const card = screen.getByTestId("row-r1");
    fireEvent.click(within(openMore(card)).getByTestId("btn-store-no-show"));
    const confirm = await screen.findByTestId("confirm-store-no-show");
    expect(confirm.textContent).toMatch(/枠.*戻/);
    expect(confirm.textContent).toMatch(/知らせ/);
    expect(confirm.querySelectorAll("input, textarea")).toHaveLength(0);
    expect(api!.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(0);
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    await waitFor(() => expect(api!.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(1));
    expect(api!.calls.find((c) => c.path.endsWith("/cancel"))!.body).toEqual({ noShow: true });
  });

  // 2026-09-26 本人発案（キャンセルの語）: 店都合は「キャンセル」、来ない客は「来店なしでキャンセル」、その下に補足
  it("確保中の行のボタンは「キャンセル」と「来店なしでキャンセル」で、その下に「来店なしは枠が戻ります」の補足が出る（一覧に「戻す」の文字は無い）", async () => {
    await renderHome(() => [row()]);
    const card = screen.getByTestId("row-r1");
    expect(within(card).getByTestId("btn-store-cancel").textContent).toBe("キャンセル");
    expect(within(card).getByTestId("btn-store-no-show").textContent).toBe("来店なしでキャンセル");
    expect(within(card).getByTestId("no-show-note").textContent).toBe("来店なしは枠が戻ります");
    expect(card.textContent).not.toMatch(/戻す/);
  });

  it("21.1 取り消せない行（canCancel が false）には「来ない」を出さない", async () => {
    await renderHome(() => [row({ kind: "expired", canCancel: false })]);
    expect(within(screen.getByTestId("row-r1")).queryByTestId("btn-store-no-show")).toBeNull();
    expect(within(screen.getByTestId("row-r1")).queryByTestId("no-show-note")).toBeNull();
  });

  it("20.16 来ないで取り消した行は「来店なしでキャンセル」と出る（店の都合の取り消しは「店がキャンセル」のまま）", async () => {
    await renderHome(() => [
      { ...row({ kind: "store_cancelled", canComplete: false, canCancel: false }), noShow: true } as any,
      row({ reservationId: "r2", kind: "store_cancelled", canComplete: false, canCancel: false }),
    ]);
    expect(screen.getByTestId("row-r1").textContent).toMatch(/来店なしでキャンセル/);
    expect(screen.getByTestId("row-r2").textContent).toMatch(/店がキャンセル/);
    expect(screen.getByTestId("row-r2").textContent).not.toMatch(/来店なし/);
  });
});

// 2026-09-26 本人発案（受諾した時点のクーポンを保障）: 店の画面の行には、確保が持つクーポン（客が受諾したときに見ていたもの）を出す。
// 店が途中で選び直していても、店はこの行のクーポンの適用を認める。見た目は変えず、行の情報に足すだけ。
describe("向かっている客の行のクーポン（2026-09-26 本人発案）", () => {
  it("確保が持つクーポンの名前と特記事項が行に出る。クーポンの無い確保には出さない", async () => {
    await renderHome(() => [row({ coupons: [{ name: "生ビール1杯", note: "1組1回" }, { name: "デザート", note: "" }] }), row({ reservationId: "r2", nickname: "すずき", coupons: [] })]);
    const coupons = within(screen.getByTestId("row-r1")).getByTestId("arrival-coupons");
    expect(coupons.textContent).toMatch(/クーポン/);
    expect(coupons.textContent).toMatch(/生ビール1杯/);
    expect(coupons.textContent).toMatch(/1組1回/);
    expect(coupons.textContent).toMatch(/デザート/);
    expect(within(screen.getByTestId("row-r2")).queryByTestId("arrival-coupons")).toBeNull();
  });
});
