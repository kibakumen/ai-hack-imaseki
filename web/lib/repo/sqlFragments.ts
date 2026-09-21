// 「公開中のオファー」「枠を押さえている確保」「残りの数」の条件のただ1つの置き場
// （設計書「ファイル構成の計画」: `sqlFragments.ts` が条件のただ1つの置き場）。
// TS の側の正本は domain/offer.ts（`isReceivable`）と domain/remaining.ts で、ここはその SQL 版。
// 2つが同じ答えを出すことを、受け入れ検査 r05（タスク11のブロック）と r18 が突き合わせる。
//
// ⚠️ 並行作業の申し送り: このファイルは本来タスク9（オファーの公開・停止）の持ち場。取得（タスク11）が
// 先に要ったので、取得に要る3つだけを置いた。タスク9はここに足す形で使い、写しを別に作らないこと。
//
// 約束: どの断片も **束縛した「今」を `?1`** で受ける（SQLite の datetime('now') は使わない・実行者への契約）。
// オファーの別名は `o`、確保の別名は `r` で固定する（断片を埋め込む側がこの別名で FROM を書く）。

/**
 * 枠を押さえている確保（設計書「確保の状態と、残りの数え方」の3つ）。
 * 1. 確保中で、今が期限より前　2. 完了済みで枠を押さえたまま　3. 店が取り消したもの
 */
export const HOLDS_SLOT_CONDITION = `(
  (r.status = 'active' AND r.expires_at > ?1)
  OR (r.status = 'completed' AND r.holds_slot = 1)
  OR r.status = 'store_cancelled'
)`;

/** そのオファーの残り ＝ 募集する組数 − 枠を押さえている確保の数。 */
export const REMAINING_EXPRESSION = `(o.capacity - (SELECT COUNT(*) FROM reservations r WHERE r.offer_id = o.id AND ${HOLDS_SLOT_CONDITION}))`;

/** 公開中（`ended_at` が空で、今が `until_at` より前。設計書「オファーの状態」）。 */
export const OPEN_OFFER_CONDITION = `(o.ended_at IS NULL AND o.until_at > ?1)`;

/** 受け取れる状態（用語の節: 公開中で残りが1以上）。domain/offer.isReceivable と同じ答えを出す。 */
export const RECEIVABLE_CONDITION = `(${OPEN_OFFER_CONDITION} AND ${REMAINING_EXPRESSION} >= 1)`;
