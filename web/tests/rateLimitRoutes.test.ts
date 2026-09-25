// 抑止の表に 2026-09-25 に足した入口を、入口として（本物の手続き・手元の D1 で）見る。
//   安全-03: 外のサービス（地図・Stripe）を呼ぶのに表から漏れていた入口（現在地の地名・店の情報の保存・カード）
//   安全-22: 今のパスワードを確かめる操作（メールアドレスの変更・運営のパスワードの変更）の失敗の数え
//   安全-06: 受け取り・受け取り直しの入口
// 場面の準備は受け入れ検査と同じ偽物（_fakes）を使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, PROFILE, registerCustomer, registerStore, seedAdmin, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { ACCOUNT_SECRET_FAILURE_LIMIT, CARD_RATE_LIMIT, PLACE_RATE_LIMIT, RECEIVE_RATE_LIMIT, STORE_PROFILE_RATE_LIMIT } from "../lib/schemas/limits";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx, { email: "unei-rate@example.com", password: "admin-pass-1234" });
});
afterAll(async () => {
  await ctx.dispose();
});

describe("安全-03 外のサービスを呼ぶ入口", () => {
  it("現在地を地名に直す入口（GET /api/customer/place）は、同じ客で1分に10回まで", async () => {
    const c = await registerCustomer(ctx, { phone: "08030300001" });
    for (let i = 0; i < PLACE_RATE_LIMIT; i++) expect((await c.api.get("/api/customer/place?lat=35.6&lng=139.7")).status, String(i)).toBe(200);
    const over = await c.api.get("/api/customer/place?lat=35.6&lng=139.7");
    expect(over.status).toBe(429);
    expect(over.json.error.kind).toBe("rate_limited");
  });

  it("店の情報の保存（PUT /api/store/profile）は、同じ店で1時間に30回まで。上限の次は地図を呼ばない", async () => {
    const s = await registerStore(ctx);
    ctx.geocoder.set(PROFILE.address, { lat: 35.6595, lng: 139.7005 });
    for (let i = 0; i < STORE_PROFILE_RATE_LIMIT; i++) expect((await s.api.put("/api/store/profile", PROFILE)).status, String(i)).toBe(200);
    const geocodes = ctx.geocoder.calls.length;
    // 住所を変えた保存（通れば地図を呼ぶ形）で確かめる。同じ住所の保存は、上限と関係なく地図を呼ばない（店-18）
    const over = await s.api.put("/api/store/profile", { ...PROFILE, address: `${PROFILE.address}-別の住所` });
    expect(over.status).toBe(429);
    expect(ctx.geocoder.calls.length).toBe(geocodes);
    // 別の店は数えない
    const other = await registerStore(ctx);
    expect((await other.api.put("/api/store/profile", PROFILE)).status).toBe(200);
  });

  it("カードの登録の開始と確かめ（Stripe を呼ぶ）は、同じ店で合わせて10分に10回まで", async () => {
    const s = await registerStore(ctx);
    for (let i = 0; i < CARD_RATE_LIMIT; i++) expect((await s.api.post("/api/store/card/setup", {})).status, String(i)).toBeLessThan(429);
    expect((await s.api.post("/api/store/card/confirm", { sessionId: "cs_x" })).status).toBe(429);
  });
});

describe("安全-22 今のパスワードを確かめる操作の失敗の数え", () => {
  it("店のメールアドレスの変更は、今のパスワードの間違いが10回で断る（正しいパスワードでも）", async () => {
    const s = await registerStore(ctx, { password: "store-pass-1234" });
    for (let i = 0; i < ACCOUNT_SECRET_FAILURE_LIMIT; i++) {
      expect((await s.api.post("/api/store/email", { email: `guess-${i}@example.com`, currentPassword: `wrong-${i}-pass` })).status, String(i)).toBe(403);
    }
    const locked = await s.api.post("/api/store/email", { email: "fine@example.com", currentPassword: "store-pass-1234" });
    expect(locked.status).toBe(429);
    expect(locked.json.error.kind).toBe("rate_limited");
  });

  it("重複（409）もほかのアドレスの有無を教える失敗として数える。通った変更は数を戻すだけで、失敗の数は消えない", async () => {
    const taken = await registerStore(ctx, { email: "taken-rate@example.com" });
    const s = await registerStore(ctx, { password: "store-pass-1234" });
    for (let i = 0; i < ACCOUNT_SECRET_FAILURE_LIMIT - 1; i++) {
      expect((await s.api.post("/api/store/email", { email: taken.email, currentPassword: "store-pass-1234" })).status, String(i)).toBe(409);
    }
    expect((await s.api.post("/api/store/email", { email: `mine-${Date.now()}@example.com`, currentPassword: "store-pass-1234" })).status).toBe(200);
    expect((await s.api.post("/api/store/email", { email: taken.email, currentPassword: "store-pass-1234" })).status).toBe(409);
    expect((await s.api.post("/api/store/email", { email: taken.email, currentPassword: "store-pass-1234" })).status).toBe(429);
  });

  it("運営のパスワードの変更は、今のパスワードの間違いが10回で断る", async () => {
    for (let i = 0; i < ACCOUNT_SECRET_FAILURE_LIMIT; i++) {
      expect((await ctx.admin!.api.post("/api/admin/password", { currentPassword: `wrong-${i}-pass`, password: "brand-new-password-9" })).status, String(i)).toBe(403);
    }
    expect((await ctx.admin!.api.post("/api/admin/password", { currentPassword: "admin-pass-1234", password: "brand-new-password-9" })).status).toBe(429);
  });
});

describe("安全-06 受け取りの入口", () => {
  it("受け取り（POST /api/customer/reservations）は、同じ客で10分に10回まで", async () => {
    const c = await registerCustomer(ctx, { phone: "08030300002" });
    // 形は合っているが受け取れない要求（取得の記録が無い）で数える。手続きまで進むので1回に数える
    for (let i = 0; i < RECEIVE_RATE_LIMIT; i++) expect((await c.api.post("/api/customer/reservations", { offerId: "none", party: 2, fetchId: "none" })).status, String(i)).toBe(400);
    const over = await c.api.post("/api/customer/reservations", { offerId: "none", party: 2, fetchId: "none" });
    expect(over.status).toBe(429);
    expect(over.json.error.kind).toBe("rate_limited");
  });
});
