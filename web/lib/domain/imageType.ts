// 店の雰囲気画像の種類を、先頭のバイト列（マジックナンバー）だけで決める（2026-09-25 監査の指摘 安全-19）。
// 画像は店の保存のときに1回だけ取り、置き場に置いて**自分のオリジンから配る**ので、相手の名乗った
// content-type を信じない——SVG や HTML を画像として配ると、中の script が自分のオリジンで動きうる。
// lib/domain は自分だけを読む（依存の向き）。営業許可書の見分け（domain/fileType）とは受け付ける種類が違うので分けた。

/** 受け付ける4種類（写真とロゴに使われる形。SVG は受け付けない）。 */
export type StoreImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const startsWith = (bytes: Uint8Array, magic: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + magic.length && magic.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

const SIGNATURES: ReadonlyArray<{ readonly test: (bytes: Uint8Array) => boolean; readonly type: StoreImageType }> = [
  { test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), type: "image/png" },
  { test: (b) => startsWith(b, [0xff, 0xd8, 0xff]), type: "image/jpeg" },
  { test: (b) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a")), type: "image/gif" },
  // "RIFF" <大きさ4バイト> "WEBP"
  { test: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8), type: "image/webp" },
];

/** 受け付ける4種類のどれかなら、その種類。どれでもなければ null。 */
export const detectImageType = (bytes: Uint8Array): StoreImageType | null => SIGNATURES.find((s) => s.test(bytes))?.type ?? null;
