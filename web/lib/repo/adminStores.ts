// 運営の画面が見る店の読み書き（要件24・要件25）。lib/repo は D1 の SQL（設計書「ファイル構成の計画」）。
//
// ⚠️ 置き場所について: 設計書の検査の割り当ては `repo/stores` と書いているが、`repo/stores.ts` は
// 店の登録（タスク4）・店の情報（タスク5）・許可書とカード（タスク7）が同じ時間に足している最中で、
// 同じファイルの末尾を複数の作業ツリーが取り合う形になる。運営の側だけが使う読み書きなので、
// ここへ分けた（AI判断・進行役の並列の指示に合わせたもの。1つにまとめ直しても中身は変わらない）。
//
// 2026-09-25 監査の指摘で足したもの:
//   - 状況を変える書き込みは、運営の操作の記録（repo/adminActions）と**同じまとまり**で書く（運営-01）
//   - 承認した時点の店名・住所・許可書の写しと「承認後に変更あり」（運営-02）
//   - 審査の手がかり（許可書を上げた時刻・同じ住所や店名の登録・運営のメモと連絡済みの印・運営-05）
//   - ジャンルの絞り込み（運営-07）・全店の数（運営-11）・店が取り消した回数（横断-09）

import type { Deps } from "../ports";
import type { AdminStoreFilter } from "../schemas/admin";
import { insertAdminActionIfChangedStatement, insertAdminActionWithSqlDetailIfChangedStatement, type NewAdminAction } from "./adminActions";
import { changedRows, parseStringList } from "./d1";
import { adminCancelledEventsStatement } from "./logs";
import { adminCancelReservationsStatement } from "./reservations";
import { activeReservationCondition, publishingOfferCondition, remainingExpression } from "./sqlFragments";
import type { StoreStatus } from "./stores";

type Db = Deps["db"];

export type AdminStoreListRow = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  publishing: boolean;
  /** 登録した時刻（並び替え「登録が新しい順」の元・基準は stores.created_at）。 */
  createdAt: string;
  /** 受け取り実績＝完了済みの確保の数（並び替え「受け取り実績が多い順」）。0件なら0。 */
  claims: number;
  /** 予算の下限（並び替え「予算が安い順」）。未設定の店は null。 */
  budgetMin: number | null;
  /**
   * 公開中のオファーの残り枠（並び替え「残り枠が多い順」）。公開中のオファーが無い店は null
   * （タスク8の持ち場の外で作った値を装わない）——並べるときは末尾へ回す（画面側 compareNullsLast）。
   * `sqlFragments.remainingExpression` を直に使うので、客側の「残り」の判断と食い違わない。
   */
  offerRemaining: number | null;
  /** 承認したあとに店名・住所・許可書のどれかが変わったか（運営-02） */
  changedSinceApproval: boolean;
  /** 運営が「連絡済み」にしていて、そのあと許可書が上げ直されていないか（運営-05） */
  contacted: boolean;
  /** 店が取り消した確保の数と、受け取られた確保のうちの割合（0〜1・横断-09） */
  storeCancelled: number;
  storeCancelRate: number;
};

/** 承認した時点の写し（運営-02）。写しの無い店（未承認）は null。 */
export type AdminStoreApproval = { at: string | null; name: string; address: string | null; license: boolean };

export type AdminStoreDetailRow = AdminStoreListRow & {
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  license: boolean;
  cardRegistered: boolean;
  /** 許可書を最後に上げた時刻（上げ直しに気づくため・運営-05）。migration 0011 より前に上げた店は null */
  licenseUploadedAt: string | null;
  approval: AdminStoreApproval | null;
  /** 写しと今の値の違い（写しが無ければ全部 false） */
  changes: { name: boolean; address: boolean; license: boolean };
  /** 今向かっている（確保中の）確保の数（運営-03） */
  activeReservations: number;
  /** 同じ店名か同じ住所の、ほかの店の登録の数（運営-05） */
  duplicates: number;
  note: string | null;
  contactedAt: string | null;
};

export type AdminStoreSummary = { publishing: number; pending: number; awaiting: number; total: number };

/** LIKE の中で意味を持つ字を、そのままの字として探すために逃がす（検索語の `%` が「何でも」にならないように）。 */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 置き場所（?1・?2…）を数えながら値を積む小さな道具。SQL に値を差し込まない。 */
const binder = () => {
  const values: unknown[] = [];
  return {
    values,
    put: (value: unknown): string => {
      values.push(value);
      return `?${values.length}`;
    },
  };
};

const toBoolean = (value: unknown): boolean => value === 1 || value === true || (typeof value === "string" && value !== "");

/**
 * 受け取り実績＝その店の確保のうち完了済みの数。`reservations.store_id` を直に見る
 * （タスク13の設計より、店の全確保は `store_id` を持つので offers 経由の JOIN は要らない）。
 */
