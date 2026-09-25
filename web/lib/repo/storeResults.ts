// 店の実績の読み取り（要件23）。lib/repo は D1 の SQL（設計書「ファイル構成の計画」）。
//
// ⚠️ ここは読むだけ。記録の5つの表（fetch_logs・fetch_items・selections・reservation_events・
//    ai_calls）へ UPDATE も DELETE も書かない（基準 27.7。実績の画面を開いても記録は1行も変わらない）。
//
// ⚠️ 「期限切れ」をここで数えない。確保の今の状態を導く正本は domain/reservation.ts の
//    `effectiveState` なので、この層は**保存されている status と期限の時刻をそのまま返し**、
//    数えるのは手続き（usecases/storeResults）に任せる。SQL 側に
//    `status = 'active' AND expires_at <= ?` を書き足すと、同じ規則が2か所に増えて黙ってずれる
//    （repo/adminMetrics.ts の注が「正本が出来たら寄せる」と言っているのと同じ話）。
//
// ⚠️ 確保の表の別名は **`res`** で固定する（`r` は使わない・repo/reservations.ts の注）。
//
// ⚠️ 「今」は必ず呼ぶ側が束縛した値を渡す（実行者への契約: SQLite の datetime('now') は使わない）
//    ——実績の読み取りは時刻の比較を1つも持たないので、束縛する「今」も要らない。「今日の動き」（下の
//    `listOfferTrendCounts`・店-15）だけは今までの幅で切るので、呼ぶ側が束縛した「今」を受ける。

import type { Deps } from "../ports";
import { parseStringList } from "./d1";

type Db = Deps["db"];

/**
 * オファー1件ぶんの、公開した時刻と「取得の結果に出た回数」（基準 23.2・23.7）と、そのオファーの条件
 * （2026-09-25 監査の指摘 店-13: 次に何組・何名まで・どのクーポンで出すかを決める材料として行に載せる）。
 */
export type StoreOfferShownRow = {
  offerId: string;
  publishedAt: Date;
  shown: number;
  /** 終わった（今の）配信数と、公開のときに入れた配信数 */
  capacity: number;
  initialCapacity: number;
  partyMax: number;
  untilAt: Date;
  /** 店が「何時まで」を入れたか（店-05） */
  untilSet: boolean;
  endedAt: Date | null;
  /** 保存されている終わった理由（`stopped`・`banned`・終わっていなければ null）。時刻で終わったかは手続きが導く */
  endReason: string | null;
  couponIds: string[];
};

/** 確保1件ぶんの、どのオファーのものかと状態を導くのに要る所だけ（数えるのは手続き側）。 */
export type OfferReservationStateRow = { offerId: string; status: string; expiresAt: Date };

/**
 * そのオファーが取得の結果に含まれて客に返った取得の回数（基準 23.2）。
 *
 * 取得の記録 `fetch_items(fetch_id, store_id, …)` は**どのオファーだったかを持たない**（表の列は
 * 骨組みのタスクで決まっており、実績のためだけに増やさない）。そこで**取得の時刻**からオファーを
 * 決める——1つの店が同時に持てる公開中のオファーは1つだけ（要件17の `offer_exists`）なので、
 * 取得の時刻が決まればオファーも決まる。当てる条件は4つで、どれも落とせない:
 *
 *   ①`fl.at >= o.published_at` … 公開より前の取得は入れない。**同じ時刻は入れる**——公開の直後に
 *     押した取得（受け入れ検査の場面はここに6回入る）を落とさないため
 *   ②`o.ended_at IS NULL OR fl.at <= o.ended_at` … 止めたあとの取得は入れない。**同じ時刻は入れる**
 *     ——「取得が返ってから止めた」の2つが同じ時刻に並ぶことが実際に起きる（運営が店を止めると
 *     その場でオファーも終わるので、公開直後に受け取った客の取得と `ended_at` が同じ値になった）
 *   ③`fl.at < o.until_at` … 「何時まで」を過ぎた取得は入れない（時刻ちょうどは終わり・基準 17.14。
 *     公開中の条件 `until_at > now`・repo/sqlFragments.ts と同じ切り方）
 *   ④より後に公開したオファーが、その取得の時刻までに既に出ていたなら、取得はそちらのもの
 *     ——②で同じ時刻を入れた分、止めた瞬間に公開し直した場合に2つのオファーへ二重に数えられる。
 *     「その時刻で最も新しいオファー」に決めて、1回の取得が高々1つのオファーに入るようにする
 *
 * 同じ取得が同じ店を2行持つことは無いが、数えるのは**取得の回数**なので `DISTINCT fetch_id` で括る。
 */
const OFFER_SHOWN_SQL =
  `SELECT o.id AS offer_id, o.published_at, o.capacity, o.initial_capacity, o.party_max, o.until_at, o.until_set, o.ended_at, o.end_reason, o.coupon_ids,` +
  ` (SELECT COUNT(DISTINCT fi.fetch_id) FROM fetch_items fi JOIN fetch_logs fl ON fl.id = fi.fetch_id` +
  `   WHERE fi.store_id = o.store_id` +
  `     AND fl.at >= o.published_at` +
  `     AND (o.ended_at IS NULL OR fl.at <= o.ended_at)` +
  `     AND fl.at < o.until_at` +
  `     AND NOT EXISTS (SELECT 1 FROM offers later WHERE later.store_id = o.store_id` +
  `       AND later.published_at > o.published_at AND later.published_at <= fl.at)) AS shown` +
  ` FROM offers o WHERE o.store_id = ?1` +
  ` ORDER BY o.published_at DESC, o.rowid DESC`;

