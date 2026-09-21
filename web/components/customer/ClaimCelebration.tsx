"use client";

// 受け取れた瞬間のファンファーレ（2026-09-22。第1回の指摘「受け取った瞬間にファンファーレみたいな
// エフェクトが欲しい」／第2回の「オファーを受け取って確定したら別画面に遷移してオファー承諾の
// 楽しい演出をつけ、オファーを前面に出し」。速成版 `sprint/app/me/page.tsx` の
// `ClaimedFullscreen` を v2 へ移した）。
//
// v2 は受け取ると**確保中の表示そのものへ移る**（入れ物が表示の種類で切り替える）ので、
// ここは「移った瞬間にかぶせて、すぐ引く幕」に留める——下にある確保中の表示が本体で、
// 幕はしばらくしたら自分で消える（押せばすぐ消える）。
//
// ⚠️ 外への行き先（地図など）はここに置かない。確保中の表示の中に出る唯一の外への行き先は
//    店のホームページで、受け入れ検査が「ホームページが無い店では外への行き先が無いこと」を
//    見張っている（`r09-reservation-view.ui.test.tsx`）。だからこの幕は入れ物の側に描かれ、
//    確保中の囲い（`view-active`）の外に立つ。

import { useEffect, useState } from "react";
import { Confetti } from "../ui/Confetti";

/** 幕が出ている長さ。過ぎたら自分で引く（客の手を止めない） */
const SHOWN_MS = 2600;

type ClaimCelebrationProps = {
  /** 店に見せる番号。幕の上でもいちばん大きく出す（店頭で開いたまま見せられるように） */
  code: string;
  storeName: string;
  /** 幕が引けたことを入れ物へ返す（2回目は出さない） */
  onDone: () => void;
};

export const ClaimCelebration = ({ code, storeName, onDone }: ClaimCelebrationProps) => {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setClosing(true);
      onDone();
    }, SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  if (closing) return null;

  return (
    <div className="claim-celebration" data-testid="claim-celebration" role="status">
      <Confetti count={26} />
      <div className="claim-celebration__card">
        <p className="claim-celebration__mark">🎉</p>
        <p className="claim-celebration__lead">席を確保しました！</p>
        <p className="claim-celebration__eyebrow">確保番号</p>
        <p className="claim-celebration__code">{code}</p>
        <p className="claim-celebration__store">{storeName}</p>
        <button type="button" className="claim-celebration__close" data-testid="btn-celebration-close" onClick={onDone}>
          確保の内容を見る
        </button>
      </div>
    </div>
  );
};

export default ClaimCelebration;
