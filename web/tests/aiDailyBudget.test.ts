// アプリ全体の1日の AI の上限（2026-09-25 監査の指摘 安全-03 の「選ぶ部分」の第一の案・AI判断）。
// その日（日本時間）の ai_calls の実費の合計か回数が上限に届いたら、その日の残りは AI を呼ばずに点数順で返す。
// OrcaRouter の鍵の1日の予算を使い切られる前に、こちらから倒す（倒れ方は AI の失敗と同じ＝点数順）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, fetchOffers, fetchOffersStream, makeCtx, one, publishOffer, registerCustomer, spot, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { AI_DAILY_BUDGET_USD, AI_DAILY_CALL_LIMIT } from "../lib/schemas/limits";
import { aiBudgetLeft, startOfJstDayIso } from "../lib/usecases/aiBudget";

describe("startOfJstDayIso（日本時間のその日の始まり）", () => {
  it("日本時間の0時（UTC の前日15時）を返す", () => {
    expect(startOfJstDayIso(new Date("2026-09-22T06:00:00.000Z"))).toBe("2026-09-21T15:00:00.000Z");
    expect(startOfJstDayIso(new Date("2026-09-22T14:59:59.999Z"))).toBe("2026-09-21T15:00:00.000Z");
    expect(startOfJstDayIso(new Date("2026-09-22T15:00:00.000Z"))).toBe("2026-09-22T15:00:00.000Z");
  });
});

describe("安全-03 アプリ全体の1日の AI の上限", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: "2026-09-22T06:00:00.000Z" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  let seq = 0;
  const insertCall = (fetchId: string, cost: number | null, at: string) =>
    ctx.db
      .prepare("INSERT INTO ai_calls (id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, at) VALUES (?, ?, ?, 100, 1, 0, ?)")
      .bind(`budget-${++seq}`, fetchId, cost, at)
      .run();

  it("その日の実費の合計が上限に届くと、取得は AI を呼ばずに点数順で返し、紹介文も書かせない。次の日はまた呼ぶ", async () => {
    const at = spot();
    const s = await approvedStore(ctx, { name: "予算の店", ...at });
    await publishOffer(s.api, { capacity: 5 });
    const c = await registerCustomer(ctx);
    const first = await fetchOffers(c.api, { party: 2, ...at });
    expect(first.status).toBe(200);
    expect(await aiBudgetLeft(ctx.deps)).toBe(true);

    // 前の日の分は数えない
    await insertCall(first.json.fetchId, AI_DAILY_BUDGET_USD * 5, "2026-09-21T14:59:00.000Z");
    expect(await aiBudgetLeft(ctx.deps)).toBe(true);
    await insertCall(first.json.fetchId, AI_DAILY_BUDGET_USD, ctx.clock.now().toISOString());
    expect(await aiBudgetLeft(ctx.deps)).toBe(false);

    const aiBefore = ctx.ai.calls.length;
    const pitchBefore = ctx.pitch.total();
    const capped = await fetchOffers(c.api, { party: 2, ...at });
    expect(capped.status).toBe(200);
    expect(capped.json.items.length).toBeGreaterThan(0);
    expect(ctx.ai.calls.length).toBe(aiBefore);
    expect((await one(ctx.db, "SELECT ai_used FROM fetch_logs WHERE id = ?", capped.json.fetchId)).ai_used).toBe(0);
    const streamed = await fetchOffersStream(ctx, c.api, { party: 2, ...at });
    expect(streamed.lines.some((l) => l.type === "init")).toBe(true);
    expect(ctx.ai.calls.length).toBe(aiBefore);
    expect(ctx.pitch.total()).toBe(pitchBefore);
    expect(streamed.lines.filter((l) => l.type === "pitch").every((l) => l.source === "fallback")).toBe(true);

    // 日本時間の次の日になれば、また呼ぶ
    ctx.clock.set("2026-09-22T15:00:00.000Z");
    expect(await aiBudgetLeft(ctx.deps)).toBe(true);
  });

  it("実費が記録されない呼び出しもあるので、回数でも止める", async () => {
    ctx.clock.set("2026-09-23T06:00:00.000Z");
    const at = spot();
    const s = await approvedStore(ctx, { name: "回数の店", ...at });
    await publishOffer(s.api, { capacity: 5 });
    const c = await registerCustomer(ctx);
    const f = await fetchOffers(c.api, { party: 2, ...at });
    expect(await aiBudgetLeft(ctx.deps)).toBe(true);
    await ctx.db
      .prepare(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT INTO ai_calls (id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, at) SELECT 'bulk-' || i, ?, NULL, 1, 1, 0, ? FROM n",
      )
      .bind(AI_DAILY_CALL_LIMIT, f.json.fetchId, ctx.clock.now().toISOString())
      .run();
    expect(await aiBudgetLeft(ctx.deps)).toBe(false);
  });
});
