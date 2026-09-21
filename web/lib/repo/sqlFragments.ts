
// SQL の条件のただ1つの置き場（設計書「ファイル構成の計画」: sqlFragments.ts が「公開中」
// 「枠を押さえている確保」の条件のただ1つの置き場）。同じ条件を2か所に書くと、片方だけ直って
// 黙ってずれる——このリポジトリが繰り返し踏んできた失敗なので、文字列の形で1か所に置く。
//
// ⚠️ ここに在るのは「公開中」だけ（タスク6が置いた）。「枠を押さえている確保」と「残りの数」の
//    式は、タスク8・11・18 がこのファイルへ足す（受け取り・残り・公開中の変更が使う）。
//
// ⚠️ 「今」は必ず呼ぶ側が束縛した値を渡す（実行者への契約: SQLite の datetime('now') は使わない）。
//    偽の時計で日付をまたぐ検査が、SQL の側だけ本物の時計を見ていると通らなくなる。

/**
 * 公開中のオファーの条件。まだ終わっておらず（`ended_at` が無い）、「何時まで」を過ぎていない。
 *
 * @param alias 条件を当てる offers の表の別名（例: `"o"`）
 * @param nowPlaceholder 束縛した「今」（ISO 8601）の置き場所（例: `"?2"`）
 *
 * @example
 * `SELECT id FROM offers AS o WHERE o.store_id = ?1 AND ${publishingOfferCondition("o", "?2")}`
 */
export const publishingOfferCondition = (alias: string, nowPlaceholder: string): string =>
  `${alias}.ended_at IS NULL AND ${alias}.until_at > ${nowPlaceholder}`;

// 「公開中」「枠を押さえている確保」「残りの数」の SQL のただ1つの置き場
// （設計書「ファイル構成の計画」・「どの判断をどこに置くか」）。
// TS 側の正本は domain/offer.ts（受け取れる状態）と domain/remaining.ts（残りの数）で、
// 2つが同じ答えを出すことを受け入れ検査 r05・r18 が突き合わせる。
//
// ⚠️ 時刻は SQLite の `datetime('now')` を使わず、手続きが束縛した「今」を渡す
// （設計書「実行者への契約」の時刻の項）。呼ぶ側が置き場所（?1・?2…）を決める。

/** 公開中 ＝ 終わっていない かつ 今が「何時まで」より前（設計書「オファーの状態」）。 */
export const offerLiveCondition = (offerAlias: string, nowPlaceholder: string): string =>
  `${offerAlias}.ended_at IS NULL AND ${nowPlaceholder} < ${offerAlias}.until_at`;

/**
 * 枠を押さえている確保（設計書「確保の状態と、残りの数え方」の3つ）:
 * ①確保中（期限より前）②完了済みで holds_slot=1 ③店が取り消したもの（常に押さえたまま）。
 * ⚠️ 確保の側の列を書くのはタスク13以降。ここは読む側の条件だけを持つ。
 */
export const holdsSlotCondition = (reservationAlias: string, nowPlaceholder: string): string =>
  `((${reservationAlias}.status = 'active' AND ${nowPlaceholder} < ${reservationAlias}.expires_at)` +
  ` OR (${reservationAlias}.status = 'completed' AND ${reservationAlias}.holds_slot = 1)` +
  ` OR ${reservationAlias}.status = 'store_cancelled')`;

/** 残り ＝ 募集する組数 − 枠を押さえている確保の数（要件18の基準 18.1〜18.13）。 */
export const remainingExpression = (offerAlias: string, nowPlaceholder: string): string =>
  `(${offerAlias}.capacity - (SELECT COUNT(*) FROM reservations r` +
  ` WHERE r.offer_id = ${offerAlias}.id AND ${holdsSlotCondition("r", nowPlaceholder)}))`;
