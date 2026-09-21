// 要件33 効果を示す数字の記録。33.1〜33.3 はタスク11、33.4 はタスク24。第4周の追記（3列＋モデル別の表）はタスク27・28。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, MIN, one, publishOffer, receivedScene, registerCustomer, selectionText, type Ctx } from "./_fakes";

describeTask("11", "AI の呼び出しと取得の記録（33.1・33.2・33.3）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    const s = await approvedStore(ctx, { name: "数字の店" });
    await publishOffer(s.api);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("33.1 AI の呼び出しごとに実費・所要時間・成否が残る（偽の口が返した値と偽の時計）", async () => {
    const c = await registerCustomer(ctx, { phone: "08013130001" });
    ctx.ai.respond(async (input) => {
      await ctx.clock.advance(1_234);
      return { ok: true, text: selectionText([{ storeId: input.stores[0].id, reason: "合います" }]), costUsd: 0.0077 };
    });
    const ok = await fetchOffers(c.api, { party: 2 });
    let call = await one(ctx.db, "SELECT cost_usd, duration_ms, succeeded FROM ai_calls WHERE fetch_id = ?", ok.json.fetchId);
    expect(call).toEqual({ cost_usd: 0.0077, duration_ms: 1234, succeeded: 1 });
    ctx.ai.respond(() => ({ ok: false, error: "down", costUsd: null }));
    const failed = await fetchOffers(c.api, { party: 2 });
    call = await one(ctx.db, "SELECT cost_usd, succeeded FROM ai_calls WHERE fetch_id = ?", failed.json.fetchId);
    expect(call).toEqual({ cost_usd: null, succeeded: 0 });
    ctx.ai.respond((input) => ({ ok: true, text: selectionText([{ storeId: input.stores[0].id, reason: "合います" }]), costUsd: 0.0012 }));
  });

  it("33.2 取得ごとに、起点が決まってから結果を返すまでの所要時間が残る（偽の時計で AI に2秒かかると 2000ms 以上）", async () => {
    const c = await registerCustomer(ctx, { phone: "08013130002" });
    ctx.ai.respond(async (input) => {
      await ctx.clock.advance(2_000);
      return { ok: true, text: selectionText([{ storeId: input.stores[0].id, reason: "合います" }]), costUsd: 0.001 };
    });
    const r = await fetchOffers(c.api, { party: 2 });
    const log = await one(ctx.db, "SELECT duration_ms FROM fetch_logs WHERE id = ?", r.json.fetchId);
    expect(log.duration_ms).toBeGreaterThanOrEqual(2000);
    expect(log.duration_ms).toBeLessThan(2000 + 6 * MIN);
    ctx.ai.respond((input) => ({ ok: true, text: selectionText([{ storeId: input.stores[0].id, reason: "合います" }]), costUsd: 0.0012 }));
  });

  it("33.3 AI を使った取得と倒れた取得を数えられる（fetch_logs.ai_used）", async () => {
    const c = await registerCustomer(ctx, { phone: "08013130003" });
    const before = await one(ctx.db, "SELECT SUM(ai_used) AS used, COUNT(*) AS n FROM fetch_logs");
    await fetchOffers(c.api, { party: 2 });
    ctx.ai.respond(() => ({ ok: false, error: "down" }));
    await fetchOffers(c.api, { party: 2 });
    await fetchOffers(c.api, { party: 2 });
    const after = await one(ctx.db, "SELECT SUM(ai_used) AS used, COUNT(*) AS n FROM fetch_logs");
    expect(after.n - before.n).toBe(3);
    expect(after.used - before.used).toBe(1);
  });
});