const adminStoreClaimsExpression = (storeAlias: string): string =>
  `(SELECT COUNT(*) FROM reservations cr WHERE cr.store_id = ${storeAlias}.id AND cr.status = 'completed')`;

/** 店が取り消した確保の数（横断-09）。「最終手段」のはずの取り消しを繰り返す店を見つけるため。 */
const storeCancelledExpression = (storeAlias: string): string =>
  `(SELECT COUNT(*) FROM reservations sc WHERE sc.store_id = ${storeAlias}.id AND sc.status = 'store_cancelled')`;

/** その店の確保の全部の数（店が取り消した割合の分母）。 */
const reservationCountExpression = (storeAlias: string): string => `(SELECT COUNT(*) FROM reservations rc WHERE rc.store_id = ${storeAlias}.id)`;

/**
 * 公開中のオファーの残り枠。その店に公開中のオファーは同時に1つだけ（`publishOffer` が二重公開を
 * 断る・基準 17.9）ので `LIMIT 1` で確定する。無ければ null（存在しない値を作らない）。
 */
const adminStorePublishingRemainingExpression = (storeAlias: string, nowPlaceholder: string): string =>
  `(SELECT ${remainingExpression("ao", nowPlaceholder)} FROM offers ao` +
  ` WHERE ao.store_id = ${storeAlias}.id AND ${publishingOfferCondition("ao", nowPlaceholder)} LIMIT 1)`;

/** 写しと今の値が違うか（写しの無い店は 0）。NULL どうしは同じと見る（`IS NOT`）。 */
const changedSinceApprovalExpression = (s: string): string =>
  `(CASE WHEN ${s}.approved_name IS NULL THEN 0` +
  ` WHEN ${s}.name IS NOT ${s}.approved_name OR ${s}.address IS NOT ${s}.approved_address OR ${s}.license_key IS NOT ${s}.approved_license_key THEN 1` +
  ` ELSE 0 END)`;

/** 「連絡済み」が今も効いているか——連絡のあとで許可書が上げ直されたら、また承認待ちに数える（運営-05）。 */
const contactedExpression = (s: string): string =>
  `(CASE WHEN ${s}.contacted_at IS NOT NULL AND (${s}.license_uploaded_at IS NULL OR ${s}.license_uploaded_at <= ${s}.contacted_at) THEN 1 ELSE 0 END)`;

/** 一覧と詳細が共通で読む列（別名 `s` の stores・`a` の accounts、「今」は `now` の置き場所）。 */
const listColumns = (now: string): string =>
  `s.id, s.name, s.address, s.status, s.created_at, s.budget_min, a.email,
   EXISTS (SELECT 1 FROM offers o WHERE o.store_id = s.id AND ${publishingOfferCondition("o", now)}) AS publishing,
   ${adminStoreClaimsExpression("s")} AS claims,
   ${adminStorePublishingRemainingExpression("s", now)} AS offer_remaining,
   ${changedSinceApprovalExpression("s")} AS changed_since_approval,
   ${contactedExpression("s")} AS contacted,
   ${storeCancelledExpression("s")} AS store_cancelled,
   ${reservationCountExpression("s")} AS reservation_count`;

