// stores の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 登録の時に作るのは店名と状態だけで、住所・位置・ジャンル・予算はタスク5（店の情報）が入れる。

import type { Deps } from "../ports";
import type { StoreProfile } from "../schemas/store";

type Db = Deps["db"];

export type StoreStatus = "pending" | "approved" | "banned";

export type NewStore = { id: string; name: string };

export type StoreSummary = { id: string; name: string; status: StoreStatus };

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertStoreStatement = (db: Db, store: NewStore) =>
  db.prepare(`INSERT INTO stores (id, name, status) VALUES (?1, ?2, 'pending')`).bind(store.id, store.name);

/** 店の番号で1件。無ければ null（アカウントは在るのに店が消えている、は起きない想定）。 */
export const findStoreSummary = async (db: Db, storeId: string): Promise<StoreSummary | null> => {
  const row = await db.prepare(`SELECT id, name, status FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return { id: row.id as string, name: row.name as string, status: row.status as StoreStatus };
};

// ---------- 店の情報（タスク5・要件15） ----------

/** 列に入っている文字列の並び（genres・menus）を配列へ。壊れていれば空（読み出しで落とさない）。 */
const parseList = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/** 保存する店の情報（位置は住所から直したもの・基準 15.9）。 */
export type StoreProfileRecord = {
  name: string;
  address: string;
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number;
  budgetMax: number;
  lat: number;
  lng: number;
};

/** 店の情報を読む。まだ入れていない項目は空か null（登録の直後は店名だけが入っている）。 */
export const findStoreProfile = async (db: Db, storeId: string): Promise<StoreProfile | null> => {
  const row = await db
    .prepare(`SELECT name, address, url, genres, menus, budget_min, budget_max FROM stores WHERE id = ?1`)
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    name: row.name as string,
    address: (row.address as string | null) ?? "",
    url: (row.url as string | null) ?? null,
    genres: parseList(row.genres),
    menus: parseList(row.menus),
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
  };
};

/** 店の情報と位置を1度に書き換える（住所と位置がずれた形を残さない・基準 15.9）。 */
export const updateStoreProfile = async (db: Db, storeId: string, profile: StoreProfileRecord): Promise<void> => {
  await db
    .prepare(
      `UPDATE stores SET name = ?2, address = ?3, url = ?4, genres = ?5, menus = ?6, budget_min = ?7, budget_max = ?8, lat = ?9, lng = ?10 WHERE id = ?1`,
    )
    .bind(
      storeId,
      profile.name,
      profile.address,
      profile.url,
      JSON.stringify(profile.genres),
      JSON.stringify(profile.menus),
      profile.budgetMin,
      profile.budgetMax,
      profile.lat,
      profile.lng,
    )
    .run();
};
