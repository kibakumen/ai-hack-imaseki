// @vitest-environment jsdom
// 要件4（画面）: 4.4・4.5 0件の文と次の手、4.11 受け取りの操作が1つでクーポンを選ぶ操作が無い、4.14 クーポン0個は欄が空、4.7・4.10 項目。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, streamOfResult, type FakeApi, type FakeRoute } from "./_fakes";
import { TID, type ResultItem } from "./_types";

const item = (over: Partial<ResultItem> = {}): ResultItem => ({ offerId: "o1", storeId: "s1", storeName: "店A", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "和食が好みに合います", partyMax: 4, coupons: [{ name: "生ビール", note: "1組1回" }, { name: "デザート", note: "" }], storeUrl: "https://example.com/a", ...over });

const installGeo = () => Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: 35.6, longitude: 139.7 } }) } });

describeTask("12", "結果の一覧", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const search = async (items: ResultItem[], routes: Record<string, FakeRoute> = {}) => {
    installGeo();
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "GET /api/customer/home": () => ({ json: homeFetch() }), "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items } }), ...routes });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.btn("fetch"));
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
  };

  it("4.4・4.5 0件: 見つからなかったこと・人数を減らすと見つかるかもしれないこと・場所を変える・時間を置く、が出る", async () => {
    await search([]);
    const empty = await screen.findByTestId("result-empty");
    expect(empty.textContent).toMatch(/見つかりません|見つかりませんでした/);
    expect(empty.textContent).toMatch(/人数/);
    expect(empty.textContent).toMatch(/場所/);
    expect(empty.textContent).toMatch(/時間/);
    expect(screen.queryAllByTestId(/^result-o/)).toHaveLength(0);
  });

  it("4.7・4.10・4.11・4.14 カードごとに項目が出て、受け取りの操作が1つ、クーポンを選ぶ操作が無い。URL の有無、クーポン0個の欄が空", async () => {
    await search([item(), item({ offerId: "o2", storeId: "s2", storeName: "店B", storeUrl: null, coupons: [], walkMinutes: 7, reason: "近いです" })]);
    const a = await screen.findByTestId(TID.card("o1"));
    expect(a.textContent).toContain("店A");
    expect(a.textContent).toMatch(/3\s*分/);
    expect(a.textContent).toMatch(/2,?000/);
    expect(a.textContent).toMatch(/4,?000/);
    expect(a.textContent).toContain("和食が好みに合います");
    expect(a.textContent).toMatch(/4\s*名/);
    expect(a.textContent).toContain("生ビール");
    expect(a.textContent).toContain("1組1回");
    expect(a.textContent).toContain("デザート");
    expect(within(a).getAllByTestId(TID.btn("receive"))).toHaveLength(1);
    expect(a.querySelectorAll("input[type='checkbox'], input[type='radio'], select")).toHaveLength(0);
    expect(a.querySelector("a[href='https://example.com/a']")).toBeTruthy();
    const b = screen.getByTestId(TID.card("o2"));
    expect(b.querySelector("a[href^='http']")).toBeNull();
    expect(within(b).getByTestId("coupon-list").textContent!.trim()).toBe("");
    expect(within(b).getAllByTestId(TID.btn("receive"))).toHaveLength(1);
    expect(b.textContent).toMatch(/7\s*分/);
    expect(screen.queryByTestId("result-empty")).toBeNull();
  });

  it("4.6 少しずつ届く入口（本番の道）: カードが先に出て「書いています」を見せ、紹介文が届くとその文に替わる", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const first = item();
    await search([first], {
      "POST /api/customer/fetch/stream": () => ({
        stream: { lines: [{ type: "init", fetchId: "f1", items: [first] }, { type: "pitch", storeId: "s1", reason: "刺身がすぐそこで待っています", source: "persona" }, { type: "done" }], holdAfter: 1, release: released },
      }),
    });
    const card = await screen.findByTestId(TID.card("o1"));
    expect(card.querySelector('[aria-busy="true"]')).toBeTruthy();
    release();
    await waitFor(() => expect(card.textContent).toContain("刺身がすぐそこで待っています"));
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
    expect(api.calls.filter((c) => c.path === "/api/customer/fetch")).toHaveLength(0);
  });

  // ストリームが途中で切れたら、まだ届いていない紹介文は「決まった文」として確定させる（待機の見た目で固めない）。
  it("不具合-21 取得の途中で通信が切れても、紹介文の欄が「書いています…」のまま止まらない", async () => {
    const first = item();
    await search([first], { "POST /api/customer/fetch/stream": () => ({ stream: { lines: [{ type: "init", fetchId: "f1", items: [first] }], end: "cut" } }) });
    const card = await screen.findByTestId(TID.card("o1"));
    // 通信が切れたことが画面に届くまで待つ（切れた後の表示を見る）
    await screen.findByTestId(TID.msgForm);
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
    expect(card.textContent).not.toContain("書いています");
  });

  // 探し直したら、前の検索のストリームは止めるか、その行を捨てる。
  it("不具合-06 探し直したあとに前の検索の紹介文が届いても、一覧は新しい検索の結果のまま", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const older = item({ offerId: "o-old", storeId: "s-old", storeName: "前の店" });
    const newer = item({ offerId: "o-new", storeId: "s-new", storeName: "新しい店" });
    let count = 0;
    await search([], {
      "POST /api/customer/fetch/stream": () => {
        count++;
        return count === 1 ? { stream: streamOfResult({ fetchId: "f-old", items: [older] }, { holdAfter: 1, release: released }) } : { stream: streamOfResult({ fetchId: "f-new", items: [newer] }) };
      },
    });
    await screen.findByTestId(TID.card("o-old"));
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await screen.findByTestId(TID.card("o-new"));
    release();
    // 前の検索の紹介文の行が届き切るのを待つ
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId(TID.card("o-old"))).toBeNull();
    expect(screen.getByTestId(TID.card("o-new"))).toBeTruthy();
  });
});
