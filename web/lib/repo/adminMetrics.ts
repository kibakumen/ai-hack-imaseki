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
import { activeReservationCondition, expiredReservationCondition, storeChosenCancelCondition, withdrawnCancelCondition } from "./sqlFragments";

type Db = Deps["db"];

/**
 * 店の選定の AI の呼び出しの合計（基準 33.1 の記録から数える）。
 * **用途「店の選定」だけ**を数える（2026-09-25 監査の指摘 不具合-10 の第一の案・AI判断）——紹介文の生成と判定は
 * 1回の取得で何本も呼ぶので、混ぜると「1回あたりの実費」「答えた・倒れた」が選定の工夫を表さなくなる。
 * 紹介文の分は用途別（byPurpose）に、全部の用途の実費の合計は costTotals に出す。
 */
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
  /**
   * 候補が在るのに点数順に倒れた取得の数（AI の失敗・時間切れ・その日の予算切れ）。
   * **候補0件の取得は入れない**——AI を呼ばない決まり（基準 7.11）で、倒れたのではない（不具合-10）。
   */
  fellBack: number;
  /** 候補0件で AI を呼ばなかった取得の数（不具合-10） */
  noCandidates: number;
};

/** AI の実費の合計（全部の用途。運営-08 の「今日いくら使ったか」）。 */
export type CostTotals = { costUsd: number; calls: number };

/**
 * 確保の数と、自動で取り消された（期限切れの）数。`settled` は**もう終わった**確保の数
 * （まだ確保中の行を除いた数・割合の分母・不具合-10）。
 */
/**
 * `storeCancelled` は店が取り消した確保の数、`noShowCancelled` はそのうち「来ない（枠を戻す）」の数（2026-09-26 本人選択）。
 * `withdrawnCancelled` は店の退会の巻き添えで取り消した確保の数で、`storeCancelled` には入れない（同日の本人選択）。
 */
export type ReservationTotals = { total: number; expired: number; settled: number; storeCancelled: number; noShowCancelled: number; withdrawnCancelled: number };

/**
 * `resolved_model` で括った1行（タスク28 の続き・第4周の追記）。`model` が null の行は、
 * 実際に答えたモデルが分からない呼び出し（OrcaRouter の応答ヘッダーが無かった等）をまとめたもの。
 */
export type ByModelRow = {
  model: string | null;
  count: number;
  /** その群の実費が1件も残っていない（全部 NULL）ときは null（0 に倒さない・画面は「—」と出す）。 */
  avgCostUsd: number | null;
  avgDurationMs: number;
  validationFailedRate: number;
  fellBackRate: number;
};

/**
 * `purpose` で括った1行（店の選定／紹介文の生成／紹介文の判定・migrations/0002）。
 * こちらは「実費の合計」を持つ——本人の指示（用途別の実費内訳）が求めるのは
 * 「その用途にいくら使ったか」の総額で、1回あたりの平均ではないため。
 */
export type ByPurposeRow = {
  purpose: string;
  count: number;
  totalCostUsd: number;
  avgDurationMs: number;
};

/** 集計は行が無いと NULL を返す。数として読めない値は 0 に倒す（画面に空欄を出さないため）。 */
const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `toNumber` と違い、NULL を 0 に倒さず null のまま返す（実費の平均で「まだ1件も無い」を隠さないため）。 */
const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
         FROM ai_calls
        WHERE purpose = 'select'`,
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
              SUM(CASE WHEN ai_used = 0 AND candidate_count > 0 THEN 1 ELSE 0 END) AS fell_back,
              SUM(CASE WHEN candidate_count = 0 THEN 1 ELSE 0 END) AS no_candidates
         FROM fetch_logs`,
    )
    .first();
  return {
    count: toNumber(row?.count),
    avgDurationMs: toMilliseconds(row?.avg_duration_ms),
    aiUsed: toNumber(row?.ai_used),
    fellBack: toNumber(row?.fell_back),
    noCandidates: toNumber(row?.no_candidates),
  };
};

/**
 * AI の実費の合計と回数（全部の用途）。`sinceIso` を渡すとその時刻以後だけ（今日＝日本時間の0時から・運営-08）。
 * 実費が残っていない呼び出し（倒れた呼び出しは NULL）は0円として足す。
 */
