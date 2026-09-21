// 要件1 客の登録（手続き・入口）／要件2 客の識別子は r02。画面は r01-customer-register.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { CUSTOMER, cookieOf, loadWeb, makeCtx, one, registerCustomer, rows, type Ctx } from "./_fakes";

describeTask("3", "客の登録（手続き）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("1.1 通る入力で、識別子（Cookie）なしで登録が1件できる", async () => {
    const before = (await rows(ctx.db, "SELECT id FROM customers")).length;
    const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, humanToken: "tok-ok" });
    expect([200, 201]).toContain(r.status);
    expect(cookieOf(r)).toBeTruthy();
    const after = await rows(ctx.db, "SELECT nickname, phone FROM customers");
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ nickname: CUSTOMER.nickname, phone: CUSTOMER.phone });
  });

  it("1.2 呼び名 0字・21字は保存されず nickname が返る。1字・20字は通る", async () => {
    for (const nickname of ["", "あ".repeat(21)]) {
      const before = (await rows(ctx.db, "SELECT id FROM customers")).length;
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, nickname, humanToken: "tok-ok" });
      expect(r.status, nickname.length.toString()).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("nickname");
      expect((await rows(ctx.db, "SELECT id FROM customers")).length).toBe(before);
    }
    for (const nickname of ["あ", "あ".repeat(20)]) {
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, nickname, humanToken: "tok-ok" });
      expect([200, 201], nickname.length.toString()).toContain(r.status);
    }
  });

  it("1.3 電話番号 9桁・12桁・数字以外は保存されず phone が返る。10桁・11桁は通る", async () => {
    for (const phone of ["090123456", "090123456789", "０９０１２３４５６７８", "090-1234-5678"]) {
      const before = (await rows(ctx.db, "SELECT id FROM customers")).length;
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, phone, humanToken: "tok-ok" });
      expect(r.status, phone).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("phone");
      expect((await rows(ctx.db, "SELECT id FROM customers")).length).toBe(before);
    }
    for (const phone of ["0312345678", "09012345678"]) {
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, phone, humanToken: "tok-ok" });
      expect([200, 201], phone).toContain(r.status);
    }
  });

  it("1.7 予算 −1・100001・小数は保存されず budgetMax が返る。0・100000 は通る", async () => {
    for (const budgetMax of [-1, 100001, 3000.5]) {
      const before = (await rows(ctx.db, "SELECT id FROM customers")).length;
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, budgetMax, humanToken: "tok-ok" });
      expect(r.status, String(budgetMax)).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("budgetMax");
      expect((await rows(ctx.db, "SELECT id FROM customers")).length).toBe(before);
    }
    for (const budgetMax of [0, 100000]) {
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, budgetMax, humanToken: "tok-ok" });
      expect([200, 201], String(budgetMax)).toContain(r.status);
    }
  });

  it("1.4・1.6 ジャンル 0個・12個は通り、選択肢に無い値・重複は落ちる。予算が未指定でも通る", async () => {
    const { GENRES } = await loadWeb("lib/domain/genres");
    expect(GENRES).toHaveLength(12);
    const { customerRegisterSchema } = await loadWeb("lib/schemas/customer");
    const base = { nickname: "a", phone: "09012345678" };
    expect(customerRegisterSchema.safeParse({ ...base, genres: [], budgetMax: null }).success).toBe(true);
    expect(customerRegisterSchema.safeParse({ ...base, genres: [...GENRES], budgetMax: null }).success).toBe(true);
    expect(customerRegisterSchema.safeParse({ ...base, genres: ["フレンチ"], budgetMax: null }).success).toBe(false);
    expect(customerRegisterSchema.safeParse({ ...base, genres: [GENRES[0], GENRES[0]], budgetMax: null }).success).toBe(false);
    expect(customerRegisterSchema.safeParse({ ...base, genres: [] }).success).toBe(true);
    const r = await ctx.api().post("/api/register/customer", { nickname: "b", phone: "09012345678", genres: [...GENRES], humanToken: "tok-ok" });
    expect([200, 201]).toContain(r.status);
    const saved = await one(ctx.db, "SELECT budget_max FROM customers ORDER BY rowid DESC LIMIT 1");
    expect(saved.budget_max).toBeNull();
  });

  it("1.8・1.10・1.11 ホームは Cookie なし・でたらめな Cookie で 401、登録済みなら取得の画面（kind fetch）と登録の値", async () => {
    const none = await ctx.api().get("/api/customer/home");
    expect(none.status).toBe(401);
    expect(JSON.stringify(none.json)).not.toContain(CUSTOMER.phone);
    const c = await registerCustomer(ctx);
    const name = c.cookie.split("=")[0];
    const bogus = await ctx.api(`${name}=${"x".repeat(22)}`).get("/api/customer/home");
    expect(bogus.status).toBe(401);
    const home = await c.api.get("/api/customer/home");
    expect(home.status).toBe(200);
    expect(home.json.kind).toBe("fetch");
    expect(home.json.profile).toEqual({ nickname: CUSTOMER.nickname, phone: CUSTOMER.phone, genres: CUSTOMER.genres, budgetMax: CUSTOMER.budgetMax });
  });

  it("2.7 客の入口のスキーマにパスワード・確認番号・ログインの項目が無い", async () => {
    const schemas = await loadWeb("lib/schemas/customer");
    const text = JSON.stringify(Object.keys(schemas)) + JSON.stringify(Object.values(schemas).map((s: any) => Object.keys(s?.shape ?? {})));
    expect(text).not.toMatch(/password|passcode|pin|login|otp|verification/i);
  });
});

describeTask("29", "【最終日】客の登録の変更（1.9）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("1.9 4項目を変えられ、範囲の外は変わらない。別の客の登録は変わらない", async () => {
    const a = await registerCustomer(ctx, { nickname: "さとう", phone: "08011112222" });
    const b = await registerCustomer(ctx, { nickname: "すずき", phone: "08033334444" });
    const ok = await a.api.patch("/api/customer/profile", { nickname: "さとう2", phone: "08099998888", genres: ["中華"], budgetMax: 1500 });
    expect(ok.status).toBe(200);
    const home = await a.api.get("/api/customer/home");
    expect(home.json.profile).toEqual({ nickname: "さとう2", phone: "08099998888", genres: ["中華"], budgetMax: 1500 });
    const bad = await a.api.patch("/api/customer/profile", { nickname: "あ".repeat(21), phone: "08099998888", genres: ["中華"], budgetMax: 1500 });
    expect(bad.status).toBe(400);
    expect((await a.api.get("/api/customer/home")).json.profile.nickname).toBe("さとう2");
    expect((await b.api.get("/api/customer/home")).json.profile).toMatchObject({ nickname: "すずき", phone: "08033334444" });
  });
});
