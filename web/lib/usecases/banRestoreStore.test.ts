// 運営の停止と復帰の手続き（要件25の基準 25.4・25.6・25.7・25.8・25.9・25.10・25.11、
// 要件18の基準 18.6、要件27の基準 27.4）。
//
// ⚠️ なぜ受け入れ検査（r25-approve-ban）とは別にこれを置くか: 受け入れ検査は「完了済み」（タスク17）の
// 入口でコードが使えないことを見る所があり、それが揃うまで全部は回せない。ここでは手続きを直に呼んで、
// タスク21の持ち場（確保の取り消し・記録・期限切れを触らないこと・復帰）だけを先に確かめる。
// もう1つ、受け入れ検査では見ていない所を見る——**期限切れの確保は止めても変わらない**（基準 20.23 の前提）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, makeCtx, MIN, one, receive, receivedScene, registerCustomer, registerStore, rows, snapshot, T0, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { banStore } from "./banStore";
import { restoreStore } from "./restoreStore";

let ctx: Ctx;
let seq = 0;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

/** そのオファーをもう1人が受け取る（同じ店に確保中の確保を2件作るため）。 */
const anotherReceive = async (offerId: string) => {
  seq += 1;
  const customer = await registerCustomer(ctx, { nickname: `ふたりめ${seq}`, phone: `0805000${String(seq).padStart(4, "0")}` });
  const fetched = await fetchOffers(customer.api, { party: 2 });
  const received = await receive(customer.api, { offerId, party: 2, fetchId: fetched.json.fetchId });
  expect(received.status, received.text).toBe(200);
  return received.json.reservation as { id: string };
};

describe("banStore", () => {
  it("25.6・25.7・25.8・27.4 止めると状況が変わり、オファーが終わり、確保中の確保が全部取り消されて記録が1件ずつ付く", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    const second = await anotherReceive(scene.offer.id);
    expect(await banStore(ctx.deps, scene.store.id)).toEqual({ ok: true });

    expect(await one(ctx.db, "SELECT status FROM stores WHERE id = ?", scene.store.id)).toMatchObject({ status: "banned" });
    expect(await one(ctx.db, "SELECT end_reason FROM offers WHERE id = ?", scene.offer.id)).toMatchObject({ end_reason: "banned" });
    for (const id of [scene.reservation.id, second.id]) {
      expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", id), id).toMatchObject({ status: "admin_cancelled" });
      expect(await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ? AND status = 'admin_cancelled'", id), id).toHaveLength(1);
    }
  });

  it("18.6 取り消された確保は枠を押さえないので、残りは募集する組数まで戻る", async () => {
    const scene = await receivedScene(ctx, { capacity: 2 });
    await banStore(ctx.deps, scene.store.id);
    const held = await rows(ctx.db, "SELECT status FROM reservations WHERE offer_id = ? AND status IN ('active','store_cancelled')", scene.offer.id);
    expect(held).toEqual([]);
  });

  it("25.8 期限切れの確保は止めても変わらない（店はまだ完了済みにできる・基準 20.23 の前提）", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 25 * MIN).toISOString());
    const fresh = await anotherReceive(scene.offer.id);
    await banStore(ctx.deps, scene.store.id);
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ status: "active" });
    expect(await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ? AND status = 'admin_cancelled'", scene.reservation.id)).toEqual([]);
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", fresh.id)).toMatchObject({ status: "admin_cancelled" });
    ctx.clock.set(T0);
  });

  it("25.4 未承認の店ともう止めた店は止められない（D1 を1文字も変えない）", async () => {
    const pending = await registerStore(ctx, { name: "未承認のまま止めようとする店" });
    let before = await snapshot(ctx.db);
    expect(await banStore(ctx.deps, pending.id)).toEqual({ ok: false, kind: "state", state: "pending" });
    expect(await snapshot(ctx.db)).toBe(before);

    const store = await approvedStore(ctx, { name: "二度止める店" });
    await banStore(ctx.deps, store.id);
    before = await snapshot(ctx.db);
    expect(await banStore(ctx.deps, store.id)).toEqual({ ok: false, kind: "state", state: "banned" });
    expect(await snapshot(ctx.db)).toBe(before);

    expect(await banStore(ctx.deps, "no-such-store")).toEqual({ ok: false, kind: "not_found" });
  });
});

describe("restoreStore", () => {
  it("25.9・25.10 止められている店は戻せる。終わったオファーと取り消された確保は戻らない", async () => {
    const scene = await receivedScene(ctx);
    await banStore(ctx.deps, scene.store.id);
    expect(await restoreStore(ctx.deps, scene.store.id)).toEqual({ ok: true });

    expect(await one(ctx.db, "SELECT status FROM stores WHERE id = ?", scene.store.id)).toMatchObject({ status: "approved" });
    expect((await one(ctx.db, "SELECT ended_at FROM offers WHERE id = ?", scene.offer.id))?.ended_at).toBeTruthy();
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ status: "admin_cancelled" });
  });

  it("25.9 承認済みの店・未承認の店・在らない店は戻せない（D1 を1文字も変えない）", async () => {
    const approved = await approvedStore(ctx, { name: "戻す必要の無い店" });
    const pending = await registerStore(ctx, { name: "未承認のまま戻そうとする店" });
    const before = await snapshot(ctx.db);
    expect(await restoreStore(ctx.deps, approved.id)).toEqual({ ok: false, kind: "state", state: "approved" });
    expect(await restoreStore(ctx.deps, pending.id)).toEqual({ ok: false, kind: "state", state: "pending" });
    expect(await restoreStore(ctx.deps, "no-such-store")).toEqual({ ok: false, kind: "not_found" });
    expect(await snapshot(ctx.db)).toBe(before);
  });
});
