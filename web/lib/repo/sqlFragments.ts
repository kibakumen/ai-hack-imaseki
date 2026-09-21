// SQL の条件のただ1つの置き場（設計書「ファイル構成の計画」: sqlFragments.ts が「公開中」
// 「枠を押さえている確保」の条件のただ1つの置き場）。同じ条件を2か所に書くと、片方だけ直って
// 黙ってずれる——このリポジトリが繰り返し踏んできた失敗なので、文字列の形で1か所に置く。
//
// TS 側の正本は domain/offer.ts（`isReceivable`）と domain/remaining.ts（`remainingOf`）で、
// ここはその SQL 版。2つが同じ答えを出すことを受け入れ検査 r05・r18 が突き合わせる。
//
// ⚠️ 2026-09-21 タスク13 で **断片を1組へ寄せた**。タスク9 が置いた関数の形（別名と置き場所を
//    引数で受ける）と、タスク11 が置いた定数の形（別名 `o`・`r`、置き場所 `?1` を決め打ち）の
//    2組が並んでいて、同じ意味の SQL が2つ在った。関数の形だけを残した理由は3つ:
//    ①定数の形は置き場所を `?1` に固定していて、受け取りの INSERT（束縛が9個）では使えない
//    ②`publishingOfferCondition` は単体の検査（sqlFragments.test.ts）が出力を固定している
//    ③別名を引数で受ける形は、定数の形を包める（逆はできない）。
//    撤去した名前: `offerLiveCondition`（= `publishingOfferCondition`）・`OPEN_OFFER_CONDITION`・
//    `HOLDS_SLOT_CONDITION`・`REMAINING_EXPRESSION`・`RECEIVABLE_CONDITION`。
//
// ⚠️ 「今」は必ず呼ぶ側が束縛した値を渡す（実行者への契約: SQLite の datetime('now') は使わない）。
//    偽の時計で日付をまたぐ検査が、SQL の側だけ本物の時計を見ていると通らなくなる。

/**
 * 公開中のオファーの条件（設計書「オファーの状態」）。まだ終わっておらず（`ended_at` が無い）、
 * 「何時まで」を過ぎていない（時刻ちょうどは終わり・基準 17.14）。
 *
 * @param alias 条件を当てる offers の表の別名（例: `"o"`）
 * @param nowPlaceholder 束縛した「今」（ISO 8601）の置き場所（例: `"?2"`）
 *
 * @example
 * `SELECT id FROM offers AS o WHERE o.store_id = ?1 AND ${publishingOfferCondition("o", "?2")}`
 */
export const publishingOfferCondition = (alias: string, nowPlaceholder: string): string =>
  `${alias}.ended_at IS NULL AND ${alias}.until_at > ${nowPlaceholder}`;

/**
 * 「確保中の確保」の条件（`status='active'` で、今が期限より前）。
 * TS 側の正本は `domain/reservation.ts` の `effectiveState`（`active` を返す場合）。
 *
 * ⚠️ 2026-09-21 タスク21 が足した。運営の停止は「確保中の確保」を3つの文で見る（送る相手を読む・
 * 記録を足す・状態を変える）ので、同じ条件を3か所に書かないためにここへ出した（基準 25.8）。
 * 下の `holdsSlotCondition` の1つ目もこれを通す（出る文字列は前と同じ）。
 */
export const activeReservationCondition = (reservationAlias: string, nowPlaceholder: string): string =>
  `${reservationAlias}.status = 'active' AND ${reservationAlias}.expires_at > ${nowPlaceholder}`;

/**
 * 枠を押さえている確保（設計書「確保の状態と、残りの数え方」の3つ）:
 * ①確保中（期限より前）②完了済みで holds_slot=1 ③店が取り消したもの（常に押さえたまま）。
 *
 * TS 側の正本は domain/remaining.ts の `holdsSlot`（同じ順・同じ条件）。
 */
export const holdsSlotCondition = (reservationAlias: string, nowPlaceholder: string): string =>
  `((${activeReservationCondition(reservationAlias, nowPlaceholder)})` +
  ` OR (${reservationAlias}.status = 'completed' AND ${reservationAlias}.holds_slot = 1)` +
  ` OR ${reservationAlias}.status = 'store_cancelled')`;

/**
 * 残り ＝ 募集する組数 − 枠を押さえている確保の数（要件18の基準 18.1〜18.13）。
 *
 * ⚠️ 中の副問い合わせは確保の表に別名 `r` を使う。埋め込む側の問い合わせで `r` を別の意味に
 *    使わないこと（受け取りの INSERT は、その客の確保中の確保を `ar` で見ている）。
 */
export const remainingExpression = (offerAlias: string, nowPlaceholder: string): string =>
  `(${offerAlias}.capacity - (SELECT COUNT(*) FROM reservations r` +
  ` WHERE r.offer_id = ${offerAlias}.id AND ${holdsSlotCondition("r", nowPlaceholder)}))`;

/**
 * 受け取れる状態（要件の用語の節: 公開中で残りが1以上）。domain/offer.ts の `isReceivable` と
 * 同じ答えを出す（突き合わせは受け入れ検査 r05・r18）。
 */
export const receivableCondition = (offerAlias: string, nowPlaceholder: string): string =>
  `((${publishingOfferCondition(offerAlias, nowPlaceholder)}) AND ${remainingExpression(offerAlias, nowPlaceholder)} >= 1)`;
