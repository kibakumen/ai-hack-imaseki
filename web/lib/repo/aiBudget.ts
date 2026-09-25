// アプリ全体の1日の AI の上限（2026-09-25 監査の指摘 安全-03）が読む、その日の ai_calls の合計。
// ⚠️ repo/logs.ts には追加の文しか置かない（基準 27.7・構造の検査）ので、読み口はこちらに置いた。
// 時刻の索引は migration 0003 の idx_ai_calls_at_daily_budget。

import type { Deps } from "../ports";

type Db = Deps["db"];

export type AiCallsTotal = { calls: number; costUsd: number };

/** その時刻以降の ai_calls の回数と実費の合計（実費が記録されない行は0として足す）。 */
export const sumAiCallsSince = async (db: Db, sinceIso: string): Promise<AiCallsTotal> => {
  const row = await db.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_calls WHERE at >= ?1`).bind(sinceIso).first();
  return { calls: Number((row as { calls?: unknown } | null)?.calls ?? 0), costUsd: Number((row as { cost?: unknown } | null)?.cost ?? 0) };
};
