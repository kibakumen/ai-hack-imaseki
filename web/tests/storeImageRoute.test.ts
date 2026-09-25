// 店の画像の入口 GET /api/customer/store-image を、入口として見る（2026-09-25 設計-04）。
// 部品（adapters/storeImage）の検査は内部のアドレスを断ることを見ているが、入口が「客の渡した任意の URL」を
// そのまま取りに行くことを確かめる検査が無かった。直す前に、直ったときの振る舞いを先に書いておく。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerCustomer, type Ctx } from "../../tests/acceptance/v2/_fakes";

describe("入口 GET /api/customer/store-image", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("識別子が無ければ 401 で、外へ取りに行かない", async () => {
    const r = await ctx.api().get(`/api/customer/store-image?url=${encodeURIComponent("https://example.com/")}`);
    expect(r.status).toBe(401);
    expect(ctx.storeImage.calls).toEqual([]);
  });

  // 入口の入力を店の番号へ替え、承認済みの店に登録された URL だけを取りに行く（安全-12 の直し方）。
  it.fails("既知の不具合（安全-12）: 客が渡した任意の URL を、サーバーから取りに行かない", async () => {
    const { api } = await registerCustomer(ctx);
    const target = "https://attacker.example/page";
    await api.get(`/api/customer/store-image?url=${encodeURIComponent(target)}`);
    expect(ctx.storeImage.calls).not.toContain(target);
  });
});
