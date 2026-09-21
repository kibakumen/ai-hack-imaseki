// 店のホームのうち、オファーにまつわる部分（要件17の基準 17.11・17.17〜17.22）。
// ⚠️ 別のファイルに切ってあるのは、`usecases/storeHome.ts` がタスク7（承認の状況・チェックリスト）と
// タスク17（向かっている客）でも育つため。あちらへの差し込みは1行に留める。

import { missingStoreProfile, publishPrefill, type PublishPrefill } from "../domain/storeHome";
import { latestUntilOf } from "../domain/until";
import type { Deps } from "../ports";
import { findLastOffer, findLiveOffer, findStorePublishState, listStoreCoupons, type CouponRow } from "../repo/offers";
import type { OfferView } from "../schemas/offer";

export type StoreHomeOfferPart = {
  /** 店名・住所・ジャンル・予算の幅のうち埋まっていないもの（基準 17.11・要件12の基準 12.8） */
  missingProfile: string[];
  /** 公開中のオファー。無ければ null（基準 17.22） */
  offer: OfferView | null;
  /** 公開のフォームの初めの値（基準 17.17〜17.21） */
  publishPrefill: PublishPrefill;
  coupons: CouponRow[];
};

const toOfferView = (
  offer: { id: string; capacity: number; remaining: number; partyMax: number; publishedAt: string; untilAt: string; couponIds: string[] },
  coupons: CouponRow[],
): OfferView => ({
  id: offer.id,
  capacity: offer.capacity,
  // 残りが0を下回って見えないように畳む（要件18の基準 18.11 の見え方の側）。
  remaining: Math.max(0, offer.remaining),
  partyMax: offer.partyMax,
  untilAt: offer.untilAt,
  publishedAt: offer.publishedAt,
  // 見せているクーポンは、店のクーポンの並び（作った順）で出す。削除されたものは落ちる。
  coupons: coupons.filter((coupon) => offer.couponIds.includes(coupon.id)),
  latestUntil: latestUntilOf(new Date(offer.publishedAt)).toISOString(),
});

export const storeHomeOfferPart = async (deps: Deps, storeId: string): Promise<StoreHomeOfferPart> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const [store, coupons, live] = await Promise.all([
    findStorePublishState(deps.db, storeId),
    listStoreCoupons(deps.db, storeId),
    findLiveOffer(deps.db, storeId, nowIso),
  ]);

  // 公開中があるときは、その値がカードに出ている。初めの値が要るのは公開のフォームのときだけ。
  const last = live ? null : await findLastOffer(deps.db, storeId);

  return {
    missingProfile: store ? missingStoreProfile(store) : [],
    offer: live ? toOfferView(live, coupons) : null,
    publishPrefill: publishPrefill({
      lastOffer: last ? { ...last, untilAt: new Date(last.untilAt) } : null,
      coupons,
      now,
    }),
    coupons,
  };
};
