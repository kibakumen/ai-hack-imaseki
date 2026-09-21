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
