// 【最終日】店が新しいパスワードを決める（要件14の基準 14.15・14.16）。
// 保存を置き換えた時点で、それまでの値（＝運営が知っている仮のパスワード）は効かなくなる。
// 範囲の検査は入口（changePasswordSchema）が済ませているので、ここは作り直して書くだけ。
//
// 今のセッションは切らない——決めた直後に画面から追い出さないため（AI判断）。切りたいのは
// 「運営が知っている値」であって、目の前の店ではない。

import type { Deps } from "../ports";
import { findAccountById, updateAccountPassword } from "../repo/accounts";
import type { ChangeOwnPasswordInput } from "../schemas/account";
import { hashPassword, verifyPassword } from "./credentials";

export const changePassword = async (deps: Deps, accountId: string, password: string): Promise<void> => {
  const passwordHash = await hashPassword(deps, password);
  // 決め直したので、求める印は下ろす（基準 14.16）。
  await updateAccountPassword(deps.db, accountId, passwordHash, false);
};

export type ChangeOwnPasswordResult = { ok: true } | { ok: false; kind: "password_mismatch" };

/**
 * 今のパスワードを確かめてから決め直す（2026-09-22 追加・運営の入口 POST /api/admin/password が使う）。
 * 運営には仮のパスワードの場面が無い（種データから作り直す・基準 14.8）ので、今の値を覚えている
 * 前提で再入力を求められる。店の入口（上の changePassword）は仮のパスワードで入った店のために
 * 求めない形のまま残す。
 */
export const changeOwnPassword = async (deps: Deps, accountId: string, input: ChangeOwnPasswordInput): Promise<ChangeOwnPasswordResult> => {
  const account = await findAccountById(deps.db, accountId);
  if (!account) return { ok: false, kind: "password_mismatch" };
  if (!(await verifyPassword(deps, account.passwordHash, input.currentPassword))) return { ok: false, kind: "password_mismatch" };
  await changePassword(deps, account.id, input.password);
  return { ok: true };
};
