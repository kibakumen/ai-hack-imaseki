// 同じ取得の結果から、同じオファーを押さえ続けられないこと（2026-09-25 監査の指摘 安全-06・案A と案B の組み合わせ）。
//
// 以前は受け取り直しに回数の上限が無く、同じ fetchId で同じオファーを何度でも受け取り直せた。
// 配信数10の店を10個の識別子で押さえ、20分ごとに受け取り直せば、本物の客には「満席」が返り続けた。
//   案A: 受け取り直しは1つの受け取りにつき1回まで（同じ取得・同じオファーの確保は、受け取り直しを含めて2件まで）
//   案B の一部: 取得から一定時間（60分）を過ぎた結果からは、新しく受け取れない
//   （案B の「その取得の結果に出た店か」は、結果に無い店の受け取りの件（不具合-12）の直しが持つ）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchOffers, makeCtx, MIN, one, receive, receivedScene, rows, type Ctx } from "../../tests/acceptance/v2/_fakes";

const T0 = "2026-09-22T06:00:00.000Z";

describe("安全-06 同じ取得の結果から押さえ続けられない", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const at = (minutes: number) => ctx.clock.set(new Date(Date.parse(T0) + minutes * MIN).toISOString());

  it("受け取り直しは1つの受け取りにつき1回まで。受け取り直した確保が切れたら、そこからは受け取り直せない", async () => {
    at(0);
    const s = await receivedScene(ctx, { capacity: 5 });
    at(21);
    const retried = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(retried.status).toBe(200);
    at(42);
    // 受け取り直した確保が切れた直後の表示では、もう受け取り直しを勧めない
    const home = await s.customer.api.get("/api/customer/home");
    expect(home.json.kind).toBe("expired");
    expect(home.json.expired.canRetry).toBe(false);
    const again = await s.customer.api.post("/api/customer/reservations", { retryOf: retried.json.reservation.id });
    expect(again.status).toBe(409);
    expect(again.json.refusal).toMatchObject({ kind: "results_stale", nextStep: "search_again" });
    const customerId = (await one(ctx.db, "SELECT customer_id FROM reservations WHERE id = ?", s.reservation.id)).customer_id;
    expect(await rows(ctx.db, "SELECT id FROM reservations WHERE customer_id = ?", customerId)).toHaveLength(2);
  });

  it("受け取り直しの道でなく、同じ取得の結果からもう一度受け取る道でも、同じオファーは2件まで", async () => {
    at(100);
    const s = await receivedScene(ctx, { capacity: 5 });
    at(121);
    expect((await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId })).status).toBe(200);
    at(142);
    const third = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
    expect(third.status).toBe(409);
    expect(third.json.refusal.kind).toBe("results_stale");
    // 探し直せば、また受け取れる
    const f = await fetchOffers(s.customer.api, { party: 2, ...s.at });
    expect((await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
  });

  it("取得から60分を過ぎた結果からは、新しく受け取れない（探し直しを勧める）", async () => {
    at(300);
    const s = await receivedScene(ctx, { capacity: 5 });
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {})).status).toBe(200);
    at(361);
    const stale = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: s.fetchId });
    expect(stale.status).toBe(409);
    expect(stale.json.refusal).toMatchObject({ kind: "results_stale", nextStep: "search_again" });
  });
});
