// パスワードとセッションの値を作る所（要件14の基準 14.1・14.4）。
// 乱数は差し替え口 Rng、PBKDF2 と SHA-256 は差し替え口 Hasher から受け取る（crypto を呼ぶのは
// lib/adapters だけ・依存の向き）。保存する値の形を組む・解く・比べるのは domain/password.ts。

import { buildPasswordRecord, constantTimeEqual, parsePasswordRecord, saltFromBytes } from "../domain/password";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { PASSWORD_ITERATIONS, PASSWORD_SALT_BYTES, SESSION_MAX_AGE_SECONDS, SESSION_TOKEN_BYTES } from "../schemas/limits";

/** `accounts.password_hash` に入れる1つの文字列を作る（塩は登録ごとに引き直す）。 */
export const hashPassword = async (deps: Deps, password: string): Promise<string> => {
  const salt = saltFromBytes(deps.rng.bytes(PASSWORD_SALT_BYTES));
  const hashB64 = await deps.hasher.derive(password, salt, PASSWORD_ITERATIONS);
  return buildPasswordRecord({ iterations: PASSWORD_ITERATIONS, salt, hashB64 });
};

/**
 * 保存された値と入れられたパスワードが同じか。保存された値が壊れていれば false
 * （合わない側へ倒す・フェイルクローズ）。
 */
export const verifyPassword = async (deps: Deps, record: string, password: string): Promise<boolean> => {
  const parsed = parsePasswordRecord(record);
  if (!parsed) return false;
  const hashB64 = await deps.hasher.derive(password, parsed.salt, parsed.iterations);
  return constantTimeEqual(hashB64, parsed.hashB64);
};

/** 端末に配る値（token）と、表に置く値（token_hash）と、切れる時刻。書き込みは呼ぶ側が行う。 */
export type IssuedSession = { token: string; tokenHash: string; expiresAtIso: string };

export const issueSession = async (deps: Deps): Promise<IssuedSession> => {
  const token = tokenFromBytes(deps.rng.bytes(SESSION_TOKEN_BYTES));
  const tokenHash = await deps.hasher.sha256Hex(token);
  const expiresAtIso = new Date(deps.clock.now().getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  return { token, tokenHash, expiresAtIso };
};
