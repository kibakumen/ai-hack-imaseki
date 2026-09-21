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
import { aiCallTotals, fetchTotals, reservationTotals } from "../repo/adminMetrics";

/**
 * モデル別の表の1行（第4周の追記・タスク28 が中身を入れる）。
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

export type AdminMetrics = {
  ai: { calls: number; avgCostUsd: number; avgDurationMs: number; succeeded: number; failed: number };
  fetch: { count: number; avgDurationMs: number; aiUsed: number; fellBack: number };
  /** `expiredRate` は確保のうち自動で取り消された（期限切れの）割合。0〜1 の小数で返す */
  reservations: { total: number; expiredRate: number };
  byModel: AdminMetricsByModelRow[];
  /** 受け皿（別のモデル）が答えた呼び出しの数（`ai_calls.fallback_level` ≥ 1） */
  fallbackCount: number;
};

/** 割合。分母が0のときは0にする（「まだ1件も無い」を「割合が求まらない」にせず、画面を止めない）。 */
const rateOf = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export const adminMetrics = async (deps: Deps): Promise<AdminMetrics> => {
  const nowIso = deps.clock.now().toISOString();
  const [ai, fetch, reservations] = await Promise.all([aiCallTotals(deps.db), fetchTotals(deps.db), reservationTotals(deps.db, nowIso)]);
  return {
    ai,
    fetch,
    reservations: { total: reservations.total, expiredRate: rateOf(reservations.expired, reservations.total) },
    // ⚠️ タスク28（OrcaRouter の3点セット A-2）がここを埋める: `repo/adminMetrics.ts` に
    //    `resolved_model` で括った集計（`GROUP BY resolved_model`）と `fallback_level >= 1` の件数を足し、
    //    この2行をその呼び出しに差し替える。応答の形（AdminMetricsByModelRow）は上に用意してある。
    byModel: [],
    fallbackCount: 0,
  };
};
