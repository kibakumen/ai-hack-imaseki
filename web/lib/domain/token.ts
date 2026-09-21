// 客の識別子（要件2の基準2.2: 128ビット以上の乱数から作った22字以上の文字列）。
// 乱数そのものは差し替え口 Rng（adapters/webcrypto.ts の実物）が渡す。ここは渡されたバイト列を
// 文字列へ直すだけの純粋な関数（自分だけを読む・依存の向き）。base64url は data encoding であって
// Web Crypto API ではないので、lib/domain から使ってよい。

const BASE64URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 16バイト（128ビット）以上のバイト列を base64url の文字列へ直す（パディング無し）。 */
export const tokenFromBytes = (bytes: Uint8Array): string => {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL_CHARS[(value >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += BASE64URL_CHARS[(value << (6 - bits)) & 0x3f];
  return out;
};

/** 発行した識別子の形が正しいか（22字以上・base64url の文字だけ）。 */
export const isValidToken = (token: string): boolean => token.length >= 22 && /^[A-Za-z0-9_-]+$/.test(token);
