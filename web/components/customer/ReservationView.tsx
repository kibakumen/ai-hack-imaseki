"use client";

// 確保中の表示（要件9の基準 9.1・9.2・9.13。設計書「画面と入口」の確保中の行）。
// 店頭でこの画面を見せるだけで入れるように、**コードをいちばん大きく**出し、店名・住所・人数・
// 期限の時刻・受け取った時点のクーポン（基準 16.6 の写し）を並べる。
// 受け取った時点でクーポンが1つも無ければ、欄は残して中を空にする（基準 9.13）。
//
// 表示の切り替え（いつこの表示を出すか）は入れ物（`CustomerApp`）が持ち、ここは渡された確保を描くだけ。
//
// ⚠️ タスク15 が「確保を取り消す」と「人数を変える」をここへ足す（要件10）。人数の変更の断りは
// `failure` の受け皿に入れて `InputRefusal` が描く（設計書「入力の誤りの出し方」の 10.5・10.7 の行）。
// ⚠️ タスク23 が通報の入口を、タスク19 が通知の説明をここへ足す。

import type { ApiFailure } from "../../lib/client/api";
import { PushPrompt } from "./PushPrompt";
import { timeInJst } from "../store/jstTime";
import { FormMessage } from "../ui/InputRefusal";
import type { ReservationDto } from "./home";

type ReservationViewProps = {
  reservation: ReservationDto;
  /** 「ほかの店を探す」＝確保を持ったまま取得の画面へ（基準 8.10 の入口）。 */
  onSearchMore: () => void;
  /**
   * 確保への操作が断られたときの受け皿（タスク15 の人数の変更で使う）。
   * 項目に帰せる断りは項目の直下に出るので、ここでは操作の直下の分だけを出す。
   */
  failure?: ApiFailure | null;
  /** まだ通知を許可していない客だけ true（要件22の基準 22.8・タスク19） */
  pushPromptDue?: boolean;
};

export const ReservationView = ({ reservation, onSearchMore, failure = null, pushPromptDue = false }: ReservationViewProps) => (
  <section data-testid="view-active">
    <PushPrompt due={pushPromptDue} />
    <h2>席を確保しました</h2>
    <p className="reservation-code" data-testid="reservation-code">
      {reservation.code}
    </p>
    <p>お店でこの番号を見せてください。</p>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p data-testid="reservation-address">{reservation.storeAddress}</p>
    <p data-testid="reservation-party">{reservation.party}名</p>
    <p data-testid="reservation-expires">期限 {timeInJst(reservation.expiresAt)} まで</p>
    <p>クーポン</p>
    {/* 受け取った時点の写しをそのまま出す。1つも無ければ中は空（基準 9.13） */}
    <ul className="coupon-list" data-testid="coupon-list">
      {reservation.coupons.map((coupon, index) => (
        <li key={`${coupon.name}-${index}`}>
          {coupon.name}
          {coupon.note === "" ? null : `（${coupon.note}）`}
        </li>
      ))}
    </ul>
    {reservation.storeUrl === null ? null : (
      <a href={reservation.storeUrl} target="_blank" rel="noreferrer">
        お店のホームページを見る
      </a>
    )}
    <button type="button" data-testid="btn-search-more" onClick={onSearchMore}>
      ほかの店を探す
    </button>
    <FormMessage failure={failure} fieldNames={["party"]} />
  </section>
);

export default ReservationView;
