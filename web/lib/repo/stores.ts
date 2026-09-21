// stores の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 登録の時に作るのは店名と状態だけで、住所・位置・ジャンル・予算はタスク5（店の情報）が入れる。

import type { Deps } from "../ports";

type Db = Deps["db"];

export type StoreStatus = "pending" | "approved" | "banned";

/** `createdAtIso` は店の登録の時刻（同点・同距離のときの並び・要件6の基準 6.4。タスク9 で追加）。 */
export type NewStore = { id: string; name: string; createdAtIso: string };

export type StoreSummary = { id: string; name: string; status: StoreStatus };

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertStoreStatement = (db: Db, store: NewStore) =>
  db.prepare(`INSERT INTO stores (id, name, created_at, status) VALUES (?1, ?2, ?3, 'pending')`).bind(store.id, store.name, store.createdAtIso);

/** 店の番号で1件。無ければ null（アカウントは在るのに店が消えている、は起きない想定）。 */
export const findStoreSummary = async (db: Db, storeId: string): Promise<StoreSummary | null> => {
  const row = await db.prepare(`SELECT id, name, status FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return { id: row.id as string, name: row.name as string, status: row.status as StoreStatus };
};
