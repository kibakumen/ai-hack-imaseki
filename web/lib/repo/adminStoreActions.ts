// 運営が店の状況を変える書き込み（要件25 承認・取り消し・戻す、運営-02 の確かめた、運営-05 のメモ）と、その判断に要る読み。
// 2026-09-25 監査の指摘 設計-16 で repo/adminStores.ts から分けた（SQL は変えていない）。
// 状況を変える書き込みは、運営の操作の記録（repo/adminActions）と**同じまとまり**で書く（運営-01）。

import type { Deps } from "../ports";
import { insertAdminActionIfChangedStatement, insertAdminActionWithSqlDetailIfChangedStatement, type NewAdminAction } from "./adminActions";
import { changedRows } from "./d1";
import { contactedExpression } from "./adminStores";
import { adminCancelledEventsStatement } from "./logs";
import { adminCancelReservationsStatement } from "./reservationsOfStore";
import { activeReservationCondition, publishingOfferCondition } from "./sqlFragments";
import type { StoreStatus } from "./stores";

type Db = Deps["db"];

/**
 * 承認と「今の内容を確かめた」が読む、店の今の内容（運営-02 のレビュー）。承認の写しに入る3つ（店名・住所・許可書）と、
 * 運営が画面で見た内容と突き合わせる許可書を上げた時刻、承認に要るカードの有無、今の写しが指す許可書。
 */
export type StoreReview = {
  status: StoreStatus;
  name: string;
  address: string | null;
  licenseKey: string | null;
  licenseUploadedAt: string | null;
  cardRegistered: boolean;
  /** 承認した時点の写しが在るか（未承認の店は false） */
  approved: boolean;
  /** 今の写しが指す許可書（写しが無い・許可書なしで写した店は null） */
  approvedLicenseKey: string | null;
};

/** 写しに入れる3つ。書き込みの WHERE に入れて、読んでから書くまでの間に変わったら当てない。 */
export type StoreReviewSnapshot = Pick<StoreReview, "name" | "address" | "licenseKey">;

/** 店の今の内容（承認・確かめの前の見立て）。無ければ null。 */
export const findStoreReview = async (db: Db, storeId: string): Promise<StoreReview | null> => {
  const row = await db
    .prepare(
      `SELECT status, name, address, license_key, license_uploaded_at, card_registered_at, approved_name, approved_license_key
         FROM stores WHERE id = ?1`,
    )
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    status: row.status as StoreStatus,
    name: row.name as string,
    address: (row.address as string | null) ?? null,
    licenseKey: (row.license_key as string | null) ?? null,
    licenseUploadedAt: (row.license_uploaded_at as string | null) ?? null,
    cardRegistered: row.card_registered_at !== null && row.card_registered_at !== undefined,
    approved: row.approved_name !== null && row.approved_name !== undefined,
    approvedLicenseKey: (row.approved_license_key as string | null) ?? null,
  };
};

/** 写しに入れる3つが、読んだときのままか（`IS` は NULL どうしも同じと見る）。置き場所は ?3・?4・?5。 */
const UNCHANGED_SINCE_READ = "name IS ?3 AND address IS ?4 AND license_key IS ?5";

/** 承認に使った許可書の置き場と種類（運営-02）。写しが無ければ null。 */
export const findApprovedLicense = async (db: Db, storeId: string): Promise<{ key: string; mime: string | null } | null> => {
  const row = await db.prepare(`SELECT approved_license_key, approved_license_mime FROM stores WHERE id = ?1`).bind(storeId).first();
  const key = row?.approved_license_key;
  return typeof key === "string" && key !== "" ? { key, mime: (row?.approved_license_mime as string | null) ?? null } : null;
};

/**
 * 承認する（基準 25.1）。未承認の店だけが承認済みになる——前の状況を WHERE に入れた1つの UPDATE で、
 * 同時に来た操作が二重に効かないようにする。同じ文で、承認した時点の店名・住所・許可書を写す（運営-02）。
 * **写すのは `read`（手続きが読んだ内容）と同じときだけ**——読んでから書くまでの間に店が許可書を上げ直したり
 * 店名を変えたりしたら当てない（運営が見ていない内容を写しに入れない・運営-02 のレビュー）。
 * 記録（運営-01）は同じまとまりの中で、状況が変わったときだけ足す。当たれば true。
 */
