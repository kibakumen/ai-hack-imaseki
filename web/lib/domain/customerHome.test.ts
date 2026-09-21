// 客の画面でまず何を出すか（設計書「客の画面」の優先の順の表・要件9の基準 9.1〜9.7・9.13）。
// 受け入れ検査（r08・r11）は入口を通した形で見るので、ここでは表の**順そのもの**と境界を固定する。

import { describe, expect, it } from "vitest";
import { CANCELLED_VIEW_MS, COMPLETED_VIEW_MS, customerHomeView, retryability } from "./customerHome";

const NOW = new Date("2026-09-22T06:30:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const reservation = (over: Record<string, unknown> = {}) => ({
  id: "res-1",
  code: "12345678",
  storeId: "store-1",
  storeName: "受け取りの店",
  storeAddress: "東京都渋谷区道玄坂1-1",
  storeUrl: "https://example.com/store",
  party: 2,
  expiresAt: minutes(10),
  statusAt: minutes(-10),
  status: "active",
  coupons: [{ name: "生ビール", note: "1組1回" }],
  ...over,
});

const liveOffer = { endedAt: null, untilAt: minutes(120), remaining: 2, partyMax: 4 };

describe("customerHomeView の優先の順", () => {
  it("6 確保が1件も無ければ取得の画面", () => {
    expect(customerHomeView({ reservation: null, offer: null, lastFetchAt: null }, NOW)).toEqual({ kind: "fetch" });
  });

  it("2 確保中なら確保中の表示。9.1・9.13 コード・店名・住所・人数・期限・クーポンが載る", () => {
    const view = customerHomeView({ reservation: reservation(), offer: liveOffer, lastFetchAt: null }, NOW);
    expect(view.kind).toBe("active");
    expect(view.reservation).toMatchObject({ code: "12345678", storeName: "受け取りの店", party: 2, status: "active", coupons: [{ name: "生ビール", note: "1組1回" }] });
    expect(view.reservation?.expiresAt).toBe(minutes(10).toISOString());
    expect(customerHomeView({ reservation: reservation({ coupons: [] }), offer: liveOffer, lastFetchAt: null }, NOW).reservation?.coupons).toEqual([]);
  });

  it("3 期限から20分以内の期限切れはコードつき。受け取れる状態なら受け取り直せる（11.5〜11.8）", () => {
    const row = reservation({ expiresAt: minutes(-5) });
    const view = customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: null }, NOW);
    expect(view.kind).toBe("expired");
    expect(view.expired).toEqual({ showCode: true, canRetry: true });
    expect(view.reservation).toMatchObject({ code: "12345678", status: "expired" });
  });

  it("3 受け取れない状態なら受け取り直せず、人数が「何名まで」を超えているときだけ値が載る（11.8・11.9）", () => {
    const row = reservation({ expiresAt: minutes(-5) });
    const stopped = { ...liveOffer, endedAt: minutes(-1) };
    expect(customerHomeView({ reservation: row, offer: stopped, lastFetchAt: null }, NOW).expired).toEqual({ showCode: true, canRetry: false });
    const narrowed = { ...liveOffer, partyMax: 1 };
    expect(customerHomeView({ reservation: row, offer: narrowed, lastFetchAt: null }, NOW).expired).toEqual({ showCode: true, canRetry: false, partyMax: 1 });
  });

  it("4 期限から20分を過ぎるとコードが消え、そのあと取得を押していれば取得の画面（11.9）", () => {
    const row = reservation({ expiresAt: minutes(-25) });
    const over = customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: null }, NOW);
    expect(over.kind).toBe("expired");
    expect(over.expired).toEqual({ showCode: false, canRetry: false });
    expect(over.reservation?.code).toBe("");
    expect(customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: minutes(-1) }, NOW).kind).toBe("fetch");
  });

  it("4 店・運営に取り消されたら、その理由の表示。取得を押したあと・3時間を過ぎたら取得の画面（9.6・9.7）", () => {
    for (const status of ["store_cancelled", "admin_cancelled"] as const) {
      const row = reservation({ status, statusAt: minutes(-30) });
      expect(customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: null }, NOW).kind, status).toBe(status);
      expect(customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: minutes(-1) }, NOW).kind, status).toBe("fetch");
      const old = reservation({ status, statusAt: new Date(NOW.getTime() - CANCELLED_VIEW_MS) });
      expect(customerHomeView({ reservation: old, offer: liveOffer, lastFetchAt: null }, NOW).kind, status).toBe("fetch");
    }
  });

  it("5 完了済みは一定の間だけ既定で出て、過ぎたら取得の画面（9.3・9.4）", () => {
    const row = reservation({ status: "completed", statusAt: minutes(-1) });
    expect(customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: null }, NOW).kind).toBe("completed");
    const old = reservation({ status: "completed", statusAt: new Date(NOW.getTime() - COMPLETED_VIEW_MS) });
    expect(customerHomeView({ reservation: old, offer: liveOffer, lastFetchAt: null }, NOW).kind).toBe("fetch");
  });

  it("6 客が取り消したあとは、すぐ取得の画面（9.5）", () => {
    const row = reservation({ status: "customer_cancelled", statusAt: minutes(-1) });
    expect(customerHomeView({ reservation: row, offer: liveOffer, lastFetchAt: null }, NOW)).toEqual({ kind: "fetch" });
  });
});

describe("retryability", () => {
  it("オファーが無い・終わった・満席なら受け取り直せない（値は載せない）", () => {
    expect(retryability(null, 2, NOW)).toEqual({ canRetry: false });
    expect(retryability({ ...liveOffer, remaining: 0 }, 2, NOW)).toEqual({ canRetry: false });
    expect(retryability({ ...liveOffer, untilAt: minutes(-1) }, 2, NOW)).toEqual({ canRetry: false });
  });

  it("人数がちょうど「何名まで」なら受け取り直せる。超えたらその値を載せる", () => {
    expect(retryability({ ...liveOffer, partyMax: 2 }, 2, NOW)).toEqual({ canRetry: true });
    expect(retryability({ ...liveOffer, partyMax: 2 }, 3, NOW)).toEqual({ canRetry: false, partyMax: 2 });
  });
});
