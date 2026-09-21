// @vitest-environment jsdom
// 要件4（画面）: 4.4・4.5 0件の文と次の手、4.11 受け取りの操作が1つでクーポンを選ぶ操作が無い、4.14 クーポン0個は欄が空、4.7・4.10 項目。
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, type FakeApi } from "./_fakes";
import { TID, type ResultItem } from "./_types";

const item = (over: Partial<ResultItem> = {}): ResultItem => ({ offerId: "o1", storeId: "s1", storeName: "店A", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "和食が好みに合います", partyMax: 4, coupons: [{ name: "生ビール", note: "1組1回" }, { name: "デザート", note: "" }], storeUrl: "https://example.com/a", ...over });

const installGeo = () => Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: 35.6, longitude: 139.7 } }) } });

describeTask("12", "結果の一覧", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const search = async (items: ResultItem[]) => {
    installGeo();
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "GET /api/customer/home": () => ({ json: homeFetch() }), "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items } }) });
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
});
