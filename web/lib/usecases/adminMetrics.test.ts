// 運営の数字（要件33の基準 33.4）と、数字の画面が記録を書き換えないこと（基準 27.7 のこの入口の分）。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか: 受け入れ検査（r33-metrics・r27-logs のタスク24 のブロック）は
// 場面の準備にオファーの公開（タスク6）・取得（11）・受け取り（13）・完了済み（19）の入口を使うので、
// それらが揃うまで1件も回せない。ここでは D1 に直に種を入れて、タスク24の持ち場だけを先に確かめる。
// 受け入れ検査が通るようになったら、重なる分はここから落としてよい（2026-09-21 実行者）。
// この置き方の前例はタスク8の `adminStores.test.ts`（同じ理由・同じ形）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, rows, seedAdmin, T0, type Api, type Ctx } from "../../../tests/acceptance/v2/_fakes";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (offsetMs: number) => new Date(new Date(T0).getTime() + offsetMs).toISOString();

/** 記録の5つの表（基準 27.7）。 */
const LOG_TABLES = ["fetch_logs", "fetch_items", "selections", "reservation_events", "ai_calls"];

const STORE_ID = "store-metrics";
const CUSTOMER_ID = "customer-metrics";
const OFFER_ID = "offer-metrics";

let ctx: Ctx;
let admin: Api;

/** 取得の記録を1件（タスク11 が入口から入れるはずの列を直に埋める）。候補の数の既定は3件。 */
const seedFetch = (id: string, input: { aiUsed: number; durationMs: number; candidateCount?: number }) =>
  ctx.db
    .prepare(
      `INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at)
       VALUES (?1, ?2, 35.6595, 139.7005, 2, '[]', NULL, ?6, ?6, ?3, ?4, ?5)`,
    )
    .bind(id, CUSTOMER_ID, input.aiUsed, input.durationMs, T0, input.candidateCount ?? 3)
    .run();

/** AI の呼び出しの記録を1件。倒れた呼び出しは実費が NULL（タスク11・27 が入れる形）。用途の既定は店の選定。 */
const seedAiCall = (id: string, input: { fetchId: string; costUsd: number | null; durationMs: number; succeeded: number; purpose?: string; at?: string; fallbackLevel?: number | null }) =>
  ctx.db
    .prepare(
      `INSERT INTO ai_calls (id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at, purpose)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, NULL, ?8, ?6, ?7)`,
    )
    .bind(id, input.fetchId, input.costUsd, input.durationMs, input.succeeded, input.at ?? T0, input.purpose ?? "select", input.fallbackLevel ?? null)
    .run();

