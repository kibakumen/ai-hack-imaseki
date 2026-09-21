// 上げられたファイルの種類を、先頭のバイト列（マジックナンバー）だけで決める（要件13の基準 13.2・13.3）。
// 名前の拡張子も、要求が名乗った content-type も見ない——どちらも送り手が自由に書けるので、
// 「拡張子だけ偽ったファイル」を通してしまう（受け入れ検査 r13 の fake.pdf がその場合）。
// lib/domain は自分だけを読む（依存の向き）。

/** 受け付ける3種類（基準 13.2。写真を受け付けるのは本人選択）。 */
export type DetectedFileType = "application/pdf" | "image/jpeg" | "image/png";

/** 先頭のバイト列と、それが指す種類。長い印から順に見る（短い印の取り違えを避ける）。 */
const SIGNATURES: ReadonlyArray<{ readonly magic: readonly number[]; readonly type: DetectedFileType }> = [
  // "%PDF-"
  { magic: [0x25, 0x50, 0x44, 0x46, 0x2d], type: "application/pdf" },
  // PNG の8バイトの印
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: "image/png" },
  // JPEG（SOI ＋ 何かのマーカー）
  { magic: [0xff, 0xd8, 0xff], type: "image/jpeg" },
];

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/**
 * 受け付ける3種類のどれかなら、その種類。どれでもなければ null（呼ぶ側が `file_unsupported` で断る）。
 *
 * @param bytes ファイルの中身（先頭だけあれば足りる）
 */
export const detectFileType = (bytes: Uint8Array): DetectedFileType | null =>
  SIGNATURES.find((s) => startsWith(bytes, s.magic))?.type ?? null;
