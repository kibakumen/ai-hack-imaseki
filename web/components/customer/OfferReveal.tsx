"use client";

// 「◯件のオファーを受け取りました！」のお披露目（2026-09-22。第1回の指摘
// 「～件のオファーを受け取りました！みたいな感じで**宝くじを受け取ったような演出**が欲しい」。
// 速成版 `sprint/app/me/page.tsx` の `revealCount` の札を v2 へ移した）。
//
// **描かれた時に1回だけ出て、自分で消える**。出す・消すの状態を入れ物（`CustomerApp`）へ増やさない
// ——結果の一覧（`ResultList`）は探すたびに作り直されるので、この部品が描かれることが
// 「今、結果が届いた」と同じ意味になる。
//
// 読み上げには渡さない（`aria-hidden`）。件数は一覧の見出しと中身が伝えるので、
// 同じことを二度読ませない。

import { useEffect, useState } from "react";

/** 札が出ている長さ。CSS 側の `prize-pop`（跳ね）＋`prize-fade-out`（消え）と合わせる */
const SHOWN_MS = 1700;

type OfferRevealProps = {
  /** 届いたオファーの件数。0件のときは出さない（祝うことが無い） */
  count: number;
};

export const OfferReveal = ({ count }: OfferRevealProps) => {
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setFinished(true), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (finished || count <= 0) return null;

  return (
    <div aria-hidden className="offer-reveal" data-testid="offer-reveal">
      <div className="offer-reveal__card">
        <p className="offer-reveal__mark">🎉</p>
        <p className="offer-reveal__count">{count}件</p>
        <p className="offer-reveal__lead">のオファーを受け取りました！</p>
      </div>
    </div>
  );
};

export default OfferReveal;
