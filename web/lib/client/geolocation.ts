// ブラウザの現在地を取るただ1つの場所（基準 3.9）。取得のボタンが押されたときに1回だけ取り、
// 位置を追い続ける呼び出し（常時の追跡）は使わない——構造の検査が、その呼び出しの名前がこのファイル
// にも無いことと、ほかのどのソースにも位置の呼び出しが無いことを見る（検査の割り当ての 3.9 の行）。
//
// 取れなかった3つ（客が許可を断った・呼び出しが失敗した・5秒返らなかった）を**1つの断りにまとめる**
// （基準 3.7・3.8）。まとめる理由: 画面が客に求めることはどれも同じ「場所を文字で入れてください」で、
// 区別しても次の一手が変わらない。断りの形は入口が返すものと同じ（`ApiFailure`）なので、フォームは
// 現在地と入口の失敗を1つの分岐（`client/api` の `isFailure`）で扱える。

import type { ApiFailure } from "./api";
import { GEOLOCATION_TIMEOUT_MS } from "../schemas/limits";

/** 現在地が取れたとき。起点の座標をそのまま取得の入口へ送る（基準 3.1）。 */
export type CurrentLocation = { ok: true; lat: number; lng: number };

/**
 * 現在地が取れなかったことを表す断り（基準 3.7・3.8）。
 *
 * 場所の欄に結びつける（`fields` に `place`）ので、文は場所の欄の直下に出て、押した操作の直下には
 * 出ない（設計書「入力の誤りの出し方」の 3.4〜3.7 の行。部品 `components/ui/InputRefusal` の規則）。
 */
const LOCATION_REQUIRED: ApiFailure = {
  ok: false,
  error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] },
};

/**
 * 今の現在地を1回だけ取る。5秒（`GEOLOCATION_TIMEOUT_MS`）で打ち切り、取れなければ断りを返す。
 * 位置の仕組みを持たないブラウザも「取れなかった」と同じに扱う（客は場所を文字で入れれば先へ進める）。
 */
export const currentLocation = async (): Promise<CurrentLocation | ApiFailure> => {
  const geo = typeof navigator === "undefined" ? undefined : navigator.geolocation;
  if (!geo) return LOCATION_REQUIRED;
  return new Promise<CurrentLocation | ApiFailure>((resolve) => {
    let settled = false;
    // 打ち切りと答えのどちらが先に来ても、1回だけ答える（後から来た方は捨てる）。
    const finish = (result: CurrentLocation | ApiFailure) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish(LOCATION_REQUIRED), GEOLOCATION_TIMEOUT_MS);
    geo.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish({ ok: true, lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        finish(LOCATION_REQUIRED);
      },
    );
  });
};
