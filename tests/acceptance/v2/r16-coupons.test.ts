// 要件16 クーポン（手続き）。16.6 は受け取りのタスク（13）、16.8 は取得の判断のタスク（10）。画面は r16-coupons.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, loadWeb, makeCtx, publishOffer, receivedScene, registerStore, rows, type Ctx } from "./_fakes";

describeTask("6", "クーポンの作成・編集・削除", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("16.1・16.2 3つまで作れ、4つ目は limit_reached で断り、一覧は3つのまま", async () => {
    const s = await registerStore(ctx);
    const created: string[] = [];
    for (const name of ["生ビール1杯", "デザート", "10%引き"]) {
      const r = await s.api.post("/api/store/coupons", { name, note: `${name}の注意` });
      expect([200, 201], name).toContain(r.status);
      expect(r.json.coupon).toMatchObject({ name, note: `${name}の注意` });
      created.push(r.json.coupon.id);
    }
    const fourth = await s.api.post("/api/store/coupons", { name: "4つ目", note: "" });
    expect(fourth.status).toBe(409);
    expect(fourth.json.error.kind).toBe("limit_reached");
    const list = (await s.api.get("/api/store/coupons")).json.items;
    expect(list.map((c: any) => c.id)).toEqual(created);
    expect(list.map((c: any) => c.name)).toEqual(["生ビール1杯", "デザート", "10%引き"]);
  });

  it("16.3 名前 0字・41字、特記事項 101字は断る。40字・100字は通る", async () => {
    const s = await registerStore(ctx);
    for (const [body, field] of [[{ name: "", note: "" }, "name"], [{ name: "あ".repeat(41), note: "" }, "name"], [{ name: "a", note: "あ".repeat(101) }, "note"]] as const) {
      const r = await s.api.post("/api/store/coupons", body);
      expect(r.status, field).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain(field);
    }
    expect([200, 201]).toContain((await s.api.post("/api/store/coupons", { name: "あ".repeat(40), note: "い".repeat(100) })).status);
    expect((await rows(ctx.db, "SELECT id FROM coupons WHERE store_id = ?", s.id)).length).toBe(1);
  });

  it("16.4 編集と削除ができ、別の店のクーポンは触れない", async () => {
    const s = await registerStore(ctx);
    const other = await registerStore(ctx);
    const c = (await s.api.post("/api/store/coupons", { name: "元の名前", note: "元の注意" })).json.coupon;
    const edit = await s.api.put(`/api/store/coupons/${c.id}`, { name: "新しい名前", note: "新しい注意" });
    expect(edit.status).toBe(200);
    expect((await s.api.get("/api/store/coupons")).json.items[0]).toMatchObject({ id: c.id, name: "新しい名前", note: "新しい注意" });
    expect([403, 404]).toContain((await other.api.put(`/api/store/coupons/${c.id}`, { name: "乗っ取り", note: "" })).status);
    expect([403, 404]).toContain((await other.api.del(`/api/store/coupons/${c.id}`)).status);
    expect((await s.api.get("/api/store/coupons")).json.items[0].name).toBe("新しい名前");
    expect((await s.api.del(`/api/store/coupons/${c.id}`)).status).toBe(200);
    expect((await s.api.get("/api/store/coupons")).json.items).toEqual([]);
  });
});

describeTask("9", "公開中のクーポンは編集・削除できない（16.5）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("16.5 公開中のオファーが見せているクーポンの編集と削除は coupon_in_use で断り、見せていないクーポンは編集できる。止めたあとは編集できる", async () => {
    const s = await approvedStore(ctx, { coupons: [{ name: "見せる", note: "" }, { name: "見せない", note: "" }] });
    const [shown, hidden] = s.coupons;
    await publishOffer(s.api, { couponIds: [shown.id] });
    for (const call of [() => s.api.put(`/api/store/coupons/${shown.id}`, { name: "変更", note: "" }), () => s.api.del(`/api/store/coupons/${shown.id}`)]) {
      const r = await call();
      expect(r.status).toBe(409);
      expect(r.json.error.kind).toBe("coupon_in_use");
    }
    expect((await s.api.get("/api/store/coupons")).json.items.find((c: any) => c.id === shown.id).name).toBe("見せる");
    expect((await s.api.put(`/api/store/coupons/${hidden.id}`, { name: "見せない2", note: "" })).status).toBe(200);
    expect((await s.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    expect((await s.api.put(`/api/store/coupons/${shown.id}`, { name: "変更", note: "" })).status).toBe(200);
  });
});

describeTask("13", "確保はクーポンの写しを持ち続ける（16.6）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("16.6 受け取った時点の名前と特記事項が、あとの編集と削除で変わらない", async () => {
    const scene = await receivedScene(ctx, { coupons: [{ name: "生ビール1杯", note: "1組1回" }] });
    const before = (await scene.customer.api.get("/api/customer/home")).json.reservation.coupons;
    expect(before).toEqual([{ name: "生ビール1杯", note: "1組1回" }]);
    expect((await scene.store.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    const coupon = scene.store.coupons[0];
    expect((await scene.store.api.put(`/api/store/coupons/${coupon.id}`, { name: "変わった名前", note: "変わった注意" })).status).toBe(200);
    expect((await scene.customer.api.get("/api/customer/home")).json.reservation.coupons).toEqual(before);
    expect((await scene.store.api.del(`/api/store/coupons/${coupon.id}`)).status).toBe(200);
    expect((await scene.customer.api.get("/api/customer/home")).json.reservation.coupons).toEqual(before);
  });
});

describeTask("10", "特記事項は絞り込みにも点数にも使わない（16.8）", () => {
  it("16.8 絞り込みと点数の入力の型にクーポンが無く、特記事項だけ違う2つの入力で結果が同じ", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const { rankStores } = await loadWeb("lib/domain/score");
    const mk = (note: string) => ({ id: "s1", lat: 35.6595, lng: 139.7005, partyMax: 4, budgetMin: 1000, budgetMax: 3000, receivable: true, genres: ["和食"], coupons: [{ name: "x", note }] });
    const input = { origin: { lat: 35.6595, lng: 139.7005 }, party: 2, budgetMax: null };
    expect(JSON.stringify(filterCandidates(input, [mk("A")]).map((s: any) => s.id))).toBe(JSON.stringify(filterCandidates(input, [mk("とても長い特記事項".repeat(5))]).map((s: any) => s.id)));
    const rank = (note: string) => rankStores([{ id: "s1", distanceMeters: 100, storeGenres: ["和食"], createdAt: "2026-01-01T00:00:00Z", coupons: [{ name: "x", note }] }], ["和食"]);
    expect(rank("A")[0].score).toBe(rank("B".repeat(50))[0].score);
  });
});
