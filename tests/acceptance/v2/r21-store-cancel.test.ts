// 要件21 店による確保の取り消し（手続き）。画面は r20-arrivals.ui.test.tsx のタスク18のブロック。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { fetchOffers, makeCtx, MIN, one, receive, receivedScene, registerCustomer, snapshot, type Ctx } from "./_fakes";

describeTask("18", "店の取り消し", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("21.1・21.4 確保中を1件ずつ取り消せ、コードが使えなくなる。ほかの確保は残る", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    const other = await registerCustomer(ctx, { nickname: "もうひとり", phone: "08066660001" });
    const f = await fetchOffers(other.api, { party: 2 });
    const r2 = await receive(other.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId });
    expect(r2.status).toBe(200);
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    expect(r.status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe("store_cancelled");
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", r2.json.reservation.id)).status).toBe("active");
    const complete = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    expect(complete.status).toBe(409);
    expect(complete.json.current.state).toBe("store_cancelled");
    expect((await s.customer.api.get("/api/customer/home")).json.kind).toBe("store_cancelled");
  });

  it("21.5・21.6・21.7 確保中でない状態（完了済み・期限切れ・客が取り消した・店が取り消した）は、状態も残りも変えずに断り、偽のプッシュの口が呼ばれない（運営に取り消されたはタスク21のブロック）", async () => {
    const make = async (state: string) => {
      ctx.clock.set("2026-09-22T06:00:00.000Z");
      const s = await receivedScene(ctx);
      if (state === "completed") await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
      if (state === "customer_cancelled") await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
      if (state === "store_cancelled") await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
      if (state === "expired") ctx.clock.set(new Date(ctx.clock.now().getTime() + 21 * MIN).toISOString());
      return s;
    };
    for (const state of ["completed", "expired", "customer_cancelled", "store_cancelled"]) {
      const s = await make(state);
      const before = await snapshot(ctx.db);
      const pushBefore = ctx.push.calls.length;
      const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
      expect(r.status, state).toBe(409);
      expect(r.json.current.state, state).toBe(state);
      expect(await snapshot(ctx.db), state).toBe(before);
      expect(ctx.push.calls.length, state).toBe(pushBefore);
    }
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("別の店のセッションからは取り消せない", async () => {
    const s = await receivedScene(ctx);
    const other = await receivedScene(ctx);
    const r = await other.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    expect([403, 404]).toContain(r.status);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe("active");
  });
});

describeTask("21", "運営に取り消された確保を店が取り消そうとしたとき（21.6・21.7）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("21.6・21.7 状態も残りも変えずに断り、プッシュは送らない", async () => {
    const s = await receivedScene(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    const before = await snapshot(ctx.db);
    const pushBefore = ctx.push.calls.length;
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    expect(r.status).toBe(409);
    expect(r.json.current.state).toBe("admin_cancelled");
    expect(await snapshot(ctx.db)).toBe(before);
    expect(ctx.push.calls.length).toBe(pushBefore);
  });
});
