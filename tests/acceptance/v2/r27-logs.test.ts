// 要件27 提示と選択の記録。27.1・27.2・27.5・27.6 はタスク11、27.3・27.4 はタスク13（r08 にもある）、27.7 はタスク24。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, north, one, publishOffer, receivedScene, registerCustomer, rows, selectionText, SHIBUYA, tables, type Ctx } from "./_fakes";

describeTask("11", "取得の記録（27.1・27.2・27.5・27.6）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    for (let i = 0; i < 3; i++) {
      const s = await approvedStore(ctx, { name: `記録の店${i}`, address: `記録の住所${i}`, ...north(SHIBUYA, 30 * i) });
      await publishOffer(s.api);
    }
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("27.1・27.2 取得1回で記録1件（時刻・客の内部の番号・起点・人数・その回の好みと予算・候補の数・返した件数・AI を使ったか）と、返した店ごとの順位・点数・理由", async () => {
    const c = await registerCustomer(ctx, { nickname: "きろく", phone: "08012120001" });
    const before = (await rows(ctx.db, "SELECT id FROM fetch_logs")).length;
    const r = await fetchOffers(c.api, { party: 3, genres: ["和食", "中華"], budgetMax: 2500, lat: SHIBUYA.lat, lng: SHIBUYA.lng });
    expect(r.status).toBe(200);
    expect((await rows(ctx.db, "SELECT id FROM fetch_logs")).length).toBe(before + 1);
    const log = await one(ctx.db, "SELECT * FROM fetch_logs WHERE id = ?", r.json.fetchId);
    expect(log.at ?? log.created_at).toBe(ctx.clock.now().toISOString());
    expect(log.customer_id).toBeTruthy();
    expect(log.origin_lat).toBeCloseTo(SHIBUYA.lat, 4);
    expect(log.origin_lng).toBeCloseTo(SHIBUYA.lng, 4);
    expect(log.party).toBe(3);
    expect(JSON.parse(log.genres)).toEqual(["和食", "中華"]);
    expect(log.budget_max).toBe(2500);
    expect(log.candidate_count).toBe(3);
    expect(log.returned_count).toBe(r.json.items.length);
    expect(log.ai_used).toBe(1);
    const items = await rows(ctx.db, "SELECT rank, score, reason, store_id FROM fetch_items WHERE fetch_id = ? ORDER BY rank", r.json.fetchId);
    expect(items.map((i: any) => i.store_id)).toEqual(r.json.items.map((i: any) => i.storeId));
    expect(items.map((i: any) => i.rank)).toEqual(items.map((_: any, i: number) => i + 1));
    for (const [i, it] of items.entries()) {
      expect(typeof it.score).toBe("number");
      expect(it.reason).toBe(r.json.items[i].reason);
    }
  });

  it("27.2 点数順に倒れた取得では理由が空として残る。27.5 0件の取得も1件残る", async () => {
    const c = await registerCustomer(ctx, { nickname: "たおれ", phone: "08012120002" });
    ctx.ai.respond(() => ({ ok: false, error: "down" }));
    const r = await fetchOffers(c.api, { party: 2 });
    const items = await rows(ctx.db, "SELECT reason FROM fetch_items WHERE fetch_id = ?", r.json.fetchId);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.reason ?? "").toBe("");
    ctx.ai.respond((input) => ({ ok: true, text: selectionText(input.stores.slice(0, 1).map((s) => ({ storeId: s.id, reason: "合います" }))), costUsd: 0 }));
    const zero = await fetchOffers(c.api, { lat: SHIBUYA.lat + 1, party: 2 });
    expect(zero.json.items).toEqual([]);
    const log = await one(ctx.db, "SELECT candidate_count, returned_count FROM fetch_logs WHERE id = ?", zero.json.fetchId);
    expect(log).toEqual({ candidate_count: 0, returned_count: 0 });
  });

  it("27.6 記録のどの列にも客の電話番号と呼び名が無い", async () => {
    const c = await registerCustomer(ctx, { nickname: "ひみつのなまえ", phone: "08012120003" });
    await fetchOffers(c.api, { party: 2 });
    for (const t of ["fetch_logs", "fetch_items", "selections", "reservation_events", "ai_calls"]) {
      const all = JSON.stringify(await rows(ctx.db, `SELECT * FROM "${t}"`));
      expect(all, t).not.toContain("ひみつのなまえ");
      expect(all, t).not.toContain("08012120003");
      expect(all, t).not.toContain("たなか");
    }
  });
});

describeTask("24", "記録は追加だけ（27.7）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("27.7 一連の操作のあと、前からあった記録の行が1つも変わっていない（5つの表）", async () => {
    const LOG_TABLES = ["fetch_logs", "fetch_items", "selections", "reservation_events", "ai_calls"];
    expect(await tables(ctx.db)).toEqual(expect.arrayContaining(LOG_TABLES));
    const s = await receivedScene(ctx, { capacity: 3 });
    const before: Record<string, any[]> = {};
    for (const t of LOG_TABLES) before[t] = await rows(ctx.db, `SELECT * FROM "${t}" ORDER BY rowid`);
    await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/party`, { party: 3 });
    await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {});
    const f = await fetchOffers(s.customer.api, { party: 2 });
    await s.customer.api.post("/api/customer/reservations", { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId });
    await s.store.api.post("/api/store/offers/current/stop", {});
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    await ctx.admin!.api.get("/api/admin/metrics");
    for (const t of LOG_TABLES) {
      const after = await rows(ctx.db, `SELECT * FROM "${t}" ORDER BY rowid`);
      expect(after.length, t).toBeGreaterThanOrEqual(before[t].length);
      expect(after.slice(0, before[t].length), t).toEqual(before[t]);
    }
    expect((await rows(ctx.db, "SELECT * FROM reservation_events")).length).toBeGreaterThan(before.reservation_events.length);
  });
});
