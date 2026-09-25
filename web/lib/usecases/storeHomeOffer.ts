// 店のホームのうち、オファーにまつわる部分（要件17の基準 17.11・17.17〜17.22）。
// ⚠️ 別のファイルに切ってあるのは、`usecases/storeHome.ts` がタスク7（承認の状況・チェックリスト）と
// タスク17（向かっている客）でも育つため。あちらへの差し込みは1行に留める。

import { publishPrefill, type PublishPrefill } from "../domain/storeHome";
import { latestUntilOf } from "../domain/until";
import type { Deps } from "../ports";
import { listCoupons, type CouponRow } from "../repo/coupons";
import { findLastOffer, findLiveOffer } from "../repo/offers";
import type { OfferView } from "../schemas/offer";

export type StoreHomeOfferPart = {
  /** 公開中のオファー。無ければ null（基準 17.22） */
  offer: OfferView | null;
  /** 公開のフォームの初めの値（基準 17.17〜17.21） */
  publishPrefill: PublishPrefill;
};

const toOfferView = (
  offer: { id: string; capacity: number; remaining: number; partyMax: number; publishedAt: string; untilAt: string; untilSet: boolean; couponIds: string[] },
  coupons: readonly CouponRow[],
): OfferView => ({
  id: offer.id,
  capacity: offer.capacity,
  // 残りが0を下回って見えないように畳む（要件18の基準 18.11 の見え方の側）。
  remaining: Math.max(0, offer.remaining),
  partyMax: offer.partyMax,
  untilAt: offer.untilAt,
  publishedAt: offer.publishedAt,
  // 見せているクーポンは、店のクーポンの並び（作った順）で出す。削除されたものは落ちる。
  coupons: coupons.filter((coupon) => offer.couponIds.includes(coupon.id)).map(({ id, name, note }) => ({ id, name, note })),
  latestUntil: latestUntilOf(new Date(offer.publishedAt)).toISOString(),
  untilSet: offer.untilSet,
});

/**
 * 公開中のオファーのカード1枚ぶん（公開中の変更の応答が使う・要件19・タスク20が足した）。
 * 公開中が無ければ null。店のホームと**同じ `toOfferView` を通す**ので、カードに出る5項目と
 * 最長の時刻の作り方は1か所のまま（片方だけ直って黙ってずれない）。
 */
export const liveOfferView = async (deps: Deps, storeId: string): Promise<OfferView | null> => {
  const nowIso = deps.clock.now().toISOString();
  const [coupons, live] = await Promise.all([listCoupons(deps.db, storeId), findLiveOffer(deps.db, storeId, nowIso)]);
  return live ? toOfferView(live, coupons) : null;
};

/**
 * 店のホームのオファーの部分。店のクーポンは**呼ぶ側（usecases/storeHome）が1回読んだもの**を受け取る
 * （2026-09-25 監査の指摘 設計-10: 店のホームが店の行とクーポンを2回ずつ読み、1回ぶんを捨てていた）。
 * 足りない店の情報の判定もここでは持たない（`domain/storeHome.missingProfileFields` 1本・店のホームが呼ぶ）。
 */
export const storeHomeOfferPart = async (deps: Deps, storeId: string, coupons: readonly CouponRow[]): Promise<StoreHomeOfferPart> => {
  const now = deps.clock.now();
  const live = await findLiveOffer(deps.db, storeId, now.toISOString());

  // 公開中があるときは、その値がカードに出ている。初めの値が要るのは公開のフォームのときだけ。
  const last = live ? null : await findLastOffer(deps.db, storeId);

  return {
    offer: live ? toOfferView(live, coupons) : null,
    publishPrefill: publishPrefill({
      lastOffer: last ? { ...last, untilAt: new Date(last.untilAt) } : null,
      coupons,
      now,
    }),
  };
};
