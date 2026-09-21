"use client";

// 店の雰囲気画像（第2回の指摘「お店の画像もほしい」・2026-09-22 速成版 `sprint/app/me/page.tsx`
// の `StoreImage` を移植）。ホームページの URL から入口（GET /api/customer/store-image）へ問い合わせ、
// 取れれば画像を、取れなければ何も出さない（呼び出し側の `OfferArt` が飾りの地をそのまま見せる——
// **画像は飾りなので、落ちても本文は出る**）。
//
// 店ごとに問い合わせが要るので、この部品だけが `apiCall` を直接呼ぶ（`FetchForm` の地名の問い合わせ
// `/api/customer/place` と同じ置き方——画面が fetch を直接呼ばないのは client/api.ts の役目で、
// `apiCall` を経由する呼び方は許される・基準 29.4）。

import { useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";

export type StoreImageProps = {
  /** 店のホームページの URL。無ければ問い合わせない。 */
  url: string | null;
  /** 装飾画像の alt。地の div が aria-hidden なので空でよいが、将来の再利用に備えて渡せるようにする。 */
  alt?: string;
};

export const StoreImage = ({ url, alt = "" }: StoreImageProps) => {
  // どの URL の答えなのかを一緒に持つ。`url` が変わった瞬間は「まだ答えが無い」を
  // **描くときに** 導けるので、効果の中で同期的に状態を捨てる必要がない
  // （同期の setState は連鎖した描き直しを起こすので lint が止める）。
  const [answered, setAnswered] = useState<{ url: string | null; src: string | null }>({ url: null, src: null });

  useEffect(() => {
    let alive = true;
    if (!url) return;
    void (async () => {
      const answer = await apiCall<{ imageUrl?: unknown }>("GET", `/api/customer/store-image?url=${encodeURIComponent(url)}`);
      if (!alive) return;
      setAnswered({ url, src: !isFailure(answer) && typeof answer.imageUrl === "string" ? answer.imageUrl : null });
    })();
    return () => {
      alive = false;
    };
  }, [url]);

  const src = answered.url === url ? answered.src : null;
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- 店ごとに違う外部ドメインの画像なので、next/image の許可リスト設定を要しない img を使う
  return <img src={src} alt={alt} loading="lazy" className="offer-card__art-img" />;
};

export default StoreImage;
