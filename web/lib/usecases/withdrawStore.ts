// 店の退会（2026-09-26 本人発案・監査の指摘 安全-20 の残り。要件13の基準 13.13〜13.20）。
//
// 本人が決めた範囲:
//   消す … 店のアカウント（とそのセッション）・店舗情報・営業許可書（置き場のファイルと表の鍵）・クーポン・店の画像。
//          公開中のオファーは終わらせる
//   残す … 過去の確保・通報・運営の操作の記録・取得の記録。店の行は番号だけ残し、店名を「退会した店」に伏せる（repo/storeWithdrawal）
//   向かっている客 … 運営が店を止めたとき（usecases/banStore）と同じく、確保を取り消して購読のある客へ知らせる
//
// 取り返しがつかないので、今のパスワードの再入力を求める（店のパスワードの変更・メールアドレスの変更と同じ確かめ・安全-07）。
// 総当たりは連打の抑止の「今のパスワードを確かめる操作」の規則が数える（http/rateLimits）。
//
// 登録取り消し済みの店は、この入口では退会させない（AI判断）。止めた店がすぐ退会して同じメールアドレスで登録し直すと、
// 運営は止めた店だと気づく手がかり（店名・メールアドレス）を失う。止めた店の許可書は止めたときにもう消している（安全-20）ので、
// 残りの消去は店向けの利用規約のとおり運営への連絡で受ける。

import { WITHDRAWN_STORE_NAME } from "../domain/texts";
import type { Deps } from "../ports";
import { findAccountById } from "../repo/accounts";
import { findWithdrawalTarget, withdrawStoreRecords, type WithdrawalTarget } from "../repo/storeWithdrawal";
import { verifyPassword } from "./credentials";
import { deleteLicenseFiles } from "./license";
import { scheduleLicenseSweep } from "./licenseSweep";
import { sendCancellationPushes } from "./pushMessage";
import { discardStoreImage } from "./storeImage";

export type WithdrawStoreResult =
  /** 退会した。`cancelled` は取り消した確保の数（店の画面が「N 組の確保を取り消し、お知らせしました」と出す） */
  | { ok: true; cancelled: number }
  /** 今のパスワードが合わない（入口は 403・欄の直下に出す） */
  | { ok: false; kind: "password_mismatch" }
  /** 店かアカウントがもう無い・もう退会している（入口は見分けの断り 401 に倒す） */
  | { ok: false; kind: "not_found" }
  /** 登録取り消し済み（運営への連絡で受ける・入口は 409） */
  | { ok: false; kind: "store_banned" };

/** 退会を頼んだ本人（入口の見分けの結果）。 */
export type WithdrawOwner = { accountId: string; storeId: string };

/** 読んでから書くまでに許可書が上げ直されたとき、読み直して試す回数（最初の1回を含む・license の DISCARD_ATTEMPTS と同じ考え）。 */
const WITHDRAW_ATTEMPTS = 2;

/** 今の店の状態から、退会できない理由を1つ決める（できるなら null）。 */
const refusalOf = (target: WithdrawalTarget | null): Extract<WithdrawStoreResult, { ok: false }> | null => {
  if (!target || target.withdrawn) return { ok: false, kind: "not_found" };
  if (target.status === "banned") return { ok: false, kind: "store_banned" };
  return null;
};

/** 表から外したあとで、置き場のファイル（許可書の今の分と承認の写し・店の画像）を消す。消せなかったものは掃除が拾う。 */
const discardFiles = async (deps: Deps, storeId: string, target: WithdrawalTarget): Promise<void> => {
  await deleteLicenseFiles(deps, storeId, [target.licenseKey, target.approvedLicenseKey]);
  await discardStoreImage(deps, storeId);
  scheduleLicenseSweep(deps);
};

export const withdrawStore = async (deps: Deps, owner: WithdrawOwner, currentPassword: string): Promise<WithdrawStoreResult> => {
  const account = await findAccountById(deps.db, owner.accountId);
  if (!account) return { ok: false, kind: "not_found" };
  if (!(await verifyPassword(deps, account.passwordHash, currentPassword))) return { ok: false, kind: "password_mismatch" };

  const nowIso = deps.clock.now().toISOString();
  for (let attempt = 1; attempt <= WITHDRAW_ATTEMPTS; attempt += 1) {
    const target = await findWithdrawalTarget(deps.db, owner.storeId);
    const refused = refusalOf(target);
    if (refused || !target) return refused ?? { ok: false, kind: "not_found" };

    const done = await withdrawStoreRecords(deps.db, { storeId: owner.storeId, nowIso, withdrawnName: WITHDRAWN_STORE_NAME, read: target });
    if (!done) continue;

    deps.logger.log({ event: "store_withdrawn", id: owner.storeId });
    // 取り消した確保を1件ずつ残す（`id` は確保の番号。客を指す値は載せない・基準 27.6）
    for (const reservation of done.cancelled) deps.logger.log({ event: "store_withdraw_cancel", id: reservation.reservationId });
    await discardFiles(deps, owner.storeId, target);
    // 取り消された客へ「お店の都合で取り消された」を知らせる（基準 22.2 と同じ流れ・送信の失敗は飲み込む）
    await sendCancellationPushes(
      deps,
      done.cancelled.map((reservation) => reservation.customerId),
    );
    return { ok: true, cancelled: done.cancelled.length };
  }
  // 2回とも当たらなかった: 読み直した状態で断る（同時に退会した・止められた、なら見分けの断りか store_banned）
  return refusalOf(await findWithdrawalTarget(deps.db, owner.storeId)) ?? { ok: false, kind: "not_found" };
};
