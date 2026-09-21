// 要件3 取得の入力（手続き）: 3.2〜3.6・3.10・3.11・3.14・3.15。画面は r03-fetch-input.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, one, publishOffer, registerCustomer, rows, SHIBUYA, type Ctx } from "./_fakes";

describeTask("11", "場所の文字と地図のサービス、人数の範囲、登録に書き戻さない", () => {
  let ctx: Ctx;
  let storeId: string;
  beforeAll(async () => {
    ctx = await makeCtx();
    const s = await approvedStore(ctx, { name: "渋谷の店" });
    await publishOffer(s.api);
    storeId = s.id;
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("3.2 場所の文字があれば現在地を使わず、地図のサービスで直した位置を起点にする", async () => {
    const c = await registerCustomer(ctx);
    ctx.geocoder.set("渋谷駅", SHIBUYA);
    ctx.geocoder.set("新宿駅", { lat: 35.6896, lng: 139.7006 });
    const shibuya = await c.api.post("/api/customer/fetch", { place: "渋谷駅", lat: 35.0, lng: 135.0, party: 2, genres: [], budgetMax: null });
    expect(shibuya.status).toBe(200);
    expect(shibuya.json.items.map((i: any) => i.storeId)).toEqual([storeId]);
    expect(ctx.geocoder.calls).toContain("渋谷駅");
    const shinjuku = await c.api.post("/api/customer/fetch", { place: "新宿駅", party: 2, genres: [], budgetMax: null });
    expect(shinjuku.json.items).toEqual([]);
    const log = await one(ctx.db, "SELECT origin_lat, origin_lng FROM fetch_logs WHERE id = ?", shibuya.json.fetchId);
    expect(log.origin_lat).toBeCloseTo(SHIBUYA.lat, 3);
  });

  it("3.4・3.5・3.6 0件／失敗／3秒返らない（偽の時計）／日本の外、のどれでも取得を行わない（記録が増えず AI も呼ばれず place_unresolved）", async () => {
    const c = await registerCustomer(ctx, { phone: "08000000011" });
    ctx.geocoder.set("失敗する場所", "fail");
    ctx.geocoder.set("返らない場所", "hang");
    ctx.geocoder.set("サンフランシスコ", { lat: 37.77, lng: -122.41 });
    for (const place of ["どこにもない場所", "失敗する場所", "返らない場所", "サンフランシスコ"]) {
      const logs = (await rows(ctx.db, "SELECT id FROM fetch_logs")).length;
      const ai = ctx.ai.calls.length;
      const pending = c.api.post("/api/customer/fetch", { place, party: 2, genres: [], budgetMax: null });
      if (place === "返らない場所") await ctx.clock.advance(3_100);
      const r = await pending;
      expect(r.status, place).toBe(400);
      expect(r.json.error.kind, place).toBe("place_unresolved");
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("place");
      expect((await rows(ctx.db, "SELECT id FROM fetch_logs")).length, place).toBe(logs);
      expect(ctx.ai.calls.length, place).toBe(ai);
    }
  });

  it("3.3・3.10・3.11 場所 51字、人数 空・0・11・小数は落ち、1と10は通る（スキーマと入口の両方）", async () => {
    const { fetchSchema } = await loadWeb("lib/schemas/fetch");
    const base = { lat: SHIBUYA.lat, lng: SHIBUYA.lng, genres: [], budgetMax: null };
    expect(fetchSchema.safeParse({ ...base, place: "あ".repeat(51), party: 2 }).success).toBe(false);
    expect(fetchSchema.safeParse({ ...base, place: "あ".repeat(50), party: 2 }).success).toBe(true);
    for (const party of [undefined, 0, 11, 2.5]) expect(fetchSchema.safeParse({ ...base, party }).success, String(party)).toBe(false);
    for (const party of [1, 10]) expect(fetchSchema.safeParse({ ...base, party }).success, String(party)).toBe(true);
    const c = await registerCustomer(ctx, { phone: "08000000012" });
    const r = await c.api.post("/api/customer/fetch", { ...base, party: 0 });
    expect(r.status).toBe(400);
    expect(r.json.error.fields).toContainEqual({ name: "party", reason: "out_of_range" });
    expect((await c.api.post("/api/customer/fetch", { ...base })).json.error.fields).toContainEqual({ name: "party", reason: "required" });
    expect((await c.api.post("/api/customer/fetch", { ...base, party: 2.5 })).json.error.fields).toContainEqual({ name: "party", reason: "not_integer" });
    expect((await c.api.post("/api/customer/fetch", { ...base, place: "あ".repeat(51), party: 2 })).json.error.fields).toContainEqual({ name: "place", reason: "too_long" });
  });

  it("3.14・3.15 その回だけ変えた好みと予算、起点を登録に書き戻さない", async () => {
    const c = await registerCustomer(ctx, { phone: "08000000013", genres: ["和食"], budgetMax: 4000 });
    const before = await one(ctx.db, "SELECT * FROM customers WHERE phone = ?", "08000000013");
    const r = await fetchOffers(c.api, { party: 5, genres: ["中華", "焼肉"], budgetMax: 1500, lat: 35.7, lng: 139.8 });
    expect(r.status).toBe(200);
    expect(await one(ctx.db, "SELECT * FROM customers WHERE phone = ?", "08000000013")).toEqual(before);
    expect((await c.api.get("/api/customer/home")).json.profile).toMatchObject({ genres: ["和食"], budgetMax: 4000 });
  });
});
