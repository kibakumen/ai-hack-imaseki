// 同時に来た操作で、クーポン・人数・運営の停止の規則が破れないこと（2026-09-25 監査の指摘 不具合-13）。
// 確かめてから条件なしで書いていた箇所を、条件を文の中へ移した直しの検査。割り込みの道具は _interleavedDb.ts。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, one, publishOffer, receive, receivedScene, registerCustomer, requireInResults, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { wrappedApp, type Hook } from "./_interleavedDb";

const T0 = "2026-09-22T06:00:00.000Z";
const SUBSCRIPTION = { endpoint: "https://push.example.test/sub/late", keys: { p256dh: "BPUB", auth: "AUTH" } };
let phoneSeq = 0;
const nextPhone = () => `0805555${String(++phoneSeq).padStart(4, "0")}`;

describe("同時の操作で規則が破れない（不具合-13）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const withHooks = (hooks: Hook[]) => wrappedApp(ctx, hooks);

  it("不具合-13① クーポンを作る要求が数えたあとに別の作成が入っても、3つを超えない", async () => {
    const store = await approvedStore(ctx, { coupons: [{ name: "一つ目", note: "" }, { name: "二つ目", note: "" }] });
    const w = await withHooks([{ match: /INSERT INTO coupons/, before: async () => void (await store.api.post("/api/store/coupons", { name: "割り込み" })) }]);
    const r = await w.api(store.api.cookie).post("/api/store/coupons", { name: "四つ目" });
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("limit_reached");
    expect((await one(ctx.db, "SELECT COUNT(*) AS n FROM coupons WHERE store_id = ?", store.id)).n).toBe(3);
  });

  it("不具合-13② 公開がクーポンを読んだあとにそのクーポンが消されても、公開中のオファーは消えたクーポンを指さない", async () => {
    const store = await approvedStore(ctx, { coupons: [{ name: "消される", note: "" }, { name: "残る", note: "" }] });
    const [gone, kept] = store.coupons;
    const w = await withHooks([{ match: /INSERT INTO offers/, before: async () => void (await store.api.del(`/api/store/coupons/${gone.id}`)) }]);
    const r = await w.api(store.api.cookie).post("/api/store/offers", { couponIds: [gone.id, kept.id], capacity: 3, partyMax: 4, until: "23:00" });
    expect(r.status).toBe(201);
    const ids = JSON.parse((await one(ctx.db, "SELECT coupon_ids FROM offers WHERE id = ?", r.json.offer.id)).coupon_ids);
    expect(ids).toEqual([kept.id]);
    expect(r.json.offer.coupons.map((c: { id: string }) => c.id)).toEqual([kept.id]);
  });

  it("不具合-13② 削除と編集が確かめたあとに、そのクーポンを付けた公開が入ると、削除も編集も断られる", async () => {
    const store = await approvedStore(ctx, { coupons: [{ name: "見せる", note: "" }] });
    const [shown] = store.coupons;
    const publish = async () => void (await publishOffer(store.api, { couponIds: [shown.id] }));
    const deleting = await withHooks([{ match: /DELETE FROM coupons/, before: publish }]);
    const del = await deleting.api(store.api.cookie).del(`/api/store/coupons/${shown.id}`);
    expect(del.status).toBe(409);
    expect(del.json.error.kind).toBe("coupon_in_use");
    expect(await one(ctx.db, "SELECT id FROM coupons WHERE id = ?", shown.id)).not.toBeNull();

    expect((await store.api.post("/api/store/offers/current/stop", {})).status).toBe(200);
    const editing = await withHooks([{ match: /UPDATE coupons/, before: publish }]);
    const put = await editing.api(store.api.cookie).put(`/api/store/coupons/${shown.id}`, { name: "書き換え" });
    expect(put.status).toBe(409);
    expect(put.json.error.kind).toBe("coupon_in_use");
    expect((await one(ctx.db, "SELECT name FROM coupons WHERE id = ?", shown.id)).name).toBe("見せる");
  });

  it("不具合-13③ 客が人数を増やすのと同時に店が「何名まで」を下げると、上限を超えた人数は残らない", async () => {
    const s = await receivedScene(ctx, { capacity: 3, partyMax: 4, party: 2 });
    const w = await withHooks([
      { match: /UPDATE reservations SET party/, before: async () => void (await s.store.api.post("/api/store/offers/current/party-max", { partyMax: 2 })) },
    ]);
    const r = await w.api(s.customer.api.cookie).post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 4 });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ kind: "party_over_max", partyMax: 2 });
    expect((await one(ctx.db, "SELECT party FROM reservations WHERE id = ?", s.reservation.id)).party).toBe(2);
  });

  it("不具合-13④ 運営が止める直前に受け取った客にも、運営の都合で取り消された知らせが届く", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    const late = await registerCustomer(ctx, { nickname: "直前の客", phone: nextPhone() });
    expect((await late.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION })).status).toBe(200);
    const f = await fetchOffers(late.api, { party: 2, ...s.at });
    requireInResults(f, s.offer.id);
    const w = await withHooks([
      {
        match: /UPDATE stores SET status = 'banned'/,
        before: async () => void expect((await receive(late.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200),
      },
    ]);
    const before = ctx.push.calls.length;
    expect((await w.api(ctx.admin!.api.cookie).post(`/api/admin/stores/${s.store.id}/ban`, {})).status).toBe(200);
    const lateId = (await one(ctx.db, "SELECT id FROM customers WHERE nickname = ?", "直前の客")).id;
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE customer_id = ?", lateId)).status).toBe("admin_cancelled");
    expect(ctx.push.calls.slice(before).map((c) => (c.subscription as { endpoint: string }).endpoint)).toContain(SUBSCRIPTION.endpoint);
  });
});
