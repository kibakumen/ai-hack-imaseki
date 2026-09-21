"use client";

// 公開中のオファーのカード（要件17の基準 17.22・17.12、要件18の基準 18.15）。
// 出すのは5項目——募集する組数・残り・何名まで・何時まで・見せているクーポン——と、
// 離して置いた「公開を止める」。**残りやさばけた数を店が直接打つ欄は置かない**（基準 18.15）。
// クーポンのチェックを変える操作も置かない（要件19の基準 19.11）。終わったオファーを再開する
// 操作も無い（基準 17.15）。
// ⚠️ 公開中の4つの操作（追加で出す・残りの募集を減らす・何名まで・何時まで）はタスク20 が足す。

import { useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import { timeInJst } from "./jstTime";

export type OfferPanelOffer = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  latestUntil: string;
};

type Props = {
  offer: OfferPanelOffer;
  /** 止めたら、店のホームを取り直して公開のフォームに切り替える */
  onChanged: () => void;
};

export const OfferPanel = ({ offer, onChanged }: Props) => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const stop = async () => {
    const result = await apiCall("POST", "/api/store/offers/current/stop", {});
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    onChanged();
  };

  return (
    <section data-testid="offer-card">
      <h2>公開中のオファー</h2>
      <p>募集する組数 {offer.capacity} 組</p>
      <p data-testid="offer-remaining">残り {offer.remaining} 組</p>
      <p>何名まで {offer.partyMax} 名</p>
      <p>何時まで {timeInJst(offer.untilAt)}</p>
      <div>
        <p>見せているクーポン</p>
        {offer.coupons.length === 0 ? (
          <p>クーポンを見せないオファーとして公開しています。</p>
        ) : (
          <ul>
            {offer.coupons.map((coupon) => (
              <li key={coupon.id}>
                {coupon.name}
                {coupon.note === "" ? null : `（${coupon.note}）`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          data-testid="btn-stop"
          onClick={() => {
            void stop();
          }}
        >
          公開を止める
        </button>
        <FormMessage failure={failure} />
      </div>
    </section>
  );
};

export default OfferPanel;
