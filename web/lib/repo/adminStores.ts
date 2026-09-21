// 運営の画面が見る店の読み書き（要件24・要件25）。lib/repo は D1 の SQL（設計書「ファイル構成の計画」）。
//
// ⚠️ 置き場所について: 設計書の検査の割り当ては `repo/stores` と書いているが、`repo/stores.ts` は
// 店の登録（タスク4）・店の情報（タスク5）・許可書とカード（タスク7）が同じ時間に足している最中で、
// 同じファイルの末尾を複数の作業ツリーが取り合う形になる。運営の側だけが使う読み書きなので、
// ここへ分けた（AI判断・進行役の並列の指示に合わせたもの。1つにまとめ直しても中身は変わらない）。

import type { Deps } from "../ports";
import type { AdminStoreFilter } from "../schemas/admin";
import { publishingOfferWhere } from "./sqlFragments";
import type { StoreStatus } from "./stores";

type Db = Deps["db"];

export type AdminStoreListRow = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  publishing: boolean;
};

export type AdminStoreDetailRow = AdminStoreListRow & {
  url: string | null;
  genresJson: string;
  menusJson: string;
  budgetMin: number | null;
  budgetMax: number | null;
  license: boolean;
  cardRegistered: boolean;
};

export type AdminStoreSummary = { publishing: number; pending: number };

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

const toListRow = (row: Record<string, unknown>): AdminStoreListRow => ({
  id: row.id as string,
  name: row.name as string,
  address: (row.address as string | null) ?? null,
  email: (row.email as string | null) ?? null,
  status: row.status as StoreStatus,
  publishing: toBoolean(row.publishing),
});

/**
 * 運営の一覧（要件24の基準 24.1〜24.6）。並びは登録した順（AI判断・基準に指定は無い）。
 * 検索は店名・住所・メールアドレスの部分一致で、絞り込みと重ねて効く。
 */
export const listStoresForAdmin = async (
  db: Db,
  input: { filter?: AdminStoreFilter; q?: string; nowIso: string },
): Promise<AdminStoreListRow[]> => {
  const bind = binder();
  const now = bind.put(input.nowIso);
  const publishingExists = `EXISTS (SELECT 1 FROM offers o WHERE o.store_id = s.id AND ${publishingOfferWhere("o", now)})`;
  const conditions: string[] = [];
  if (input.filter === "publishing") conditions.push(publishingExists);
  else if (input.filter) conditions.push(`s.status = ${bind.put(input.filter)}`);
  if (input.q) {
    const like = bind.put(`%${escapeLike(input.q)}%`);
    conditions.push(`(s.name LIKE ${like} ESCAPE '\\' OR COALESCE(s.address, '') LIKE ${like} ESCAPE '\\' OR COALESCE(a.email, '') LIKE ${like} ESCAPE '\\')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT s.id, s.name, s.address, s.status, a.email, ${publishingExists} AS publishing
     FROM stores s
     LEFT JOIN accounts a ON a.store_id = s.id AND a.role = 'store'
     ${where}
     ORDER BY s.rowid`;
  const result = await db.prepare(sql).bind(...bind.values).all();
  return (result.results as Array<Record<string, unknown>>).map(toListRow);
};

/** いちばん上の集計（基準 24.8・24.9）。絞り込みや検索とは別に、全体の数を返す。 */
export const summarizeStoresForAdmin = async (db: Db, nowIso: string): Promise<AdminStoreSummary> => {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM offers o WHERE ${publishingOfferWhere("o", "?1")}) AS publishing,
         (SELECT COUNT(*) FROM stores WHERE status = 'pending') AS pending`,
    )
    .bind(nowIso)
    .first();
  return { publishing: Number(row?.publishing ?? 0), pending: Number(row?.pending ?? 0) };
};

/** 店の詳細（基準 24.10・24.11・25.2）。無ければ null。 */
export const findStoreForAdmin = async (db: Db, storeId: string, nowIso: string): Promise<AdminStoreDetailRow | null> => {
  const row = await db
    .prepare(
      `SELECT s.id, s.name, s.address, s.status, s.url, s.genres, s.menus, s.budget_min, s.budget_max,
              s.license_key, s.card_registered_at, a.email,
              EXISTS (SELECT 1 FROM offers o WHERE o.store_id = s.id AND ${publishingOfferWhere("o", "?2")}) AS publishing
         FROM stores s
         LEFT JOIN accounts a ON a.store_id = s.id AND a.role = 'store'
        WHERE s.id = ?1`,
    )
    .bind(storeId, nowIso)
    .first();
  if (!row) return null;
  return {
    ...toListRow(row as Record<string, unknown>),
    url: (row.url as string | null) ?? null,
    genresJson: (row.genres as string | null) ?? "[]",
    menusJson: (row.menus as string | null) ?? "[]",
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
    license: row.license_key !== null && row.license_key !== undefined,
    cardRegistered: row.card_registered_at !== null && row.card_registered_at !== undefined,
  };
};

/**
 * 承認する（基準 25.1）。未承認の店だけが承認済みになる——前の状況を WHERE に入れた1つの UPDATE で、
 * 同時に来た操作が二重に効かないようにする（設計書「確保の状態と、残りの数え方」の書き方に合わせた）。
 */
export const approveStoreStatement = (db: Db, storeId: string) =>
  db.prepare(`UPDATE stores SET status = 'approved' WHERE id = ?1 AND status = 'pending'`).bind(storeId);

/** 止める（基準 25.6）。承認済みの店だけが「止められている」になる。 */
export const banStoreStatement = (db: Db, storeId: string) =>
  db.prepare(`UPDATE stores SET status = 'banned' WHERE id = ?1 AND status = 'approved'`).bind(storeId);

/** 止めた店の公開中のオファーを終わりにする（基準 25.7）。終わった理由は banned。 */
export const endPublishedOffersStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `UPDATE offers SET ended_at = ?2, end_reason = 'banned'
        WHERE store_id = ?1 AND ${publishingOfferWhere("offers", "?2")}`,
    )
    .bind(storeId, nowIso);

/** 状況だけを読む（承認・停止の前の見立て）。無ければ null。 */
export const findStoreStatus = async (db: Db, storeId: string): Promise<StoreStatus | null> => {
  const row = await db.prepare(`SELECT status FROM stores WHERE id = ?1`).bind(storeId).first();
  return row ? (row.status as StoreStatus) : null;
};
