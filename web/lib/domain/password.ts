// 保存するパスワードの値（方式・繰り返しの回数・塩・ハッシュを1つの文字列にしたもの）を
// 組む・解く・比べる、ただ1つの置き場（設計書「依存の向き」の注）。crypto を直接呼ばない
// （PBKDF2 の実物は adapters/webcrypto.ts の Hasher）。自分だけを読む（依存の向き）。

export const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const SEPARATOR = "$";

export type PasswordRecord = {
  algorithm: typeof PASSWORD_ALGORITHM;
  iterations: number;
  /** 塩（base64）。受け入れ検査（14.4）がこの名前で読む */
  salt: string;
  hashB64: string;
};

/** Rng がくれたバイト列を、塩として保存できる base64 の文字列にする（乱数そのものは作らない）。 */
export const saltFromBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/** 保存する1つの文字列を組む（`accounts.password_hash` に入れる値）。 */
export const buildPasswordRecord = (input: { iterations: number; salt: string; hashB64: string }): string =>
  [PASSWORD_ALGORITHM, String(input.iterations), input.salt, input.hashB64].join(SEPARATOR);

/** 保存された1つの文字列を解く。形が違えば null（壊れた値・古い方式）。 */
export const parsePasswordRecord = (record: string): PasswordRecord | null => {
  const parts = record.split(SEPARATOR);
  if (parts.length !== 4) return null;
  const [algorithm, iterationsText, salt, hashB64] = parts;
  if (algorithm !== PASSWORD_ALGORITHM) return null;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  if (!salt || !hashB64) return null;
  return { algorithm, iterations, salt, hashB64 };
};

/** 2つの文字列（同じ塩・同じ回数で導いたハッシュどうし）を、長さの違いを早期に返さない形で比べる。 */
export const constantTimeEqual = (a: string, b: string): boolean => {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};
