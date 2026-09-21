"use client";

// 期限切れの表示（要件11の基準 11.5〜11.9。設計書「画面と入口」の期限切れの行）。
//
// 出すものは応答の `expired` が決める（判断は `domain/customerHome` の側。ここは描くだけ）:
//   - `showCode` … 期限から20分の間だけ、コード・店名・人数と「店の人に見せてください」を出す（基準 11.6・11.7）。
//                  20分を過ぎるとサーバーはコードを空にして `showCode: false` を返すので、案内も引っ込める。
//   - `canRetry` … 受け取れる状態で人数も収まっているなら「同じ人数で受け取り直す」（基準 11.8）、
//                  そうでなければ取得し直す入口（基準 11.9）。**両方は出さない**。
//
// 受け取り直しが断られたときは、**押した操作の場所**に結果のカードと同じ `RefusalNotice` を出す
// （設計書「受け取りが断られたとき」の3・5。理由の近くに出し、別の画面へ飛ばさない）。
// 表示そのものは断りの応答に載った新しいホームで入れ物が作り直すので、この部品は渡された値を描くだけ。

import type { ExpiredDto, ReceiveRefusal, ReservationDto } from "./home";
import { RefusalNotice } from "./RefusalNotice";

type ExpiredViewProps = {
  reservation: ReservationDto;
  expired?: ExpiredDto;
  /** 受け取り直しが断られたとき（無ければ何も出さない）。 */
  refusal?: ReceiveRefusal | null;
  onRetry: () => void;
  onNextStep: () => void;
  onSearchAgain: () => void;
};

export const ExpiredView = ({ reservation, expired, refusal = null, onRetry, onNextStep, onSearchAgain }: ExpiredViewProps) => {
  // 応答に `expired` が無い形でも表示を止めない（コードは出さず、取得し直す入口だけにする）
  const showCode = expired?.showCode ?? false;
  const canRetry = expired?.canRetry ?? false;
  return (
    <section data-testid="view-expired">
      <h2>確保の期限が切れました</h2>
      {showCode ? (
        <>
          <p className="reservation-code" data-testid="reservation-code">
            {reservation.code}
          </p>
          <h3 data-testid="reservation-store">{reservation.storeName}</h3>
          <p data-testid="reservation-party">{reservation.party}名</p>
          <p>お店に着いているなら、この画面を店の人に見せてください。</p>
        </>
      ) : null}
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
