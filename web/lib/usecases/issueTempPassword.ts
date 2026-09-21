// 【最終日】運営が発行する仮のパスワード（要件14の基準 14.10〜14.13）。
// システムはこの値をどこへも送らない——運営が画面で1回だけ見て、自分のメールで店へ伝える
// （本人選択・`04_v2の注文.md` の16節）。保存するのは元に戻せない形だけなので、後から出し直せない。
//
// 店の承認の状況（未承認・承認済み・止められている）によらず発行できる（基準 14.10 の補足）。

import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { findAccountByStoreId, updateAccountPassword } from "../repo/accounts";
import { deleteSessionsByAccount } from "../repo/sessions";
import { TEMP_PASSWORD_BYTES } from "../schemas/limits";
import { hashPassword } from "./credentials";

/** 発行した仮のパスワード（呼ぶ側の応答に1回だけ載せる値）。 */
export type IssuedTempPassword = { tempPassword: string };

/** その店のアカウントが無ければ null（入口が 404 に倒す）。 */
export const issueTempPassword = async (deps: Deps, storeId: string): Promise<IssuedTempPassword | null> => {
  const account = await findAccountByStoreId(deps.db, storeId);
  if (!account) return null;

  const tempPassword = tokenFromBytes(deps.rng.bytes(TEMP_PASSWORD_BYTES));
  const passwordHash = await hashPassword(deps, tempPassword);
  // 前のパスワードを効かなくする（基準 14.12）と同時に、次に入ったとき決め直させる印を立てる（基準 14.14）。
  await updateAccountPassword(deps.db, account.id, passwordHash, true);
  // 開いたままの画面が使えてしまわないよう、その店のセッションも全部切る（基準 14.12）。
  await deleteSessionsByAccount(deps.db, account.id);

  return { tempPassword };
};
