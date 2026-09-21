// coupons の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
//
// ⚠️ 2026-09-21 の並列の実装では、このファイルはタスク7（店のホームが返すクーポンの一覧）が
// 読みの1本だけを置いた。**クーポンの作成・変更・削除はタスク6が同じファイルへ足す**。

import type { Deps } from "../ports";

type Db = Deps["db"];

export type CouponRow = { id: string; name: string; note: string };

/** その店のクーポンを作った順に。公開のフォームのチェックの並びがこの順になる。 */
export const listCouponsByStore = async (db: Db, storeId: string): Promise<CouponRow[]> => {
  const result = await db.prepare(`SELECT id, name, note FROM coupons WHERE store_id = ?1 ORDER BY created_at, id`).bind(storeId).all();
  const rows = (result?.results ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ id: row.id as string, name: row.name as string, note: (row.note as string | null) ?? "" }));
};
