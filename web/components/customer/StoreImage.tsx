"use client";

// 店の雰囲気画像（第2回の指摘「お店の画像もほしい」・2026-09-22 速成版 `sprint/app/me/page.tsx`
// の `StoreImage` を移植）。取れなければ何も出さない（呼び出し側の `OfferArt` が飾りの地をそのまま見せる——
// **画像は飾りなので、落ちても本文は出る**）。
//
// 2026-09-25 監査の指摘 安全-12・安全-19 で、画像は**自分のオリジンから**読む形にした
// （GET /api/customer/store-image?storeId=…・店が情報を保存したときにサーバーが1回だけ取って置いたもの）。
// 以前は店のサーバーの画像を客の端末が直接読んでいて、結果に出るたびに客の接続元と時刻が店側に渡った。
// 同じオリジンの画像なので、客の Cookie が付いて見分けが通る（`callApi` を経由しない読み込みはこの1つだけ）。

import { useState } from "react";

export type StoreImageProps = {
  /** 店の番号。ホームページの URL が無い店は null（問い合わせない）。 */
  storeId: string | null;
  /** 装飾画像の alt。地の div が aria-hidden なので空でよいが、将来の再利用に備えて渡せるようにする。 */
  alt?: string;
};

/** 客の画面が読む店の画像の場所（自分のオリジン）。 */
export const storeImageSrc = (storeId: string): string => `/api/customer/store-image?storeId=${encodeURIComponent(storeId)}`;

export const StoreImage = ({ storeId, alt = "" }: StoreImageProps) => {
  // 読めなかった店の番号を覚える（404＝画像の無い店・読み込みの失敗）。番号が変われば描き直して読み直す。
  const [failedFor, setFailedFor] = useState<string | null>(null);
  if (!storeId || failedFor === storeId) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 自分の入口が返す画像で、next/image の変換を通す必要が無い
    <img src={storeImageSrc(storeId)} alt={alt} loading="lazy" className="offer-card__art-img" onError={() => setFailedFor(storeId)} />
  );
};

export default StoreImage;