export const approvePendingStore = async (db: Db, storeId: string, read: StoreReviewSnapshot, action: NewAdminAction): Promise<boolean> => {
  const [approved] = await db.batch([
    db
      .prepare(
        `UPDATE stores SET status = 'approved', approved_at = ?2, approved_name = name, approved_address = address,
                approved_license_key = license_key, approved_license_mime = license_mime
          WHERE id = ?1 AND status = 'pending' AND ${UNCHANGED_SINCE_READ}`,
      )
      .bind(storeId, action.atIso, read.name, read.address, read.licenseKey),
    insertAdminActionIfChangedStatement(db, action),
  ]);
  return changedRows(approved) > 0;
};

/** 止めた店を戻した先。承認の写しが残っていれば承認済み、止めたときに外していれば承認待ち（安全-20 のレビュー）。 */
export type RestoredStatus = "approved" | "pending";

/**
 * 止められている店を戻す（基準 25.9）。止められている店だけが当たり、戻した先の状況を返す。当たらなければ null。
 *
 *   - 承認の写しが残っている店（許可書を消す手続きより前に止めた店・消すのに失敗した店）… 承認済みへ。許可書も残っている
 *   - 止めたときに許可書と承認の写しを外した店 … **承認待ちへ**。店が許可書を上げ直し、運営が確かめてから承認する
 *     （2026-09-25 安全-20 のレビュー。それまでは承認済みへ戻し、許可書の無い承認済みの店がそのまま公開できた）
 *
 * 終わったオファーと取り消された確保は戻さない（基準 25.10）——この文は `stores` だけを触る。
 * 承認した時点の写しも取り直さない（戻すのは審査のやり直しではない。やり直すのは承認待ちへ戻った店の承認）。
 */
export const restoreBannedStore = async (db: Db, storeId: string, action: NewAdminAction): Promise<RestoredStatus | null> => {
  const [restored] = await db.batch([
    db
      .prepare(
        `UPDATE stores SET status = CASE WHEN approved_name IS NULL THEN 'pending' ELSE 'approved' END
          WHERE id = ?1 AND status = 'banned' RETURNING status`,
      )
      .bind(storeId),
    insertAdminActionIfChangedStatement(db, action),
  ]);
  // 当たった行だけが `RETURNING` で返る（返らなければ、止められていなかった・同時に来た操作に負けた）
  const status = ((restored?.results ?? [])[0] as { status?: unknown } | undefined)?.status;
  return status === "approved" || status === "pending" ? status : null;
};

/**
 * 止めた結果。止められなかった（承認済みでなかった・同時に来た操作に負けた）なら null。
 * `cancelled` は実際に取り消した確保（番号と客の番号）、`notified` はそのうち知らせを受け取れる客（購読あり）の数。
 */
export type BanResult = { cancelled: Array<{ reservationId: string; customerId: string }>; notified: number } | null;

/**
 * 停止の記録に添える数（運営-01・運営-03）: これから取り消す確保の数と、そのうち知らせを受け取れる客の数
 * （1人に1回ずつ送るので客の数で数える）。**停止と同じまとまりの中で**数える——まとまりの中には割り込みが無いので、
 * 5の文が実際に取り消す行と同じものを数える。先に読んでおく形では、読んでから止めるまでの間に受け取った客が
 * 記録の数からも画面の数からも漏れる（不具合-13 と運営-01 を合わせたときの形）。?8 は店の番号、?9 は今の時刻。
 */
const BAN_DETAIL_SQL = `json_object(
    'cancelled', (SELECT COUNT(*) FROM reservations r WHERE r.store_id = ?8 AND ${activeReservationCondition("r", "?9")}),
    'notified', (SELECT COUNT(DISTINCT r.customer_id) FROM reservations r JOIN push_subscriptions p ON p.customer_id = r.customer_id
                  WHERE r.store_id = ?8 AND ${activeReservationCondition("r", "?9")})
  )`;

/** 記録した `detail`（`RETURNING`）から、知らせを受け取れる客の数を読む。読めなければ 0。 */
const notifiedFromRecorded = (recorded: { results?: unknown[] } | undefined): number => {
  const row = (recorded?.results ?? [])[0] as Record<string, unknown> | undefined;
  if (typeof row?.detail !== "string") return 0;
  try {
    const parsed = JSON.parse(row.detail) as { notified?: unknown };
    return typeof parsed.notified === "number" ? parsed.notified : 0;
  } catch {
    return 0;
  }
};

