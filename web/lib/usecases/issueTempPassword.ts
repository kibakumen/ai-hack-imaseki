// 【最終日】運営が発行する仮のパスワード（要件14の基準 14.10〜14.13）。
// システムはこの値をどこへも送らない——運営が画面で1回だけ見て、自分のメールで店へ伝える
// （本人選択・`04_v2の注文.md` の16節）。保存するのは元に戻せない形だけなので、後から出し直せない。
//
// 店の承認の状況（未承認・承認済み・止められている）によらず発行できる（基準 14.10 の補足）。
//
// 2026-09-25 監査の指摘 運営-01 の案3: 発行の前に**運営自身の今のパスワード**を確かめる。仮のパスワードで
// 店として入れば客の電話番号を読めるので、運営のセッションを盗まれただけで店を乗っ取れないようにする。
// 発行したことは「誰が・いつ」つきで記録に残す（仮のパスワードの値は残さない）。

import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { insertAdminAction } from "../repo/adminActions";
import { findAccountById, findAccountByStoreId, updateAccountPassword } from "../repo/accounts";
import { deleteSessionsByAccount } from "../repo/sessions";
import { TEMP_PASSWORD_BYTES } from "../schemas/limits";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { hashPassword, verifyPassword } from "./credentials";

export type IssueTempPasswordResult =
  /** 発行した仮のパスワード（呼ぶ側の応答に1回だけ載せる値） */
  | { ok: true; tempPassword: string }
  /** 運営自身の今のパスワードが合わない（403・password_mismatch）。店の側は1文字も変えない */
  | { ok: false; kind: "password_mismatch" }
  /** その店のアカウントが無い（入口が 404 に倒す） */
  | { ok: false; kind: "not_found" };

/** 運営の今のパスワードが合うか。先に確かめる——合わない要求には、店の在る無しも教えない。 */
const confirmsAdmin = async (deps: Deps, actor: AdminActor, currentPassword: string): Promise<boolean> => {
  const admin = await findAccountById(deps.db, actor.accountId);
  return admin !== null && (await verifyPassword(deps, admin.passwordHash, currentPassword));
};

export const issueTempPassword = async (deps: Deps, storeId: string, actor: AdminActor, currentPassword: string): Promise<IssueTempPasswordResult> => {
  if (!(await confirmsAdmin(deps, actor, currentPassword))) return { ok: false, kind: "password_mismatch" };

  const account = await findAccountByStoreId(deps.db, storeId);
  if (!account) return { ok: false, kind: "not_found" };

  const tempPassword = tokenFromBytes(deps.rng.bytes(TEMP_PASSWORD_BYTES));
  const passwordHash = await hashPassword(deps, tempPassword);
  // 前のパスワードを効かなくする（基準 14.12）と同時に、次に入ったとき決め直させる印を立てる（基準 14.14）。
  await updateAccountPassword(deps.db, account.id, passwordHash, true);
  // 開いたままの画面が使えてしまわないよう、その店のセッションも全部切る（基準 14.12）。
  await deleteSessionsByAccount(deps.db, account.id);
  await insertAdminAction(deps.db, newAdminAction(deps, actor, "temp_password", storeId));
  deps.logger.log({ event: "issue_temp_password", id: storeId, actor: actor.accountId });

  return { ok: true, tempPassword };
};
