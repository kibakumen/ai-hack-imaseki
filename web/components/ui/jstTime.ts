// 画面に日付と時刻を日本時間で出すためだけの道具（表示の計算）。
// 判断の正本は lib/domain だが、部品は lib/domain のうち texts.ts しか値として読めない
// （設計書「依存の向き」）ので、表示だけのこの計算を画面の側に置く。
// 場所は日本の中だけ（要件3の基準 3.6）なので、時差は定数で固定する。
//
// ⚠️ `components/store/jstTime.ts` に "HH:MM" だけを出す `timeInJst` が在る（タスク9が置いた）。
//    役割が重なるので、タスク25 の「揃え」でどちらかへ寄せること（2026-09-21・タスク23 の申し送り）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * ISO 8601 の時刻を、日本時間の "YYYY/M/D HH:MM" にする。読めない値は空文字（表示を止めない）。
 * 年をそのまま続けず区切るので、コードと見間違える8桁の数字にはならない（基準 26.17 の行の検査）。
 */
export const dateTimeInJst = (iso: string): string => {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const local = new Date(at + JST_OFFSET_MS);
  return `${local.getUTCFullYear()}/${local.getUTCMonth() + 1}/${local.getUTCDate()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};
