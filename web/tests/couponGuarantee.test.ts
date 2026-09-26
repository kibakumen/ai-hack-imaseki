/* eslint-disable @typescript-eslint/no-explicit-any -- 場面と応答は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 客がオファーを受諾した時点で見ていたクーポンを、席と同じように保障する（2026-09-26 本人発案（受諾した時点のクーポンを保障））。
//
// それまでは、確保には受け取った瞬間の最新のクーポンが写っていた（要件16の基準 16.6 の旧い読み）。店が公開したまま
// クーポンを選び直す（基準 19.11）と、選び直す前に結果を見た客は、見ていない特典で受け取ることになった。
// 今は取得の記録（fetch_items・追加だけの表）に、その結果で客に見せたクーポンをオファーごとに写し、その取得の結果から
// 受け取ったら、確保に**見せたクーポン**を写す。店の画面の向かっている客の行にも、確保が持つクーポンを出す。
//
// 見るのは次の5つ:
//   1. 取得の記録に、見せたオファーとクーポンが残る
//   2. 選び直す前に見た客は、見たクーポンで受け取る。店の画面の行にも同じクーポンが出る。選び直したあとに見た客は新しいクーポン
//   3. 受け取りと店の選び直しが同時に来ても（クーポンを読む直前・確保を書く直前のどちらに割り込んでも）、客が見たものが写る
//   4. 結果を経ない受け取り直し（期限切れからの受け取り直し）は、元の確保のクーポンを引き継ぐ
//   5. 写しの無い古い記録（migration 0017 より前の取得）からの受け取りは、今までどおり受け取った時点のクーポン
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, MIN, one, publishOffer, receive, registerCustomer, requireInResults, spot, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { wrappedApp } from "./_interleavedDb";

const T0 = "2026-09-26T06:00:00.000Z";
const BEER = { name: "生ビール1杯", note: "1組1回" };
const DESSERT = { name: "デザート", note: "" };

describe("受諾した時点のクーポンを保障する（2026-09-26 本人発案）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const at = (minutes: number) => ctx.clock.set(new Date(Date.parse(T0) + minutes * MIN).toISOString());

  /** 生ビールとデザートの2つを見せて公開した店と、その結果を見た客 */
  const seenScene = async () => {
    at(0);
    const where = spot();
    const store = await approvedStore(ctx, { name: "保障の店", coupons: [BEER, DESSERT], ...where });
    const [beer, dessert] = store.coupons;
    const offer = await publishOffer(store.api, { capacity: 3, partyMax: 4, couponIds: [beer.id, dessert.id] });
    const customer = await registerCustomer(ctx);
    const seen = await fetchOffers(customer.api, { party: 2, ...where });
    requireInResults(seen, offer.id);
    const shown = seen.json.items.find((item: any) => item.offerId === offer.id).coupons;
    expect(shown).toEqual([BEER, DESSERT]);
    return { where, store, beer, dessert, offer, customer, fetchId: seen.json.fetchId as string };
  };
  const rechoose = async (store: any, couponIds: string[]) => expect((await store.api.post("/api/store/offers/current/coupons", { couponIds })).status).toBe(200);
  const arrivalCoupons = async (store: any, reservationId: string) =>
    ((await store.api.get("/api/store/home")).json.arrivals as any[]).find((row) => row.reservationId === reservationId)?.coupons;

  it("取得の記録に、その結果で見せたオファーとクーポンが残る", async () => {
    const s = await seenScene();
    const item = await one(ctx.db, "SELECT offer_id, coupons_json FROM fetch_items WHERE fetch_id = ? AND store_id = ?", s.fetchId, s.store.id);
    expect(item.offer_id).toBe(s.offer.id);
    expect(JSON.parse(item.coupons_json)).toEqual([BEER, DESSERT]);
  });

  it("選び直す前に見た客は見たクーポンで受け取り、店の画面の行にも同じクーポンが出る。選び直したあとに見た客は新しいクーポン", async () => {
    const s = await seenScene();
    await rechoose(s.store, [s.dessert.id]);
    const received = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
    expect(received.status).toBe(200);
    expect(received.json.reservation.coupons).toEqual([BEER, DESSERT]);
    expect((await s.customer.api.get("/api/customer/home")).json.reservation.coupons).toEqual([BEER, DESSERT]);
    expect(await arrivalCoupons(s.store, received.json.reservation.id)).toEqual([BEER, DESSERT]);

    const later = await registerCustomer(ctx);
    const seenLater = await fetchOffers(later.api, { party: 2, ...s.where });
    requireInResults(seenLater, s.offer.id);
    const laterReceived = await receive(later.api, { offerId: s.offer.id, party: 2, fetchId: seenLater.json.fetchId });
    expect(laterReceived.json.reservation.coupons).toEqual([DESSERT]);
    expect(await arrivalCoupons(s.store, laterReceived.json.reservation.id)).toEqual([DESSERT]);
  });

  // 受け取りの手続きは、クーポンを読んでから確保を書くまでに隙がある。どちらの時点に選び直しが割り込んでも、見たものが写る
  for (const [label, match] of [
    ["クーポンを読む直前", /FROM coupons c/],
    ["確保を書く直前", /INSERT INTO reservations/],
  ] as const) {
    it(`受け取りと店の選び直しが同時に来ても（${label}に割り込む）、客が見たクーポンが写る`, async () => {
      const s = await seenScene();
      const w = await wrappedApp(ctx, [{ match, before: () => rechoose(s.store, [s.dessert.id]) }]);
      const received = await w.api(s.customer.api.cookie).post("/api/customer/reservations", { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
      expect(received.status).toBe(200);
      expect((await s.store.api.get("/api/store/home")).json.offer.coupons.map((c: any) => c.name)).toEqual([DESSERT.name]);
      expect(received.json.reservation.coupons).toEqual([BEER, DESSERT]);
      expect(await arrivalCoupons(s.store, received.json.reservation.id)).toEqual([BEER, DESSERT]);
    });
  }

  it("期限切れからの受け取り直し（結果を経ない）は、元の確保のクーポンを引き継ぐ", async () => {
    const s = await seenScene();
    const first = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
    expect(first.status).toBe(200);
    at(21);
    await rechoose(s.store, []);
    const retry = await s.customer.api.post("/api/customer/reservations", { retryOf: first.json.reservation.id });
    expect(retry.status).toBe(200);
    expect(retry.json.reservation.id).not.toBe(first.json.reservation.id);
    expect(retry.json.reservation.coupons).toEqual([BEER, DESSERT]);
    at(0);
  });

  it("写しの無い古い取得の記録（migration 0017 より前）からの受け取りは、受け取った時点のクーポンを写す", async () => {
    const s = await seenScene();
    // 0017 より前に書かれた行を再現する（記録の表は追加だけだが、ここは検査の中で古い形を作るだけ）
    await ctx.db.prepare("UPDATE fetch_items SET offer_id = NULL, coupons_json = NULL WHERE fetch_id = ?1").bind(s.fetchId).run();
    await rechoose(s.store, [s.dessert.id]);
    const received = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
    expect(received.status).toBe(200);
    expect(received.json.reservation.coupons).toEqual([DESSERT]);
  });
});
