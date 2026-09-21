// 画面に日付と時刻を日本時間で出すためだけの道具（表示の計算）。**画面の時刻の書き方はここが唯一の場所**。
// 判断の正本は lib/domain だが、部品は lib/domain のうち texts.ts しか値として読めない
// （設計書「依存の向き」）ので、表示だけのこの計算を画面の側に置く。
// 場所は日本の中だけ（要件3の基準 3.6）なので、時差は定数で固定する。
//
// 2026-09-22 タスク25 の「揃え」で `components/store/jstTime.ts`（"HH:MM" と "M/D HH:MM"）を
// ここへ寄せて消した。日付つきの書き方は **"YYYY/M/D HH:MM" の1つだけ**にする
// ——実績の表（要件23）・最近行った店（要件26）・通報の一覧（要件25）が別々の書き方で
// 同じ意味の値を出していたため。年を出しても、区切りが入るのでコードと見間違える8桁の数字には
// ならない（基準 26.17 の行の検査）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, "0");

/** ISO 8601 の値を日本時間へ寄せた時点。読めない値は null（呼ぶ側が空文字へ倒す）。 */
const jstOf = (iso: string): Date | null => {
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? null : new Date(at + JST_OFFSET_MS);
};

/** ISO 8601 の時刻を、日本時間の "HH:MM" にする。読めない値は空文字（表示を止めない）。 */
export const timeInJst = (iso: string): string => {
  const local = jstOf(iso);
  return local ? `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}` : "";
};

/** ISO 8601 の時刻を、日本時間の "YYYY/M/D HH:MM" にする。読めない値は空文字（表示を止めない）。 */
export const dateTimeInJst = (iso: string): string => {
  const local = jstOf(iso);
  return local ? `${local.getUTCFullYear()}/${local.getUTCMonth() + 1}/${local.getUTCDate()} ${timeInJst(iso)}` : "";
};
