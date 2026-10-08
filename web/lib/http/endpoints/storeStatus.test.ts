// 入口 GET /api/store/status（2026-10-08 本人選択・AI提示）。
// 店舗情報の画面が承認の状態を出すために、店のホーム（向かっている客の呼び名・電話番号まで入る）を丸ごと読んでいた。
// この入口は状態の1語だけを返す。ここで見るのは: 店のセッションが要ること／自分の店の状態だけを返すこと（ほかの店の
// 状態は読めない）／客の個人情報を返さないこと／応答が形の表に合うこと。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CUSTOMER, approvedStore, makeCtx, receivedScene, registerCustomer, registerStore, type Ctx } from "../../../../tests/acceptance/v2/_fakes";
import { RESPONSES } from "../../schemas/responses";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

describe("GET /api/store/status", () => {
  it("ログインしていなければ 401、客のセッションでは通らない（店の入口）", async () => {
    const anon = await ctx.api().get("/api/store/status");
    expect(anon.status).toBe(401);
    expect(anon.json).not.toHaveProperty("status");
    const customer = await registerCustomer(ctx, { phone: "08011112222" });
    const asCustomer = await customer.api.get("/api/store/status");
    expect([401, 403]).toContain(asCustomer.status);
    expect(asCustomer.json).not.toHaveProperty("status");
  });

  it("自分の店の状態だけを返す。承認された別の店があっても、承認待ちの店には承認待ちと出る", async () => {
    const pending = await registerStore(ctx);
    const approved = await approvedStore(ctx);
    const mine = await pending.api.get("/api/store/status");
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual({ ok: true, status: "pending" });
    expect(RESPONSES["GET /api/store/status"].safeParse(mine.json).success).toBe(true);
    expect((await approved.api.get("/api/store/status")).json).toEqual({ ok: true, status: "approved" });
    // 店を選ぶ手がかり（番号）を渡しても無視して、セッションの店だけを読む
    expect((await pending.api.get(`/api/store/status?storeId=${approved.id}`)).json).toEqual({ ok: true, status: "pending" });
  });

  it("向かっている客がいても、呼び名・電話番号・確保番号を返さない（店のホームは返す）", async () => {
    const scene = await receivedScene(ctx);
    const home = await scene.store.api.get("/api/store/home");
    expect(JSON.stringify(home.json)).toContain(CUSTOMER.phone);
    const status = await scene.store.api.get("/api/store/status");
    expect(status.json).toEqual({ ok: true, status: "approved" });
    const text = JSON.stringify(status.json);
    for (const secret of [CUSTOMER.phone, CUSTOMER.nickname, scene.reservation.code, scene.store.id]) expect(text).not.toContain(secret);
  });
});
