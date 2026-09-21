// 「最近行った店」（要件26の基準 26.10〜26.12・26.15・26.17）。
// 出すのは**完了済みの確保だけ**で、取り消された確保と期限切れのままの確保は出さない（行っていない店
// だから・要件26の補足）。客が次の確保を作ったあとも出る——客のホームがいちばん新しい確保しか
// 見ないのとは別の問い合わせ。
//
// ⚠️ 応答の項目は4つに閉じる（基準 26.17: コード・住所・ホームページの URL を出さない）。
//    それらを見返すのは要件8の基準 8.11（過去の受け取りの見返し・タスク30）。

import { recentWindowStart } from "../domain/report";
import type { Deps } from "../ports";
import { listRecentStores } from "../repo/reports";

export type RecentStoreItem = {
  reservationId: string;
  storeId: string;
  storeName: string;
  completedAt: string;
};

export const recentStores = async (deps: Deps, customerId: string): Promise<{ items: RecentStoreItem[] }> => {
  const now = deps.clock.now();
  const rows = await listRecentStores(deps.db, customerId, recentWindowStart(now).toISOString());
  return {
    items: rows.map((row) => ({
      reservationId: row.reservationId,
      storeId: row.storeId,
      storeName: row.storeName,
      completedAt: row.completedAtIso,
    })),
  };
};
