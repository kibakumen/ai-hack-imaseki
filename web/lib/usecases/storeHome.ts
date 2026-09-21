// 店のホームの中身（要件12の基準 12.6・12.7・12.8、要件13の基準 13.8）。
// 承認の状況・準備のチェックリスト（営業許可書・カード）・足りない店の情報・クーポンの一覧を返す。
//
// ⚠️ **この関数は3つのタスクが順に育てる**（2026-09-21 の並列の実装・タスク表の申し送り）。
//    タスク7（ここ）が骨と `checklist`・`missingProfile`・`coupons` を置き、
//    **タスク9 が `offer` と `publishPrefill`**、**タスク17 が `arrivals`** を埋める。
//    下の3か所の ⚠️ が、その差し込み口（ほかの行は触らずに済む形にしてある）。

import { EMPTY_PUBLISH_PREFILL, missingProfileFields, type ArrivalView, type OfferView, type PublishPrefillView, type StoreStatusView } from "../domain/storeHome";
import type { Deps } from "../ports";
import { listCouponsByStore, type CouponRow } from "../repo/coupons";
import { findStoreHomeRow } from "../repo/stores";

export type StoreHome = {
  id: string;
  status: StoreStatusView;
  /** 承認に足りないものの有無（基準 12.8・13.8。カードは登録済みかどうかだけ） */
  checklist: { license: boolean; card: boolean };
  /** 公開に足りない店の情報の項目（基準 12.8・17.11） */
  missingProfile: string[];
  offer: OfferView | null;
  publishPrefill: PublishPrefillView;
  coupons: CouponRow[];
  arrivals: ArrivalView[];
};

/** 見分けの直後に店が消えた場合だけ null（入口が 401 に倒す）。 */
export const storeHome = async (deps: Deps, storeId: string): Promise<StoreHome | null> => {
  const store = await findStoreHomeRow(deps.db, storeId);
  if (!store) return null;

  const coupons = await listCouponsByStore(deps.db, storeId);

  return {
    id: store.id,
    status: store.status,
    checklist: { license: store.licenseKey !== null, card: store.cardRegisteredAt !== null },
    missingProfile: missingProfileFields(store),
    // ⚠️ タスク9: 公開中のオファーを読んで `OfferView` にする（無ければ null のまま）
    offer: null,
    // ⚠️ タスク9: `domain/storeHome.publishPrefill({ lastOffer, coupons, now })` の結果に差し替える
    publishPrefill: EMPTY_PUBLISH_PREFILL,
    coupons,
    // ⚠️ タスク17: 「向かっている客」の行を読んで `ArrivalView[]` にする
    arrivals: [],
  };
};
