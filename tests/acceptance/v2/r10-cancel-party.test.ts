// 要件10 客による取り消しと人数の変更（手続き）。画面は r10-cancel-party.ui.test.tsx。
// 後のタスクの状態（完了済み17・店の取り消し18・運営の停止21・何名までの変更20）が要る場合は、そのタスクの番号を名乗る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { makeCtx, MIN, one, receivedScene, snapshot, type Ctx } from "./_fakes";

describeTask("15", "客の取り消しと人数の変更", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const stateOf = async (id: string) => (await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", id)).status;

  it("10.1・10.2 確保中の確保を取り消せて、コードが使えなくなる（状態が customer_cancelled）。取得の画面へ戻る。二度目は断る", async () => {
    const s = await receivedScene(ctx);
    const r = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
    expect(r.status).toBe(200);
    expect(r.json.home.kind).toBe("fetch");
    expect(await stateOf(s.reservation.id)).toBe("customer_cancelled");
    const again = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
    expect(again.status).toBe(409);
    expect(again.json.current.state).toBe("customer_cancelled");
  });

  it("10.3 期限切れ・客が取り消した確保への取り消しは、状態も残りも変えずに断る（今の状態を返す）", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const expired = await receivedScene(ctx, { capacity: 3 });
    ctx.clock.set("2026-09-22T06:21:00.000Z");
    let before = await snapshot(ctx.db);
    let r = await expired.customer.api.post(`/api/customer/reservations/${expired.reservation.id}/cancel`, {});
    expect(r.status).toBe(409);
    expect(r.json.current.state).toBe("expired");
    expect(await snapshot(ctx.db)).toBe(before);
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const cancelled = await receivedScene(ctx, { capacity: 3 });
    await cancelled.customer.api.post(`/api/customer/reservations/${cancelled.reservation.id}/cancel`, {});
    before = await snapshot(ctx.db);
    r = await cancelled.customer.api.post(`/api/customer/reservations/${cancelled.reservation.id}/cancel`, {});
    expect(r.status).toBe(409);
    expect(r.json.current.state).toBe("customer_cancelled");
    expect(await snapshot(ctx.db)).toBe(before);
  });

  it("10.4・10.5 人数を変えられる。0・11・小数・空は変えず入力の誤り", async () => {
    const s = await receivedScene(ctx, { partyMax: 6, party: 2 });
    const ok = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 3 });
    expect(ok.status).toBe(200);
    expect(ok.json.home.reservation.party).toBe(3);
    for (const party of [0, 11, 2.5, undefined]) {
      const r = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, party === undefined ? {} : { party });
      expect(r.status, String(party)).toBe(400);
      expect(r.json.error.kind).toBe("invalid_input");
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("party");
    }
    expect((await one(ctx.db, "SELECT party FROM reservations WHERE id = ?", s.reservation.id)).party).toBe(3);
  });

  it("10.6・10.7・10.9 増やす変更は「何名まで」以下なら人数だけ変わり（確保・コード・期限はそのまま）、超えると party_over_max。減らす変更は通る。終わったオファーは終わった時点の値", async () => {
    const s = await receivedScene(ctx, { partyMax: 4, party: 2 });
    const before = await one(ctx.db, "SELECT id, code, expires_at FROM reservations WHERE id = ?", s.reservation.id);
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 4 })).status).toBe(200);
    expect(await one(ctx.db, "SELECT id, code, expires_at FROM reservations WHERE id = ?", s.reservation.id)).toEqual(before);
    const over = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 5 });
    expect(over.status).toBe(409);
    expect(over.json.error.kind).toBe("party_over_max");
    expect((await one(ctx.db, "SELECT party FROM reservations WHERE id = ?", s.reservation.id)).party).toBe(4);
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 1 })).status).toBe(200);
    await s.store.api.post("/api/store/offers/current/stop", {});
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 4 })).status).toBe(200);
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 5 })).status).toBe(409);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 2 })).status).toBe(200);
  });
});

describeTask("20", "「何名まで」を下げたあとの人数の変更（10.7・10.9）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("10.7・10.9 店が「何名まで」を下げたあと、増やす変更はその時点の値と比べ、減らす変更は超えていても通る", async () => {
    const s = await receivedScene(ctx, { partyMax: 4, party: 4 });
    await s.store.api.post("/api/store/offers/current/party-max", { partyMax: 2 });
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 3 })).status).toBe(200);
    expect((await one(ctx.db, "SELECT party FROM reservations WHERE id = ?", s.reservation.id)).party).toBe(3);
    const over = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 4 });
    expect(over.status).toBe(409);
    expect(over.json.error.kind).toBe("party_over_max");
    expect((await one(ctx.db, "SELECT party FROM reservations WHERE id = ?", s.reservation.id)).party).toBe(3);
  });
});

describeTask("21", "確保中でない5つの状態への取り消し（10.3）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("10.3 完了済み・期限切れ・客が取り消した・店が取り消した・運営に取り消された確保への取り消しは、状態も残りも変えずに断る", async () => {
    const make = async (state: string) => {
      ctx.clock.set("2026-09-22T06:00:00.000Z");
      const s = await receivedScene(ctx, { capacity: 3 });
      if (state === "completed") await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
      if (state === "customer_cancelled") await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
      if (state === "store_cancelled") await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
      if (state === "admin_cancelled") await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
      if (state === "expired") ctx.clock.set("2026-09-22T06:21:00.000Z");
      return s;
    };
    for (const state of ["completed", "expired", "customer_cancelled", "store_cancelled", "admin_cancelled"]) {
      const s = await make(state);
      const before = await snapshot(ctx.db);
      const r = await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
      expect(r.status, state).toBe(409);
      expect(r.json.ok).toBe(false);
      expect(r.json.current.state, state).toBe(state);
      expect(await snapshot(ctx.db), state).toBe(before);
    }
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });
});
