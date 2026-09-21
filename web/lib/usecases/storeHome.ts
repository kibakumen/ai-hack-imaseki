// 店のホームの中身（要件12の基準 12.6）。今は承認の状況だけを返す最小の形。
// ⚠️ 足りないもののチェックリスト（12.7・12.8）・公開中のカード・クーポン・向かっている客は、
// タスク7・9・17 がこの手続きに足す（受け入れ検査 r12 のタスク7のブロックがその形を見る）。

import type { Deps } from "../ports";
import { findStoreSummary, type StoreStatus } from "../repo/stores";

export type StoreHome = { id: string; status: StoreStatus };

/** 見分けの直後に店が消えた場合だけ null（入口が 401 に倒す）。 */
export const storeHome = async (deps: Deps, storeId: string): Promise<StoreHome | null> => {
  const store = await findStoreSummary(deps.db, storeId);
  return store ? { id: store.id, status: store.status } : null;
};
