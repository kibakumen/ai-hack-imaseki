// 受け取りごとに発行する8桁のコード（要件8・要件20）。乱数そのものは差し替え口 Rng が渡す。
// ここは渡されたバイト列を8桁の数字の文字列へ直すだけの純粋な関数（自分だけを読む・依存の向き）。

/** 8桁の数字1つの通り数（1億。基準 8.3 の「範囲」は AI判断）。 */
const CODE_SPACE = 100_000_000;

/** 4バイト以上のバイト列から、先頭4バイトを符号無し32ビット整数として読み、8桁（0埋め）にする。 */
export const codeFromBytes = (bytes: Uint8Array): string => {
  let n = 0;
  for (let i = 0; i < 4; i++) n = n * 256 + (bytes[i] ?? 0);
  return String(n % CODE_SPACE).padStart(8, "0");
};

/**
 * コードの隣の値（引き直しの最後の手段・タスク13が足した）。
 *
 * 乱数が同じ値を返し続ける場合（検査の偽の乱数・差し替え口の壊れた実装）でも、必ず空きへ進める
 * ようにするためのもの。ふつうは引き直し（新しい乱数）で足りる——8桁は1億通りで、大会の期間の
 * 発行数に対して重なる見込みはほぼ無い（要件8の補足）。
 */
export const nextCode = (code: string, step: number): string => String((Number(code) + step) % CODE_SPACE).padStart(8, "0");
