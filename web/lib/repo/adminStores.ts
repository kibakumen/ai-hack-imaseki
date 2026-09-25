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
//
// 2026-09-25 監査の指摘 設計-16 で2つに分けた（481 行になっていた。SQL は変えていない）:
//   repo/adminStores.ts        … ここ（一覧・数・詳細の読み）
//   repo/adminStoreActions.ts  … 承認・取り消し・戻す・確かめた・メモの書き込みと、その判断に要る読み

import type { Deps } from "../ports";
import type { AdminStoreFilter } from "../schemas/admin";
import { parseStringList } from "./d1";
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
export const contactedExpression = (s: string): string =>
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
