// 要件26 通報と最近行った店（手続き）。画面は r26-report.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, MIN, one, publishOffer, receive, receivedScene, rows, type Ctx } from "./_fakes";

const DAY = 24 * 60 * MIN;
const T0 = new Date("2026-09-22T06:00:00.000Z").getTime();
const at = (ctx: Ctx, ms: number) => ctx.clock.set(new Date(T0 + ms).toISOString());

describeTask("23", "通報と最近行った店", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("26.2・26.3・26.4 理由が空・空白だけ・501字は保存されず（項目名つき）。通ると店・理由・日時・客の内部の番号が保存され、生の識別子は無い", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx);
    for (const reason of ["", "   ", "\n\t", "あ".repeat(501)]) {
      const before = (await rows(ctx.db, "SELECT id FROM reports")).length;
      const r = await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason });
      expect(r.status, JSON.stringify(reason)).toBe(400);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("reason");
      expect((await rows(ctx.db, "SELECT id FROM reports")).length).toBe(before);
    }
    const ok = await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "来たら閉まっていた" });
    expect([200, 201]).toContain(ok.status);
    const saved = await one(ctx.db, "SELECT * FROM reports ORDER BY rowid DESC LIMIT 1");
    expect(saved).toMatchObject({ store_id: s.store.id, reason: "来たら閉まっていた" });
    expect(saved.at ?? saved.created_at).toBe(new Date(T0).toISOString());
    expect(saved.customer_id).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain(s.customer.cookie.split("=").slice(1).join("="));
  });

  it("26.18 その客の確保中の店でも、7日以内に完了済みの店でもない店（行っていない・取り消された・期限切れのまま・8日前）は report_not_allowed", async () => {
    at(ctx, 0);
    const never = await approvedStore(ctx, { name: "行っていない店" });
    await publishOffer(never.api);
    const active = await receivedScene(ctx);
    const check = async (label: string, api: any, storeId: string, expected: number) => {
      const before = (await rows(ctx.db, "SELECT id FROM reports")).length;
      const r = await api.post("/api/customer/reports", { storeId, reason: `${label}への通報` });
      if (expected === 200) expect([200, 201], label).toContain(r.status);
      else {
        expect(r.status, label).toBe(expected);
        expect(r.json.error.kind, label).toBe("report_not_allowed");
        expect((await rows(ctx.db, "SELECT id FROM reports")).length, label).toBe(before);
      }
    };
    await check("行っていない店", active.customer.api, never.id, 409);
    await check("確保中の店", active.customer.api, active.store.id, 200);
    const cancelled = await receivedScene(ctx);
    await cancelled.customer.api.post(`/api/customer/reservations/${cancelled.reservation.id}/cancel`, {});
    await check("取り消した店", cancelled.customer.api, cancelled.store.id, 409);
    const expired = await receivedScene(ctx);
    at(ctx, 25 * MIN);
    await check("期限切れのままの店", expired.customer.api, expired.store.id, 409);
    at(ctx, 0);
    const done = await receivedScene(ctx);
    await done.store.api.post(`/api/store/reservations/${done.reservation.id}/complete`, {});
    at(ctx, 7 * DAY - MIN);
    await check("7日以内に完了済みの店", done.customer.api, done.store.id, 200);
    at(ctx, 8 * DAY);
    await check("8日前に完了済みの店", done.customer.api, done.store.id, 409);
    await check("無い店", done.customer.api, "no-such-store", 409);
    at(ctx, 0);
  });

  it("26.6・26.8 運営の一覧は新しい順で、店名つき、応答に客の電話番号と呼び名が無い", async () => {
    at(ctx, 0);
    const a = await receivedScene(ctx, { storeName: "先の店" });
    await a.customer.api.post("/api/customer/reports", { storeId: a.store.id, reason: "先の通報" });
    at(ctx, MIN);
    const b = await receivedScene(ctx, { storeName: "後の店" });
    await b.customer.api.post("/api/customer/reports", { storeId: b.store.id, reason: "後の通報" });
    const list = await ctx.admin!.api.get("/api/admin/reports");
    expect(list.status).toBe(200);
    const mine = list.json.items.filter((i: any) => ["先の通報", "後の通報"].includes(i.reason));
    expect(mine.map((i: any) => i.reason)).toEqual(["後の通報", "先の通報"]);
    expect(mine[0]).toMatchObject({ storeId: b.store.id, storeName: "後の店" });
    expect(mine[0].at).toBe(new Date(T0 + MIN).toISOString());
    expect(list.text).not.toContain("たなか");
    expect(list.text).not.toContain("09012345678");
    at(ctx, 0);
  });

  it("26.10・26.11・26.12・26.15・26.17 最近行った店: 完了済みから7日以内だけ、次の確保を作ったあとも出る、新しい順、コード・住所・URL は無い", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { storeName: "一軒目" });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    at(ctx, 60 * MIN);
    const s2 = await approvedStore(ctx, { name: "二軒目" });
    const o2 = await publishOffer(s2.api);
    const f = await fetchOffers(s.customer.api, { party: 2 });
    const r2 = await receive(s.customer.api, { offerId: o2.id, party: 2, fetchId: f.json.fetchId });
    expect(r2.status).toBe(200);
    let recent = (await s.customer.api.get("/api/customer/recent")).json.items;
    expect(recent.map((i: any) => i.storeName)).toEqual(["一軒目"]);
    expect(recent[0]).toMatchObject({ storeId: s.store.id, completedAt: new Date(T0).toISOString() });
    expect(Object.keys(recent[0]).sort()).toEqual(["completedAt", "reservationId", "storeId", "storeName"]);
    await s2.api.post(`/api/store/reservations/${r2.json.reservation.id}/complete`, {});
    recent = (await s.customer.api.get("/api/customer/recent")).json.items;
    expect(recent.map((i: any) => i.storeName)).toEqual(["二軒目", "一軒目"]);
    at(ctx, 7 * DAY + MIN);
    recent = (await s.customer.api.get("/api/customer/recent")).json.items;
    expect(recent.map((i: any) => i.storeName)).toEqual(["二軒目"]);
    at(ctx, 0);
  });
});
