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
//    ——このファイルは時刻の比較を1つも持たないので、束縛する「今」も要らない。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** オファー1件ぶんの、公開した時刻と「取得の結果に出た回数」（基準 23.2・23.7）。 */
export type StoreOfferShownRow = { offerId: string; publishedAt: Date; shown: number };

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
  `SELECT o.id AS offer_id, o.published_at,` +
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