describeTask("24", "運営の数字の入口（33.4）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("33.4 数字と、確保のうち自動で取り消された割合を返し、出来事を起こすと値が変わる", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const a = await receivedScene(ctx, { capacity: 5 });
    const b = await receivedScene(ctx, { capacity: 5 });
    await b.store.api.post(`/api/store/reservations/${b.reservation.id}/complete`, {});
    let m = await ctx.admin!.api.get("/api/admin/metrics");
    expect(m.status).toBe(200);
    expect(m.json.ai.calls).toBeGreaterThanOrEqual(2);
    expect(typeof m.json.ai.avgCostUsd).toBe("number");
    expect(typeof m.json.ai.avgDurationMs).toBe("number");
    expect(m.json.ai).toMatchObject({ succeeded: expect.any(Number), failed: expect.any(Number) });
    expect(m.json.fetch).toMatchObject({ count: expect.any(Number), avgDurationMs: expect.any(Number), aiUsed: expect.any(Number), fellBack: expect.any(Number) });
    expect(m.json.reservations).toEqual({ total: 2, expiredRate: 0 });
    ctx.clock.set("2026-09-22T06:25:00.000Z");
    m = await ctx.admin!.api.get("/api/admin/metrics");
    expect(m.json.reservations).toEqual({ total: 2, expiredRate: 0.5 });
    expect(a.reservation.id).toBeTruthy();
    ctx.ai.respond(() => ({ ok: false, error: "down" }));
    await fetchOffers(a.customer.api, { party: 2 });
    const m2 = await ctx.admin!.api.get("/api/admin/metrics");
    expect(m2.json.fetch.fellBack).toBe(m.json.fetch.fellBack + 1);
    expect(m2.json.ai.failed).toBe(m.json.ai.failed + 1);
  });
});

