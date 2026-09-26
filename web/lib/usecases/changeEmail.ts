// ログインのメールアドレスの変更（2026-09-22 追加・店と運営の両方が使う）。
//
// このシステムは店へメールを送らない（要件12の補足・本人選択）ので、新しいアドレスに確認のリンクを
// 送って本人を確かめる手が無い。代わりに**今のパスワードの再入力**を求める——セッションの値を
// 盗まれただけでは、ログインの ID を書き換えて乗っ取ることができないようにするため。
// 確かめの無いまま変えられる形（半端な安全性）は選ばない。
//
// 重複の見方は店の登録（registerStore）と同じ2段: 先回りの引き当てで断りの語を返し、
// 滑り込みは表の UNIQUE（COLLATE NOCASE）を最後の砦にして同じ断りへ倒す。
//
// 変えたら、今の1本以外のセッションを全部切る（2026-09-25 監査の指摘 安全-08）——ログインの ID を
// 変えた本人の画面は残し、ほかの端末（乗っ取った側・置き忘れた端末）のセッションは止める。
// 別のアドレスへ変えたら「メールアドレスの確認」は未確認に戻る（2026-09-26 取り込み・要件14の基準 14.27）。
// 本人の確かめは今のパスワードのまま——確認メールは変更を止めない（何もブロックしない・基準 14.26）。
// 別のアドレスへ変えたら、前のアドレスを鍵に含む数え（端末の印・締め出しの数え）も同じまとまりで消す（2026-09-26 レビュー）。

import type { Deps } from "../ports";
import { changeOwnAccountEmail, findAccountByEmail, findAccountById, isEmailTakenError } from "../repo/accounts";
import { deleteOtherSessionsOfAccount } from "../repo/sessions";
import type { ChangeEmailInput } from "../schemas/account";
import type { SessionOwner } from "./changePassword";
import { verifyPassword } from "./credentials";

export type ChangeEmailResult = { ok: true } | { ok: false; kind: "password_mismatch" | "email_taken" };

export const changeEmail = async (deps: Deps, owner: SessionOwner, input: ChangeEmailInput): Promise<ChangeEmailResult> => {
  const account = await findAccountById(deps.db, owner.accountId);
  // セッションが指す本人が表に無い（消された直後など）。見分けの外の話なので、合わない側へ倒す。
  if (!account) return { ok: false, kind: "password_mismatch" };
  if (!(await verifyPassword(deps, account.passwordHash, input.currentPassword))) return { ok: false, kind: "password_mismatch" };

  // 同じ値への「変更」は何もせず成立させる（大小の違いだけの書き換えも、この引き当てが自分を返す）。
  const taken = await findAccountByEmail(deps.db, input.email);
  if (taken && taken.id !== account.id) return { ok: false, kind: "email_taken" };

  try {
    await changeOwnAccountEmail(deps.db, account.id, input.email, account.email);
  } catch (error) {
    if (!isEmailTakenError(error)) throw error;
    return { ok: false, kind: "email_taken" };
  }
  await deleteOtherSessionsOfAccount(deps.db, account.id, owner.tokenHash);
  return { ok: true };
};
