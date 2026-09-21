// 要件28 客の個人データと登録の消去。28.3 はタスク11、28.1・28.2 はタスク25、28.4〜28.11 は【最終日】タスク32。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, MIN, one, publishOffer, receivedScene, registerCustomer, rows, snapshot, type Ctx } from "./_fakes";

describeTask("11", "AI に渡す内容（28.3）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    const s = await approvedStore(ctx);
    await publishOffer(s.api);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("28.3 偽の AI に渡った中身に、その客の呼び名と電話番号が無い（別の呼び名でも）", async () => {
    for (const [nickname, phone] of [["ひみつのなまえ", "08015150001"], ["べつのなまえ", "08015150002"]] as const) {
      const c = await registerCustomer(ctx, { nickname, phone });
      await fetchOffers(c.api, { party: 2 });
      const input = JSON.stringify(ctx.ai.calls.at(-1));
      expect(input).not.toContain(nickname);
      expect(input).not.toContain(phone);
      expect(ctx.ai.calls.at(-1)).not.toHaveProperty("nickname");
      expect(ctx.ai.calls.at(-1)).not.toHaveProperty("phone");
    }
  });
});

describeTask("25", "電話番号と呼び名が出る場所（28.1・28.2）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("28.1・28.2 電話番号が出るのは本人のホームと受け取られた店のホームだけ。運営の入口の応答に電話番号と呼び名が無い", async () => {
    const s = await receivedScene(ctx);
    const PHONE = "09012345678";
    const NAME = "たなか";
    await s.customer.api.post("/api/customer/reports", { storeId: s.store.id, reason: "通報の理由" });
    expect((await s.customer.api.get("/api/customer/home")).text).toContain(PHONE);
    const storeHome = await s.store.api.get("/api/store/home");
    expect(storeHome.text).toContain(PHONE);
    expect(storeHome.text).toContain(NAME);
    const other = await approvedStore(ctx, { name: "関係ない店" });
    expect((await other.api.get("/api/store/home")).text).not.toContain(PHONE);
    for (const p of ["/api/admin/stores", `/api/admin/stores/${s.store.id}`, "/api/admin/reports", "/api/admin/metrics", "/api/admin/stores?q=たなか"]) {
      const r = await ctx.admin!.api.get(p);
      expect(r.status, p).toBe(200);
      expect(r.text, p).not.toContain(PHONE);
      expect(r.text, p).not.toContain(NAME);
    }
    const f = await fetchOffers(s.customer.api, { party: 2 });
    expect(f.text).not.toContain(PHONE);
    expect((await s.customer.api.get("/api/customer/recent")).text).not.toContain(PHONE);
    expect((await s.store.api.get("/api/store/results")).text).not.toContain(PHONE);
  });
});

describeTask("32", "【最終日】登録の消去（28.4〜28.11）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("28.5 確保中の確保があると消せず（先に取り消すよう示す）。期限から20分以内の期限切れの確保があるときも消せない", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx);
    const before = await snapshot(ctx.db);
    let r = await s.customer.api.del("/api/customer");
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("has_active_reservation");
    expect(await snapshot(ctx.db)).toBe(before);
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    r = await s.customer.api.del("/api/customer");
    expect(r.status).toBe(409);
    ctx.clock.set("2026-09-22T06:41:00.000Z");
    r = await s.customer.api.del("/api/customer");
    expect(r.status).toBe(200);
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("28.4・28.6・28.7・28.8・28.9・28.10 消すと4項目が消え、店の一覧の行に呼び名と電話番号が出ず、その Cookie の要求が通らず、応答が Cookie を消し、記録は残る", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx, { capacity: 3 });
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {});
    const logsBefore = await rows(ctx.db, "SELECT * FROM fetch_logs ORDER BY rowid");
    const customerId = (await one(ctx.db, "SELECT customer_id FROM reservations WHERE id = ?", s.reservation.id)).customer_id;
    const r = await s.customer.api.del("/api/customer");
    expect(r.status).toBe(200);
    expect(r.setCookies.length).toBeGreaterThan(0);
    expect(r.setCookies[0]).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    const row = await one(ctx.db, "SELECT nickname, phone, genres, budget_max, token_hash FROM customers WHERE id = ?", customerId);
    expect(row.nickname ?? "").toBe("");
    expect(row.phone ?? "").toBe("");
    expect(row.genres ?? "[]").toMatch(/^\[\]$|^$/);
    expect(row.budget_max).toBeNull();
    expect(row.token_hash).toBeNull();
    const arrivals = (await s.store.api.get("/api/store/home")).json.arrivals;
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].nickname ?? "").not.toContain("たなか");
    expect(arrivals[0].phone ?? "").not.toContain("09012345678");
    expect((await s.customer.api.get("/api/customer/home")).status).toBe(401);
    expect((await fetchOffers(s.customer.api, { party: 2 })).status).toBe(401);
    expect(await rows(ctx.db, "SELECT * FROM fetch_logs ORDER BY rowid")).toEqual(logsBefore);
    expect(logsBefore.some((l: any) => l.customer_id === customerId)).toBe(true);
  });
});
