// 公開中のオファーの「いまの数字」のカード（2026-10-08 本人選択「案C 片手の親指」の論点1）。
// 画面の上半分は**読むだけ**にする——ここには押せるものを置かない（数を変える・止めるは画面の下の帯から）。
// 出すのは5項目（配信数・残り・何名まで・何時まで・見せているクーポン・要件17の基準 17.22）と、受け取られた数の細い棒。
// ⚠️ 残りは `offer-remaining` の名前で出す（店が打つ欄は置かない・基準 18.15）。

import type { OfferViewDto } from "../../lib/client/api";
import { timeInJst } from "../ui/jstTime";
import { OfferStatusBadge } from "./OfferPanelParts";

type Props = {
  offer: OfferViewDto;
  /** 向かっている客（確保中）の組数 */
  arriving: number;
};

const percent = (part: number, whole: number): string => `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`;

export const OfferGlance = ({ offer, arriving }: Props) => {
  const sold = Math.max(0, offer.capacity - offer.remaining);
  const settled = Math.max(0, sold - arriving);
  const until = timeInJst(offer.untilAt);
  return (
    <div className="store-glance">
      <div className="store-glance__head">
        <OfferStatusBadge remaining={offer.remaining} />
        <span className="store-glance__since">{timeInJst(offer.publishedAt)} に公開</span>
      </div>
      <div className="store-remain">
        <p className="store-remain__main" data-testid="offer-remaining">
          <span className="store-remain__label">残り</span>
          <span className="store-remain__num">{offer.remaining}</span>
          <span className="store-remain__unit">組</span>
        </p>
        <span className="store-remain__of">/ 配信数 {offer.capacity}組</span>
      </div>
      <div className="store-meter" role="img" aria-label={`配信数 ${offer.capacity}組のうち、受け取り済み ${sold}組（向かっている ${arriving}組）`}>
        <i style={{ width: percent(settled, offer.capacity) }} />
        <i style={{ width: percent(Math.min(arriving, sold), offer.capacity) }} />
      </div>
      <p className="store-glance__legend">
        受け取り済み {sold}組（うち向かっている {arriving}組）・残り {offer.remaining}組
      </p>
      {offer.remaining === 0 ? <p className="store-glance__full">配信数を増やすと、また客に出ます。</p> : null}
      <dl className="store-facts">
        <div className="store-fact">
          <dt>何名まで</dt>
          <dd>{offer.partyMax}名</dd>
        </div>
        <div className="store-fact">
          <dt>何時まで</dt>
          <dd>
            {offer.untilSet ? `${until} に終了` : `${until} に自動で終了`}
            {offer.untilSet ? null : <small>終了タイマーなし（公開から12時間）</small>}
          </dd>
        </div>
      </dl>
      <div className="store-tags">
        <span className="store-tags__label">見せるクーポン</span>
        {offer.coupons.length === 0 ? (
          <span className="store-tags__none">なし</span>
        ) : (
          offer.coupons.map((coupon) => (
            <span className="store-tag" key={coupon.id}>
              {coupon.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
};

export default OfferGlance;
