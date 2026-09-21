// 店のホームの中身（要件12の基準 12.6）。今は承認の状況だけを返す最小の形。
// ⚠️ 足りないもののチェックリスト（12.7・12.8）・公開中のカード・クーポン・向かっている客は、
// タスク7・9・17 がこの手続きに足す（受け入れ検査 r12 のタスク7のブロックがその形を見る）。

import type { Deps } from "../ports";
import { findStoreSummary, type StoreStatus } from "../repo/stores";
import { storeHomeOfferPart, type StoreHomeOfferPart } from "./storeHomeOffer";

export type StoreHome = { id: string; status: StoreStatus } & StoreHomeOfferPart;

/** 見分けの直後に店が消えた場合だけ null（入口が 401 に倒す）。 */
export const storeHome = async (deps: Deps, storeId: string): Promise<StoreHome | null> => {
  const store = await findStoreSummary(deps.db, storeId);
  if (!store) return null;
  // タスク9 の差し込み（オファー・公開のフォームの初めの値・足りない店の情報・クーポン）。
  return { id: store.id, status: store.status, ...(await storeHomeOfferPart(deps, store.id)) };
};