/** 確保を1件（タスク13 が入口から入れる列を直に埋める）。 */
const seedReservation = (id: string, input: { status: string; expiresAt: string }) =>
  ctx.db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json)
       VALUES (?1, ?2, ?3, ?4, 'fetch-1', 2, ?5, ?6, ?7, ?8, ?6, 1, 0, '[]')`,
    )
    .bind(id, OFFER_ID, STORE_ID, CUSTOMER_ID, id.replace(/\D/g, "").padStart(8, "9"), T0, input.expiresAt, input.status)
    .run();

beforeAll(async () => {
  ctx = await makeCtx();
  admin = (await seedAdmin(ctx)).api;
  await ctx.db.prepare(`INSERT INTO stores (id, name, status) VALUES (?1, ?2, 'approved')`).bind(STORE_ID, "数字の店").run();
  await ctx.db
    .prepare(`INSERT INTO customers (id, nickname, phone, genres, budget_max, token_hash) VALUES (?1, ?2, ?3, '[]', NULL, ?4)`)
    .bind(CUSTOMER_ID, "かずの客", "08099990000", "token-hash-metrics")
    .run();
  await ctx.db
    .prepare(`INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at) VALUES (?1, ?2, 3, 3, 4, ?3, ?4)`)
    .bind(OFFER_ID, STORE_ID, T0, at(2 * HOUR))
    .run();

  // 取得4回: 所要時間 2000・3000・4000・1000（平均 2500）。AI を使えたのは2回、点数順に倒れたのは1回、
  // 候補0件で AI を呼ばなかったのが1回（倒れたのではない・不具合-10）。
  await seedFetch("fetch-ai-1", { aiUsed: 1, durationMs: 2000 });
  await seedFetch("fetch-ai-2", { aiUsed: 1, durationMs: 3000 });
  await seedFetch("fetch-fell-back", { aiUsed: 0, durationMs: 4000 });
  await seedFetch("fetch-no-candidates", { aiUsed: 0, durationMs: 1000, candidateCount: 0 });

  // AI の呼び出し3回: 実費 0.001・0.003（平均 0.002。倒れた回は実費が残らないので平均に入らない）、
  // 所要時間 800・1200・400（平均 800）、成功2回・失敗1回。
  await seedAiCall("call-1", { fetchId: "fetch-ai-1", costUsd: 0.001, durationMs: 800, succeeded: 1 });
  await seedAiCall("call-2", { fetchId: "fetch-ai-2", costUsd: 0.003, durationMs: 1200, succeeded: 1 });
  await seedAiCall("call-3", { fetchId: "fetch-fell-back", costUsd: null, durationMs: 400, succeeded: 0 });
  // 紹介文の生成を1回（店の選定の数には入れず、実費の合計には入れる・不具合-10・運営-08）と、
  // 前の日（日本時間）の選定を1回（全期間の合計には入り、今日の合計には入らない）。予備のモデルが答えた呼び出し。
  await seedAiCall("call-pitch", { fetchId: "fetch-ai-1", costUsd: 0.005, durationMs: 900, succeeded: 1, purpose: "pitch" });
  await seedAiCall("call-yesterday", { fetchId: "fetch-ai-2", costUsd: 0.01, durationMs: 700, succeeded: 1, at: at(-24 * HOUR), purpose: "pitch_eval", fallbackLevel: 1 });

  // 確保4件: 期限前の確保中1・期限を過ぎた確保中1（＝自動で取り消された）・完了済み1・客が取り消した1。
  await seedReservation("res-1-active-future", { status: "active", expiresAt: at(30 * MINUTE) });
  await seedReservation("res-2-active-past", { status: "active", expiresAt: at(-5 * MINUTE) });
  await seedReservation("res-3-completed", { status: "completed", expiresAt: at(-5 * MINUTE) });
  await seedReservation("res-4-cancelled", { status: "customer_cancelled", expiresAt: at(-5 * MINUTE) });
});

afterAll(async () => {
  await ctx.dispose();
});

describe("運営の数字（要件33の基準 33.4）", () => {
  it("AI の実費・所要時間・成否と、取得の所要時間・AI を使った数・倒れた数を記録から出す", async () => {
    const m = await admin.get("/api/admin/metrics");
    expect(m.status).toBe(200);
    expect(m.json.ai.calls).toBe(3);
    expect(m.json.ai.avgCostUsd).toBeCloseTo(0.002, 6);
    expect(m.json.ai.avgDurationMs).toBe(800);
    expect(m.json.ai.succeeded).toBe(2);
    expect(m.json.ai.failed).toBe(1);
    expect(m.json.fetch).toEqual({ count: 4, avgDurationMs: 2500, aiUsed: 2, fellBack: 1, noCandidates: 1, fellBackRate: 1 / 3 });
  });

  it("不具合-10: 候補0件の取得は「点数順に倒れた取得」に数えず、別の数で出す。AI の呼び出しの数は店の選定だけ", async () => {
    const m = (await admin.get("/api/admin/metrics")).json;
    expect(m.fetch.fellBack).toBe(1);
    expect(m.fetch.noCandidates).toBe(1);
    // 紹介文の生成・判定の2回は、選定の数（3回）に入らない
    expect(m.ai.calls).toBe(3);
    expect(m.byPurpose.map((r: { purpose: string }) => r.purpose).sort()).toEqual(["pitch", "pitch_eval", "select"]);
  });

  it("運営-08: 全期間と今日（日本時間）の実費の合計・回数、予備のモデルが答えた割合、数えた時刻が返る", async () => {
    ctx.clock.set(T0);
    const m = (await admin.get("/api/admin/metrics")).json;
    expect(m.at).toBe(T0);
    expect(m.cost.totalCalls).toBe(5);
    expect(m.cost.totalUsd).toBeCloseTo(0.001 + 0.003 + 0.005 + 0.01, 9);
    expect(m.cost.todayCalls).toBe(4);
    expect(m.cost.todayUsd).toBeCloseTo(0.001 + 0.003 + 0.005, 9);
    expect(m.fallbackCount).toBe(1);
    expect(m.fallbackRate).toBeCloseTo(1 / 5, 9);
  });

  it("確保のうち自動で取り消された割合は、もう終わった確保のうち期限を過ぎた確保中の割合。まだ確保中の行は分母に入れない（不具合-10）", async () => {
    ctx.clock.set(T0);
    const m = await admin.get("/api/admin/metrics");
    // 4件のうち、期限前の確保中1件は分母から除く → 期限切れ1 / 終わった3
    expect(m.json.reservations.total).toBe(4);
    expect(m.json.reservations.expiredRate).toBeCloseTo(1 / 3, 9);
  });

  it("時間が進んで期限を過ぎた確保が増えると、割合も増える（期限切れは列に持たず時刻から導く）", async () => {
    ctx.clock.set(at(31 * MINUTE));
    const m = await admin.get("/api/admin/metrics");
    expect(m.json.reservations).toEqual({ total: 4, expiredRate: 0.5 });
    ctx.clock.set(T0);
  });

  it("モデル別の表は、この場面の3件（resolved_model は全部 NULL・fallback_level も全部 NULL）を1行にまとめる（タスク28）", async () => {
    const m = await admin.get("/api/admin/metrics");
    // seedAiCall は resolved_model を常に NULL で入れるので、5件は1つの群（model: null）に落ちる。
    // 実費の平均は非NULLの4件（0.001・0.003・0.005・0.01）の平均、所要は5件（800・1200・400・900・700）の平均。
    expect(m.json.byModel).toHaveLength(1);
    expect(m.json.byModel[0]).toMatchObject({ model: null, count: 5, avgDurationMs: 800, validationFailedRate: 0, fellBackRate: 0.2 });
    expect(m.json.byModel[0].avgCostUsd).toBeCloseTo(0.019 / 4, 9);
    // fallback_level が 1 の1件だけを受け皿に数える（NULL は `>= 1` に当たらない）。
    expect(m.json.fallbackCount).toBe(1);
  });

  it("27.7 数字を読んでも、記録の5つの表は1行も変わらない", async () => {
    const before: Record<string, unknown[]> = {};
    for (const t of LOG_TABLES) before[t] = await rows(ctx.db, `SELECT * FROM "${t}" ORDER BY rowid`);
    await admin.get("/api/admin/metrics");
    for (const t of LOG_TABLES) {
      expect(await rows(ctx.db, `SELECT * FROM "${t}" ORDER BY rowid`), t).toEqual(before[t]);
    }
  });

  it("運営の入口は、店のセッションでは 403・ログインしていなければ 401", async () => {
    const store = await registerStore(ctx, { name: "関係ない店", email: "metrics-other-store@example.com" });
    expect((await store.api.get("/api/admin/metrics")).status).toBe(403);
    expect((await ctx.api().get("/api/admin/metrics")).status).toBe(401);
  });
});

describe("記録がまだ1行も無いとき（タスク11 が記録を足す前）", () => {
  it("落ちずに、全部の数字を 0 として返す（平均も数で返す）", async () => {
    const empty = await makeCtx();
    try {
      const emptyAdmin = (await seedAdmin(empty)).api;
      const m = await emptyAdmin.get("/api/admin/metrics");
      expect(m.status).toBe(200);
      expect(m.json.ai).toEqual({ calls: 0, avgCostUsd: 0, avgDurationMs: 0, succeeded: 0, failed: 0 });
      expect(m.json.fetch).toEqual({ count: 0, avgDurationMs: 0, aiUsed: 0, fellBack: 0, noCandidates: 0, fellBackRate: 0 });
      expect(m.json.reservations).toEqual({ total: 0, expiredRate: 0 });
      expect(m.json.cost).toEqual({ totalUsd: 0, totalCalls: 0, todayUsd: 0, todayCalls: 0 });
      expect(m.json.fallbackRate).toBe(0);
    } finally {
      await empty.dispose();
    }
  });
});
