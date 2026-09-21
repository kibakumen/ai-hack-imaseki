// 時刻を日本時間の "HH:MM" にして出すためだけの道具（店の画面が置いた。
// 2026-09-21 タスク14 から客の確保中の表示〔期限の時刻・基準 9.1〕も同じものを使う）。
// 判断の正本は lib/domain/until.ts だが、部品は lib/domain のうち texts.ts しか値として読めない
// （設計書「依存の向き」）ので、表示だけのこの計算を画面の側に置く（AI判断）。
// 場所は日本の中だけ（要件3の基準 3.6）なので、時差は定数で固定する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 8601 の時刻を、日本時間の "HH:MM" にする。読めない値は空文字（表示を止めない）。 */
export const timeInJst = (iso: string): string => {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const local = new Date(at + JST_OFFSET_MS);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

/**
 * ISO 8601 の時刻を、日本時間の "M/D HH:MM" にする。読めない値は空文字（表示を止めない）。
 *
 * 実績の表（要件23）は**終わったオファーも並べる**ので、日をまたいだ2件が同じ "HH:MM" に
 * 見えないように日付まで出す（2026-09-21 タスク22 が足した。既存の関数は触っていない）。
 */
export const dateTimeInJst = (iso: string): string => {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const local = new Date(at + JST_OFFSET_MS);
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()} ${timeInJst(iso)}`;
};
