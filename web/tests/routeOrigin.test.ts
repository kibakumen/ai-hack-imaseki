// 経路の出発地は、打った場所で探したときだけ付ける（2026-09-25 監査の指摘 客-11）。
//
// 本人の指摘（打った場所で探したのに、経路の出発地が現在地になる）を直したとき、確保の応答に探した起点の座標を
// 載せるようにした。ところが記録に「現在地で探したのか、打った場所で探したのか」の区別が無く、現在地で探した
// 客にも探した時点の座標が固定の出発地として付くようになった（いちばん多い場面の案内が悪くなった）。
// 取得の記録に起点の種類を持たせ、現在地のときは出発地を付けない（マップが今の現在地から引く）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, one, publishOffer, receive, registerCustomer, requireInResults, spot, type Ctx } from "../../tests/acceptance/v2/_fakes";

describe("確保の応答の経路の出発地（客-11）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: "2026-09-22T06:00:00.000Z" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const storeWithOffer = async () => {
    const at = spot();
    const store = await approvedStore(ctx, { name: "経路の店", ...at });
    const offer = await publishOffer(store.api, { capacity: 3, partyMax: 4 });
    return { at, offer };
  };

  it("現在地（座標）で探して受け取った確保には、出発地を付けない。記録には現在地で探したことが残る", async () => {
    const { at, offer } = await storeWithOffer();
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, { party: 2, ...at });
    requireInResults(fetched, offer.id);
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    expect(received.status).toBe(200);
    expect(received.json.reservation.origin ?? null).toBeNull();
    expect((await customer.api.get("/api/customer/home")).json.reservation.origin ?? null).toBeNull();
    expect((await one(ctx.db, "SELECT origin_kind FROM fetch_logs WHERE id = ?", fetched.json.fetchId)).origin_kind).toBe("here");
  });

  it("打った場所で探して受け取った確保には、その場所の座標を出発地として付ける", async () => {
    const { at, offer } = await storeWithOffer();
    ctx.geocoder.set("経路の駅", at);
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, { party: 2, place: "経路の駅" });
    requireInResults(fetched, offer.id);
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    expect(received.status).toBe(200);
    expect(received.json.reservation.origin).toEqual({ lat: at.lat, lng: at.lng });
    expect((await customer.api.get("/api/customer/home")).json.reservation.origin).toEqual({ lat: at.lat, lng: at.lng });
    expect((await one(ctx.db, "SELECT origin_kind FROM fetch_logs WHERE id = ?", fetched.json.fetchId)).origin_kind).toBe("place");
  });
});
