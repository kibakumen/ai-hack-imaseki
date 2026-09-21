// 運営の数字（要件33の基準 33.4）が、記録から実際に集計を出すことを確かめる（2026-09-22）。
//
// ⚠️ **なぜここに置いたか**: 受け入れ検査 `tests/acceptance/v2/r33-metrics.test.ts` のタスク28は
// 「モデル別の表」だけを見ており、凍結されているため1文字も変えられない。ここで足すのは
// ①モデル別・用途別・倒れた回数が「記録が1件も無いとき」に空へ倒れること
// ②複数のモデル・複数の用途が混ざったときに、件数・実費・所要が正しく分かれること——の2点。
// どちらも凍結検査の外側の性質なので、`web/tests/`（`tests/acceptance/v2/` の外）に置く。
//
// `logPrivacy.test.ts` と同じ道具（`makeCtx`・`receivedScene`）を使う。`ai_calls` は
// `fetch_id` に外部キー制約が在るので、まず1件受け取りまで済ませて実在する `fetchId` を作り、
// それへ追加の行を挿し込む（`tests/acceptance/v2/r33-metrics.test.ts` タスク28と同じやり方）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWeb, makeCtx, receivedScene, type Ctx } from "../../tests/acceptance/v2/_fakes";
import type { AdminMetrics } from "../lib/usecases/adminMetrics";

let ctx: Ctx;
let adminMetrics: (deps: Ctx["deps"]) => Promise<AdminMetrics>;

beforeAll(async () => {
  ({ adminMetrics } = await loadWeb<{ adminMetrics: typeof adminMetrics }>("lib/usecases/adminMetrics"));
  ctx = await makeCtx();
});

afterAll(async () => {
  await ctx.dispose();
});

describe("運営の数字: モデル別・用途別・倒れた回数", () => {
  it("ai_calls が1件も無いとき、byModel・byPurpose は空、fallbackCount は0（0の棒を並べず「まだ呼び出しがありません」を画面が出す前提）", async () => {
    const m = await adminMetrics(ctx.deps);
    expect(m.byModel).toEqual([]);
    expect(m.byPurpose).toEqual([]);
    expect(m.fallbackCount).toBe(0);
  });

  it("モデルと用途が混ざった行から、モデル別（件数・平均実費・平均所要・検査落ち率・受け皿率）と用途別（件数・実費の合計・平均所要）と倒れた回数を正しく分ける", async () => {
    const scene = await receivedScene(ctx);
    const fetchId = scene.fetchId;
    const insert = (row: { model: string | null; purpose: string; cost: number | null; ms: number; succeeded: number; vf: number; level: number | null }) =>
      ctx.db
        .prepare(
          `INSERT INTO ai_calls (id, fetch_id, purpose, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), fetchId, row.purpose, row.cost, row.ms, row.succeeded, row.vf, row.model, null, row.level, ctx.clock.now().toISOString())
        .run();

    // gpt-4o-mini が「店の選定」を2回（1回は検査落ち）
    await insert({ model: "openai/gpt-4o-mini", purpose: "select", cost: 0.001, ms: 500, succeeded: 1, vf: 0, level: 0 });
    await insert({ model: "openai/gpt-4o-mini", purpose: "select", cost: 0.002, ms: 700, succeeded: 1, vf: 1, level: 0 });
    // haiku が「紹介文の判定」で受け皿（fallback_level >= 1）
    await insert({ model: "anthropic/claude-haiku-4.5", purpose: "pitch_eval", cost: 0.0005, ms: 300, succeeded: 1, vf: 0, level: 1 });
    // モデルが分からない（倒れた）呼び出しが「紹介文の生成」
    await insert({ model: null, purpose: "pitch", cost: null, ms: 200, succeeded: 0, vf: 0, level: null });

    const m = await adminMetrics(ctx.deps);

    const gpt = m.byModel.find((r) => r.model === "openai/gpt-4o-mini");
    expect(gpt).toBeTruthy();
    expect(gpt!.count).toBe(2);
    expect(gpt!.avgCostUsd).toBeCloseTo(0.0015, 6);
    expect(gpt!.avgDurationMs).toBe(600);
    expect(gpt!.validationFailedRate).toBeCloseTo(0.5, 6);
    expect(gpt!.fellBackRate).toBe(0);

    const haiku = m.byModel.find((r) => r.model === "anthropic/claude-haiku-4.5");
    expect(haiku).toMatchObject({ count: 1, avgDurationMs: 300, validationFailedRate: 0, fellBackRate: 1 });
    expect(haiku!.avgCostUsd).toBeCloseTo(0.0005, 6);

    // `receivedScene` は場面づくりの中で `fetchOffers` を1回通す（fetchId を作るため）ので、
    // それ自体が「店の選定」の ai_calls を1件残す（fakeAi の既定応答: costUsd 0.0012・resolvedModel 無し
    // →null・durationMs はフェイククロックが進まないので 0）。model null の群・purpose select の群は
    // どちらもこの1件を含んだ数になる——モデルが分からない（倒れた）行として自分が足した1件と合わせて2件。
    const unknown = m.byModel.find((r) => r.model === null);
    expect(unknown).toBeTruthy();
    expect(unknown!.count).toBe(2);
    expect(unknown!.avgCostUsd).toBeCloseTo(0.0012, 6);
    expect(unknown!.avgDurationMs).toBe(100);
    expect(unknown!.fellBackRate).toBe(0);

    expect(m.fallbackCount).toBe(1);

    const select = m.byPurpose.find((r) => r.purpose === "select");
    expect(select).toBeTruthy();
    expect(select!.count).toBe(3);
    expect(select!.totalCostUsd).toBeCloseTo(0.0042, 6);
    expect(select!.avgDurationMs).toBeCloseTo(400, 6);

    const pitch = m.byPurpose.find((r) => r.purpose === "pitch");
    expect(pitch).toMatchObject({ count: 1, avgDurationMs: 200 });
    expect(pitch!.totalCostUsd).toBe(0);

    const pitchEval = m.byPurpose.find((r) => r.purpose === "pitch_eval");
    expect(pitchEval).toBeTruthy();
    expect(pitchEval!.count).toBe(1);
    expect(pitchEval!.totalCostUsd).toBeCloseTo(0.0005, 6);
    expect(pitchEval!.avgDurationMs).toBe(300);
  });
});
