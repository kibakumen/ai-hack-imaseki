// 要件30 連打の抑止【最終日】（手続き・偽の時計）。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, CUSTOMER, fetchOffers, makeCtx, MIN, ORIGIN, publishOffer, receivedScene, registerCustomer, registerStore, type Ctx } from "./_fakes";

const at = (ctx: Ctx, minutes: number) => ctx.clock.set(new Date(new Date("2026-09-22T06:00:00.000Z").getTime() + minutes * MIN).toISOString());

describeTask("33", "連打の抑止", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    const s = await approvedStore(ctx, { name: "連打の店" });
    await publishOffer(s.api, { capacity: 20 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("30.1・30.5 同じ客の取得は1分に5回まで。6回目は rate_limited で、AI も地図も呼ばれない。1分たつとまた通る。別の客は数えない", async () => {
    at(ctx, 0);
    const c = await registerCustomer(ctx, { phone: "08020200001" });
    for (let i = 0; i < 5; i++) expect((await fetchOffers(c.api, { party: 2 })).status, String(i)).toBe(200);
    const ai = ctx.ai.calls.length;
    const geo = ctx.geocoder.calls.length;
    ctx.geocoder.set("渋谷駅", { lat: 35.6595, lng: 139.7005 });
    const sixth = await c.api.post("/api/customer/fetch", { place: "渋谷駅", party: 2, genres: [], budgetMax: null });
    expect(sixth.status).toBe(429);
    expect(sixth.json.error.kind).toBe("rate_limited");
    expect(ctx.ai.calls.length).toBe(ai);
    expect(ctx.geocoder.calls.length).toBe(geo);
    const other = await registerCustomer(ctx, { phone: "08020200002" });
    expect((await fetchOffers(other.api, { party: 2 })).status).toBe(200);
    at(ctx, 1);
    expect((await fetchOffers(c.api, { party: 2 })).status).toBe(200);
  });

  it("30.2 同じ接続元からの客の登録と店の登録は合わせて1時間に10回まで。11回目は断る。別の接続元は数えない。1時間たつと通る", async () => {
    at(ctx, 10);
    const post = (path: string, body: unknown, ip: string) => ctx.app.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip }, body: JSON.stringify(body) }));
    for (let i = 0; i < 6; i++) expect((await post("/api/register/customer", { ...CUSTOMER, phone: `0802021${String(i).padStart(4, "0")}`, humanToken: "tok-ok" }, "203.0.113.5")).status, `客${i}`).toBeLessThan(300);
    for (let i = 0; i < 4; i++) expect((await post("/api/register/store", { name: `店${i}`, email: `rate-${i}@example.com`, password: "store-pass-1234", humanToken: "tok-ok" }, "203.0.113.5")).status, `店${i}`).toBeLessThan(300);
    const eleventh = await post("/api/register/customer", { ...CUSTOMER, phone: "08020219999", humanToken: "tok-ok" }, "203.0.113.5");
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).error.kind).toBe("rate_limited");
    expect((await post("/api/register/customer", { ...CUSTOMER, phone: "08020218888", humanToken: "tok-ok" }, "203.0.113.6")).status).toBeLessThan(300);
    at(ctx, 71);
    expect((await post("/api/register/customer", { ...CUSTOMER, phone: "08020217777", humanToken: "tok-ok" }, "203.0.113.5")).status).toBeLessThan(300);
  });

  it("30.3 同じ客の通報は1時間に5回まで。6回目は断る", async () => {
    at(ctx, 100);
    const s = await receivedScene(ctx);
    for (let i = 0; i < 5; i++) expect((await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: `理由${i}` })).status, String(i)).toBeLessThan(300);
    const sixth = await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "6回目" });
    expect(sixth.status).toBe(429);
    at(ctx, 161);
    expect((await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "1時間後" })).status).toBeLessThan(300);
  });

  it("30.4 同じアカウントへのログインの失敗が10回続くと15分断る。正しいパスワードでも断り、15分たつと通る。別のアカウントは数えない", async () => {
    at(ctx, 200);
    const s = await registerStore(ctx, { email: "locked@example.com", password: "right-password-1" });
    const t = await registerStore(ctx, { email: "free@example.com", password: "right-password-1" });
    const login = (email: string, password: string) => ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });
    for (let i = 0; i < 10; i++) expect((await login("locked@example.com", `wrong-${i}`)).status, String(i)).not.toBe(200);
    const locked = await login("locked@example.com", "right-password-1");
    expect(locked.status).toBe(429);
    expect(locked.json.error.kind).toBe("rate_limited");
    expect((await login("free@example.com", "right-password-1")).status).toBe(200);
    at(ctx, 214);
    expect((await login("locked@example.com", "right-password-1")).status).toBe(429);
    at(ctx, 216);
    expect((await login("locked@example.com", "right-password-1")).status).toBe(200);
    expect(s.id).not.toBe(t.id);
  });
});
