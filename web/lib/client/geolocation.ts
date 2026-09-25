// ブラウザの現在地を取るただ1つの場所（基準 3.9）。取るのは客が押したとき（「現在地を使う」「今すぐ探す」）と、
// 前に「現在地を使う」を押した端末で画面を開いたとき（`client/locationStatus` の覚え）だけで、
// 位置を追い続ける呼び出し（常時の追跡）は使わない——構造の検査が、その呼び出しの名前がこのファイル
// にも無いことと、ほかのどのソースにも位置の呼び出しが無いことを見る（検査の割り当ての 3.9 の行）。
//
// 取れなかった3つ（客が許可を断った・呼び出しが失敗した・5秒返らなかった）は、どれも**同じ語の断り**
// （`location_required`・基準 3.7・3.8）にする——場所の欄の直下に出す文は「場所を文字で入れてください」で
// 同じだから。ただ、許可を断った客には「空のままなら今いる場所で探します」と案内しても取れないので、
// 断りに `denied` の印を付け、画面が案内の文を替えられるようにする（2026-09-25 監査の指摘 客-09）。
//
// **打ち切りはブラウザに任せる**（客-09）。以前は呼んだ瞬間から自前のタイマーで5秒を数えていたので、
// 初めての客が許可のダイアログを読んでいる時間まで数えられ、6秒後に「許可」を押すと、届いた位置を捨てて
// 「取れませんでした」と出していた。`getCurrentPosition` の `timeout` は許可が出てから数える。

import type { ApiFailure } from "./api";
import { GEOLOCATION_TIMEOUT_MS } from "../schemas/limits";

/** 現在地が取れたとき。起点の座標をそのまま取得の入口へ送る（基準 3.1）。 */
export type CurrentLocation = { ok: true; lat: number; lng: number };

/**
 * 直前に取れた位置をどれだけ使い回すか（AI判断の値）。開いた瞬間に取った位置を、そのすぐあとの
 * 「今すぐ探す」でもう一度待たせないため。歩いている客の位置がずれすぎない長さにとどめる。
 */
const GEOLOCATION_MAX_AGE_MS = 60000;
/** 位置の許可を断られた（`GeolocationPositionError.PERMISSION_DENIED`）。 */
const PERMISSION_DENIED = 1;

/**
 * 現在地が取れなかったことを表す断り（基準 3.7・3.8）。
 *
 * 場所の欄に結びつける（`fields` に `place`）ので、文は場所の欄の直下に出て、押した操作の直下には
 * 出ない（設計書「入力の誤りの出し方」の 3.4〜3.7 の行。部品 `components/ui/InputRefusal` の規則）。
 */
export const LOCATION_REQUIRED: ApiFailure = {
  ok: false,
  error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] },
};

/** 客が位置情報の許可を断った。語は同じで、`denied` の印だけが違う（読むのは `client/locationStatus`）。 */
export const LOCATION_DENIED: ApiFailure = {
  ok: false,
  error: { kind: "location_required", fields: [{ name: "place", reason: "required" }], denied: true },
};

/**
 * 今の現在地を1回だけ取る。許可が出てから5秒（`GEOLOCATION_TIMEOUT_MS`）でブラウザが打ち切り、
 * 取れなければ断りを返す。位置の仕組みを持たないブラウザも「取れなかった」と同じに扱う
 * （客は場所を文字で入れれば先へ進める）。
 */
export const currentLocation = async (): Promise<CurrentLocation | ApiFailure> => {
  const geo = typeof navigator === "undefined" ? undefined : navigator.geolocation;
  if (!geo) return LOCATION_REQUIRED;
  return new Promise<CurrentLocation | ApiFailure>((resolve) => {
    geo.getCurrentPosition(
      (position) => resolve({ ok: true, lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => resolve(error?.code === PERMISSION_DENIED ? LOCATION_DENIED : LOCATION_REQUIRED),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS },
    );
  });
};
