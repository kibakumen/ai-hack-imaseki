"use client";

// 期限切れの表示（要件11の基準 11.5〜11.9。設計書「画面と入口」の期限切れの行）。
//
// 出すものは応答の `expired` が決める（判断は `domain/customerHome` の側。ここは描くだけ）:
//   - `showCode` … 期限から20分の間だけ、コード・店名・人数と「店の人に見せてください」を出す（基準 11.6・11.7）。
//                  20分を過ぎるとサーバーはコードを空にして `showCode: false` を返すので、案内も引っ込める。
//   - `canRetry` … 受け取れる状態で人数も収まっているなら「同じ人数で受け取り直す」（基準 11.8）、
//                  そうでなければ取得し直す入口（基準 11.9）。**両方は出さない**。
//
//   - `partyMax` … 「何名まで」が下がっていて受け取り直せないとき、その人数を言う（探し直すと入れ物がその人数を
//                  人数の欄へ入れる）。
//
// 20分の猶予の間は、店の住所と経路のボタンも出す（道に迷って1分過ぎた客が店にたどり着けるように）。店名は
// 猶予を過ぎても出す（どの店の確保だったか分かるように）。2026-09-25 監査の指摘 客-06——以前は期限が切れると
// 住所・経路と受け取り直せない理由が消え、20分を過ぎると店名まで消えた。
//
// 受け取り直しが断られたときは、**押した操作の場所**に結果のカードと同じ `RefusalNotice` を出す
// （設計書「受け取りが断られたとき」の3・5。理由の近くに出し、別の画面へ飛ばさない）。
// 表示そのものは断りの応答に載った新しいホームで入れ物が作り直すので、この部品は渡された値を描くだけ。

import type { SearchOrigin } from "../../lib/client/lastOrigin";
import type { ExpiredDto, ReceiveRefusal, ReservationDto } from "./home";
import { RefusalNotice } from "./RefusalNotice";
import { RouteButton } from "./RouteButton";

type ExpiredViewProps = {
  reservation: ReservationDto;
  expired?: ExpiredDto;
  /** 受け取り直しが断られたとき（無ければ何も出さない）。 */
  refusal?: ReceiveRefusal | null;
  onRetry: () => void;
  onNextStep: () => void;
  onSearchAgain: () => void;
  /** 経路の出発地（確保中の画面と同じ値）。分からなければ null */
  from?: SearchOrigin | null;
};

export const ExpiredView = ({ reservation, expired, refusal = null, onRetry, onNextStep, onSearchAgain, from = null }: ExpiredViewProps) => {
  // 応答に `expired` が無い形でも表示を止めない（コードは出さず、取得し直す入口だけにする）
  const showCode = expired?.showCode ?? false;
  const canRetry = expired?.canRetry ?? false;
  const partyMax = canRetry ? undefined : expired?.partyMax;
  return (
    <section data-testid="view-expired">
      <h2>確保の期限が切れました</h2>
      <h3 data-testid="reservation-store">{reservation.storeName}</h3>
      {showCode ? (
        <>
          <p className="reservation-code" data-testid="reservation-code">
            {reservation.code}
          </p>
          <p data-testid="reservation-party">{reservation.party}名</p>
          <p className="expired-address" data-testid="reservation-address">
            {reservation.storeAddress}
          </p>
          <p>お店に着いているなら、この画面を店の人に見せてください。</p>
          <RouteButton destination={reservation} from={from} />
        </>
      ) : null}
      {partyMax === undefined ? null : (
        <p className="expired-party-max" data-testid="expired-party-max">
          この店は今{partyMax}名までです。同じ人数では受け取り直せません。探し直すときは{partyMax}名で探します。
        </p>
      )}
      {refusal === null ? null : <RefusalNotice refusal={refusal} onNextStep={onNextStep} />}
      {canRetry ? (
        <button type="button" data-testid="btn-retry" onClick={onRetry}>
          同じ人数で受け取り直す
        </button>
      ) : (
        <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
          ほかの店を探し直す
        </button>
      )}
    </section>
  );
};

export default ExpiredView;