describeTask("27", "OrcaRouter の3点セット A-1: 応答ヘッダーの3列と受け皿", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    const s = await approvedStore(ctx, { name: "受け皿の店" });
    await publishOffer(s.api);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("偽の OrcaRouter が応答ヘッダーを返すと ai_calls の3列にその値が残り、無ければ NULL（0 や空文字に補わない）", async () => {
    const { createOrcaRouterSelector } = await loadWeb("lib/adapters/orcarouter");
    const withHeaders = (headers: Record<string, string>, resolved = "openai/gpt-4o-mini") =>
      (async () => new Response(JSON.stringify({ choices: [{ message: { content: selectionText([{ storeId: "x", reason: "y" }]) } }], usage: { cost_usd: 0.002 } }), { status: 200, headers: { "content-type": "application/json", ...headers } })) as typeof fetch;
    const a = await ctx.withDeps({ ai: createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: withHeaders({ "X-Orca-Resolved-Model": "openai/gpt-4o-mini", "X-Orca-Request-Id": "req-A", "X-Orca-Fallback-Level": "1" }) }) });
    const ca = await registerCustomer(a, { phone: "08014140001" });
    const ra = await fetchOffers(ca.api, { party: 2 });
    const rowA = await one(ctx.db, "SELECT resolved_model, request_id, fallback_level, succeeded, validation_failed FROM ai_calls WHERE fetch_id = ?", ra.json.fetchId);
    expect(rowA).toEqual({ resolved_model: "openai/gpt-4o-mini", request_id: "req-A", fallback_level: 1, succeeded: 1, validation_failed: 1 });
    const b = await ctx.withDeps({ ai: createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: withHeaders({}) }) });
    const cb = await registerCustomer(b, { phone: "08014140002" });
    const rb = await fetchOffers(cb.api, { party: 2 });
    const rowB = await one(ctx.db, "SELECT resolved_model, request_id, fallback_level FROM ai_calls WHERE fetch_id = ?", rb.json.fetchId);
    expect(rowB).toEqual({ resolved_model: null, request_id: null, fallback_level: null });
  });

  it("要求の本文に受け皿（models と route: fallback）が入り、モデルは設定 ORCAROUTER_MODEL の値。受け皿は別ベンダーの anthropic/claude-haiku-4.5", async () => {
    const { createOrcaRouterSelector } = await loadWeb("lib/adapters/orcarouter");
    for (const model of ["orcarouter/ai-sekitori", "orcarouter/auto"]) {
      let body: any = null;
      const capture = (async (_: any, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      await createOrcaRouterSelector({ apiKey: "k", model, fetch: capture }).select({ party: 2, genres: [], budgetMax: null, stores: [{ id: "s", genres: ["和食"], menus: [], budgetMin: 1, budgetMax: 2 }] }, {});
      expect(body.model).toBe(model);
      expect(body.route).toBe("fallback");
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models.length).toBeLessThanOrEqual(5);
      expect(body.models.at(-1)).toBe("anthropic/claude-haiku-4.5");
      expect(body.models.some((m: string) => /^anthropic\//.test(m))).toBe(true);
    }
    const { readEnv } = await loadWeb("lib/adapters/env");
    expect(readEnv({ ORCAROUTER_MODEL: "orcarouter/ai-sekitori", TURNSTILE_SITE_KEY: "s", VAPID_PUBLIC_KEY: "v" }).config.orcarouterModel).toBe("orcarouter/ai-sekitori");
    expect(readEnv({ TURNSTILE_SITE_KEY: "s", VAPID_PUBLIC_KEY: "v" }).config.orcarouterModel).toBe("orcarouter/auto");
  });

  it("出力が 7.3・7.4 に落ちた呼び出しは validation_failed=1 かつ succeeded=1。通った呼び出しは 0/1", async () => {
    const c = await registerCustomer(ctx, { phone: "08014140003" });
    ctx.ai.respond(() => ({ ok: true, text: selectionText([{ storeId: "not-a-candidate", reason: "x" }]), costUsd: 0.001 }));
    const bad = await fetchOffers(c.api, { party: 2 });
    expect(await one(ctx.db, "SELECT succeeded, validation_failed FROM ai_calls WHERE fetch_id = ?", bad.json.fetchId)).toEqual({ succeeded: 1, validation_failed: 1 });
    ctx.ai.respond((input) => ({ ok: true, text: selectionText([{ storeId: input.stores[0].id, reason: "合います" }]), costUsd: 0.001 }));
    const good = await fetchOffers(c.api, { party: 2 });
    expect(await one(ctx.db, "SELECT succeeded, validation_failed FROM ai_calls WHERE fetch_id = ?", good.json.fetchId)).toEqual({ succeeded: 1, validation_failed: 0 });
  });
});

describeTask("28", "OrcaRouter の3点セット A-2: モデル別の表", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("ai_calls に2つのモデルの行と受け皿の行を入れて、モデル別の件数・平均実費・平均所要時間・検査落ち率・倒れた率、受け皿の件数、NULL は「不明」", async () => {
    const s = await receivedScene(ctx);
    const fetchId = s.fetchId;
    const insert = (model: string | null, cost: number | null, ms: number, succeeded: number, vf: number, level: number | null) =>
      ctx.db.prepare("INSERT INTO ai_calls (id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), fetchId, cost, ms, succeeded, vf, model, null, level, ctx.clock.now().toISOString()).run();
    await insert("openai/gpt-4o-mini", 0.001, 800, 1, 0, 0);
    await insert("openai/gpt-4o-mini", 0.003, 1200, 1, 1, 0);
    await insert("google/gemini-2.5-flash", 0.002, 600, 1, 0, 0);
    await insert("anthropic/claude-haiku-4.5", 0.004, 1500, 1, 0, 1);
    await insert(null, null, 300, 0, 0, null);
    const m = await ctx.admin!.api.get("/api/admin/metrics");
    expect(m.status).toBe(200);
    const byModel = m.json.byModel as any[];
    const gpt = byModel.find((r) => r.model === "openai/gpt-4o-mini");
    expect(gpt.count).toBe(2);
    expect(gpt.avgCostUsd).toBeCloseTo(0.002, 6);
    expect(gpt.avgDurationMs).toBe(1000);
    expect(gpt.validationFailedRate).toBeCloseTo(0.5, 6);
    expect(byModel.find((r) => r.model === "google/gemini-2.5-flash")).toMatchObject({ count: 1, avgDurationMs: 600, validationFailedRate: 0 });
    expect(byModel.find((r) => r.model === "anthropic/claude-haiku-4.5")).toMatchObject({ count: 1 });
    const unknown = byModel.find((r) => r.model === null);
    expect(unknown).toBeTruthy();
    expect(unknown.count).toBeGreaterThanOrEqual(1);
    expect(m.json.fallbackCount).toBe(1);
    for (const r of byModel) {
      expect(typeof r.fellBackRate).toBe("number");
      expect(r.fellBackRate).toBeGreaterThanOrEqual(0);
      expect(r.fellBackRate).toBeLessThanOrEqual(1);
    }
  });
});
