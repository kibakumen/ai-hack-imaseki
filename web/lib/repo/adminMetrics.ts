// 運営の数字の読み取り（要件33の基準 33.4）。lib/repo は D1 の SQL（設計書「ファイル構成の計画」）。
//
// ⚠️ ここは読むだけ。記録の5つの表（fetch_logs・fetch_items・selections・reservation_events・ai_calls）へ
//    UPDATE も DELETE も書かない（基準 27.7。構造の検査 structure.test.ts の 27.7 の項が見張る）。
//    数字の画面を開いても記録が1行も変わらないのは、この「読むだけ」で保たれている。
//
// ⚠️ 「今」は必ず呼ぶ側が束縛した値を渡す（実行者への契約: SQLite の datetime('now') は使わない）。
//    偽の時計で時間を進める受け入れ検査が、SQL の側だけ本物の時計を見ていると通らなくなる。
//
// ⚠️ 表が1行も無い場合（取得の手続き＝タスク11 が記録を足す前）も落ちない: COUNT は 0 を、
//    AVG と SUM は NULL を返すので、読む側で 0 に倒す（下の toNumber）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** AI の呼び出しの合計（基準 33.1 の記録から数える）。 */
export type AiCallTotals = {
  calls: number;
  /**
   * 1回あたりの実費の平均。**実費が残っていない呼び出し（倒れた呼び出しは NULL）は平均に入れない**——
   * 0 として混ぜると「1回いくらか」が実際より安く見える（AI判断）。
   */
  avgCostUsd: number;
  avgDurationMs: number;
  succeeded: number;
  failed: number;
};

/** 取得の合計（基準 33.2・33.3 の記録から数える）。 */
export type FetchTotals = {
  count: number;
  avgDurationMs: number;
  /** AI の選定を使えた取得の数 */
  aiUsed: number;
  /** 点数順に倒れた取得の数 */
  fellBack: number;
};

/** 確保の数と、自動で取り消された（期限切れの）数。 */
export type ReservationTotals = { total: number; expired: number };

/** 集計は行が無いと NULL を返す。数として読めない値は 0 に倒す（画面に空欄を出さないため）。 */
const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 所要時間はミリ秒の整数で持つ（平均が端数になっても、表示と突き合わせの単位を1つにする）。 */
const toMilliseconds = (value: unknown): number => Math.round(toNumber(value));

export const aiCallTotals = async (db: Db): Promise<AiCallTotals> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS calls,
              AVG(cost_usd) AS avg_cost_usd,
              AVG(duration_ms) AS avg_duration_ms,
              SUM(CASE WHEN succeeded = 1 THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END) AS failed
         FROM ai_calls`,
    )
    .first();
  return {
    calls: toNumber(row?.calls),
    avgCostUsd: toNumber(row?.avg_cost_usd),
    avgDurationMs: toMilliseconds(row?.avg_duration_ms),
    succeeded: toNumber(row?.succeeded),
    failed: toNumber(row?.failed),
  };
};

export const fetchTotals = async (db: Db): Promise<FetchTotals> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count,
              AVG(duration_ms) AS avg_duration_ms,
              SUM(CASE WHEN ai_used = 1 THEN 1 ELSE 0 END) AS ai_used,
              SUM(CASE WHEN ai_used = 0 THEN 1 ELSE 0 END) AS fell_back
         FROM fetch_logs`,
    )
    .first();
  return {
    count: toNumber(row?.count),
    avgDurationMs: toMilliseconds(row?.avg_duration_ms),
    aiUsed: toNumber(row?.ai_used),
    fellBack: toNumber(row?.fell_back),
  };
};

/**
 * 確保の数と、自動で取り消された数（基準 33.4 の「確保のうち自動で取り消された割合」の分子と分母）。
 *
 * **期限切れは保存しない**——`status='active'` で今が期限以後のもの、と時刻から導く
 * （設計書「確保の状態と、残りの数え方」: 6つの状態のうち期限切れだけは列に持たない）。
 * 期限を過ぎたあとに店が完了済みにしたものは `status='completed'` になるので、ここでは数えない
 * （客は来ていて、自動で取り消されたわけではないため）。
 *
 * ⚠️ この条件は、期限切れを導くただ1つの置き場（タスク13・17 が置く `domain` の
 *    `effectiveState` ／ `repo/sqlFragments.ts`）が出来たらそちらへ寄せる。今は数字の画面だけが
 *    この条件を使うのでここに置いた（AI判断・タスク11・18 が同じ時間に sqlFragments を足しているため）。
 */
export const reservationTotals = async (db: Db, nowIso: string): Promise<ReservationTotals> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'active' AND expires_at <= ?1 THEN 1 ELSE 0 END) AS expired
         FROM reservations`,
    )
    .bind(nowIso)
    .first();
  return { total: toNumber(row?.total), expired: toNumber(row?.expired) };
};