const toListRow = (row: Record<string, unknown>): AdminStoreListRow => {
  const storeCancelled = Number(row.store_cancelled ?? 0);
  const reservationCount = Number(row.reservation_count ?? 0);
  return {
    id: row.id as string,
    name: row.name as string,
    address: (row.address as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    status: row.status as StoreStatus,
    publishing: toBoolean(row.publishing),
    createdAt: row.created_at as string,
    claims: Number(row.claims ?? 0),
    budgetMin: (row.budget_min as number | null) ?? null,
    offerRemaining: row.offer_remaining === null || row.offer_remaining === undefined ? null : Number(row.offer_remaining),
    changedSinceApproval: toBoolean(row.changed_since_approval),
    contacted: toBoolean(row.contacted),
    storeCancelled,
    storeCancelRate: reservationCount > 0 ? storeCancelled / reservationCount : 0,
  };
};

/**
 * 運営の一覧（要件24の基準 24.1〜24.6）。並びは登録した順（AI判断・基準に指定は無い）。
 * 検索は店名・住所・メールアドレスの部分一致で、絞り込み・ジャンルと重ねて効く。
 */
export const listStoresForAdmin = async (
  db: Db,
  input: { filter?: AdminStoreFilter; genre?: string; q?: string; nowIso: string },
): Promise<AdminStoreListRow[]> => {
  const bind = binder();
  const now = bind.put(input.nowIso);
  const conditions: string[] = [];
  if (input.filter === "publishing") conditions.push(`EXISTS (SELECT 1 FROM offers po WHERE po.store_id = s.id AND ${publishingOfferCondition("po", now)})`);
  else if (input.filter) conditions.push(`s.status = ${bind.put(input.filter)}`);
  // ジャンルは JSON の並びで持っているので、要素を1つずつ見る（運営-07）
  if (input.genre) conditions.push(`EXISTS (SELECT 1 FROM json_each(s.genres) g WHERE g.value = ${bind.put(input.genre)})`);
  if (input.q) {
    const like = bind.put(`%${escapeLike(input.q)}%`);
    conditions.push(`(s.name LIKE ${like} ESCAPE '\\' OR COALESCE(s.address, '') LIKE ${like} ESCAPE '\\' OR COALESCE(a.email, '') LIKE ${like} ESCAPE '\\')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT ${listColumns(now)}
     FROM stores s
     LEFT JOIN accounts a ON a.store_id = s.id AND a.role = 'store'
     ${where}
     ORDER BY s.rowid`;
  const result = await db.prepare(sql).bind(...bind.values).all();
  return (result.results as Array<Record<string, unknown>>).map(toListRow);
};

/**
 * いちばん上の集計（基準 24.8・24.9）。絞り込みや検索とは別に、全体の数を返す。
 * `awaiting` は未承認のうち「連絡済み」の印の無い店（運営-05）、`total` は登録されている店の全部（運営-11）。
 */
export const summarizeStoresForAdmin = async (db: Db, nowIso: string): Promise<AdminStoreSummary> => {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM offers o WHERE ${publishingOfferCondition("o", "?1")}) AS publishing,
         (SELECT COUNT(*) FROM stores WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM stores s WHERE s.status = 'pending' AND ${contactedExpression("s")} = 0) AS awaiting,
         (SELECT COUNT(*) FROM stores) AS total`,
    )
    .bind(nowIso)
    .first();
  return {
    publishing: Number(row?.publishing ?? 0),
    pending: Number(row?.pending ?? 0),
    awaiting: Number(row?.awaiting ?? 0),
    total: Number(row?.total ?? 0),
  };
};

const toApproval = (row: Record<string, unknown>): AdminStoreApproval | null =>
  row.approved_name === null || row.approved_name === undefined
    ? null
    : {
        at: (row.approved_at as string | null) ?? null,
        name: row.approved_name as string,
        address: (row.approved_address as string | null) ?? null,
        license: row.approved_license_key !== null && row.approved_license_key !== undefined,
      };

/** 写しと今の値の違い（写しが無ければ全部 false）。 */
const toChanges = (row: Record<string, unknown>): AdminStoreDetailRow["changes"] => {
  if (row.approved_name === null || row.approved_name === undefined) return { name: false, address: false, license: false };
  const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
  return { name: !same(row.name, row.approved_name), address: !same(row.address, row.approved_address), license: !same(row.license_key, row.approved_license_key) };
};

/** 店の詳細（基準 24.10・24.11・25.2、運営-02・運営-03・運営-05）。無ければ null。 */
export const findStoreForAdmin = async (db: Db, storeId: string, nowIso: string): Promise<AdminStoreDetailRow | null> => {
  const row = await db
    .prepare(
      `SELECT ${listColumns("?2")},
              s.url, s.genres, s.menus, s.budget_max, s.license_key, s.card_registered_at, s.license_uploaded_at,
              s.approved_at, s.approved_name, s.approved_address, s.approved_license_key, s.admin_note, s.contacted_at,
              (SELECT COUNT(*) FROM reservations ar WHERE ar.store_id = s.id AND ${activeReservationCondition("ar", "?2")}) AS active_reservations,
              (SELECT COUNT(*) FROM stores d WHERE d.id <> s.id
                  AND (d.name = s.name OR (COALESCE(s.address, '') <> '' AND d.address = s.address))) AS duplicates
         FROM stores s
         LEFT JOIN accounts a ON a.store_id = s.id AND a.role = 'store'
        WHERE s.id = ?1`,
    )
    .bind(storeId, nowIso)
    .first();
  if (!row) return null;
  const record = row as Record<string, unknown>;
  return {
    ...toListRow(record),
    url: (record.url as string | null) ?? null,
    genres: parseStringList(record.genres),
    menus: parseStringList(record.menus),
    budgetMin: (record.budget_min as number | null) ?? null,
    budgetMax: (record.budget_max as number | null) ?? null,
    license: record.license_key !== null && record.license_key !== undefined,
    cardRegistered: record.card_registered_at !== null && record.card_registered_at !== undefined,
    licenseUploadedAt: (record.license_uploaded_at as string | null) ?? null,
    approval: toApproval(record),
    changes: toChanges(record),
    activeReservations: Number(record.active_reservations ?? 0),
    duplicates: Number(record.duplicates ?? 0),
    note: (record.admin_note as string | null) ?? null,
    contactedAt: (record.contacted_at as string | null) ?? null,
  };
};

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

