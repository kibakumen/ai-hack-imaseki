// 要件23 店の実績（手続き）。23.8 の画面は r23-results.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, MIN, publishOffer, receive, registerCustomer, type Ctx } from "./_fakes";

describeTask("22", "オファーごとの実績", () => {
  let ctx: Ctx;
  let seq = 0;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const customer = () => registerCustomer(ctx, { nickname: `客${++seq}`, phone: `0809000${String(seq).padStart(4, "0")}` });

  it("23.1〜23.7 出来事を起こしてから数える: 出た回数・受け取られた数・完了済み（期限切れのあとを含む）・取り消し（内訳つき）。終わったオファーも新しい順", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await approvedStore(ctx, { name: "実績の店" });
    const first = await publishOffer(s.api, { capacity: 10, partyMax: 4 });
    const shown: Array<Awaited<ReturnType<typeof customer>>> = [];
    for (let i = 0; i < 6; i++) {
      const c = await customer();
      const f = await fetchOffers(c.api, { party: 2 });
      expect(f.json.items.map((x: any) => x.offerId)).toContain(first.id);
      shown.push(Object.assign(c, { fetchId: f.json.fetchId as string }));
    }
    const far = await customer();
    await fetchOffers(far.api, { lat: 36.5, party: 2 });
    const rs = await Promise.all(shown.slice(0, 5).map((c: any) => receive(c.api, { offerId: first.id, party: 2, fetchId: c.fetchId })));
    for (const r of rs) expect(r.status).toBe(200);
    const ids = rs.map((r) => r.json.reservation.id);
    await s.api.post(`/api/store/reservations/${ids[0]}/complete`, {});
    await shown[1].api.post(`/api/customer/reservations/${ids[1]}/cancel`, {});
    await s.api.post(`/api/store/reservations/${ids[2]}/cancel`, {});
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    await s.api.post(`/api/store/reservations/${ids[3]}/complete`, {});
    let results = (await s.api.get("/api/store/results")).json.items;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ offerId: first.id, shown: 6, received: 5, completed: 2, cancelled: { total: 3, customer: 1, expired: 1, store: 1, admin: 0 } });

    await s.api.post("/api/store/offers/current/stop", {});
    ctx.clock.set("2026-09-22T06:30:00.000Z");
    const second = await publishOffer(s.api, { capacity: 2 });
    const c = await customer();
    const f = await fetchOffers(c.api, { party: 2 });
    await receive(c.api, { offerId: second.id, party: 2, fetchId: f.json.fetchId });
    await ctx.admin!.api.post(`/api/admin/stores/${s.id}/ban`, {});
    results = (await s.api.get("/api/store/results")).json.items;
    expect(results.map((r: any) => r.offerId)).toEqual([second.id, first.id]);
    expect(results[0]).toMatchObject({ shown: 1, received: 1, completed: 0, cancelled: { total: 1, admin: 1 } });
    expect(results[1].completed).toBe(2);
  });

  it("23.8 実績が無い店は0件（画面の文の元）。別の店の実績は混ざらない", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const a = await approvedStore(ctx, { name: "実績なし" });
    expect((await a.api.get("/api/store/results")).json.items).toEqual([]);
    const b = await approvedStore(ctx, { name: "実績あり" });
    await publishOffer(b.api);
    expect((await a.api.get("/api/store/results")).json.items).toEqual([]);
    expect((await b.api.get("/api/store/results")).json.items).toHaveLength(1);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());
  });
});
