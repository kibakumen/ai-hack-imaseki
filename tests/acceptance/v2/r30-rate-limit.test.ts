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

  // 2026-09-25 監査の指摘 不具合-04 で、客の登録と店の登録を**別に数える**ようにした（要件30.2 の変更・AI判断）。
  // 合わせて数えていた頃は、会場の Wi-Fi のように同じ回線から11人目が来ると、客の自動の登録も店の登録も止まった。
  it("30.2 同じ接続元からの店の登録は1時間に10回まで。11回目は断る。客の登録は店の数を分け合わない。別の接続元は数えない。1時間たつと通る", async () => {
    at(ctx, 10);
    const post = (path: string, body: unknown, ip: string) => ctx.app.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": ip }, body: JSON.stringify(body) }));
    const store = (i: number, ip = "203.0.113.5") => post("/api/register/store", { name: `店${i}`, email: `rate-${i}@example.com`, password: "store-pass-1234", humanToken: "tok-ok" }, ip);
    for (let i = 0; i < 10; i++) expect((await store(i)).status, `店${i}`).toBeLessThan(300);
    const eleventh = await store(10);
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).error.kind).toBe("rate_limited");
    expect((await post("/api/register/customer", { ...CUSTOMER, phone: "08020218888", humanToken: "tok-ok" }, "203.0.113.5")).status).toBeLessThan(300);
    expect((await store(11, "203.0.113.6")).status).toBeLessThan(300);
    at(ctx, 71);
    expect((await store(12)).status).toBeLessThan(300);
  });

  it("30.2 同じ接続元からの客の登録は1時間に60回まで。61回目は断る（不具合-04: 会場の回線に合わせて広げた）", async () => {
    at(ctx, 80);
    const ip = "203.0.113.60";
    for (let i = 0; i < 60; i++) expect((await ctx.api(null, { ip }).post("/api/register/customer", { ...CUSTOMER, phone: `0802022${String(i).padStart(4, "0")}`, humanToken: "tok-ok" })).status, `客${i}`).toBeLessThan(300);
    const over = await ctx.api(null, { ip }).post("/api/register/customer", { ...CUSTOMER, phone: "08020229999", humanToken: "tok-ok" });
    expect(over.status).toBe(429);
    expect(over.json.error.kind).toBe("rate_limited");
  });

  it("30.2 人かどうかの確かめに落ちた登録は数えない（不具合-04: 確かめを解かずに送るだけでは、同じ回線の人を止められない）", async () => {
    at(ctx, 90);
    const ip = "203.0.113.61";
    for (let i = 0; i < 12; i++) expect((await ctx.api(null, { ip }).post("/api/register/store", { name: `空振り${i}`, email: `miss-${i}@example.com`, password: "store-pass-1234" })).status, String(i)).toBe(400);
    expect((await ctx.api(null, { ip }).post("/api/register/store", { name: "本物", email: "real-after-miss@example.com", password: "store-pass-1234", humanToken: "tok-ok" })).status).toBeLessThan(300);
  });

  it("30.3 同じ客の通報は1時間に5回まで。6回目は断る", async () => {
    at(ctx, 100);
    const s = await receivedScene(ctx);
    // 通報を受け付けるのは、確保中か7日以内に完了済みになった店だけ（要件26の基準 26.18）。
    // 1時間後も通報できる客にするため、来店して完了済みにしておく（確保中のまま1時間たつと期限切れになり、
    // 26.18 で断られる——それを連打の抑止と取り違えないように・設計-02）
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: `理由${i}` })).status, String(i)).toBeLessThan(300);
    const sixth = await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "6回目" });
    expect(sixth.status).toBe(429);
    expect(sixth.json.error.kind).toBe("rate_limited");
    at(ctx, 161);
    expect((await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "1時間後" })).status).toBeLessThan(300);
  });

  it("30.4 同じアカウントへの同じ接続元からのログインの失敗が10回続くと15分断る。正しいパスワードでも断り、15分たつと通る。別のアカウント・別の接続元は数えない", async () => {
    at(ctx, 200);
    const s = await registerStore(ctx, { email: "locked@example.com", password: "right-password-1" });
    const t = await registerStore(ctx, { email: "free@example.com", password: "right-password-1" });
    // 締め出しは「メールアドレス × 接続元」で数える（2026-09-25 監査の指摘 安全-10 の案1・AI判断）ので、同じ接続元から送る
    const login = (email: string, password: string, ip = "203.0.113.40") => ctx.api(null, { ip }).post("/api/auth/login", { email, password, humanToken: "tok-ok" });
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
    // 安全-10: 他人が別の接続元から10回間違えても、本人の接続元からの正しいパスワードは締め出されない
    for (let i = 0; i < 10; i++) expect((await login("free@example.com", `wrong-${i}`, "198.51.100.66")).status, String(i)).toBe(401);
    expect((await login("free@example.com", "right-password-1", "198.51.100.66")).status).toBe(429);
    expect((await login("free@example.com", "right-password-1")).status).toBe(200);
  });

  // 安全-10 のレビュー: 接続元ごとの失敗の上限（パスワードスプレーを数える・15分に30回）は正しいパスワードも断るので、
  // 会場の Wi-Fi や携帯の CGNAT で同じ回線の他人が30回間違えると、その回線の店と運営が全員入れなくなった。
  // 前にこの端末（ブラウザ）でそのアカウントに入った印を持つ要求だけ、接続元の上限を数えない（AI判断）。
  it("安全-10: 同じ回線の他人がアカウントをまたいで30回間違えても、前にこの端末で入った店は入れる。印の無い端末は断る", async () => {
    at(ctx, 250);
    await registerStore(ctx, { email: "venue@example.com", password: "right-password-1" });
    const body = (email: string, password: string) => ({ email, password, humanToken: "tok-ok" });
    const before = await ctx.api(null, { ip: "198.51.100.10" }).post("/api/auth/login", body("venue@example.com", "right-password-1"));
    expect(before.status).toBe(200);
    // ログインが配った Cookie を全部持ち帰る（端末の印の名前は決めない）
    const browser = before.setCookies.map((c) => c.split(";")[0]).join("; ");
    const venue = "203.0.113.90";
    for (let i = 0; i < 30; i++) expect((await ctx.api(null, { ip: venue }).post("/api/auth/login", body(`nobody-${i}@example.com`, "guess-1"))).status, String(i)).toBe(401);
    expect((await ctx.api(null, { ip: venue }).post("/api/auth/login", body("venue@example.com", "right-password-1"))).status).toBe(429);
    expect((await ctx.api(browser, { ip: venue }).post("/api/auth/login", body("venue@example.com", "right-password-1"))).status).toBe(200);
  });

  // 数えが「読んでから書く」の2手だった頃は、同時に送ると上限をすり抜けた。上限まで通り、残りは断る
  // （以前の検査は全部1本ずつ順に送っていて、これを見ていなかった・設計-04。数えを1つの文にした・安全-02）。
  it("安全-02: 同じ客が取得を10本同時に送っても、通るのは1分の上限の5本だけ", async () => {
    at(ctx, 300);
    const c = await registerCustomer(ctx, { phone: "08020200010" });
    const results = await Promise.all(Array.from({ length: 10 }, () => fetchOffers(c.api, { party: 2 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
  });

  it("安全-02: 同じ接続元から店の登録を15本同時に送っても、通るのは1時間の上限の10本だけ", async () => {
    at(ctx, 400);
    const ip = "203.0.113.77";
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => ctx.api(null, { ip }).post("/api/register/store", { name: `同時${i}`, email: `race-${i}@example.com`, password: "store-pass-1234", humanToken: "tok-ok" })),
    );
    expect(results.filter((r) => r.status < 300)).toHaveLength(10);
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
  });
});
