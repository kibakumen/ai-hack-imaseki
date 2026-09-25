// 店の画像の入口 GET /api/customer/store-image を、入口として見る（2026-09-25 設計-04・安全-12・安全-19）。
//
// 以前は客が渡した任意の URL をサーバーが取りに行き（外向きの GET の踏み台）、返した外部の URL を客の端末が
// 店のサーバーから直接読んでいた（客の接続元と時刻が店側に渡る）。今は:
//   - 画像は店が情報を保存したときに1回だけ、その店の登録の URL から取り、置き場に置く
//   - 客の入口は店の番号で引き、**承認済みの店**の画像を自分のオリジンから返すだけ（外へは出ない）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, PROFILE, registerCustomer, registerStore, type Ctx } from "../../tests/acceptance/v2/_fakes";

describe("入口 GET /api/customer/store-image", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("識別子が無ければ 401 で、外へ取りに行かない", async () => {
    const r = await ctx.api().get(`/api/customer/store-image?storeId=x`);
    expect(r.status).toBe(401);
    expect(ctx.storeImage.calls).toEqual([]);
  });

  // 入口の入力を店の番号へ替え、承認済みの店に登録された URL だけを取りに行く（安全-12 の直し方）。
  it("安全-12: 客が渡した任意の URL を、サーバーから取りに行かない（url では受け付けない）", async () => {
    const { api } = await registerCustomer(ctx);
    const target = "https://attacker.example/page";
    const r = await api.get(`/api/customer/store-image?url=${encodeURIComponent(target)}`);
    expect(r.status).toBe(400);
    expect(ctx.storeImage.calls).not.toContain(target);
  });

  it("安全-19: 店の情報を保存したときに、その店の URL から1回だけ取り、客には自分のオリジンから画像のバイトを返す", async () => {
    const s = await approvedStore(ctx, { name: "画像の店" });
    const calls = ctx.storeImage.calls.length;
    ctx.geocoder.set(PROFILE.address, { lat: 35.6595, lng: 139.7005 });
    expect((await s.api.put("/api/store/profile", { ...PROFILE, url: "https://shop.example/home" })).status).toBe(200);
    expect(ctx.storeImage.calls.slice(calls)).toEqual(["https://shop.example/home"]);

    const { api } = await registerCustomer(ctx);
    const before = ctx.storeImage.calls.length;
    const r = await api.get(`/api/customer/store-image?storeId=${encodeURIComponent(s.id)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    // 客の要求では外へ出ない
    expect(ctx.storeImage.calls.length).toBe(before);
  });

  it("承認されていない店・画像の無い店・無い番号は 404（在る無しを分けて見せない）", async () => {
    const pending = await registerStore(ctx);
    ctx.geocoder.set(PROFILE.address, { lat: 35.6595, lng: 139.7005 });
    expect((await pending.api.put("/api/store/profile", { ...PROFILE, url: "https://pending.example/" })).status).toBe(200);
    const { api } = await registerCustomer(ctx);
    expect((await api.get(`/api/customer/store-image?storeId=${encodeURIComponent(pending.id)}`)).status).toBe(404);
    expect((await api.get(`/api/customer/store-image?storeId=no-such-store`)).status).toBe(404);

    const noUrl = await approvedStore(ctx, { name: "URL の無い店" });
    expect((await noUrl.api.put("/api/store/profile", { ...PROFILE, url: null })).status).toBe(200);
    expect((await api.get(`/api/customer/store-image?storeId=${encodeURIComponent(noUrl.id)}`)).status).toBe(404);
  });
});
