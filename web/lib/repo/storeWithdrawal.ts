// 店の退会の読み書き（2026-09-26 本人発案・監査の指摘 安全-20 の残り。要件13の基準 13.13〜13.20）。
//
// **伏せて残す形**（migrations/0014 の注）: 店の行は消さず、番号だけを残して店名を「退会した店」に伏せ、ほかの店の情報を空にする。
// 行を消せないのは、offers・reservations・fetch_items・selections・reports が外部キーで指しているため——消すと記録ごと消すか
// 外部キーを外すかになり、記録の表を追加だけにする基準 27.7 と、運営の証拠（通報・操作の記録）を失わない決めに反する。
// 状況は 'banned' に倒す（承認済みだけを出す読みと承認待ちの数から外れる）。退会したかは `withdrawn_at` で見分ける。
//
// 消すもの（1つのまとまり `db.batch`）: 店舗情報・許可書の鍵・カードの控え・承認の写しの店名と住所と許可書・クーポン・
// 店のアカウントとそのセッション・メールアドレスの確認の控え・端末の印とログインの数え（鍵にメールアドレスを含む）。公開中のオファーは終わらせ、
// 確保中の確保は「店が取り消した」にする。置き場のファイル（許可書・画像）は手続き（usecases/withdrawStore）が消す。
// 残すもの: 店の行の番号・登録した時刻・承認した時刻・規約の同意の版と時刻・運営のメモ（運営の書いたもの）、
// 過去の確保・通報・運営の操作の記録（admin_actions）・取得の記録（5つの表）。

import { normalizeLoginEmail } from "../domain/loginDevice";
import type { Deps } from "../ports";
import { changedRows } from "./d1";
import { storeWithdrawnEventsStatement } from "./logs";
import { clearCustomerPhonesOfWithdrawnStoreStatement, withdrawCancelReservationsStatement } from "./reservationsOfStore";
import { publishingOfferCondition } from "./sqlFragments";
import type { StoreStatus } from "./stores";

type Db = Deps["db"];

/** 退会の前に読む店の今（状況・退会済みか・消す許可書の鍵・店のメールアドレス）。 */
export type WithdrawalTarget = {
  status: StoreStatus;
  withdrawn: boolean;
  licenseKey: string | null;
  approvedLicenseKey: string | null;
  /** 店のアカウントのメールアドレス（端末の印とログインの数えの鍵を消すため）。アカウントが無ければ null */
  email: string | null;
};

export const findWithdrawalTarget = async (db: Db, storeId: string): Promise<WithdrawalTarget | null> => {
  const row = await db
    .prepare(
      `SELECT s.status, s.withdrawn_at, s.license_key, s.approved_license_key, a.email
         FROM stores s LEFT JOIN accounts a ON a.store_id = s.id AND a.role = 'store'
        WHERE s.id = ?1`,
    )
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    status: row.status as StoreStatus,
    withdrawn: typeof row.withdrawn_at === "string" && row.withdrawn_at !== "",
    licenseKey: (row.license_key as string | null) ?? null,
    approvedLicenseKey: (row.approved_license_key as string | null) ?? null,
    email: (row.email as string | null) ?? null,
  };
};

/** 退会した店か（運営の「戻す」が退会した店に当たらないように、手続きが先に見る）。 */
export const isWithdrawnStore = async (db: Db, storeId: string): Promise<boolean> => {
  const row = await db.prepare(`SELECT 1 AS found FROM stores WHERE id = ?1 AND withdrawn_at IS NOT NULL`).bind(storeId).first();
  return row !== null;
};

export type WithdrawStoreInput = {
  storeId: string;
  nowIso: string;
  /** 伏せたあとの店名（domain/texts の WITHDRAWN_STORE_NAME） */
  withdrawnName: string;
  /** 手続きが読んだ許可書の鍵とメールアドレス。鍵が読んだときのままのときだけ当てる（消すファイルと外す鍵を食い違わせない） */
  read: Pick<WithdrawalTarget, "licenseKey" | "approvedLicenseKey" | "email">;
};

/** 退会で取り消した確保（番号と客の番号）。退会の1文目が当たらなければ null。 */
export type WithdrawStoreResult = { cancelled: Array<{ reservationId: string; customerId: string }> } | null;

/** 退会の1文目が当たったまとまりでだけ、あとの文を当てる条件（1文目が入れた退会の時刻 ?2 で見分ける）。 */
const WITHDRAWN_NOW = `EXISTS (SELECT 1 FROM stores ws WHERE ws.id = ?1 AND ws.withdrawn_at = ?2)`;

/**
 * 店の行を伏せる1文目。**未承認か承認済みで、まだ退会していず、許可書の鍵が読んだときのままのときだけ**当たる
 * （登録取り消し済みの店は運営への連絡で受ける・手続きの注）。`IS` は NULL どうしも同じと見る。
 */
