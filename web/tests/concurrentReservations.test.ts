/* eslint-disable @typescript-eslint/no-explicit-any -- 場面と応答は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 同時に来た操作と途中で落ちた書き込みで、確保と記録が食い違わないこと（2026-09-25 監査の指摘 不具合-14・15・16）。
// 割り込みの道具は _interleavedDb.ts。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, MIN, one, publishOffer, receive, receivedScene, registerCustomer, requireInResults, rows, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { wrappedApp, type Hook } from "./_interleavedDb";

const T0 = "2026-09-22T06:00:00.000Z";
let phoneSeq = 0;
const nextPhone = () => `0805555${String(++phoneSeq).padStart(4, "0")}`;

describe("同時の操作で確保が食い違わない（不具合-14・15）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const at = (minutes: number) => ctx.clock.set(new Date(Date.parse(T0) + minutes * MIN).toISOString());
  const withHooks = (hooks: Hook[]) => wrappedApp(ctx, hooks);

  it("不具合-14 受け取り直しと店の「完了済み」が同時に来ても、1組が2枠を押さえない", async () => {
    at(0);
    const s = await receivedScene(ctx, { capacity: 5 });
    at(21);
    const w = await withHooks([
      {
        match: /INSERT INTO reservations/,
        before: async () => void expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200),
      },
    ]);
    const retry = await w.api(s.customer.api.cookie).post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(retry.status).toBe(409);
    expect(retry.json.home.kind).toBe("completed");
    const customerId = (await one(ctx.db, "SELECT customer_id FROM reservations WHERE id = ?", s.reservation.id)).customer_id;
    expect(await rows(ctx.db, "SELECT id FROM reservations WHERE customer_id = ?", customerId)).toHaveLength(1);
    at(0);
  });

  it("不具合-15 登録を消す要求が確かめたあとに受け取りが入ると、消去は断られて確保と登録が残る", async () => {
    const store = await approvedStore(ctx, { name: "消去と受け取り", lat: 35.9, lng: 139.9 });
    const offer = await publishOffer(store.api, { capacity: 3 });
    const customer = await registerCustomer(ctx, { nickname: "消す客", phone: nextPhone() });
    const f = await fetchOffers(customer.api, { party: 2, lat: 35.9, lng: 139.9 });
    requireInResults(f, offer.id);
    const w = await withHooks([
      {
        match: /UPDATE customers SET nickname = ''/,
        before: async () => void expect((await receive(customer.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200),
      },
    ]);
    const r = await w.api(customer.api.cookie).del("/api/customer");
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("has_active_reservation");
    expect((await one(ctx.db, "SELECT nickname, deleted_at FROM customers WHERE nickname = ?", "消す客")).deleted_at).toBeNull();
  });

  it("不具合-15 受け取る要求が確かめたあとに登録が消されると、名無しの確保は作られない", async () => {
    const store = await approvedStore(ctx, { name: "受け取りと消去", lat: 35.95, lng: 139.95 });
    const offer = await publishOffer(store.api, { capacity: 3 });
    const customer = await registerCustomer(ctx, { nickname: "消える客", phone: nextPhone() });
    const f = await fetchOffers(customer.api, { party: 2, lat: 35.95, lng: 139.95 });
    requireInResults(f, offer.id);
    const customerId = (await one(ctx.db, "SELECT id FROM customers WHERE nickname = ?", "消える客")).id;
    const w = await withHooks([{ match: /INSERT INTO reservations/, before: async () => void expect((await customer.api.del("/api/customer")).status).toBe(200) }]);
    const r = await w.api(customer.api.cookie).post("/api/customer/reservations", { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    expect(r.status).toBe(401);
    expect(await rows(ctx.db, "SELECT id FROM reservations WHERE customer_id = ?", customerId)).toEqual([]);
  });
});

describe("状態の変化とその記録は一度に書く（不具合-16）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const fail = async () => {
    throw new Error("D1 の一時的な失敗（検査が起こした）");
  };
  const withHooks = (hooks: Hook[]) => wrappedApp(ctx, hooks);
  const eventsOf = async (reservationId: string, status: string) =>
    Number((await one(ctx.db, "SELECT COUNT(*) AS n FROM reservation_events WHERE reservation_id = ? AND status = ?", reservationId, status)).n);

  it("受け取りの確保ができたあとの読み取りが落ちても、選択と状態の変化の記録は確保と一緒に残る", async () => {
    const store = await approvedStore(ctx, { name: "記録の店", lat: 36.2, lng: 139.2 });
    const offer = await publishOffer(store.api, { capacity: 3 });
    const customer = await registerCustomer(ctx, { nickname: "記録の客", phone: nextPhone() });
    const f = await fetchOffers(customer.api, { party: 2, lat: 36.2, lng: 139.2 });
    requireInResults(f, offer.id);
    const w = await withHooks([{ match: /FROM customers WHERE id = \?1 AND deleted_at IS NULL/, armedBy: /INSERT INTO reservations/, before: fail }]);
    await w.api(customer.api.cookie).post("/api/customer/reservations", { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    const reservation = await one(ctx.db, "SELECT id FROM reservations WHERE fetch_id = ?", f.json.fetchId);
    expect(reservation).not.toBeNull();
    expect(await rows(ctx.db, "SELECT id FROM selections WHERE fetch_id = ? AND store_id = ?", f.json.fetchId, store.id)).toHaveLength(1);
    expect(await eventsOf(reservation.id, "active")).toBe(1);
  });

  for (const [name, status, send] of [
    ["店の完了済み", "completed", (s: any) => (w: any) => w.api(s.store.api.cookie).post(`/api/store/reservations/${s.reservation.id}/complete`, {})],
    ["店の取り消し", "store_cancelled", (s: any) => (w: any) => w.api(s.store.api.cookie).post(`/api/store/reservations/${s.reservation.id}/cancel`, {})],
    ["客の取り消し", "customer_cancelled", (s: any) => (w: any) => w.api(s.customer.api.cookie).post(`/api/customer/reservations/${s.reservation.id}/cancel`, {})],
  ] as const) {
    it(`${name}: 記録が書けなければ状態も変わらない（状態と記録が食い違わない）`, async () => {
      const s = await receivedScene(ctx, { capacity: 3 });
      const w = await withHooks([{ match: /INSERT (OR IGNORE )?INTO reservation_events/, before: fail }]);
      await send(s)(w);
      const row = await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id);
      expect(row.status).toBe("active");
      expect(await eventsOf(s.reservation.id, status)).toBe(0);
      // 落ちなければ、状態と記録が1件ずつ
      expect((await send(s)(ctx)).status).toBe(200);
      expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe(status);
      expect(await eventsOf(s.reservation.id, status)).toBe(1);
    });
  }
});
