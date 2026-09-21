// 過去の受け取りの見返し（要件8の基準 8.11【最終日】）。その客が受け取ったものを、受け取った
// 時刻の新しい順に返すだけの読む手続き。
//
// ⚠️ 「期限切れ」を自分で判定しない。`domain/reservation.ts` の `effectiveState` が正本
//    （設計書「どの判断をどこに置くか」の「確保の今の状態」の行）。
//
// ⚠️ 期限切れの記録（基準 27.4）はここでは足さない。足すのは客のホームと店のホームの持ち場
//    （設計書「期限切れの記録」）で、状態は期限の時刻から導くので記録が遅れて付いても中身は変わらない。
//
// ⚠️ ほかの客の確保が混ざらないことは repo の WHERE が担う（基準 2.5）。この手続きは客の番号を
//    入口の見分けから受け取るだけで、要求の本文からは受けない。

import { effectiveState, type EffectiveState } from "../domain/reservation";
import type { Deps } from "../ports";
import { listReservationsOfCustomer } from "../repo/customerHistory";

export type CustomerHistoryItem = {
  id: string;
  /** 8桁のコード（基準 8.11） */
  code: string;
  /** 確保の今の状態（「期限切れ」は保存せず時刻から導く・基準 8.11） */
  status: EffectiveState;
  storeId: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
  party: number;
  /** 受け取った時刻（ISO 8601）。並びの元。画面がいつの受け取りかを出したいときに使える */
  receivedAt: string;
};

/** その客の過去の受け取り。1件も無ければ空の配列（画面が「まだありません」を出す）。 */
export const customerHistory = async (deps: Deps, customerId: string): Promise<CustomerHistoryItem[]> => {
  const now = deps.clock.now();
  const rows = await listReservationsOfCustomer(deps.db, customerId);
  return rows.map(({ reservation, store }) => ({
    id: reservation.id,
    code: reservation.code,
    status: effectiveState(reservation, now),
    storeId: reservation.storeId,
    storeName: store.name,
    storeAddress: store.address,
    storeUrl: store.url,
    party: reservation.party,
    receivedAt: reservation.createdAt.toISOString(),
  }));
};
