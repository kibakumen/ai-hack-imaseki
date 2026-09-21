// 「受け取れる状態」の TS 側の正本（設計書「どの判断をどこに置くか」）。
// SQL 側は repo/sqlFragments.ts で、2つが同じ答えを出すことを受け入れ検査 r05・r18 が突き合わせる。
//
// 受け取れる状態 ＝ 公開中（終わっていない かつ 今が「何時まで」より前）かつ 残りが1以上。
// 承認の条件は持たない——未承認の店は公開できず（要件17の基準 17.10）、運営が止めると
// `ended_at` が書かれる（要件25の基準 25.7）ので、公開中のオファーを持つ店は承認済みである
// （設計書「オファーの状態」）。

export type OfferState = {
  /** 店が止めた時・運営が店を止めた時だけ入る。「何時まで」で終わったことは保存しない */
  endedAt: Date | null;
  untilAt: Date;
  /** 募集する組数 − 枠を押さえている確保の数（要件18） */
  remaining: number;
};

/** 「何時まで」の時刻ちょうどは、もう受け取れない（要件17の基準 17.14）。 */
export const isReceivable = (offer: OfferState, now: Date): boolean => {
  if (offer.endedAt) return false;
  return now.getTime() < offer.untilAt.getTime() && offer.remaining >= 1;
};