/** その店のオファーを、公開した時刻の新しい順に全部（終わったオファーも出す・基準 23.7）。 */
export const listOfferShownCounts = async (db: Db, storeId: string): Promise<StoreOfferShownRow[]> => {
  const result = await db.prepare(OFFER_SHOWN_SQL).bind(storeId).all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    offerId: row.offer_id as string,
    publishedAt: new Date(row.published_at as string),
    shown: Number(row.shown ?? 0),
    capacity: Number(row.capacity ?? 0),
    initialCapacity: Number(row.initial_capacity ?? 0),
    partyMax: Number(row.party_max ?? 0),
    untilAt: new Date(row.until_at as string),
    untilSet: Number(row.until_set ?? 1) === 1,
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    endReason: (row.end_reason as string | null) ?? null,
    couponIds: parseStringList(row.coupon_ids),
  }));
};

const OFFER_RESERVATIONS_SQL = `SELECT res.offer_id, res.status, res.expires_at FROM reservations res WHERE res.store_id = ?1`;

/** その店の確保を全部（受け取られた数・完了済み・取り消しの元・基準 23.3〜23.6）。 */
export const listReservationStatesOfStore = async (db: Db, storeId: string): Promise<OfferReservationStateRow[]> => {
  const result = await db.prepare(OFFER_RESERVATIONS_SQL).bind(storeId).all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    offerId: row.offer_id as string,
    status: row.status as string,
    expiresAt: new Date(row.expires_at as string),
  }));
};

// ---------- 公開中のオファーの「今日の動き」（2026-09-25 監査の指摘 店-15） ----------

/**
 * 時刻の列を、起点からの区切りの番号にする式（整数の割り算・区切りの長さは秒で渡す）。
 * `strftime('%s', …)` は ISO 8601（ミリ秒と `Z` つき）を秒へ直す（SQLite の日時の関数・`julianday` の小数を避ける）。
 * ⚠️ 束縛した数は実数として渡ることがある（JS の数）ので、両方を INTEGER に直してから割る——実数のままだと
 *    割り算が小数を返し、区切りの番号が 0.4 のような値になって、どの区切りにも当たらない。
 */
const bucketOf = (column: string, originSecondsPlaceholder: string, bucketSecondsPlaceholder: string): string =>
  `((CAST(strftime('%s', ${column}) AS INTEGER) - CAST(${originSecondsPlaceholder} AS INTEGER)) / CAST(${bucketSecondsPlaceholder} AS INTEGER))`;

/**
 * 公開中のオファーが**結果に出た回数**を、区切りごとに数える（実績の `shown` と同じ数え方——その店が出た取得の
 * 回数・公開した時刻から今まで）。1つの店が同時に持てる公開中のオファーは1つだけなので、時刻で切れば
 * そのオファーのぶんになる（上の OFFER_SHOWN_SQL の注）。
 */
const SHOWN_BUCKETS_SQL =
  `SELECT ${bucketOf("fl.at", "?2", "?3")} AS bucket, COUNT(DISTINCT fi.fetch_id) AS n` +
  ` FROM fetch_items fi JOIN fetch_logs fl ON fl.id = fi.fetch_id` +
  ` WHERE fi.store_id = ?1 AND fl.at >= ?4 AND fl.at <= ?5` +
  ` GROUP BY bucket`;

/** 公開中のオファーで作られた確保（受け取り）を、区切りごとに数える（実績の `received` と同じ・基準 23.3）。 */
const RECEIVED_BUCKETS_SQL = `SELECT ${bucketOf("res.created_at", "?2", "?3")} AS bucket, COUNT(*) AS n FROM reservations res WHERE res.offer_id = ?1 GROUP BY bucket`;

export type TrendCounts = { shown: Array<{ bucket: number; count: number }>; received: Array<{ bucket: number; count: number }> };

const toBucketCounts = (result: { results?: unknown[] }): Array<{ bucket: number; count: number }> =>
  ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({ bucket: Number(row.bucket ?? 0), count: Number(row.n ?? 0) }));

/**
 * 公開中のオファーの、区切りごとの結果に出た回数と受け取り（店のホームが30秒ごとに読む）。
 * 起点（`originIso`）と区切りの長さ（`bucketMs`）は domain/offerTrend が決めて渡す。
 */
export const listOfferTrendCounts = async (
  db: Db,
  input: { storeId: string; offerId: string; publishedAtIso: string; nowIso: string; originIso: string; bucketMs: number },
): Promise<TrendCounts> => {
  const originSeconds = Math.floor(new Date(input.originIso).getTime() / 1000);
  const bucketSeconds = Math.floor(input.bucketMs / 1000);
  const [shown, received] = await Promise.all([
    db.prepare(SHOWN_BUCKETS_SQL).bind(input.storeId, originSeconds, bucketSeconds, input.publishedAtIso, input.nowIso).all(),
    db.prepare(RECEIVED_BUCKETS_SQL).bind(input.offerId, originSeconds, bucketSeconds).all(),
  ]);
  return { shown: toBucketCounts(shown), received: toBucketCounts(received) };
};
