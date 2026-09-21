// 「公開中」「枠を押さえている確保」の条件のただ1つの置き場（設計書「ファイル構成の計画」
// 「どの判断をどこに置くか」）。TS の側の同じ判断は domain/offer.ts・domain/remaining.ts が持ち、
// 2つの書き方が同じ答えを出すことを突き合わせの検査が見る（タスク10以降）。
//
// ⚠️ タスク8（運営の一覧の「オファー公開中」の絞り込みと、店を止めたときのオファーの終わり）が
// 最初に要ったので、ここでは公開中の条件だけを置いた。枠を押さえている確保の条件は、それを要る
// タスク（9・13・18）がこのファイルへ足す。

/**
 * 公開中のオファーの条件（設計書「オファーの状態」: `ended_at` が空で、今が `until_at` より前）。
 * 残りが0のオファーも「公開中」に含む（要件24の基準 24.4 の補足）。
 *
 * @param alias `offers` の表の別名（例 "o"）
 * @param nowParam 束縛した「今」（ISO 8601 の文字列）を指す置き場所（例 "?1"）。
 *                 SQLite の `datetime('now')` は使わない（設計書「実行者への契約」の時刻の項）
 */
export const publishingOfferWhere = (alias: string, nowParam: string): string =>
  `${alias}.ended_at IS NULL AND ${alias}.until_at > ${nowParam}`;
