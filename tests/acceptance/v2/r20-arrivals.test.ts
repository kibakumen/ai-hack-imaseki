// 要件20 向かっている客と完了済み（手続き・ホームの一覧の行）。20.23〜20.25 はタスク21。画面は r20-arrivals.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { fetchOffers, makeCtx, MIN, one, receive, receivedScene, registerCustomer, rows, snapshot, type Ctx } from "./_fakes";

const T0 = new Date("2026-09-22T06:00:00.000Z").getTime();
const at = (ctx: Ctx, minutes: number) => ctx.clock.set(new Date(T0 + minutes * MIN).toISOString());

describeTask("17", "向かっている客の一覧と完了済み", () => {
  let ctx: Ctx;
  let seq = 0;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const arrivals = async (api: any) => (await api.get("/api/store/home")).json.arrivals as any[];
  const anotherCustomer = async (over: Record<string, unknown> = {}) => registerCustomer(ctx, { nickname: `客${++seq}`, phone: `0803000${String(seq).padStart(4, "0")}`, ...over });

  it("20.1・20.2・20.3・20.18 確保中の行に呼び名・電話番号・人数・コード・期限が出て、期限の近い順。人数の変更が映る。0件なら空", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 5, party: 2 });
    let rows = await arrivals(s.store.api);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "active", nickname: "たなか", phone: "09012345678", party: 2, code: s.reservation.code, canComplete: true, canCancel: true });
    expect(rows[0].expiresAt).toBe(new Date(T0 + 20 * MIN).toISOString());
    at(ctx, 5);
    const later = await anotherCustomer({ nickname: "あとから" });
    const f = await fetchOffers(later.api, { party: 3 });
    await receive(later.api, { offerId: s.offer.id, party: 3, fetchId: f.json.fetchId });
    await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 4 });
    rows = await arrivals(s.store.api);
    expect(rows.map((r) => r.nickname)).toEqual(["たなか", "あとから"]);
    expect(rows[0].party).toBe(4);
    const empty = await receivedScene(ctx);
    await empty.customer.api.post(`/api/customer/reservations/${empty.reservation.id}/cancel`, {});
    expect(await arrivals(empty.store.api)).toEqual([]);
  });

  it("20.5・20.14・20.15 期限切れは20分・完了済みは24時間残る。客が取り消した行は出ない（店が取り消した行はタスク18、運営はタスク21のブロック）", async () => {
    at(ctx, 0);
    const expired = await receivedScene(ctx);
    const completed = await receivedScene(ctx);
    await completed.store.api.post(`/api/store/reservations/${completed.reservation.id}/complete`, {});
    const byCustomer = await receivedScene(ctx);
    await byCustomer.customer.api.post(`/api/customer/reservations/${byCustomer.reservation.id}/cancel`, {});
    expect(await arrivals(byCustomer.store.api)).toEqual([]);
    at(ctx, 25);
    let list = await arrivals(expired.store.api);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "expired", canComplete: true, canCancel: false });
    list = await arrivals(completed.store.api);
    expect(list[0]).toMatchObject({ kind: "completed", canComplete: false, canCancel: false });
    at(ctx, 41);
    expect(await arrivals(expired.store.api)).toEqual([]);
    expect(await arrivals(completed.store.api)).toHaveLength(1);
    at(ctx, 24 * 60 + 1);
    expect(await arrivals(completed.store.api)).toEqual([]);
  });

  it("20.6・20.7・20.9・20.12・20.13・20.19 完了済みにできるのは確保中と、期限から20分以内で客が新しい確保を作っていない期限切れだけ。ほかは状態も残りも変えずに断る", async () => {
    at(ctx, 0);
    const active = await receivedScene(ctx, { capacity: 5 });
    expect((await active.store.api.post(`/api/store/reservations/${active.reservation.id}/complete`, {})).status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", active.reservation.id)).status).toBe("completed");
    at(ctx, 60);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", active.reservation.id)).status).toBe("completed");
    expect((await active.customer.api.get("/api/customer/home")).json.kind).toBe("fetch");
    for (const r of await (async () => {
      at(ctx, 0);
      const within20 = await receivedScene(ctx);
      const over20 = await receivedScene(ctx);
      const newer = await receivedScene(ctx, { capacity: 5 });
      at(ctx, 25);
      await newer.customer.api.post("/api/customer/reservations", { retryOf: newer.reservation.id });
      return [
        { name: "20分以内の期限切れ", scene: within20, minutes: 25, ok: true },
        { name: "20分を過ぎた期限切れ", scene: over20, minutes: 41, ok: false, state: "expired" },
        { name: "客が新しい確保を作った期限切れ", scene: newer, minutes: 25, ok: false, state: "expired" },
      ];
    })()) {
      at(ctx, r.minutes);
      const before = await snapshot(ctx.db);
      const res = await r.scene.store.api.post(`/api/store/reservations/${r.scene.reservation.id}/complete`, {});
      if (r.ok) expect(res.status, r.name).toBe(200);
      else {
        expect(res.status, r.name).toBe(409);
        expect(res.json.current.state, r.name).toBe(r.state);
        expect(await snapshot(ctx.db), r.name).toBe(before);
      }
    }
    for (const state of ["completed", "customer_cancelled"]) {
      at(ctx, 0);
      const s = await receivedScene(ctx);
      if (state === "completed") await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
      if (state === "customer_cancelled") await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
      const before = await snapshot(ctx.db);
      const res = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
      expect(res.status, state).toBe(409);
      expect(res.json.current.state, state).toBe(state);
      expect(await snapshot(ctx.db), state).toBe(before);
    }
  });

  it("20.22 同じ確保へ完了済みと客の取り消しを同時に投げ、結果が「順に扱ったとき」のどちらかで、残りの増減が1回だけ（店の取り消しを加えた形はタスク18のブロック）", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 3 });
    const results = await Promise.all([s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {}), s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {})]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const state = (await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status;
    expect(state).toBe(["completed", "customer_cancelled"][results.findIndex((r) => r.status === 200)]);
    for (const r of results.filter((r) => r.status !== 200)) expect(r.json.current.state).toBe(state);
    expect((await s.store.api.get("/api/store/home")).json.offer.remaining).toBe(state === "customer_cancelled" ? 3 : 2);
  });

  it("20.11 完了済みにする操作はコードの入力を求めない（本文なしで通る）", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx);
    const r = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`);
    expect(r.status).toBe(200);
    const route = ctx.app.routes.find((x: any) => /reservations\/:id\/complete$/.test(x.path) && x.auth === "store");
    expect(route).toBeTruthy();
  });

});

describeTask("18", "店が取り消した行（20.16）・店が取り消した確保への完了済み（20.19）・同時の3つの出来事（20.22）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("20.16 店が取り消した行は「店が取り消した」と分かる形で電話番号とともに20分残り、そのあと消える。20.19 その確保は完了済みにできない", async () => {
    at(ctx, 10);
    const s = await receivedScene(ctx);
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {})).status).toBe(200);
    at(ctx, 25);
    const list = (await s.store.api.get("/api/store/home")).json.arrivals;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "store_cancelled", phone: "09012345678", canComplete: false, canCancel: false });
    const before = await snapshot(ctx.db);
    const res = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    expect(res.status).toBe(409);
    expect(res.json.current.state).toBe("store_cancelled");
    expect(await snapshot(ctx.db)).toBe(before);
    at(ctx, 31);
    expect((await s.store.api.get("/api/store/home")).json.arrivals).toEqual([]);
    at(ctx, 0);
  });

  it("20.22 同じ確保へ完了済み・客の取り消し・店の取り消しを同時に投げ、結果が「順に扱ったとき」のどれかで、残りの増減が1回だけ", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 3 });
    const results = await Promise.all([
      s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {}),
      s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {}),
      s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {}),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const state = (await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status;
    const winner = results.findIndex((r) => r.status === 200);
    expect(state).toBe(["completed", "customer_cancelled", "store_cancelled"][winner]);
    for (const r of results.filter((r) => r.status !== 200)) expect(r.json.current.state).toBe(state);
    const remaining = (await s.store.api.get("/api/store/home")).json.offer.remaining;
    expect(remaining).toBe(state === "customer_cancelled" ? 3 : 2);
    const events = await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ?", s.reservation.id);
    expect(events.filter((e: any) => e.status === state)).toHaveLength(1);
  });
});

describeTask("21", "止められている店の完了済み（20.23・20.24）と、運営に取り消された行（20.15・20.19）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("20.23・20.24 止められている店の期限切れの行は canComplete が false で、要求も状態も残りも変えずに断る（store_banned）", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx);
    at(ctx, 25);
    expect((await s.store.api.get("/api/store/home")).json.arrivals[0].canComplete).toBe(true);
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    const list = (await s.store.api.get("/api/store/home")).json.arrivals;
    for (const r of list) expect(r.canComplete).toBe(false);
    const before = await snapshot(ctx.db);
    const res = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    expect(res.status).toBe(409);
    expect(res.json.error?.kind ?? res.json.current?.state).toMatch(/store_banned|expired|admin_cancelled/);
    expect(await snapshot(ctx.db)).toBe(before);
    at(ctx, 0);
  });

  it("20.15・20.19 運営に取り消された行は一覧から消え、その確保は完了済みにできない", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    expect((await s.store.api.get("/api/store/home")).json.arrivals).toEqual([]);
    const before = await snapshot(ctx.db);
    const res = await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    expect(res.status).toBe(409);
    expect(await snapshot(ctx.db)).toBe(before);
  });
});