/**
 * 止める（基準 25.6・25.7・25.8・25.11・27.4）。5つの文を1つのまとまり（`db.batch`）で流す——
 * 止められた店に公開中のオファーが残る／オファーは終わったのに確保だけ確保中で残る、という形を作らない。
 * 店の状況が当たれば、取り消した確保（番号と客の番号）と通知できる客の数を返す。承認済みでなかった・同時に来た操作に負けたなら null。
 *
 * **文の順に意味が在る**:
 *   1. 店の状況を banned にする（前の状況 approved を WHERE に入れた1つの UPDATE）
 *   2. 1 が当たったときだけ、運営の操作の記録を足す（運営-01。`changes()` が 1 の文を見るので、1 の直後）。
 *      取り消す数と通知できる客の数は、この文の中で数える（`BAN_DETAIL_SQL`・まだ `status='active'` の行を数える）
 *   3. 公開中のオファーを終わりにする（終わった理由は banned・基準 25.7）
 *   4. これから取り消す確保の、状態の変化の記録を足す（基準 27.4。まだ `status='active'` の行を選ぶので 5 より前）
 *   5. 確保中の確保を全部「運営に取り消された」にし、取り消した行を返す（基準 25.8・25.11・22.2）
 *
 * 知らせの相手は5の文が実際に取り消した行から決める（不具合-13）。先に読んでおく形では、読んでから
 * 止めるまでの間に受け取った客が、取り消されたのに知らせを受け取れなかった。
 */
export const banApprovedStore = async (db: Db, storeId: string, nowIso: string, action: NewAdminAction): Promise<BanResult> => {
  const [banned, recorded, , , cancelled] = await db.batch([
    db.prepare(`UPDATE stores SET status = 'banned' WHERE id = ?1 AND status = 'approved'`).bind(storeId),
    insertAdminActionWithSqlDetailIfChangedStatement(db, action, BAN_DETAIL_SQL, [storeId, nowIso]),
    db
      .prepare(
        `UPDATE offers SET ended_at = ?2, end_reason = 'banned'
          WHERE store_id = ?1 AND ${publishingOfferCondition("offers", "?2")}`,
      )
      .bind(storeId, nowIso),
    adminCancelledEventsStatement(db, storeId, nowIso),
    adminCancelReservationsStatement(db, storeId, nowIso),
  ]);
  if (changedRows(banned) === 0) return null;
  return {
    cancelled: ((cancelled?.results ?? []) as Array<Record<string, unknown>>).map((row) => ({ reservationId: row.id as string, customerId: row.customer_id as string })),
    notified: notifiedFromRecorded(recorded),
  };
};

/**
 * 承認後の変更を確かめた（運営-02）。今の店名・住所・許可書で写しを取り直し、「承認後に変更あり」を消す。
 * 写しの無い店（未承認）には当たらない。承認と同じく、`read` から変わっていたら当てない。さらに、取り替える前の
 * 写しが `read.approvedLicenseKey` のままのときだけ当てる——手続きは、当たったあとでその許可書を置き場から消すので、
 * 消す鍵と取り替えた鍵が食い違わないようにする（運営-02 のレビュー）。当たれば true。
 */
export const acknowledgeStoreChanges = async (
  db: Db,
  storeId: string,
  read: StoreReviewSnapshot & { approvedLicenseKey: string | null },
  action: NewAdminAction,
): Promise<boolean> => {
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE stores SET approved_name = name, approved_address = address, approved_license_key = license_key, approved_license_mime = license_mime
          WHERE id = ?1 AND approved_name IS NOT NULL AND approved_license_key IS ?2 AND ${UNCHANGED_SINCE_READ}`,
      )
      .bind(storeId, read.approvedLicenseKey, read.name, read.address, read.licenseKey),
    insertAdminActionIfChangedStatement(db, action),
  ]);
  return changedRows(updated) > 0;
};

/**
 * 運営のメモと「連絡済み」の印を書く（運営-05 の A）。連絡済みにするときは、印がまだ無いか、
 * 連絡のあとで許可書が上げ直されていれば今の時刻を入れ、そうでなければ前の時刻を保つ
 * （メモを書き足しただけで「いつ連絡したか」が動かないように）。当たれば true。
 */
export const saveStoreNote = async (db: Db, storeId: string, input: { note: string | null; contacted: boolean }, action: NewAdminAction): Promise<boolean> => {
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE stores SET admin_note = ?2,
                contacted_at = CASE WHEN ?3 = 0 THEN NULL WHEN ${contactedExpression("stores")} = 1 THEN contacted_at ELSE ?4 END
          WHERE id = ?1`,
      )
      .bind(storeId, input.note, input.contacted ? 1 : 0, action.atIso),
    insertAdminActionIfChangedStatement(db, action),
  ]);
  return changedRows(updated) > 0;
};

/** 状況だけを読む（承認・停止の前の見立て）。無ければ null。 */
export const findStoreStatus = async (db: Db, storeId: string): Promise<StoreStatus | null> => {
  const row = await db.prepare(`SELECT status FROM stores WHERE id = ?1`).bind(storeId).first();
  return row ? (row.status as StoreStatus) : null;
};