export const costTotals = async (db: Db, sinceIso: string | null = null): Promise<CostTotals> => {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd, COUNT(*) AS calls FROM ai_calls WHERE ?1 IS NULL OR at >= ?1`)
    .bind(sinceIso)
    .first();
  return { costUsd: toNumber(row?.cost_usd), calls: toNumber(row?.calls) };
};

/**
 * 確保の数と、自動で取り消された数（基準 33.4 の「確保のうち自動で取り消された割合」の分子）と、
 * もう終わった確保の数（その分母）。**まだ確保中の行は分母に入れない**——向かっている途中の客を
 * 「自動で取り消されなかった」側に数えると、昼のピークほど割合が低く見える（2026-09-25 監査の指摘 不具合-10）。
 *
 * **期限切れは保存しない**——`status='active'` で今が期限以後のもの、と時刻から導く
 * （設計書「確保の状態と、残りの数え方」: 6つの状態のうち期限切れだけは列に持たない）。
 * 期限を過ぎたあとに店が完了済みにしたものは `status='completed'` になるので、ここでは数えない
 * （客は来ていて、自動で取り消されたわけではないため）。
 *
 * 期限切れの条件は `repo/sqlFragments.ts` の `expiredReservationCondition`（TS 側の正本は `domain/reservation` の
 * `effectiveState`）。2026-09-25 監査の指摘 設計-10 で、ここに手で書いていた条件をそちらへ寄せた。
 */
export const reservationTotals = async (db: Db, nowIso: string): Promise<ReservationTotals> => {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ${expiredReservationCondition("reservations", "?1")} THEN 1 ELSE 0 END) AS expired,
              SUM(CASE WHEN ${activeReservationCondition("reservations", "?1")} THEN 0 ELSE 1 END) AS settled,
              SUM(CASE WHEN ${storeChosenCancelCondition("reservations")} THEN 1 ELSE 0 END) AS store_cancelled,
              SUM(CASE WHEN reservations.status = 'store_cancelled' AND reservations.cancel_reason = 'no_show' THEN 1 ELSE 0 END) AS no_show,
              SUM(CASE WHEN ${withdrawnCancelCondition("reservations")} THEN 1 ELSE 0 END) AS withdrawn
         FROM reservations`,
    )
    .bind(nowIso)
    .first();
  return { total: toNumber(row?.total), expired: toNumber(row?.expired), settled: toNumber(row?.settled), storeCancelled: toNumber(row?.store_cancelled), noShowCancelled: toNumber(row?.no_show), withdrawnCancelled: toNumber(row?.withdrawn) };
};

/**
 * `resolved_model` で括った表（タスク28・第4周の追記）。行が1つも無い（`ai_calls` が空）ときは
 * 空配列——SQL の `GROUP BY` は行が無いと1件も返さないので、ここで空を作る必要はない。
 *
 * `NULL` の `resolved_model` は SQLite の `GROUP BY` の中で1つの群にまとまる（`NULL = NULL` を
 * 使わず「同じ値」として括る規則）ので、実際に答えたモデルが分からない呼び出しは自然に1行へ集まる。
 *
 * `fallback_level >= 1` は「受け皿（別のモデル）が答えた」呼び出し（基準の言葉づかいは usecases 側の型コメント）。
 * `fallback_level` が `NULL`（OrcaRouter の応答ヘッダーが無かった）の行は `CASE` の条件が `NULL` になり
 * `ELSE` 側（0）へ落ちる——「受け皿かどうか分からない」を「受け皿だった」に混ぜない。
 */
export const byModelTotals = async (db: Db): Promise<ByModelRow[]> => {
  const result = await db
    .prepare(
      `SELECT resolved_model AS model,
              COUNT(*) AS count,
              AVG(cost_usd) AS avg_cost_usd,
              AVG(duration_ms) AS avg_duration_ms,
              AVG(CASE WHEN validation_failed = 1 THEN 1.0 ELSE 0.0 END) AS validation_failed_rate,
              AVG(CASE WHEN fallback_level >= 1 THEN 1.0 ELSE 0.0 END) AS fell_back_rate
         FROM ai_calls
        GROUP BY resolved_model`,
    )
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    model: (row.model as string | null) ?? null,
    count: toNumber(row.count),
    avgCostUsd: toNumberOrNull(row.avg_cost_usd),
    avgDurationMs: toMilliseconds(row.avg_duration_ms),
    validationFailedRate: toNumber(row.validation_failed_rate),
    fellBackRate: toNumber(row.fell_back_rate),
  }));
};

/**
 * 倒れた（受け皿が答えた）呼び出しの数（`fallback_level >= 1`）。モデル別の行を束ねて出す代わりに
 * 単独で持つ——応答の `fallbackCount` は全体の1つの数で、モデル別の行数とは数え方が違う
 * （画面「AI の実費と所要（モデル別）」の見出しの下に1行だけ出す・タスク28）。
 */
export const fallbackCount = async (db: Db): Promise<number> => {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE fallback_level >= 1`).first();
  return toNumber(row?.n);
};

/**
 * `purpose` で括った表（店の選定 select／紹介文の生成 pitch／紹介文の判定 pitch_eval・
 * migrations/0002_ai_call_purpose）。本人の指示「用途別の実費内訳」に応える集計で、実費は
 * **合計**（`SUM`）を返す——「その用途にいくら使ったか」であって「1回あたりいくらか」ではないため
 * （モデル別の `avgCostUsd` と役割が違う）。
 *
 * `purpose` 列は `NOT NULL DEFAULT 'select'` なので、この表に `purpose: null` の行は現れない。
 */
export const byPurposeTotals = async (db: Db): Promise<ByPurposeRow[]> => {
  const result = await db
    .prepare(
      `SELECT purpose,
              COUNT(*) AS count,
              COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
              AVG(duration_ms) AS avg_duration_ms
         FROM ai_calls
        GROUP BY purpose`,
    )
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    purpose: String(row.purpose),
    count: toNumber(row.count),
    totalCostUsd: toNumber(row.total_cost_usd),
    avgDurationMs: toMilliseconds(row.avg_duration_ms),
  }));
};
