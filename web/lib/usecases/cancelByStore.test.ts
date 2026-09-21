// 店による確保の取り消しの手続き（要件21の基準 21.1・21.4・21.5・21.6・21.7、要件18の基準 18.4・18.5）。
//
// ⚠️ なぜ受け入れ検査（r21-store-cancel）とは別にこれを置くか: 受け入れ検査は「完了済み」（タスク17）と
// 「客の取り消し」（タスク15）の入口を使って場面を作る所があり、それらが揃うまで全部は回せない。
// ここでは手続きを直に呼んで、タスク18の持ち場（返る形・記録・枠の押さえ）だけを先に確かめる。
// 受け入れ検査が全部通るようになったら、重なる分はここから落としてよい（2026-09-21 実行者）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, MIN, one, receivedScene, rows, snapshot, T0, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { cancelByStore } from "./cancelByStore";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

describe("cancelByStore", () => {
  it("21.1・18.4・18.5・27.4 確保中を取り消すと店が取り消した状態になり、枠は押さえたまま、記録が1件だけ付く", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    expect(await cancelByStore(ctx.deps, scene.store.id, scene.reservation.id)).toEqual({ ok: true });
    expect(await one(ctx.db, "SELECT status, holds_slot FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({
      status: "store_cancelled",
      holds_slot: 1,
    });
    expect(await one(ctx.db, "SELECT capacity FROM offers WHERE id = ?", scene.offer.id)).toMatchObject({ capacity: 3 });
    const events = await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ? AND status = 'store_cancelled'", scene.reservation.id);
    expect(events).toHaveLength(1);
  });

  it("21.4 取り消すのは1件だけ（同じオファーのほかの確保は確保中のまま）", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    const other = await receivedScene(ctx, { capacity: 3 });
    await cancelByStore(ctx.deps, scene.store.id, scene.reservation.id);
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", other.reservation.id)).toMatchObject({ status: "active" });
  });

  it("21.5・21.7 もう店が取り消した確保への取り消しは、今の状態を返して断り、D1 を1文字も変えない", async () => {
    const scene = await receivedScene(ctx);
    await cancelByStore(ctx.deps, scene.store.id, scene.reservation.id);
    const before = await snapshot(ctx.db);
    expect(await cancelByStore(ctx.deps, scene.store.id, scene.reservation.id)).toEqual({ ok: false, kind: "state", state: "store_cancelled" });
    expect(await snapshot(ctx.db)).toBe(before);
  });

  it("21.5 期限切れの確保は取り消せない（期限切れを返して断る）", async () => {
    const scene = await receivedScene(ctx);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 21 * MIN).toISOString());
    const before = await snapshot(ctx.db);
    expect(await cancelByStore(ctx.deps, scene.store.id, scene.reservation.id)).toEqual({ ok: false, kind: "state", state: "expired" });
    expect(await snapshot(ctx.db)).toBe(before);
    ctx.clock.set(T0);
  });

  it("別の店の確保と、在らない番号は「無い」として返す（存在を分けて見せない）", async () => {
    const scene = await receivedScene(ctx);
    const other = await receivedScene(ctx);
    expect(await cancelByStore(ctx.deps, other.store.id, scene.reservation.id)).toEqual({ ok: false, kind: "not_found" });
    expect(await cancelByStore(ctx.deps, scene.store.id, "no-such-reservation")).toEqual({ ok: false, kind: "not_found" });
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ status: "active" });
  });
});
