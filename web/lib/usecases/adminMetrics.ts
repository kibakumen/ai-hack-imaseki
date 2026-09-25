// 運営の数字（要件33の基準 33.4）。記録した数字と、確保のうち自動で取り消された割合を1つにまとめる。
// 手続きは Deps を引数で受け、数え方は SQL の側に置く（設計書「どの判断をどこに置くか」）。
//
// ⚠️ 読むだけの手続き。記録の5つの表へ1行も書かない（基準 27.7）。
//    設計書「確保の状態と、残りの数え方」の末尾は、まだ記録の無い期限切れを画面の手続きの先頭で
//    `INSERT OR IGNORE` で足す形を書いているが、**それは基準 27.4 の持ち場（タスク13）**で、
//    この手続きは足さない。割合は `reservations` の期限の列から時刻で導くので、記録が遅れて
//    付いても数字は変わらない（2026-09-21・タスク24 の実行者。タスク13 が期限切れの記録を
//    共通の道具にしたら、ここからその道具を呼ぶ形に寄せてよい）。
//
// ⚠️ 応答に客のデータ（電話番号・呼び名）は入れない（基準 27.6・28.2）。ここが読むのは数だけ。

import type { Deps } from "../ports";
import { aiCallTotals, byModelTotals, byPurposeTotals, costTotals, fallbackCount as countFallbacks, fetchTotals, reservationTotals } from "../repo/adminMetrics";
import { startOfJstDayIso } from "./aiBudget";

/**
 * モデル別の表の1行（第4周の追記・タスク28）。
 * `model` が null の行は、実際に答えたモデルが分からない呼び出しをまとめたもの（画面が「不明」と出す）。
 */
export type AdminMetricsByModelRow = {
  model: string | null;
  count: number;
  avgCostUsd: number | null;
  avgDurationMs: number;
  validationFailedRate: number;
  fellBackRate: number;
};

/**
 * 用途別の表の1行（2026-09-22・本人の指示「用途別の実費内訳」）。`purpose` は
 * `select`（店の選定）／`pitch`（紹介文の生成）／`pitch_eval`（紹介文の判定）の3つ
 * （migrations/0002_ai_call_purpose・`repo/logs.ts` の `AiCallPurpose`）。
 *
 * `totalCostUsd` は**合計**——モデル別の `avgCostUsd`（1回あたり）とは役割が違い、
 * 「その用途にいくら使ったか」を答える。
 */
export type AdminMetricsByPurposeRow = {
  purpose: string;
  count: number;
  totalCostUsd: number;
  avgDurationMs: number;
};

export type AdminMetrics = {
  /** 数えた時点（2026-09-25 監査の指摘 運営-08。画面が「◯時◯分の時点」と出す） */
  at: string;
  /** AI の実費の合計（全部の用途）。全期間と、今日＝日本時間の0時から（運営-08） */
  cost: { totalUsd: number; totalCalls: number; todayUsd: number; todayCalls: number };
  /** 店の選定の AI の呼び出しだけ（不具合-10。紹介文の分は byPurpose） */
  ai: { calls: number; avgCostUsd: number; avgDurationMs: number; succeeded: number; failed: number };
  /**
   * `fellBack` は候補が在るのに点数順になった取得、`noCandidates` は候補0件で AI を呼ばなかった取得（不具合-10）。
   * `fellBackRate` は候補の在った取得のうち点数順になった割合（設計書「運営の画面」の「点数順に倒れた割合」）。
   */
  fetch: { count: number; avgDurationMs: number; aiUsed: number; fellBack: number; noCandidates: number; fellBackRate: number };
  /** `expiredRate` は、もう終わった確保のうち自動で取り消された（期限切れの）割合。0〜1 の小数で返す */
  reservations: { total: number; expiredRate: number };
  byModel: AdminMetricsByModelRow[];
  /** 用途別の実費内訳（2026-09-22・本人の指示） */
  byPurpose: AdminMetricsByPurposeRow[];
  /** 受け皿（別のモデル）が答えた呼び出しの数（`ai_calls.fallback_level` ≥ 1） */
  fallbackCount: number;
  /** 受け皿が答えた割合（全部の呼び出しのうち・設計書「運営の画面」の数字） */
  fallbackRate: number;
};

/** 割合。分母が0のときは0にする（「まだ1件も無い」を「割合が求まらない」にせず、画面を止めない）。 */
const rateOf = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export const adminMetrics = async (deps: Deps): Promise<AdminMetrics> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const [ai, fetch, reservations, byModel, byPurpose, fallbacks, total, today] = await Promise.all([
    aiCallTotals(deps.db),
    fetchTotals(deps.db),
    reservationTotals(deps.db, nowIso),
    byModelTotals(deps.db),
    byPurposeTotals(deps.db),
    countFallbacks(deps.db),
    costTotals(deps.db),
    costTotals(deps.db, startOfJstDayIso(now)),
  ]);
  return {
    at: nowIso,
    cost: { totalUsd: total.costUsd, totalCalls: total.calls, todayUsd: today.costUsd, todayCalls: today.calls },
    ai,
    fetch: { ...fetch, fellBackRate: rateOf(fetch.fellBack, fetch.count - fetch.noCandidates) },
    reservations: { total: reservations.total, expiredRate: rateOf(reservations.expired, reservations.settled) },
    byModel,
    byPurpose,
    fallbackCount: fallbacks,
    fallbackRate: rateOf(fallbacks, total.calls),
  };
};
