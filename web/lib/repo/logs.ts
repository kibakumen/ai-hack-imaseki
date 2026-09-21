// 記録の表への書き込み（要件27・要件33）。**追加だけ**——この5つの表（fetch_logs・fetch_items・
// selections・reservation_events・ai_calls）に対して行を書き換える文も消す文もここには置かない
// （基準 27.7・構造の検査が見張る）。
//
// 個人データは持ち込まない（基準 27.6）——客を指すのは内部の番号（customers.id）だけで、
// 呼び名も電話番号もこの型に無い（設計書「客の識別子」）。
//
// ⚠️ 並行作業の申し送り: selections（タスク13）と reservation_events（タスク13）の追加も、
// このファイルに同じ形で足すこと（記録の入口を1つにするため）。
// → 2026-09-21 タスク13 が足した（このファイルの下半分）。**確保の状態が変わるたびに
//   `insertReservationEvent` を呼ぶ**のが基準 27.4 の唯一の置き場所。タスク15（客の取り消し）・
//   17（完了済み）・18（店の取り消し）・21（運営の停止）も、状態を変える1文が通った直後に
//   これを呼ぶこと（呼ばないと、自動で取り消された割合〔要件33〕が後から数えられない）。

import type { Deps } from "../ports";
import { activeReservationCondition } from "./sqlFragments";

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

// ---------- 選択と、確保の状態の変化（タスク13が足した・要件27の基準 27.3・27.4） ----------

/** 客が受け取った時に「どの取得のどの店が選ばれたか」を1件足す（基準 27.3）。 */
export type SelectionRecord = { id: string; fetchId: string; storeId: string; at: string };

/** 確保の状態が変わった時に「どの確保がどの状態へいつ変わったか」を1件足す（基準 27.4）。 */
export type ReservationEventRecord = { id: string; reservationId: string; status: string; at: string };

const INSERT_SELECTION = `INSERT INTO selections (id, fetch_id, store_id, at) VALUES (?1, ?2, ?3, ?4)`;

const INSERT_RESERVATION_EVENT = `INSERT INTO reservation_events (id, reservation_id, status, at) VALUES (?1, ?2, ?3, ?4)`;

export const insertSelection = async (db: Db, record: SelectionRecord): Promise<void> => {
  await db.prepare(INSERT_SELECTION).bind(record.id, record.fetchId, record.storeId, record.at).run();
};

export const insertReservationEvent = async (db: Db, record: ReservationEventRecord): Promise<void> => {
  await db.prepare(INSERT_RESERVATION_EVENT).bind(record.id, record.reservationId, record.status, record.at).run();
};

/** 期限切れの記録の番号は確保の番号から決める（同じ確保に2件付かないので `OR IGNORE` が効く）。 */
const EXPIRED_EVENT_ID_SUFFIX = ":expired";

/**
 * まだ記録の無い期限切れを足す（基準 27.4・設計書「期限切れの記録」）。
 *
 * 期限切れは書き込みを伴わない（基準 11.1・11.2）ので、状態の変化の記録は**読む側の手続きの先頭**で
 * 足す。客のホーム（`usecases/customerHome`）と店のホーム（`usecases/storeHome`）が呼ぶ。
 * 時刻は読んだ時ではなく**期限の時刻**（誰も読まない間は記録が遅れて付くが、中身は変わらない）。
 *
 * 番号を確保の番号から決めているので、何度呼んでも増えない（`OR IGNORE` が2件目を落とす）。
 * 行を書き換えず・消さずに冪等にするための形（基準 27.7）。
 */
export const insertExpiredEvents = async (db: Db, scope: { kind: "customer" | "store"; id: string }, nowIso: string): Promise<void> => {
  const where = scope.kind === "customer" ? "res.customer_id = ?1" : "res.store_id = ?1";
  await db
    .prepare(
      `INSERT OR IGNORE INTO reservation_events (id, reservation_id, status, at)` +
        ` SELECT res.id || ?3, res.id, 'expired', res.expires_at FROM reservations res` +
        ` WHERE ${where} AND res.status = 'active' AND res.expires_at <= ?2`,
    )
    .bind(scope.id, nowIso, EXPIRED_EVENT_ID_SUFFIX)
    .run();
};

/** 運営の停止で取り消された確保の記録の番号も、確保の番号から決める（下の注と同じ理由）。 */
const ADMIN_CANCELLED_EVENT_ID_SUFFIX = ":admin_cancelled";

/**
 * 運営が店を止めたときに取り消される確保の、状態の変化の記録（基準 27.4・タスク21）。
 *
 * ⚠️ **確保の状態を書き換える文より前**に `db.batch` の並びへ置く——まだ `status='active'` の行を
 * 選ぶ文なので、順が後ろだと1件も当たらない（`banStore` のまとまりの中でその順を守っている）。
 *
 * ⚠️ このファイルの言葉づかいの縛り: 構造の検査（基準 27.7）が**このファイル全体**から
 * 書き換え・削除の SQL の語を探すので、注記の中でもその語を書かない（「書き換える文」と呼ぶ）。
 *
 * 番号を確保の番号から決めているので、何度流れても増えない（`OR IGNORE` が2件目を落とす）。
 * 行を書き換えず・消さずに冪等にするための形（基準 27.7）。
 */
export const adminCancelledEventsStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO reservation_events (id, reservation_id, status, at)` +
        ` SELECT res.id || ?3, res.id, 'admin_cancelled', ?2 FROM reservations res` +
        ` WHERE res.store_id = ?1 AND ${activeReservationCondition("res", "?2")}`,
    )
    .bind(storeId, nowIso, ADMIN_CANCELLED_EVENT_ID_SUFFIX);
