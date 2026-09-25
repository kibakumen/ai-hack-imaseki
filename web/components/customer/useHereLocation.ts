"use client";

// 現在地（座標と地名）を持つ道具（`FetchForm` から切り出した・2026-09-25）。
//
// 座標（探すときに送るもの）と地名（欄に見せるもの）を別に持つ——地名に直せない場所でも座標で探せるように。
// 地名は `hereLabel` に入り、「欄の中身がまだ現在地のままか」の見分けにも使う。
//
// 2026-09-25 監査の指摘で直した3つ:
//   - 安全-18（案3）: 開いた瞬間には取りに行かない。前に「現在地を使う」を押した端末だけ、開いた瞬間に取る
//     （`client/locationStatus` の覚え）。初めての客は押すまで、位置も地名の問い合わせも送らない。
//   - 客-10: 地名を問い合わせている間は `resolving`。「地名にはできませんでした」は問い合わせが終わっても
//     取れなかったときだけ出す（以前は「取れた」を先に立ててから問い合わせたので、その間ずっと失敗の文が出た）。
//   - 客-09: 許可を断られたら `denied`（取れなかった `failed` と文を分ける）。

import { useCallback, useEffect, useState } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";
import { currentLocation, type CurrentLocation } from "../../lib/client/geolocation";
import { hasLocationConsent, isLocationDenied, rememberLocationConsent } from "../../lib/client/locationStatus";

/** 現在地の座標。 */
export type Point = { lat: number; lng: number };

/**
 * 現在地を取りに行った結果の見せ方（欄の直下の断りとは別物——押す前の案内なので責めない）。
 *   idle      … まだ取りに行っていない（初めての端末。押すまで何も送らない）
 *   locating  … 位置を待っている（許可のダイアログを読んでいる間も含む）
 *   resolving … 位置は取れて、地名を問い合わせている
 *   located   … 取れた（地名は取れたときだけ `hereLabel` に入る）
 *   failed    … 取れなかった（打ち切り・端末が位置を持たない）
 *   denied    … 客が位置情報の許可を断った
 */
export type LocateState = "idle" | "locating" | "resolving" | "located" | "failed" | "denied";

/** 取れなかった断りを、見せ方の状態へ直す。 */
const failedState = (failure: ApiFailure): LocateState => (isLocationDenied(failure) ? "denied" : "failed");

/**
 * @param onLabel 地名が取れたときに呼ぶ（欄が空なら地名を入れる——書きかけは消さない）。同じ関数のまま渡す。
 */
export const useHereLocation = (onLabel: (label: string) => void) => {
  // 前に押した端末だけ、開いた瞬間に取りに行く（初めの値が「取得中」なのは、下の effect が描かれた直後に
  // 必ず取りに行くから。effect の中で state を立てると lint `react-hooks/set-state-in-effect` が止める）
  const [auto] = useState(hasLocationConsent);
  const [locate, setLocate] = useState<LocateState>(auto ? "locating" : "idle");
  const [here, setHere] = useState<Point | null>(null);
  const [hereLabel, setHereLabel] = useState<string | null>(null);

  /** 取れた位置を持ち、地名へ直す。取れなかったときは案内だけを出す（押した時に改めて場所を求める・基準 3.7）。 */
  const apply = useCallback(
    async (located: CurrentLocation | ApiFailure): Promise<void> => {
      if (isFailure(located)) {
        setLocate(failedState(located));
        return;
      }
      const point = { lat: located.lat, lng: located.lng };
      setHere(point);
      setLocate("resolving");
      const answer = await callApi("GET /api/customer/place", { query: point });
      const label = !isFailure(answer) && typeof answer.label === "string" && answer.label !== "" ? answer.label : null;
      setHereLabel(label);
      setLocate("located");
      if (label !== null) onLabel(label);
    },
    [onLabel],
  );

  useEffect(() => {
    if (!auto) return;
    let alive = true;
    void (async () => {
      const located = await currentLocation();
      if (alive) await apply(located);
    })();
    return () => {
      alive = false;
    };
  }, [auto, apply]);

  /** 「現在地を使う」を押したとき。押したことを覚え（次から開いた瞬間に入れる）、取り直す。 */
  const locateNow = () => {
    rememberLocationConsent();
    setLocate("locating");
    void (async () => apply(await currentLocation()))();
  };

  /**
   * 「今すぐ探す」の起点に使う座標。持っていなければその場で取る（地名は問い合わせない＝地図のサービスへは送らない）。
   * ブラウザが何も返さないまま「探しています…」で止まらないよう、上限つきで待つ（2026-09-25 レビューの指摘）。
   */
  const pointForSearch = async (): Promise<Point | ApiFailure> => {
    if (here !== null) return here;
    const located = await currentLocation({ bounded: true });
    if (isFailure(located)) {
      setLocate(failedState(located));
      return located;
    }
    return { lat: located.lat, lng: located.lng };
  };

  return { locate, here, hereLabel, locateNow, pointForSearch };
};
