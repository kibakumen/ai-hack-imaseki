// 経路の出発地は、打った場所で探したときだけ付ける（2026-09-25 監査の指摘 客-11）。
//
// 本人の指摘（打った場所で探したのに、経路の出発地が現在地になる）を直したとき、確保の応答に探した起点の座標を
// 載せるようにした。ところが記録に「現在地で探したのか、打った場所で探したのか」の区別が無く、現在地で探した
// 客にも探した時点の座標が固定の出発地として付くようになった（いちばん多い場面の案内が悪くなった）。
// 取得の記録に起点の種類を持たせ、現在地のときは出発地を付けない（マップが今の現在地から引く）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, one, publishOffer, receive, registerCustomer, requireInResults, spot, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { ROUTE_ORIGIN_LABEL } from "../lib/domain/texts";

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

  // 2026-09-26 本人選択: Google から得た座標は記録に書かない（Service Specific Terms 6.3.1 の30日）。出発地は
  // 客が打った文字と、ジオコーディングの応答の place ID（無期限に置ける・Maps URLs の origin_place_id）で渡す
  it("打った場所で探して受け取った確保には、打った文字と place ID を出発地として付ける（座標は付けない・記録にも残さない）", async () => {
    const { at, offer } = await storeWithOffer();
    ctx.geocoder.set("経路の駅", { ...at, placeId: "ChIJ-route-station" });
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, { party: 2, place: "経路の駅" });
    requireInResults(fetched, offer.id);
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    expect(received.status).toBe(200);
    const expected = { place: "経路の駅", placeId: "ChIJ-route-station" };
    expect(received.json.reservation.origin).toEqual(expected);
    expect((await customer.api.get("/api/customer/home")).json.reservation.origin).toEqual(expected);
    expect(await one(ctx.db, "SELECT origin_kind, origin_lat, origin_lng, origin_place, origin_place_id FROM fetch_logs WHERE id = ?", fetched.json.fetchId)).toEqual({
      origin_kind: "place",
      origin_lat: null,
      origin_lng: null,
      origin_place: "経路の駅",
      origin_place_id: "ChIJ-route-station",
    });
  });

  it("地図の応答に place ID が無ければ、打った文字だけを出発地として付ける", async () => {
    const { at, offer } = await storeWithOffer();
    ctx.geocoder.set("番号の無い駅", at);
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, { party: 2, place: "番号の無い駅" });
    requireInResults(fetched, offer.id);
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    expect(received.json.reservation.origin).toEqual({ place: "番号の無い駅" });
  });

  // 2026-09-26 本人選択: 場所の候補（Google の Places が返した文字）を選んで探したときは、その文字を記録に書かない。
  // 期限なく残すのは place ID だけ。経路のリンクは place ID を優先し、origin には決まった文字を入れる（Maps URLs は
  // origin_place_id を使うとき origin も要る）。候補から来た文字かどうかは画面が送る印（placeFromCandidate）で分ける。
  const fromCandidate = (place: string) => ({ party: 2, place, placeFromCandidate: true }) as Parameters<typeof fetchOffers>[1];

  it("候補を選んで探したときは、記録に文字を書かず place ID だけを残す。出発地は place ID と決まった文字で付ける", async () => {
    const { at, offer } = await storeWithOffer();
    ctx.geocoder.set("東京都渋谷区渋谷２丁目 候補の駅", { ...at, placeId: "ChIJ-candidate" });
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, fromCandidate("東京都渋谷区渋谷２丁目 候補の駅"));
    requireInResults(fetched, offer.id);
    expect(await one(ctx.db, "SELECT origin_kind, origin_lat, origin_lng, origin_place, origin_place_id FROM fetch_logs WHERE id = ?", fetched.json.fetchId)).toEqual({
      origin_kind: "place",
      origin_lat: null,
      origin_lng: null,
      origin_place: null,
      origin_place_id: "ChIJ-candidate",
    });
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    const expected = { place: ROUTE_ORIGIN_LABEL, placeId: "ChIJ-candidate" };
    expect(received.json.reservation.origin).toEqual(expected);
    expect((await customer.api.get("/api/customer/home")).json.reservation.origin).toEqual(expected);
  });

  // 画面の側も、候補から来た文字を経路の出発地として覚えず、探した結果にも載せない（FetchForm・2026-09-26 独立した再レビューの指摘）。
  // 以前はここで応答が出発地を付けなくても、画面の補い（結果の起点・タブの覚え）から候補の文字が Google マップの origin へ回っていた。
  // 検査は components/customer/FetchSuggest.test.tsx。
  it("候補を選んで探し、地図の応答に place ID が無ければ、記録に何も残さず出発地も付けない（マップが現在地から引く）", async () => {
    const { at, offer } = await storeWithOffer();
    ctx.geocoder.set("番号の無い候補", at);
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, fromCandidate("番号の無い候補"));
    requireInResults(fetched, offer.id);
    expect(await one(ctx.db, "SELECT origin_kind, origin_place, origin_place_id FROM fetch_logs WHERE id = ?", fetched.json.fetchId)).toEqual({ origin_kind: "place", origin_place: null, origin_place_id: null });
    const received = await receive(customer.api, { offerId: offer.id, party: 2, fetchId: fetched.json.fetchId });
    expect(received.json.reservation.origin ?? null).toBeNull();
  });

  it("現在地（端末の座標・Google の中身ではない）で探した記録には、今までどおり座標を残す", async () => {
    const { at } = await storeWithOffer();
    const customer = await registerCustomer(ctx);
    const fetched = await fetchOffers(customer.api, { party: 2, ...at });
    const log = await one(ctx.db, "SELECT origin_lat, origin_lng, origin_place, origin_place_id FROM fetch_logs WHERE id = ?", fetched.json.fetchId);
    expect(log.origin_lat).toBeCloseTo(at.lat, 6);
    expect(log.origin_lng).toBeCloseTo(at.lng, 6);
    expect(log.origin_place).toBeNull();
    expect(log.origin_place_id).toBeNull();
  });
});