const eraseStoreStatement = (db: Db, input: WithdrawStoreInput) =>
  db
    .prepare(
      `UPDATE stores SET status = 'banned', withdrawn_at = ?2, name = ?3,
              address = NULL, lat = NULL, lng = NULL, url = NULL, genres = '[]', menus = '[]', budget_min = NULL, budget_max = NULL, geocoded_at = NULL,
              license_key = NULL, license_mime = NULL, license_uploaded_at = NULL,
              card_registered_at = NULL, stripe_customer_id = NULL, card_setup_session_id = NULL,
              approved_name = NULL, approved_address = NULL, approved_license_key = NULL, approved_license_mime = NULL
        WHERE id = ?1 AND withdrawn_at IS NULL AND status IN ('pending', 'approved')
          AND license_key IS ?4 AND approved_license_key IS ?5`,
    )
    .bind(input.storeId, input.nowIso, input.withdrawnName, input.read.licenseKey, input.read.approvedLicenseKey);

/** 鍵の頭がメールアドレスを含む数え（端末の印 `loginDevice:<email>|…` と締め出しの数え `login:<email>|…`）を消す文。 */
const forgetEmailCountersStatement = (db: Db, storeId: string, nowIso: string, email: string) => {
  const normalized = normalizeLoginEmail(email);
  return db
    .prepare(
      `DELETE FROM rate_counters WHERE (substr(key, 1, length(?3)) = ?3 OR substr(key, 1, length(?4)) = ?4) AND ${WITHDRAWN_NOW}`,
    )
    .bind(storeId, nowIso, `loginDevice:${normalized}|`, `login:${normalized}|`);
};

/**
 * 退会のまとまり（基準 13.15〜13.17）。**文の順に意味が在る**:
 *   1. 店の行を伏せ、状況を banned・退会の時刻を ?2 にする（当たらなければ、あとの文は `WITHDRAWN_NOW` で全部空振りする）
 *   2. 公開中のオファーを終わりにする（終わった理由は withdrawn）
 *   3. これから取り消す確保の、状態の変化の記録を足す（基準 27.4。まだ確保中の行を選ぶので 4 より前）
 *   4. 確保中の確保を「店が取り消した」にし、取り消した行を返す
 *   5. 店の確保に写した客の電話番号を空にする（見る店がもう無い）
 *   6. クーポンを消す
 *   7. メールアドレスを鍵に含む数え（端末の印・締め出し）を消す
 *   8. メールアドレスの確認の控え（`email_verifications`・migration 0015。メールアドレスを持つ）を消す（アカウントの番号で選ぶので 10 より前）
 *   9. 店のアカウントのセッションを消す（アカウントを指しているので 10 より前）
 *  10. 店のアカウントを消す（メールアドレスが空き、同じアドレスで新しい店を登録できる）
 */
export const withdrawStoreRecords = async (db: Db, input: WithdrawStoreInput): Promise<WithdrawStoreResult> => {
  const { storeId, nowIso } = input;
  const statements = [
    eraseStoreStatement(db, input),
    db
      .prepare(`UPDATE offers SET ended_at = ?2, end_reason = 'withdrawn' WHERE store_id = ?1 AND ${publishingOfferCondition("offers", "?2")} AND ${WITHDRAWN_NOW}`)
      .bind(storeId, nowIso),
    storeWithdrawnEventsStatement(db, storeId, nowIso),
    withdrawCancelReservationsStatement(db, storeId, nowIso),
    clearCustomerPhonesOfWithdrawnStoreStatement(db, storeId, nowIso),
    db.prepare(`DELETE FROM coupons WHERE store_id = ?1 AND ${WITHDRAWN_NOW}`).bind(storeId, nowIso),
    ...(input.read.email ? [forgetEmailCountersStatement(db, storeId, nowIso, input.read.email)] : []),
    db
      .prepare(`DELETE FROM email_verifications WHERE account_id IN (SELECT id FROM accounts WHERE store_id = ?1 AND role = 'store') AND ${WITHDRAWN_NOW}`)
      .bind(storeId, nowIso),
    db
      .prepare(`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE store_id = ?1 AND role = 'store') AND ${WITHDRAWN_NOW}`)
      .bind(storeId, nowIso),
    db.prepare(`DELETE FROM accounts WHERE store_id = ?1 AND role = 'store' AND ${WITHDRAWN_NOW}`).bind(storeId, nowIso),
  ];
  const results = await db.batch(statements);
  if (changedRows(results[0]) === 0) return null;
  const cancelled = (results[3]?.results ?? []) as Array<Record<string, unknown>>;
  return { cancelled: cancelled.map((row) => ({ reservationId: row.id as string, customerId: row.customer_id as string })) };
};
