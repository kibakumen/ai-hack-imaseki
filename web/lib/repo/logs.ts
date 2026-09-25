// 記録の表への書き込み（要件27・要件33）。**追加だけ**——この5つの表（fetch_logs・fetch_items・
// selections・reservation_events・ai_calls）に対して行を書き換える文も消す文もここには置かない
// （基準 27.7・構造の検査が見張る）。
//
// 個人データは持ち込まない（基準 27.6）——客を指すのは内部の番号（customers.id）だけで、
// 呼び名も電話番号もこの型に無い（設計書「客の識別子」）。
//
// ⚠️ 並行作業の申し送り: selections（タスク13）と reservation_events（タスク13）の追加も、
// このファイルに同じ形で足すこと（記録の入口を1つにするため）。
// → 2026-09-21 タスク13 が足した（このファイルの下半分）。
// → 2026-09-25 監査の指摘 不具合-16 で、選択と状態の変化の記録は**文（statement）を返す形**にした。
//   状態を変える1文と同じ `db.batch` の並びに入れて一度に書く（repo/reservations が組む）——別々の往復で
//   書いていた頃は、状態を変えたあとで落ちると記録だけが欠け、選ばれた店（基準 27.3）が少なく数えられた。
//   記録の文は「状態が本当にその値へ変わったとき」だけ行を足す条件つきの追加なので、状態の文が当たらな
//   かったまとまりでは何も足さない。

import type { Deps } from "../ports";
import type { D1PreparedStatement } from "./d1";
import { activeReservationCondition, expiredReservationCondition } from "./sqlFragments";

type Db = Deps["db"];

