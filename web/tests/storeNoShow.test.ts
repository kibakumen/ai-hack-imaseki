/* eslint-disable @typescript-eslint/no-explicit-any -- 場面と応答は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 店の取り消しの「来ない（枠を戻す）」（2026-09-26 本人選択・安全-06 の残り・要件18の基準 18.4 の変更と 18.16、要件21の基準 21.8）。
//
// 客が識別子を作り直して受け取り直すと、1つの回線で席を押さえ続けられた。店の側の対抗手段として、確保中の客が
// 期限内でも来ないと店が判断したら「来ない」で取り消し、その枠を残りへ戻す。ふつうの取り消し（店の都合）は
// これまでどおり枠を戻さない（基準 18.4）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchOffers, makeCtx, one, PUSH_SUBSCRIPTION, receive, receivedScene, registerCustomer, requireInResults, rows, snapshot, type Ctx } from "../../tests/acceptance/v2/_fakes";

const T0 = "2026-09-22T06:00:00.000Z";

describe("店の取り消しの「来ない（枠を戻す）」", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const remainingOf = async (store: { api: any }): Promise<number> => (await store.api.get("/api/store/home")).json.offer.remaining;

  it("18.16・21.8 「来ない」で取り消すと、店が取り消した状態になり、枠が残りへ1戻り、理由が確保と記録に残る", async () => {
    const s = await receivedScene(ctx, { capacity: 1 });
    expect(await remainingOf(s.store)).toBe(0);
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    expect(r.status).toBe(200);
    expect(await one(ctx.db, "SELECT status, holds_slot, cancel_reason FROM reservations WHERE id = ?", s.reservation.id)).toMatchObject({
      status: "store_cancelled",
      holds_slot: 0,
      cancel_reason: "no_show",
    });
    expect(await remainingOf(s.store)).toBe(1);
    // 要件27の追加だけの表に、状態と理由が1行
    const events = await rows(ctx.db, "SELECT status, reason FROM reservation_events WHERE reservation_id = ? AND status = 'store_cancelled'", s.reservation.id);
    expect(events).toEqual([{ status: "store_cancelled", reason: "no_show" }]);
  });

  it("18.13 残りが0だったオファーも、「来ない」で戻った枠を別の客が受け取れる", async () => {
    const s = await receivedScene(ctx, { capacity: 1 });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    const other = await registerCustomer(ctx, { nickname: "つぎのきゃく", phone: "08066660002" });
    const f = await fetchOffers(other.api, { party: 2, ...s.at });
    requireInResults(f, s.offer.id);
    expect((await receive(other.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
  });

  it("18.4 理由を付けない取り消し（店の都合）は、これまでどおり枠を戻さず、記録の理由は空", async () => {
    const s = await receivedScene(ctx, { capacity: 1 });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    expect(await one(ctx.db, "SELECT holds_slot, cancel_reason FROM reservations WHERE id = ?", s.reservation.id)).toMatchObject({ holds_slot: 1, cancel_reason: null });
    expect(await remainingOf(s.store)).toBe(0);
    const events = await rows(ctx.db, "SELECT reason FROM reservation_events WHERE reservation_id = ? AND status = 'store_cancelled'", s.reservation.id);
    expect(events).toEqual([{ reason: null }]);
  });

  it("9.14 客の画面には、来店なしとして取り消されたことが分かる形で届く（ホームの確保に理由が載る）", async () => {
    const s = await receivedScene(ctx);
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    const home = await s.customer.api.get("/api/customer/home");
    expect(home.json.kind).toBe("store_cancelled");
    expect(home.json.reservation.cancelReason).toBe("no_show");
    // ふつうの取り消しの客には理由が載らない
    const plain = await receivedScene(ctx);
    await plain.store.api.post(`/api/store/reservations/${plain.reservation.id}/cancel`, {});
    expect((await plain.customer.api.get("/api/customer/home")).json.reservation.cancelReason ?? null).toBeNull();
  });

  it("22.1・22.4 知らせを送り、文面は来店なしの場面の決まった文（店の都合の文とは別）", async () => {
    const s = await receivedScene(ctx);
    expect((await s.customer.api.post("/api/customer/push-subscription", { subscription: PUSH_SUBSCRIPTION })).status).toBe(200);
    const before = ctx.push.calls.length;
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    expect(ctx.push.calls.length).toBe(before + 1);
    const m = await s.customer.api.get("/api/customer/push-message");
    expect(m.json.scene).toBe("store_no_show");
    expect(m.json.body).toMatch(/来店なし/);
    expect(m.text).not.toContain("たなか");
  });

  it("20.16 店の一覧の取り消した行に、来店なしの印が付く（ふつうの取り消しには付かない）", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    const other = await registerCustomer(ctx, { nickname: "もうひとり", phone: "08066660003" });
    const f = await fetchOffers(other.api, { party: 2, ...s.at });
    const r2 = await receive(other.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    await s.store.api.post(`/api/store/reservations/${r2.json.reservation.id}/cancel`, {});
    const arrivals = (await s.store.api.get("/api/store/home")).json.arrivals as any[];
    expect(arrivals.find((a) => a.reservationId === s.reservation.id)).toMatchObject({ kind: "store_cancelled", noShow: true });
    expect(arrivals.find((a) => a.reservationId === r2.json.reservation.id)).toMatchObject({ kind: "store_cancelled", noShow: false });
  });

  it("21.5・21.6 確保中でない確保への「来ない」は、状態も残りも変えずに断る", async () => {
    const s = await receivedScene(ctx, { capacity: 1 });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    const before = await snapshot(ctx.db);
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    expect(r.status).toBe(409);
    expect(r.json.current.state).toBe("store_cancelled");
    expect(await snapshot(ctx.db)).toBe(before);
  });

  it("入力の形が違う「来ない」（真偽でない値）は、形の誤りとして断る", async () => {
    const s = await receivedScene(ctx);
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: "yes" });
    expect(r.status).toBe(400);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe("active");
  });

  it("33.4 運営の画面で、店ごとの来店なしの取り消しの回数と、全体の回数が読める", async () => {
    const s = await receivedScene(ctx);
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, { noShow: true });
    const list = (await ctx.admin!.api.get("/api/admin/stores")).json;
    const row = (list.items as any[]).find((x: any) => x.id === s.store.id);
    expect(row).toMatchObject({ storeCancelled: 1, noShowCancelled: 1 });
    const metrics = (await ctx.admin!.api.get("/api/admin/metrics")).json;
    expect(metrics.storeCancels.noShow).toBeGreaterThanOrEqual(1);
    expect(metrics.storeCancels.total).toBeGreaterThanOrEqual(metrics.storeCancels.noShow);
  });
});
