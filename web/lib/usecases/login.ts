// ログインとログアウト（要件14の基準 14.1・14.2・14.9）。メールアドレスとパスワードの
// どちらが違っても同じ断り（login_failed）を返す——見つからなかったのか合わなかったのかを、
// 応答でも所要時間の差でも見せない（合わないときも同じだけ計算する）。

import type { Deps } from "../ports";
import { findAccountByEmail, type AccountRole } from "../repo/accounts";
import { deleteSession, insertSession } from "../repo/sessions";
import type { LoginInput } from "../schemas/account";
import { hashPassword, issueSession, verifyPassword, type IssuedSession } from "./credentials";

export type LoginResult =
  | { ok: true; accountId: string; role: AccountRole; storeId: string | null; mustChangePassword: boolean; session: IssuedSession }
  | { ok: false; kind: "login_failed" };

export const login = async (deps: Deps, input: LoginInput): Promise<LoginResult> => {
  const account = await findAccountByEmail(deps.db, input.email);
  if (!account) {
    // 見つからなくても同じ重さの計算をしてから断る（所要時間でアカウントの有無を教えない）。
    await hashPassword(deps, input.password);
    return { ok: false, kind: "login_failed" };
  }
  if (!(await verifyPassword(deps, account.passwordHash, input.password))) return { ok: false, kind: "login_failed" };

  const session = await issueSession(deps);
  await insertSession(deps.db, { tokenHash: session.tokenHash, accountId: account.id, expiresAtIso: session.expiresAtIso });
  return {
    ok: true,
    accountId: account.id,
    role: account.role,
    storeId: account.storeId,
    mustChangePassword: account.mustChangePassword,
    session,
  };
};

/** そのセッションを切る。無い値・でたらめな値でも、成立したことにする（在る無しを教えない）。 */
export const logout = async (deps: Deps, token: string | null): Promise<void> => {
  if (!token) return;
  await deleteSession(deps.db, await deps.hasher.sha256Hex(token));
};
