// 要件2 客の見分け方（客の識別子）。2.4・2.5 の「客の入口の全部」は全入口の横断のタスク（25）で見る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { cookieOf, CUSTOMER, dbContains, loadWeb, makeCtx, one, receivedScene, registerCustomer, snapshot, type Ctx } from "./_fakes";

describeTask("3", "客の識別子の発行と Cookie", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("2.1・2.2 100回の登録で、値が22字以上の base64url で全部ちがい、D1 に生の値が無い", async () => {
    const values = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, phone: "090" + String(10000000 + i), humanToken: "tok-ok" });
      const cookie = cookieOf(r)!;
      const value = cookie.split("=").slice(1).join("=");
      expect(value).toMatch(/^[A-Za-z0-9_-]{22,}$/);
      values.add(value);
    }
    expect(values.size).toBe(100);
    for (const v of [...values].slice(0, 10)) expect(await dbContains(ctx.db, v), "D1 に生の値").toBe(false);
  });

  it("domain/token は16バイトを22字の base64url に直し、同じ入力で同じ出力・違う入力で違う出力", async () => {
    const { tokenFromBytes } = await loadWeb("lib/domain/token");
    const a = new Uint8Array(16).fill(1);
    const b = new Uint8Array(16).fill(2);
    expect(tokenFromBytes(a)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(tokenFromBytes(a)).toBe(tokenFromBytes(a));
    expect(tokenFromBytes(a)).not.toBe(tokenFromBytes(b));
  });

  it("2.3・2.6 Set-Cookie に HttpOnly・Secure・SameSite=Lax があり、本文と Location に値が無い", async () => {
    const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, humanToken: "tok-ok" });
    const set = r.setCookies[0];
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Secure/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Max-Age=\d{7,}|Expires=/i);
    const value = set.split(";")[0].split("=").slice(1).join("=");
    expect(r.text).not.toContain(value);
    expect(r.headers.get("location") ?? "").not.toContain(value);
  });

  it("2.6 客の入口の見分けが URL の問い合わせ文字列を読まない（Cookie の値を ?token= に付けても通らない）", async () => {
    const c = await registerCustomer(ctx);
    const value = c.cookie.split("=").slice(1).join("=");
    const name = c.cookie.split("=")[0];
    for (const q of [`?${name}=${value}`, `?token=${value}`, `?customer=${value}`]) {
      const r = await ctx.api().get(`/api/customer/home${q}`);
      expect(r.status, q).toBe(401);
    }
  });

  it("2.4・2.5 別の客の Cookie では別の客の登録の内容が返り、Cookie なしでは何も返らない", async () => {
    const a = await registerCustomer(ctx, { nickname: "あのひと", phone: "08000001110" });
    const b = await registerCustomer(ctx, { nickname: "べつのひと", phone: "08000001111" });
    expect((await a.api.get("/api/customer/home")).json.profile.nickname).toBe("あのひと");
    const home = await b.api.get("/api/customer/home");
    expect(home.json.profile.nickname).toBe("べつのひと");
    expect(home.text).not.toContain("08000001110");
    expect((await ctx.api().get("/api/customer/home")).text).not.toContain("あのひと");
  });

  it("2.7 客の入口でパスワード・確認番号・ログインを求めない（登録とホームは Cookie だけで通る）", async () => {
    const c = await registerCustomer(ctx);
    const home = await c.api.get("/api/customer/home");
    expect(home.status).toBe(200);
    expect(JSON.stringify(home.json)).not.toMatch(/password|login|otp|verification/i);
  });
});

describeTask("25", "客の入口の全部の見分け（2.4・2.5）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("2.4・2.5 客の入口の全部を、Cookie なし・でたらめ・別の客の Cookie で叩き、データも操作も通らない", async () => {
    const scene = await receivedScene(ctx);
    const other = await registerCustomer(ctx, { nickname: "べつのひと", phone: "08000001111" });
    const name = other.cookie.split("=")[0];
    const bogus = ctx.api(`${name}=${"y".repeat(22)}`);
    expect((await other.api.get("/api/customer/home")).text).not.toContain(scene.reservation.code);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const routes = ctx.app.routes.filter((r: any) => r.auth === "customer");
    expect(routes.length).toBeGreaterThan(8);
    for (const r of routes) {
      const path = r.path.replace(/:(\w+)/g, () => scene.reservation.id);
      const method = r.method === "DELETE" ? "del" : r.method.toLowerCase();
      for (const [label, api, expected] of [["なし", ctx.api(), [401]], ["でたらめ", bogus, [401]]] as const) {
        const res = await (api as any)[method](path, r.method === "GET" ? undefined : { party: 3 });
        expect(expected, `${r.method} ${path}（${label}）`).toContain(res.status);
        expect(res.text).not.toContain(scene.reservation.code);
      }
      if (/reservations\/:id/.test(r.path)) {
        const res = await (other.api as any)[method](path, { party: 3 });
        expect([403, 404, 409], `${r.method} ${path}（別の客）`).toContain(res.status);
      }
    }
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
    expect((await one(ctx.db, "SELECT status, party FROM reservations WHERE id = ?", scene.reservation.id))).toEqual({ status: "active", party: 2 });
  });
});
