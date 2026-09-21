// 記録の表への書き込み（要件27・要件33）。**追加だけ**——この5つの表（fetch_logs・fetch_items・
// selections・reservation_events・ai_calls）に対して行を書き換える文も消す文もここには置かない
// （基準 27.7・構造の検査が見張る）。
//
// 個人データは持ち込まない（基準 27.6）——客を指すのは内部の番号（customers.id）だけで、
// 呼び名も電話番号もこの型に無い（設計書「客の識別子」）。
//
// ⚠️ 並行作業の申し送り: selections（タスク13）と reservation_events（タスク13）の追加も、
// このファイルに同じ形で足すこと（記録の入口を1つにするため）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** 取得1回の記録（基準 27.1・33.2・33.3）。 */
export type FetchLogRecord = {
  id: string;
  customerId: string;
  originLat: number;
  originLng: number;
  party: number;
  /** その回の好みのジャンルを JSON の文字列にしたもの */
  genres: string;
  budgetMax: number | null;
  candidateCount: number;
  returnedCount: number;
  /** AI の選定を使ったか（倒れた取得は 0・基準 7.9） */
  aiUsed: 0 | 1;
  /** 起点が決まってから結果を返すまで（基準 33.2） */
  durationMs: number;
  at: string;
};

/** 返した店1件の記録（基準 27.2）。倒れた取得では `reason` を空で残す。 */
export type FetchItemRecord = {
  id: string;
  fetchId: string;
  storeId: string;
  rank: number;
  score: number;
  reason: string;
};

/** AI の呼び出し1回の記録（基準 33.1 ＋ OrcaRouter の応答ヘッダーの3列・設計書「OrcaRouter の使い方」）。 */
export type AiCallRecord = {
  id: string;
  fetchId: string;
  costUsd: number | null;
  durationMs: number;
  succeeded: 0 | 1;
  /** 呼び出しは成功したが出力が基準 7.3・7.4 の検査に落ちた */
  validationFailed: 0 | 1;
  resolvedModel: string | null;
  requestId: string | null;
  fallbackLevel: number | null;
  at: string;
};

const INSERT_FETCH_LOG = `
  INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
`;

const INSERT_FETCH_ITEM = `INSERT INTO fetch_items (id, fetch_id, store_id, rank, score, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

const INSERT_AI_CALL = `
  INSERT INTO ai_calls (id, fetch_id, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
`;

export const insertFetchLog = async (db: Db, log: FetchLogRecord): Promise<void> => {
  await db
    .prepare(INSERT_FETCH_LOG)
    .bind(log.id, log.customerId, log.originLat, log.originLng, log.party, log.genres, log.budgetMax, log.candidateCount, log.returnedCount, log.aiUsed, log.durationMs, log.at)
    .run();
};

/** 返した店をまとめて1度に書く（順位の並びは呼ぶ側が決めてから渡す）。 */
export const insertFetchItems = async (db: Db, items: readonly FetchItemRecord[]): Promise<void> => {
  if (items.length === 0) return;
  await db.batch(items.map((item) => db.prepare(INSERT_FETCH_ITEM).bind(item.id, item.fetchId, item.storeId, item.rank, item.score, item.reason)));
};

export const insertAiCall = async (db: Db, call: AiCallRecord): Promise<void> => {
  await db
    .prepare(INSERT_AI_CALL)
    .bind(call.id, call.fetchId, call.costUsd, call.durationMs, call.succeeded, call.validationFailed, call.resolvedModel, call.requestId, call.fallbackLevel, call.at)
    .run();
};