/** 取得1回の記録（基準 27.1・33.2・33.3）。 */
export type FetchLogRecord = {
  id: string;
  customerId: string;
  originLat: number;
  originLng: number;
  /**
   * 起点の出どころ（migration 0009・設計-20）。'place' は客が打った場所の文字を Google で位置に直したもの——
   * Google の利用条件で30日を過ぎたら丸める（usecases/googleUpkeep）。'device' は端末の現在地で、丸めない。
   */
  originSource: "place" | "device";
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

/**
 * AI の呼び出しの用途（migrations/0002）。用途別のコスト内訳を数えるための列で、
 * 店の選定（select）・紹介文の生成（pitch）・紹介文の検査（pitch_eval）の3つ。
 */
export type AiCallPurpose = "select" | "pitch" | "pitch_eval";

/** AI の呼び出し1回の記録（基準 33.1 ＋ OrcaRouter の応答ヘッダーの3列・設計書「OrcaRouter の使い方」）。 */
export type AiCallRecord = {
  id: string;
  fetchId: string;
  purpose: AiCallPurpose;
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
  INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_source)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
`;

const INSERT_FETCH_ITEM = `INSERT INTO fetch_items (id, fetch_id, store_id, rank, score, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

const INSERT_AI_CALL = `
  INSERT INTO ai_calls (id, fetch_id, purpose, cost_usd, duration_ms, succeeded, validation_failed, resolved_model, request_id, fallback_level, at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
`;

/** 取得1回の記録を足す文（まとまり `db.batch` に並べるため、文のまま返す）。 */
export const fetchLogStatement = (db: Db, log: FetchLogRecord): D1PreparedStatement =>
  db
    .prepare(INSERT_FETCH_LOG)
    .bind(log.id, log.customerId, log.originLat, log.originLng, log.party, log.genres, log.budgetMax, log.candidateCount, log.returnedCount, log.aiUsed, log.durationMs, log.at, log.originSource);

/** 返した店1件の記録を足す文。 */
export const fetchItemStatement = (db: Db, item: FetchItemRecord): D1PreparedStatement =>
  db.prepare(INSERT_FETCH_ITEM).bind(item.id, item.fetchId, item.storeId, item.rank, item.score, item.reason);

/** AI の呼び出し1回の記録を足す文。 */
export const aiCallStatement = (db: Db, call: AiCallRecord): D1PreparedStatement =>
  db
    .prepare(INSERT_AI_CALL)
    .bind(call.id, call.fetchId, call.purpose, call.costUsd, call.durationMs, call.succeeded, call.validationFailed, call.resolvedModel, call.requestId, call.fallbackLevel, call.at);

/**
 * 取得1回ぶんの記録（取得・AI の選定の呼び出し・返した店）を**1回の往復**で足す（2026-09-25 監査の指摘 不具合-08）。
 * 以前は3回を順に待ってから最初のカードを送っていた。並びは fetch_logs → ai_calls → fetch_items
 * （後の2つが取得の記録を指しているため）。1つのまとまりなので、途中で落ちたら全部戻る。
 */
export const insertFetchRecord = async (db: Db, record: { log: FetchLogRecord; aiCall: AiCallRecord | null; items: readonly FetchItemRecord[] }): Promise<void> => {
  await db.batch([fetchLogStatement(db, record.log), ...(record.aiCall ? [aiCallStatement(db, record.aiCall)] : []), ...record.items.map((item) => fetchItemStatement(db, item))]);
};

export const insertAiCall = async (db: Db, call: AiCallRecord): Promise<void> => {
  await aiCallStatement(db, call).run();
};

// ---------- 選択と、確保の状態の変化（タスク13が足した・要件27の基準 27.3・27.4） ----------

/**
 * 客が受け取った時に「どの取得のどの店が選ばれたか」を1件足す文（基準 27.3）。
 *
 * 取得と店は**確保の行から写す**——受け取りの1文が確保を作らなかったまとまりでは、行が無いので何も足さない
 * （不具合-16。受け取りの文と同じ `db.batch` に並べる）。
 */
export const selectionStatement = (db: Db, record: { id: string; reservationId: string; at: string }): D1PreparedStatement =>
  db
    .prepare(`INSERT INTO selections (id, fetch_id, store_id, at) SELECT ?1, res.fetch_id, res.store_id, ?3 FROM reservations res WHERE res.id = ?2`)
    .bind(record.id, record.reservationId, record.at);

/** 状態の変化の記録の番号は「確保の番号:状態」（同じ確保が同じ状態へ2度変わることは無いので、`OR IGNORE` で2件目を落とせる）。 */
const EVENT_ID_SEPARATOR = ":";

/**
 * 確保の状態が変わった時に「どの確保がどの状態へいつ変わったか」を1件足す文（基準 27.4）。
 *
 * **その確保が今この時刻にこの状態へ変わっていたときだけ**足す（`status` と `status_at` を見る）。状態を
 * 変える文と同じ `db.batch` の並びで、その**後ろ**に置く——状態の文が当たらなかった（同時に来た操作に
 * 負けた）まとまりでは、何も足さない（不具合-16）。番号を確保と状態から決めるので、同じ時刻に2つの要求が
 * 同じ状態へ変えようとしても記録は1件に留まる。
 */
export const reservationEventStatement = (db: Db, record: { reservationId: string; status: string; at: string }): D1PreparedStatement =>
  db
    .prepare(
      `INSERT OR IGNORE INTO reservation_events (id, reservation_id, status, at)` +
        ` SELECT res.id || ?4 || ?2, res.id, ?2, ?3 FROM reservations res WHERE res.id = ?1 AND res.status = ?2 AND res.status_at = ?3`,
    )
    .bind(record.reservationId, record.status, record.at, EVENT_ID_SEPARATOR);

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
 *
 * ⚠️ **店の側は読む幅に下限を置く**（2026-09-25 監査の指摘 設計-08）。期限切れの確保は状態の列が
 *    `active` のまま残り続けるので、下限が無いと店のホームを開くたびに（30秒ごと）その店の全期間の
 *    期限切れを読み直していた。店の側は `sinceIso`（店の一覧が読む幅と同じ・受け取った時刻で比べる）より
 *    前の確保を見ない。客の側は下限を置かない——その客が次にホームを開けば、店が見落とした古い期限切れも
 *    そこで足される（客の確保は索引で引けて、件数も客1人ぶんしかない）。
 */
export const insertExpiredEvents = async (
  db: Db,
  scope: { kind: "customer"; id: string } | { kind: "store"; id: string; sinceIso: string },
  nowIso: string,
): Promise<void> => {
  const where = scope.kind === "customer" ? "res.customer_id = ?1" : "res.store_id = ?1 AND res.status_at >= ?4";
  const statement = db.prepare(
    `INSERT OR IGNORE INTO reservation_events (id, reservation_id, status, at)` +
      ` SELECT res.id || ?3, res.id, 'expired', res.expires_at FROM reservations res` +
      ` WHERE ${where} AND ${expiredReservationCondition("res", "?2")}`,
  );
  await (scope.kind === "customer" ? statement.bind(scope.id, nowIso, EXPIRED_EVENT_ID_SUFFIX) : statement.bind(scope.id, nowIso, EXPIRED_EVENT_ID_SUFFIX, scope.sinceIso)).run();
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
