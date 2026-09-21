// 要件17 オファーの公開と停止（手続き・純粋）。画面は r17-publish.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, one, PDF_BYTES, PROFILE, publishOffer, receive, receivedScene, registerCard, registerCustomer, registerStore, seedAdmin, uploadLicense, type Ctx } from "./_fakes";

// 起点 T0 = 2026-09-22 15:00 JST
const JST = (hhmm: string, dayOffset = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 22 + dayOffset, h - 9, m)).toISOString();
};

describeTask("9", "公開と停止", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const body = (over: Record<string, unknown> = {}) => ({ couponIds: [], capacity: 3, partyMax: 4, until: "23:00", ...over });

  it("17.1・17.2・17.22 公開できる（クーポン0個の店・チェック0個でも）。ホームに組数・残り・何名まで・何時まで・見せているクーポンが出る", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await approvedStore(ctx, { coupons: [{ name: "生ビール", note: "" }, { name: "デザート", note: "" }] });
    const r = await s.api.post("/api/store/offers", body({ couponIds: [s.coupons[0].id], capacity: 5, partyMax: 6, until: "22:30" }));
    expect([200, 201]).toContain(r.status);
    const home = (await s.api.get("/api/store/home")).json;
    expect(home.offer).toMatchObject({ capacity: 5, remaining: 5, partyMax: 6 });
    expect(home.offer.untilAt).toBe(JST("22:30"));
    expect(home.offer.coupons.map((c: any) => c.name)).toEqual(["生ビール"]);
    expect(home.offer.latestUntil).toBe(JST("03:00", 1));
    const noCoupon = await approvedStore(ctx);
    expect([200, 201]).toContain((await noCoupon.api.post("/api/store/offers", body())).status);
    expect((await noCoupon.api.get("/api/store/home")).json.offer.coupons).toEqual([]);
  });

  it("17.3・17.4・17.6 組数 0・21、何名まで 0・11 は公開せず、どの項目かが fields で返る。1・20、1・10 は通る", async () => {
    for (const [over, field] of [[{ capacity: 0 }, "capacity"], [{ capacity: 21 }, "capacity"], [{ partyMax: 0 }, "partyMax"], [{ partyMax: 11 }, "partyMax"], [{ capacity: 2.5 }, "capacity"]] as const) {
      const s = await approvedStore(ctx);
      const r = await s.api.post("/api/store/offers", body(over));
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain(field);
      expect((await s.api.get("/api/store/home")).json.offer).toBeNull();
    }
    for (const over of [{ capacity: 1, partyMax: 1 }, { capacity: 20, partyMax: 10 }]) {
      const s = await approvedStore(ctx);
      expect([200, 201], JSON.stringify(over)).toContain((await s.api.post("/api/store/offers", body(over))).status);
    }
  });

  it("17.5・17.6 何時まで: 今の時分（今以前）は until in_past、12時間＋1分は over_window、日付をまたぐ 02:00 は通る", async () => {
    ctx.clock.set(JST("15:00"));
    const cases: Array<[string, string | null]> = [["15:00", "in_past"], ["14:59", "over_window"], ["03:01", "over_window"], ["03:00", null], ["02:00", null], ["15:01", null]];
    for (const [until, reason] of cases) {
      const s = await approvedStore(ctx);
      const r = await s.api.post("/api/store/offers", body({ until }));
      if (reason === null) {
        expect([200, 201], until).toContain(r.status);
      } else {
        expect(r.status, until).toBe(400);
        expect(r.json.error.fields, until).toContainEqual({ name: "until", reason });
        expect((await s.api.get("/api/store/home")).json.offer).toBeNull();
      }
    }
    const s = await approvedStore(ctx);
    await s.api.post("/api/store/offers", body({ until: "02:00" }));
    expect((await s.api.get("/api/store/home")).json.offer.untilAt).toBe(JST("02:00", 1));
  });

  it("17.9 公開中があると offer_exists で断る。止めたあとは公開できる", async () => {
    const s = await approvedStore(ctx);
    await publishOffer(s.api);
    const r = await s.api.post("/api/store/offers", body());
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("offer_exists");
    expect((await s.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    expect([200, 201]).toContain((await s.api.post("/api/store/offers", body())).status);
  });

  it("17.10 未承認と止められている店は公開を受け付けない", async () => {
    const pending = await registerStore(ctx);
    ctx.geocoder.set(PROFILE.address + "-p", { lat: 35.66, lng: 139.7 });
    await pending.api.put("/api/store/profile", { ...PROFILE, address: PROFILE.address + "-p" });
    expect((await pending.api.post("/api/store/offers", body())).status).toBe(409);
    const banned = await approvedStore(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${banned.id}/ban`, {});
    expect((await banned.api.post("/api/store/offers", body())).status).toBe(409);
    expect((await one(ctx.db, "SELECT COUNT(*) AS n FROM offers WHERE store_id IN (?, ?)", pending.id, banned.id)).n).toBe(0);
  });

  it("17.11 店名・住所・ジャンル・予算の幅のどれかが空だと profile_incomplete で、足りない項目が fields に返る", async () => {
    if (!ctx.admin) await seedAdmin(ctx);
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES);
    await registerCard(s.api);
    await ctx.admin!.api.post(`/api/admin/stores/${s.id}/approve`, {});
    const r = await s.api.post("/api/store/offers", body());
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("profile_incomplete");
    const missing = r.json.error.fields.map((f: any) => f.name);
    expect(missing).toContain("address");
    expect(missing).toContain("genres");
    expect((await s.api.get("/api/store/home")).json.missingProfile).toEqual(expect.arrayContaining(["address", "genres"]));
  });

  it("17.12・17.13・17.14 止めると終わり（end_reason stopped）。何時までを過ぎると操作なしで終わり（書き込みは無い）", async () => {
    ctx.clock.set(JST("15:00"));
    const a = await approvedStore(ctx);
    const offerA = await publishOffer(a.api);
    expect((await a.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    expect((await one(ctx.db, "SELECT ended_at, end_reason FROM offers WHERE id = ?", offerA.id)).end_reason).toBe("stopped");
    expect((await a.api.get("/api/store/home")).json.offer).toBeNull();
    expect((await a.api.post("/api/store/offers/current/stop", {})).status).toBe(409);

    const b = await approvedStore(ctx);
    const offerB = await publishOffer(b.api, { until: "15:10" });
    expect((await b.api.get("/api/store/home")).json.offer.id).toBe(offerB.id);
    ctx.clock.set(JST("15:11"));
    expect((await b.api.get("/api/store/home")).json.offer).toBeNull();
    expect((await one(ctx.db, "SELECT ended_at FROM offers WHERE id = ?", offerB.id)).ended_at).toBeNull();
    const { isReceivable } = await loadWeb("lib/domain/offer");
    expect(isReceivable({ endedAt: null, untilAt: new Date(JST("15:10")), remaining: 2 }, new Date(JST("15:10")))).toBe(false);
    expect(isReceivable({ endedAt: null, untilAt: new Date(JST("15:10")), remaining: 2 }, new Date(JST("15:09")))).toBe(true);
  });

  it("17.17〜17.21 公開のフォームの初めの値（純粋 publishPrefill）", async () => {
    const { publishPrefill } = await loadWeb("lib/domain/storeHome");
    const now = new Date(JST("15:00"));
    const coupons = [{ id: "c1" }, { id: "c2" }];
    expect(publishPrefill({ lastOffer: null, coupons, now })).toEqual({ couponIds: [], capacity: null, partyMax: null, until: null });
    const last = { initialCapacity: 5, capacity: 7, partyMax: 3, untilAt: new Date(JST("22:00")), couponIds: ["c1", "c9"] };
    expect(publishPrefill({ lastOffer: last, coupons, now })).toEqual({ couponIds: ["c1"], capacity: 5, partyMax: 3, until: "22:00" });
    expect(publishPrefill({ lastOffer: { ...last, untilAt: new Date(JST("14:00")) }, coupons, now }).until).toBeNull();
    expect(publishPrefill({ lastOffer: { ...last, untilAt: new Date(JST("02:00", 1)) }, coupons, now }).until).toBe("02:00");
    expect(publishPrefill({ lastOffer: { ...last, untilAt: new Date(JST("03:01", 1)) }, coupons, now }).until).toBeNull();
  });

  it("17.17・17.20 手続き: 前回のオファーの値がホームの publishPrefill に出て、削除したクーポンは外れる（変更のあとの値はタスク20のブロック）", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await approvedStore(ctx, { coupons: [{ name: "a", note: "" }, { name: "b", note: "" }] });
    await publishOffer(s.api, { capacity: 4, partyMax: 2, until: "21:00", couponIds: [s.coupons[0].id, s.coupons[1].id] });
    await s.api.post("/api/store/offers/current/stop", {});
    await s.api.del(`/api/store/coupons/${s.coupons[1].id}`);
    const home = (await s.api.get("/api/store/home")).json;
    expect(home.publishPrefill).toEqual({ couponIds: [s.coupons[0].id], capacity: 4, partyMax: 2, until: "21:00" });
  });
});

describeTask("13", "終わりでは確保中の確保を取り消さない（17.16）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("17.16 店が止めても、何時までを過ぎても、確保中の確保は確保中のまま", async () => {
    ctx.clock.set(JST("15:00"));
    const a = await receivedScene(ctx);
    expect((await a.store.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    expect((await a.customer.api.get("/api/customer/home")).json.kind).toBe("active");
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", a.reservation.id)).status).toBe("active");
    const store = await approvedStore(ctx);
    const offer = await publishOffer(store.api, { until: "15:10" });
    const c = await registerCustomer(ctx, { nickname: "まにあう", phone: "08023230001" });
    const f = await fetchOffers(c.api, { party: 2 });
    expect((await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
    ctx.clock.set(JST("15:11"));
    expect((await store.api.get("/api/store/home")).json.offer).toBeNull();
    expect((await c.api.get("/api/customer/home")).json.kind).toBe("active");
  });
});

describeTask("20", "前回の値は変更のあとの値（17.17）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("17.17 組数は公開のとき入れた値、何名までは終わった時点の値", async () => {
    ctx.clock.set(JST("15:00"));
    const s = await approvedStore(ctx);
    await publishOffer(s.api, { capacity: 4, partyMax: 2, until: "21:00" });
    await s.api.post("/api/store/offers/current/add", { count: 3 });
    await s.api.post("/api/store/offers/current/party-max", { partyMax: 6 });
    await s.api.post("/api/store/offers/current/stop", {});
    expect((await s.api.get("/api/store/home")).json.publishPrefill).toEqual({ couponIds: [], capacity: 4, partyMax: 6, until: "21:00" });
  });
});
