// 要件15 店の情報（手続き）。画面は r15-store-profile.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { makeCtx, one, PROFILE, registerStore, type Ctx } from "./_fakes";

describeTask("5", "店の情報の保存と住所の位置直し", () => {
  let ctx: Ctx;
  let store: Awaited<ReturnType<typeof registerStore>>;
  beforeAll(async () => {
    ctx = await makeCtx();
    store = await registerStore(ctx);
    ctx.geocoder.set(PROFILE.address, { lat: 35.6595, lng: 139.7005 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const put = (over: Record<string, unknown>) => store.api.put("/api/store/profile", { ...PROFILE, ...over });

  it("15.1・15.3 6項目が保存でき、読み直すと同じ。URL は空でも通る", async () => {
    const r = await put({ url: null });
    expect(r.status).toBe(200);
    const g = await store.api.get("/api/store/profile");
    expect(g.json.profile).toMatchObject({ ...PROFILE, url: null });
    const r2 = await put({ url: "https://example.com/x", menus: ["塩ラーメン"] });
    expect(r2.status).toBe(200);
    expect((await store.api.get("/api/store/profile")).json.profile).toMatchObject({ url: "https://example.com/x", menus: ["塩ラーメン"] });
  });

  it("15.2 店名 51字・住所 201字は断る（項目名つき）。50字・200字は通る", async () => {
    ctx.geocoder.set("a".repeat(200), { lat: 35.66, lng: 139.7 });
    for (const [over, field] of [[{ name: "店".repeat(51) }, "name"], [{ address: "a".repeat(201) }, "address"], [{ name: "" }, "name"], [{ address: "" }, "address"]] as const) {
      const r = await put(over);
      expect(r.status, field).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain(field);
    }
    expect((await put({ name: "店".repeat(50) })).status).toBe(200);
    expect((await put({ address: "a".repeat(200) })).status).toBe(200);
  });

  it("15.4 URL が ftp: や http 以外で始まると断る。http・https は通る", async () => {
    for (const url of ["ftp://example.com", "example.com", "javascript:alert(1)"]) {
      const r = await put({ url });
      expect(r.status, url).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("url");
    }
    for (const url of ["http://example.com", "https://example.com/a?b=c"]) expect((await put({ url })).status, url).toBe(200);
  });

  it("15.5 ジャンル 0個・4個は断り、1個・3個は通る。選択肢に無い値は断る", async () => {
    for (const genres of [[], ["和食", "寿司・海鮮", "焼肉", "焼き鳥・串"], ["フレンチ"]]) {
      const r = await put({ genres });
      expect(r.status, JSON.stringify(genres)).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("genres");
    }
    expect((await put({ genres: ["中華"] })).status).toBe(200);
    expect((await put({ genres: ["和食", "寿司・海鮮", "焼肉"] })).status).toBe(200);
  });

  it("15.6・15.7 おすすめメニュー 41字は断り、5件は通り、6件目は上限として断る", async () => {
    const bad = await put({ menus: ["あ".repeat(41)] });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields.map((f: any) => f.name)).toContain("menus");
    expect((await put({ menus: ["a", "b", "c", "d", "e"] })).status).toBe(200);
    const six = await put({ menus: ["a", "b", "c", "d", "e", "f"] });
    expect([400, 409]).toContain(six.status);
    expect(["limit_reached", "invalid_input"]).toContain(six.json.error.kind);
    if (six.json.error.kind === "invalid_input") expect(six.json.error.fields).toContainEqual({ name: "menus", reason: "too_many" });
    expect((await store.api.get("/api/store/profile")).json.profile.menus).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("15.8 予算の幅: 範囲の外・小数・最低が最高より上は断る。同じ値は通る", async () => {
    for (const [over, field] of [[{ budgetMin: -1 }, "budgetMin"], [{ budgetMax: 100001 }, "budgetMax"], [{ budgetMin: 1000.5 }, "budgetMin"], [{ budgetMin: 5000, budgetMax: 4000 }, "budgetMin"]] as const) {
      const r = await put(over);
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain(field);
    }
    const same = await put({ budgetMin: 3000, budgetMax: 3000 });
    expect(same.status).toBe(200);
    const minOverMax = await put({ budgetMin: 5000, budgetMax: 4000 });
    expect(minOverMax.json.error.fields).toContainEqual({ name: "budgetMin", reason: "min_over_max" });
  });

  it("15.9・15.10・15.11 住所は位置に直して保存する。0件・失敗・日本の外は住所を保存しない（address_unresolved）", async () => {
    ctx.geocoder.set("東京都新宿区1-1", { lat: 35.69, lng: 139.7 });
    expect((await put({ address: "東京都新宿区1-1" })).status).toBe(200);
    let row = await one(ctx.db, "SELECT address, lat, lng FROM stores WHERE id = ?", store.id);
    expect(row).toMatchObject({ address: "東京都新宿区1-1" });
    expect(row.lat).toBeCloseTo(35.69, 3);
    expect(row.lng).toBeCloseTo(139.7, 3);
    ctx.geocoder.set("失敗する住所", "fail");
    ctx.geocoder.set("海外の住所", { lat: 37.77, lng: -122.41 });
    for (const address of ["どこにもない住所", "失敗する住所", "海外の住所"]) {
      const r = await put({ address });
      expect(r.status, address).toBe(409);
      expect(r.json.error.kind).toBe("address_unresolved");
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("address");
      row = await one(ctx.db, "SELECT address, lat FROM stores WHERE id = ?", store.id);
      expect(row.address, address).toBe("東京都新宿区1-1");
      expect(row.lat).toBeCloseTo(35.69, 3);
    }
  });
});
