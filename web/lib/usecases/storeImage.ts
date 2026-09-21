// 店のホームページから雰囲気画像を取る手続き（読むだけ・入口 GET /api/customer/store-image）。
// 2026-09-22 本人の指摘「お店の画像もほしい」に応えた、速成版 `sprint/lib/ogImage.ts` の移植。
//
// 打ち切りは地図と同じ3秒（STORE_IMAGE_TIMEOUT_MS）で、差し替えた時計と AbortSignal の両方で数える
// （usecases/placeLabel と同じ置き方・raceDeadline の注）。
//
// ⚠️ **画像は見せ方の飾り**——取れなくても null を返すだけで断りにしない。この口を持たない差し替え
// （受け入れ検査の偽物）では外へ聞かずに null へ倒す（geocoder.reverse を持たない場面と同じ考え）。

import type { Deps } from "../ports";
import { STORE_IMAGE_TIMEOUT_MS } from "../schemas/limits";
import type { StoreImageQuery } from "../schemas/storeImage";
import { raceDeadline } from "./deadline";

export type StoreImageResult = { imageUrl: string | null };

export const storeImage = async (deps: Deps, input: StoreImageQuery): Promise<StoreImageResult> => {
  const fetcher = deps.storeImage;
  if (!fetcher) return { imageUrl: null };

  // 打ち切りの合図は、最初の await より前に作る（raceDeadline の注）。
  const deadline = deps.clock.after(STORE_IMAGE_TIMEOUT_MS);
  const answer = await raceDeadline(STORE_IMAGE_TIMEOUT_MS, deadline, (signal) => fetcher.fetch(input.url, { signal }));
  if (!answer.ok || !answer.value.ok) return { imageUrl: null };
  return { imageUrl: answer.value.imageUrl };
};
