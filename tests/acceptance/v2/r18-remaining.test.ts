// 要件18 残りの数。出来事ごとに、それを実現するタスクの番号を名乗る（受け取り・公開はタスク13〔r08〕、客の取り消し15、期限切れ16、完了済み17、店の取り消し18、運営の停止21）。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, MIN, one, publishOffer, receive, receivedScene, registerCustomer, rows, type Ctx } from "./_fakes";

const remainingOf = async (ctx: Ctx, storeApi: any) => (await storeApi.get("/api/store/home")).json.offer?.remaining ?? null;
const capacityOf = async (ctx: Ctx, offerId: string) => (await one(ctx.db, "SELECT capacity FROM offers WHERE id = ?", offerId)).capacity;

/** TS の残りの式と SQL（ホームの応答）の突き合わせ */
const assertTsMatchesSql = async (ctx: Ctx, offerId: string, sqlRemaining: number) => {
  const { remainingOf: tsRemaining } = await loadWeb("lib/domain/remaining");
  const capacity = await capacityOf(ctx, offerId);
  const rs = await rows(ctx.db, "SELECT status, expires_at, holds_slot FROM reservations WHERE offer_id = ?", offerId);
  const ts = tsRemaining(capacity, rs.map((r: any) => ({ status: r.status, expiresAt: new Date(r.expires_at), holdsSlot: r.holds_slot })), ctx.clock.now());
  expect(ts).toBe(sqlRemaining);
};

describeTask("15", "客の取り消しで残りが1戻る（18.2）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  it("18.2 受け取りで1減り、客が取り消すと1戻る。組数は動かない", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
    expect(await remainingOf(ctx, s.store.api)).toBe(3);
    expect(await capacityOf(ctx, s.offer.id)).toBe(3);
    await assertTsMatchesSql(ctx, s.offer.id, 3);
  });
});

describeTask("16", "期限切れで残りが1戻る（18.3）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  it("18.3 期限が来ると（誰も操作せず）残りが1戻り、組数は動かない", async () => {
    const s = await receivedScene(ctx, { capacity: 2 });
    expect(await remainingOf(ctx, s.store.api)).toBe(1);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 20 * MIN).toISOString());
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    expect(await capacityOf(ctx, s.offer.id)).toBe(2);
    await assertTsMatchesSql(ctx, s.offer.id, 2);
  });
});

describeTask("17", "完了済みと残り（18.7・18.8・18.9・18.14）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("18.9 確保中の完了済みでは残りが動かない", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    await assertTsMatchesSql(ctx, s.offer.id, 2);
  });

  it("18.7 期限切れの完了済みで、残りが1以上なら1減る", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx, { capacity: 3 });
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    expect(await remainingOf(ctx, s.store.api)).toBe(3);
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    expect(await capacityOf(ctx, s.offer.id)).toBe(3);
    await assertTsMatchesSql(ctx, s.offer.id, 2);
  });

  it("18.8 期限切れの完了済みで、残りが0なら0のまま完了済みになる", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx, { capacity: 1 });
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    const other = await registerCustomer(ctx, { nickname: "あとから", phone: "08077770001" });
    const f = await fetchOffers(other.api, { party: 2 });
    expect((await receive(other.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
    expect(await remainingOf(ctx, s.store.api)).toBe(0);
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    expect((await one(ctx.db, "SELECT status, holds_slot FROM reservations WHERE id = ?", s.reservation.id))).toMatchObject({ status: "completed", holds_slot: 0 });
    expect(await remainingOf(ctx, s.store.api)).toBe(0);
    await assertTsMatchesSql(ctx, s.offer.id, 0);
  });

  it("18.14 日付をまたいでも残りは組数へ戻らない（完了済みは枠を押さえたまま）", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await approvedStore(ctx, { name: "夜の店" });
    const offer = await publishOffer(s.api, { capacity: 3, until: "02:00" });
    const c = await registerCustomer(ctx, { nickname: "よる", phone: "08077770009" });
    const f = await fetchOffers(c.api, { party: 2 });
    const r = await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    expect(r.status).toBe(200);
    await s.api.post(`/api/store/reservations/${r.json.reservation.id}/complete`, {});
    expect(await remainingOf(ctx, s.api)).toBe(2);
    ctx.clock.set("2026-09-22T15:30:00.000Z");
    expect(await remainingOf(ctx, s.api)).toBe(2);
    await assertTsMatchesSql(ctx, offer.id, 2);
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });
});

describeTask("20", "同時の受け取り・減らす・期限切れの完了済みで残りが0を下回らない（18.11）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("18.11 残り1で、受け取り・「残りの募集を減らす」・期限切れの完了済みを同時に投げ、残りが0を下回らない", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx, { capacity: 2 });
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    const takerA = await registerCustomer(ctx, { nickname: "A", phone: "08077770002" });
    const fa = await fetchOffers(takerA.api, { party: 2 });
    expect((await receive(takerA.api, { offerId: s.offer.id, party: 2, fetchId: fa.json.fetchId })).status).toBe(200);
    expect(await remainingOf(ctx, s.store.api)).toBe(1);
    const takerB = await registerCustomer(ctx, { nickname: "B", phone: "08077770003" });
    const fb = await fetchOffers(takerB.api, { party: 2 });
    const results = await Promise.all([
      receive(takerB.api, { offerId: s.offer.id, party: 2, fetchId: fb.json.fetchId }),
      s.store.api.post("/api/store/offers/current/reduce", { count: 1 }),
      s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {}),
    ]);
    const remaining = await remainingOf(ctx, s.store.api);
    expect(remaining).toBeGreaterThanOrEqual(0);
    const okCount = results.filter((r) => r.status === 200).length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    await assertTsMatchesSql(ctx, s.offer.id, remaining);
    const capacity = await capacityOf(ctx, s.offer.id);
    const holding = (await rows(ctx.db, "SELECT status, expires_at, holds_slot FROM reservations WHERE offer_id = ?", s.offer.id)).filter(
      (r: any) => (r.status === "active" && new Date(r.expires_at) > ctx.clock.now()) || (r.status === "completed" && r.holds_slot === 1) || r.status === "store_cancelled",
    ).length;
    expect(capacity - holding).toBe(remaining);
  });
});

describeTask("18", "店の取り消しでは残りも組数も戻らない（18.4・18.5）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  it("18.4・18.5 店が取り消しても残りは戻らず、募集する組数も変わらない", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {})).status).toBe(200);
    expect(await remainingOf(ctx, s.store.api)).toBe(2);
    expect(await capacityOf(ctx, s.offer.id)).toBe(3);
    await assertTsMatchesSql(ctx, s.offer.id, 2);
    expect((await one(ctx.db, "SELECT holds_slot FROM reservations WHERE id = ?", s.reservation.id)).holds_slot).toBe(1);
  });
});

describeTask("21", "運営の停止で残りが1戻る（18.6）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  it("18.6 運営が店を止めると確保が取り消され、残りが戻る（オファーは終わっている）", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    await assertTsMatchesSql(ctx, s.offer.id, 3);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe("admin_cancelled");
  });
});
