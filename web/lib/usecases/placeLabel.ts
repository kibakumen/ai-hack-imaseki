// 位置を地名へ直す手続き（入口 GET /api/customer/place）。
//
// **なぜ要るか**: 客は「現在地を使う」の下の入力欄に書かれている場所を、自分が発信する場所だと
// 読む（2026-09-22 の本人の指摘）。だから画面を開いた瞬間に、そこへ現在地の地名が入っていてほしい。
// 緯度経度のままでは自分の居場所か確かめられない。
//
// 地図の鍵はサーバーにしか無いので、画面は座標をここへ渡して文字だけを受け取る。
// 直せなかったときは `label: null` を返す——画面は欄を空のままにして、座標で探せばよい
// （地名は見せ方の飾りで、探す筋には要らない）。

import type { Deps } from "../ports";
import { GEOCODE_TIMEOUT_MS } from "../schemas/limits";
import type { PlaceQuery } from "../schemas/place";
import { raceDeadline } from "./deadline";

export type PlaceLabelResult = { label: string | null };

/**
 * 座標から地名を1つ作る。打ち切りは地図と同じ3秒（`GEOCODE_TIMEOUT_MS`）で、
 * 差し替えた時計と AbortSignal の両方で数える（`raceDeadline` の注）。
 *
 * 逆方向の口を持たない差し替え（受け入れ検査の偽物）では、外へ聞かずに `null` を返す。
 */
export const placeLabel = async (deps: Deps, input: PlaceQuery): Promise<PlaceLabelResult> => {
  // 打ち切りの合図は、最初の await より前に作る（raceDeadline の注）。
  const deadline = deps.clock.after(GEOCODE_TIMEOUT_MS);
  const reverse = deps.geocoder.reverse;
  if (!reverse) return { label: null };

  const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deadline, (signal) => reverse.call(deps.geocoder, { lat: input.lat, lng: input.lng }, { signal }));
  if (!answer.ok || !answer.value.ok) return { label: null };
  return { label: answer.value.label };
};
