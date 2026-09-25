// 【最終日】店と運営が新しいパスワードを決める（要件14の基準 14.15・14.16）。
// 保存を置き換えた時点で、それまでの値（＝運営が知っている仮のパスワード）は効かなくなる。
// 範囲の検査は入口（changePasswordSchema・changeOwnPasswordSchema）が済ませているので、ここは確かめて書くだけ。
//
// 決め直したら、**今の1本以外のセッションを全部切る**（2026-09-25 監査の指摘 安全-08）。乗っ取りに
// 気づいた持ち主がパスワードを変えても、相手の端末のセッションが残っていては追い出せないため。
// 今のセッションは切らない——決めた直後に画面から追い出さないため（AI判断）。

import type { Deps } from "../ports";
import { findAccountById, updateAccountPassword } from "../repo/accounts";
import { deleteOtherSessionsOfAccount } from "../repo/sessions";
import type { ChangeOwnPasswordInput, ChangePasswordInput } from "../schemas/account";
import { hashPassword, verifyPassword } from "./credentials";

/** 変更を頼んだ本人と、今の要求のセッション（切らずに残す1本）。 */
export type SessionOwner = { accountId: string; tokenHash: string };

/** 置き換えて、求める印を下ろし（基準 14.16）、今の1本以外のセッションを切る。 */
const replacePassword = async (deps: Deps, owner: SessionOwner, password: string): Promise<void> => {
  const passwordHash = await hashPassword(deps, password);
  await updateAccountPassword(deps.db, owner.accountId, passwordHash, false);
  await deleteOtherSessionsOfAccount(deps.db, owner.accountId, owner.tokenHash);
};

export type ChangeOwnPasswordResult = { ok: true } | { ok: false; kind: "password_mismatch" };

/**
 * 今のパスワードを確かめてから決め直す（2026-09-22 追加・運営の入口 POST /api/admin/password と、
 * 2026-09-25 からは仮のパスワードの直後でない店の入口 POST /api/store/password が使う）。
 */
export const changeOwnPassword = async (deps: Deps, owner: SessionOwner, input: ChangeOwnPasswordInput): Promise<ChangeOwnPasswordResult> => {
  const account = await findAccountById(deps.db, owner.accountId);
  if (!account) return { ok: false, kind: "password_mismatch" };
  if (!(await verifyPassword(deps, account.passwordHash, input.currentPassword))) return { ok: false, kind: "password_mismatch" };
  await replacePassword(deps, owner, input.password);
  return { ok: true };
};

export type ChangeStorePasswordResult = ChangeOwnPasswordResult | { ok: false; kind: "current_password_required" };

/**
 * 店の変更（安全-07）。今のパスワードを省けるのは、仮のパスワードで入った直後（mustChangePassword）の店だけ
 * ——その店は自分で決めた値を覚えていない（基準 14.14）。それ以外は運営と同じく今のパスワードを確かめる。
 * `mustChangePassword` は見分けの時点で表から読んだ値（入口の ctx）を渡す。
 */
export const changeStorePassword = async (
  deps: Deps,
  owner: SessionOwner & { mustChangePassword: boolean },
  input: ChangePasswordInput,
): Promise<ChangeStorePasswordResult> => {
  if (owner.mustChangePassword) {
    await replacePassword(deps, owner, input.password);
    return { ok: true };
  }
  if (input.currentPassword === undefined) return { ok: false, kind: "current_password_required" };
  return changeOwnPassword(deps, owner, { currentPassword: input.currentPassword, password: input.password });
};
