// 【最終日】店が新しいパスワードを決める（要件14の基準 14.15・14.16）。
// 保存を置き換えた時点で、それまでの値（＝運営が知っている仮のパスワード）は効かなくなる。
// 範囲の検査は入口（changePasswordSchema）が済ませているので、ここは作り直して書くだけ。
//
// 今のセッションは切らない——決めた直後に画面から追い出さないため（AI判断）。切りたいのは
// 「運営が知っている値」であって、目の前の店ではない。

import type { Deps } from "../ports";
import { updateAccountPassword } from "../repo/accounts";
import { hashPassword } from "./credentials";

export const changePassword = async (deps: Deps, accountId: string, password: string): Promise<void> => {
  const passwordHash = await hashPassword(deps, password);
  // 決め直したので、求める印は下ろす（基準 14.16）。
  await updateAccountPassword(deps.db, accountId, passwordHash, false);
};
