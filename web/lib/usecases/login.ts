// ログインとログアウト（要件14の基準 14.1・14.2・14.9）。メールアドレスとパスワードの
// どちらが違っても同じ断り（login_failed）を返す——見つからなかったのか合わなかったのかを、
// 応答でも所要時間の差でも見せない（合わないときも同じだけ計算する）。
//
// 通ったら、そのブラウザに端末の印を配る（2026-09-25 のレビュー・安全-10 の続き）。印を持つ要求は、
// ログインの接続元ごとの失敗の上限（パスワードスプレーを数える）を数えない——同じ回線の他人の失敗で、
// 店と運営が締め出されないように。印はそのアカウントにだけ効き、これだけでは何の操作もできない。

import { isLoginDeviceValue } from "../domain/loginDevice";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { findAccountByEmail, type AccountRole } from "../repo/accounts";
import { rememberLoginDevice } from "../repo/loginDevices";
import { deleteSession, insertSession } from "../repo/sessions";
import type { LoginInput } from "../schemas/account";
import { LOGIN_DEVICE_BYTES } from "../schemas/limits";
import { hashPassword, issueSession, verifyPassword, type IssuedSession } from "./credentials";

export type LoginResult =
  | { ok: true; accountId: string; role: AccountRole; storeId: string | null; mustChangePassword: boolean; session: IssuedSession; loginDevice: string }
  | { ok: false; kind: "login_failed" };

/**
 * 通ったブラウザの端末の印を書き、配る値を返す。ブラウザが形の合う印を持ってきたらそれを使い回す
 * （1つのブラウザで店と運営の両方に入っても、印の Cookie は1つで済む）。無ければ新しく作る。
 */
const rememberDevice = async (deps: Deps, email: string, presented: string | null): Promise<string> => {
  const loginDevice = isLoginDeviceValue(presented) ? presented : tokenFromBytes(deps.rng.bytes(LOGIN_DEVICE_BYTES));
  await rememberLoginDevice(deps.db, { email, tokenHash: await deps.hasher.sha256Hex(loginDevice), nowIso: deps.clock.now().toISOString() });
  return loginDevice;
};

/** `presentedDevice` はブラウザが持ってきた端末の印の Cookie の値（無ければ null）。 */
export const login = async (deps: Deps, input: LoginInput, presentedDevice: string | null = null): Promise<LoginResult> => {
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
    loginDevice: await rememberDevice(deps, input.email, presentedDevice),
  };
};

/** そのセッションを切る。無い値・でたらめな値でも、成立したことにする（在る無しを教えない）。 */
export const logout = async (deps: Deps, token: string | null): Promise<void> => {
  if (!token) return;
  await deleteSession(deps.db, await deps.hasher.sha256Hex(token));
};
