// 店の登録（要件12の基準 12.1・12.2／要件14の基準 14.8）。ログインを求めずに店と店のアカウントを
// 作り、未承認（pending）にする。登録の直後にもう一度ログインさせないため、セッションもここで配る
// （AI判断・タスク表）。役割は必ず store——入力に role が乗っていても見ない（基準 14.8）。

import type { Deps } from "../ports";
import { findAccountByEmail, insertAccountStatement } from "../repo/accounts";
import { insertSessionStatement } from "../repo/sessions";
import { insertStoreStatement } from "../repo/stores";
import type { StoreRegisterInput } from "../schemas/account";
import { ID_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";
import { hashPassword, issueSession, type IssuedSession } from "./credentials";

export type RegisterStoreResult =
  | { ok: true; storeId: string; accountId: string; session: IssuedSession }
  | { ok: false; kind: "email_taken" };

export const registerStore = async (deps: Deps, input: StoreRegisterInput): Promise<RegisterStoreResult> => {
  // 店と運営を通して重複を見る（基準 12.2）。表の UNIQUE（COLLATE NOCASE）が最後の砦で、
  // ここは断りの語を返すための先回り。
  if (await findAccountByEmail(deps.db, input.email)) return { ok: false, kind: "email_taken" };

  const storeId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const accountId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const passwordHash = await hashPassword(deps, input.password);
  const session = await issueSession(deps);

  // 店・アカウント・セッションは1度に書く（途中で落ちて、店だけが残る形を作らない）。
  await deps.db.batch([
    insertStoreStatement(deps.db, { id: storeId, name: input.name, createdAtIso: deps.clock.now().toISOString() }),
    insertAccountStatement(deps.db, { id: accountId, email: input.email, role: "store", storeId, passwordHash }),
    insertSessionStatement(deps.db, { tokenHash: session.tokenHash, accountId, expiresAtIso: session.expiresAtIso }),
  ]);

  return { ok: true, storeId, accountId, session };
};
