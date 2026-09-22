// 店の登録（要件12の基準 12.1・12.2／要件14の基準 14.8）。ログインを求めずに店と店のアカウントを
// 作り、未承認（pending）にする。登録の直後にもう一度ログインさせないため、セッションもここで配る
// （AI判断・タスク表）。役割は必ず store——入力に role が乗っていても見ない（基準 14.8）。

import type { Deps } from "../ports";
import { findAccountByEmail, insertAccountStatement, isEmailTakenError } from "../repo/accounts";
import { insertSessionStatement } from "../repo/sessions";
import { insertStoreStatement } from "../repo/stores";
import type { StoreRegisterInput } from "../schemas/account";
import { ID_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";
import { hashPassword, issueSession, type IssuedSession } from "./credentials";

export type RegisterStoreResult =
  | { ok: true; storeId: string; accountId: string; session: IssuedSession }
  | { ok: false; kind: "email_taken" };

// 「メールアドレスがもう在る」の見分け（isEmailTakenError）は repo/accounts へ移した
// （2026-09-22・メールアドレスの変更と共有するため）。判定の中身は変えていない。

export const registerStore = async (deps: Deps, input: StoreRegisterInput): Promise<RegisterStoreResult> => {
  // 店と運営を通して重複を見る（基準 12.2）。表の UNIQUE（COLLATE NOCASE）が最後の砦で、
  // ここは断りの語を返すための先回り。
  if (await findAccountByEmail(deps.db, input.email)) return { ok: false, kind: "email_taken" };

  const storeId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const accountId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const passwordHash = await hashPassword(deps, input.password);
  const session = await issueSession(deps);

  // 店・アカウント・セッションは1度に書く（途中で落ちて、店だけが残る形を作らない）。
  //
  // 上の先回りと、この書き込みの間に同じメールアドレスの登録が滑り込むことが在る。そのときは
  // `accounts.email` の UNIQUE（COLLATE NOCASE）が最後の砦として例外を投げるので、ここで受けて
  // 先回りと同じ断りへ倒す——受けないと、先に登録した人と後から登録した人で応答が 409 と 500 に
  // 割れる（2026-09-22 タスク25 が足した。タスク4の監査の指摘 F1）。
  try {
    await deps.db.batch([
      insertStoreStatement(deps.db, { id: storeId, name: input.name, createdAtIso: deps.clock.now().toISOString() }),
      insertAccountStatement(deps.db, { id: accountId, email: input.email, role: "store", storeId, passwordHash }),
      insertSessionStatement(deps.db, { tokenHash: session.tokenHash, accountId, expiresAtIso: session.expiresAtIso }),
    ]);
  } catch (error) {
    // メールアドレスの重複だけを断りへ倒す。ほかの落ち方（書き込みそのものの失敗）は握りつぶさず、
    // そのまま上へ返す＝入口が 500 として扱う。
    if (!isEmailTakenError(error)) throw error;
    return { ok: false, kind: "email_taken" };
  }

  return { ok: true, storeId, accountId, session };
};
