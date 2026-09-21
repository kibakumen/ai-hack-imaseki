// 要件12 店の登録と承認の状況（手続き）。画面は r12-store-register.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { makeCtx, one, PDF_BYTES, registerCard, registerStore, rows, seedAdmin, uploadLicense, type Ctx } from "./_fakes";

describeTask("4", "店の登録", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("12.1 ログインなしで作れて未承認になる", async () => {
    const r = await ctx.api().post("/api/register/store", { name: "はじめの店", email: "first@example.com", password: "store-pass-1234", humanToken: "tok-ok" });
    expect([200, 201]).toContain(r.status);
    const account = await one(ctx.db, "SELECT role, store_id FROM accounts WHERE email = ?", "first@example.com");
    expect(account.role).toBe("store");
    const store = await one(ctx.db, "SELECT status, name FROM stores WHERE id = ?", account.store_id);
    expect(store).toMatchObject({ status: "pending", name: "はじめの店" });
  });

  it("12.2 店でも運営でも使われているメールアドレスは重複として断る（大文字小文字を区別しない）", async () => {
    await seedAdmin(ctx, { email: "boss@example.com", password: "admin-pass-1234" });
    for (const email of ["first@example.com", "FIRST@example.com", "boss@example.com", "Boss@Example.com"]) {
      const before = (await rows(ctx.db, "SELECT id FROM accounts")).length;
      const r = await ctx.api().post("/api/register/store", { name: "重複", email, password: "store-pass-1234", humanToken: "tok-ok" });
      expect(r.status, email).toBe(409);
      expect(r.json.error.kind).toBe("email_taken");
      expect((await rows(ctx.db, "SELECT id FROM accounts")).length).toBe(before);
    }
  });

  it("12.3 パスワード 7字・129字は断り、8字・128字は通る", async () => {
    for (const [password, ok] of [["a".repeat(7), false], ["a".repeat(129), false], ["a".repeat(8), true], ["a".repeat(128), true]] as const) {
      const r = await ctx.api().post("/api/register/store", { name: "pw", email: `pw-${password.length}@example.com`, password, humanToken: "tok-ok" });
      if (ok) expect([200, 201], String(password.length)).toContain(r.status);
      else {
        expect(r.status, String(password.length)).toBe(400);
        expect(r.json.error.fields.map((f: any) => f.name)).toContain("password");
      }
    }
  });

  it("12.4 メールアドレスの形: @ が0個・2個・前後が空・255字は断る", async () => {
    for (const email of ["no-at.example.com", "a@@example.com", "@example.com", "a@", `${"a".repeat(243)}@example.com`]) {
      const r = await ctx.api().post("/api/register/store", { name: "mail", email, password: "store-pass-1234", humanToken: "tok-ok" });
      expect(r.status, email).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("email");
    }
  });

  it("12.5 店名 0字・51字は断り、50字は通る", async () => {
    for (const [name, ok] of [["", false], ["店".repeat(51), false], ["店".repeat(50), true]] as const) {
      const r = await ctx.api().post("/api/register/store", { name, email: `name-${name.length}@example.com`, password: "store-pass-1234", humanToken: "tok-ok" });
      if (ok) expect([200, 201]).toContain(r.status);
      else {
        expect(r.status, String(name.length)).toBe(400);
        expect(r.json.error.fields.map((f: any) => f.name)).toContain("name");
      }
    }
  });
});

describeTask("7", "承認の状況と足りないもの（店のホーム）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("12.6・12.7・12.8 未承認の店のホームは pending・許可書とカードの有無・足りないものを返し、登録すると checklist が変わる", async () => {
    const s = await registerStore(ctx);
    let home = (await s.api.get("/api/store/home")).json;
    expect(home.status).toBe("pending");
    expect(home.checklist).toEqual({ license: false, card: false });
    await uploadLicense(s.api, PDF_BYTES);
    home = (await s.api.get("/api/store/home")).json;
    expect(home.checklist).toEqual({ license: true, card: false });
    await registerCard(s.api);
    home = (await s.api.get("/api/store/home")).json;
    expect(home.checklist).toEqual({ license: true, card: true });
    expect(home.offer).toBeNull();
  });

  it("12.10 未承認の店でも、店の情報・クーポン・営業許可書・カードの操作が通る", async () => {
    const s = await registerStore(ctx);
    ctx.geocoder.set("東京都渋谷区道玄坂2-2", { lat: 35.659, lng: 139.7 });
    const profile = await s.api.put("/api/store/profile", { name: s.name, address: "東京都渋谷区道玄坂2-2", url: null, genres: ["和食"], menus: [], budgetMin: 1000, budgetMax: 3000 });
    expect(profile.status).toBe(200);
    const coupon = await s.api.post("/api/store/coupons", { name: "生ビール1杯", note: "" });
    expect([200, 201]).toContain(coupon.status);
    expect([200, 201]).toContain((await uploadLicense(s.api, PDF_BYTES)).status);
    expect((await registerCard(s.api)).status).toBe(200);
  });
});

describeTask("8", "承認の状況が店のホームに映る（12.6・12.9）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("12.6・12.9 承認すると approved、止めると banned が店のホームに出る", async () => {
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES);
    await registerCard(s.api);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${s.id}/approve`, {})).status).toBe(200);
    expect((await s.api.get("/api/store/home")).json.status).toBe("approved");
    expect((await ctx.admin!.api.post(`/api/admin/stores/${s.id}/ban`, {})).status).toBe(200);
    expect((await s.api.get("/api/store/home")).json.status).toBe("banned");
  });
});
