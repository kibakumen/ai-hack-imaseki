// 要件19 公開中の変更（手続き・純粋 domain/until）。画面は r19-live-changes.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, one, publishOffer, receive, receivedScene, registerCustomer, type Ctx } from "./_fakes";

const JST = (hhmm: string, dayOffset = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 22 + dayOffset, h - 9, m)).toISOString();
};

describeTask("20", "公開中の変更", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const offerOf = async (api: any) => (await api.get("/api/store/home")).json.offer;

  it("19.1・19.2・19.3 「追加で出す」で組数と残りが同じ数だけ増える。足したあとの残りが21なら over_capacity。残り0でも足せる", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await receivedScene(ctx, { capacity: 3 });
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 3, remaining: 2 });
    expect((await s.store.api.post("/api/store/offers/current/add", { count: 5 })).status).toBe(200);
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 8, remaining: 7 });
    const over = await s.store.api.post("/api/store/offers/current/add", { count: 14 });
    expect(over.status).toBe(400);
    expect(over.json.error.fields).toContainEqual({ name: "count", reason: "over_capacity" });
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 8, remaining: 7 });
    for (const count of [0, 21, 1.5]) expect((await s.store.api.post("/api/store/offers/current/add", { count })).status, String(count)).toBe(400);
    const zero = await receivedScene(ctx, { capacity: 1 });
    expect((await offerOf(zero.store.api)).remaining).toBe(0);
    expect((await zero.store.api.post("/api/store/offers/current/add", { count: 2 })).status).toBe(200);
    expect(await offerOf(zero.store.api)).toMatchObject({ capacity: 3, remaining: 2 });
  });

  it("19.4・19.5 「残りの募集を減らす」で同じ数だけ減る。0 と残り＋1 は断る（out_of_range・over_remaining）", async () => {
    const s = await receivedScene(ctx, { capacity: 5 });
    expect((await s.store.api.post("/api/store/offers/current/reduce", { count: 2 })).status).toBe(200);
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 3, remaining: 2 });
    const zero = await s.store.api.post("/api/store/offers/current/reduce", { count: 0 });
    expect(zero.status).toBe(400);
    expect(zero.json.error.fields).toContainEqual({ name: "count", reason: "out_of_range" });
    const over = await s.store.api.post("/api/store/offers/current/reduce", { count: 3 });
    expect(over.status).toBe(400);
    expect(over.json.error.fields).toContainEqual({ name: "count", reason: "over_remaining" });
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 3, remaining: 2 });
    expect((await s.store.api.post("/api/store/offers/current/reduce", { count: 2 })).status).toBe(200);
    expect(await offerOf(s.store.api)).toMatchObject({ capacity: 1, remaining: 0 });
  });

  it("19.6・19.7 「何名まで」を1〜10へ上げ下げでき、そのあとの取得と受け取りは変えたあとの値と比べる", async () => {
    const s = await approvedStore(ctx);
    const offer = await publishOffer(s.api, { capacity: 5, partyMax: 4 });
    for (const partyMax of [0, 11]) expect((await s.api.post("/api/store/offers/current/party-max", { partyMax })).status).toBe(400);
    expect((await s.api.post("/api/store/offers/current/party-max", { partyMax: 2 })).status).toBe(200);
    const c = await registerCustomer(ctx, { nickname: "さんにん", phone: "08088880001" });
    let f = await fetchOffers(c.api, { party: 3 });
    expect(f.json.items.map((i: any) => i.offerId)).not.toContain(offer.id);
    let r = await receive(c.api, { offerId: offer.id, party: 3, fetchId: f.json.fetchId });
    expect(r.status).toBe(409);
    expect(r.json.refusal).toMatchObject({ kind: "party_over_max", partyMax: 2 });
    expect((await s.api.post("/api/store/offers/current/party-max", { partyMax: 10 })).status).toBe(200);
    f = await fetchOffers(c.api, { party: 3 });
    expect(f.json.items.map((i: any) => i.offerId)).toContain(offer.id);
    r = await receive(c.api, { offerId: offer.id, party: 3, fetchId: f.json.fetchId });
    expect(r.status).toBe(200);
  });

  it("19.8・19.9・19.13 何時まで: 公開 15:00・今 16:40・終わり 17:00 で、18:00 は延ばせ 16:50 は早められ、16:00・15:00 は until_in_past、04:00・14:00 は until_over_window。公開 20:00・今 23:00 で 02:00 は通り 21:00 は今以前", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await approvedStore(ctx);
    await publishOffer(s.api, { until: "17:00" });
    ctx.clock.set(JST("16:40"));
    const change = (until: string) => s.api.post("/api/store/offers/current/until", { until });
    expect((await change("18:00")).status).toBe(200);
    expect((await offerOf(s.api)).untilAt).toBe(JST("18:00"));
    expect((await change("16:50")).status).toBe(200);
    expect((await offerOf(s.api)).untilAt).toBe(JST("16:50"));
    for (const until of ["16:00", "15:00"]) {
      const r = await change(until);
      expect(r.status, until).toBe(409);
      expect(r.json.error.kind, until).toBe("until_in_past");
      expect((await offerOf(s.api)).untilAt).toBe(JST("16:50"));
    }
    for (const until of ["04:00", "14:00"]) {
      const r = await change(until);
      expect(r.status, until).toBe(409);
      expect(r.json.error.kind, until).toBe("until_over_window");
      expect((await offerOf(s.api)).untilAt).toBe(JST("16:50"));
    }
    expect((await offerOf(s.api)).latestUntil).toBe(JST("03:00", 1));
    const late = await approvedStore(ctx);
    ctx.clock.set(JST("20:00"));
    await publishOffer(late.api, { until: "23:30" });
    ctx.clock.set(JST("23:00"));
    expect((await late.api.post("/api/store/offers/current/until", { until: "02:00" })).status).toBe(200);
    expect((await offerOf(late.api)).untilAt).toBe(JST("02:00", 1));
    const past = await late.api.post("/api/store/offers/current/until", { until: "21:00" });
    expect(past.status).toBe(409);
    expect(past.json.error.kind).toBe("until_in_past");
    ctx.clock.set(JST("15:00"));
  });

  it("domain/until（純粋）: 同じ時刻の表", async () => {
    const { resolveUntil } = await loadWeb("lib/domain/until");
    const publishedAt = new Date(JST("15:00"));
    const now = new Date(JST("16:40"));
    const r = (input: string) => resolveUntil({ input, publishedAt, now });
    expect(r("18:00")).toMatchObject({ kind: "ok", at: new Date(JST("18:00")) });
    expect(r("16:50")).toMatchObject({ kind: "ok", at: new Date(JST("16:50")) });
    expect(r("16:00").kind).toBe("in_past");
    expect(r("15:00").kind).toBe("in_past");
    expect(r("04:00").kind).toBe("over_window");
    expect(r("14:00").kind).toBe("over_window");
    expect(r("03:00")).toMatchObject({ kind: "ok", at: new Date(JST("03:00", 1)) });
    expect(r("03:01").kind).toBe("over_window");
    expect(r("04:00").latest).toEqual(new Date(JST("03:00", 1)));
    const late = (input: string) => resolveUntil({ input, publishedAt: new Date(JST("20:00")), now: new Date(JST("23:00")) });
    expect(late("02:00")).toMatchObject({ kind: "ok", at: new Date(JST("02:00", 1)) });
    expect(late("21:00").kind).toBe("in_past");
  });

  it("19.10 どの変更でも確保中の確保の人数・コード・期限・クーポンが変わらない。19.12 終わったオファーへの変更は offer_ended", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await receivedScene(ctx, { capacity: 3, coupons: [{ name: "生ビール", note: "" }] });
    const read = () => one(ctx.db, "SELECT party, code, expires_at, coupons_json FROM reservations WHERE id = ?", s.reservation.id);
    const before = await read();
    await s.store.api.post("/api/store/offers/current/add", { count: 1 });
    await s.store.api.post("/api/store/offers/current/reduce", { count: 1 });
    await s.store.api.post("/api/store/offers/current/party-max", { partyMax: 1 });
    await s.store.api.post("/api/store/offers/current/until", { until: "16:00" });
    expect(await read()).toEqual(before);
    await s.store.api.post("/api/store/offers/current/stop", {});
    for (const [p, body] of [["add", { count: 1 }], ["reduce", { count: 1 }], ["party-max", { partyMax: 3 }], ["until", { until: "18:00" }]] as const) {
      const r = await s.store.api.post(`/api/store/offers/current/${p}`, body);
      expect(r.status, p).toBe(409);
      expect(r.json.error.kind, p).toBe("offer_ended");
    }
    expect(await read()).toEqual(before);
  });
});
