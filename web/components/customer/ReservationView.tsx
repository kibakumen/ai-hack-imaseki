"use client";

// 確保中の表示（要件9の基準 9.1・9.2・9.13。設計書「画面と入口」の確保中の行）。
// 店頭でこの画面を見せるだけで入れるように、**コードをいちばん大きく**出し、店名・住所・人数・
// 期限の時刻・受け取った時点のクーポン（基準 16.6 の写し）を並べる。
// 受け取った時点でクーポンが1つも無ければ、欄は残して中を空にする（基準 9.13）。
//
// 表示の切り替え（いつこの表示を出すか）は入れ物（`CustomerApp`）が持ち、ここは渡された確保を描くだけ。
//
// 「確保を取り消す」と「人数を変える」（要件10）は `ReservationActions` が持ち、この囲いの中に置く
// ——断りの出し場所（人数の欄の直下・操作の直下）もあちらの受け持ち。
// 通報の入口（要件26の基準 26.1）は入れ物（`CustomerApp`）が中身として渡す（`children`）。
// 通知の説明（`PushPrompt`）は要件22の基準 22.8。
//
// 「Googleマップで経路を開く」を**半券のすぐ下**に置く（2026-09-22 の本人の指摘「確保の画面に戻ったら
// Googleマップを探すボタンに辿り着けなくなるので、この画面にもおくようにしてほしい」）。向かうのが主で、
// 人数の変更・取り消しは従——だから操作の囲いより上。リンクの中身は確定の演出（`ClaimedCelebration`）と
// 同じ `routeHref`。出発地は入れ物が渡す（確保の応答の起点 → 探した結果 → タブの覚え。無ければ付けない）。
// ⚠️ `<a href="https://…">` ではなく **`<button>` で開く**——受け入れ検査 r09 の 9.1 が「店の URL が無ければ
//    `view-active` の中に http のリンクが1つも無い」を固定しており、その検査は変えられない。

import type { ReactNode } from "react";
import type { ApiFailure } from "../../lib/client/api";
import { routeHref, type SearchOrigin } from "../../lib/client/lastOrigin";
import { CouponPickNote } from "./CouponPickNote";
import { PushPrompt } from "./PushPrompt";
import { ReservationActions } from "./ReservationActions";
import { timeInJst } from "../ui/jstTime";
import { FormMessage } from "../ui/InputRefusal";
import type { ReservationDto } from "./home";

type ReservationViewProps = {
  reservation: ReservationDto;
  /** 「ほかの店を探す」＝確保を持ったまま取得の画面へ（基準 8.10 の入口）。 */
  onSearchMore: () => void;
  /**
   * 取り消し・人数の変更が通ったときの新しいホーム（`ReservationActions` からそのまま上がる）。
   * 今の状態と衝突して断られたときは何も渡さず呼ばれる＝入れ物がホームを取り直す（基準 10.3・9.8）。
   */
  onChanged: (home?: unknown) => void;
  /**
   * 確保への操作が断られたときの受け皿（タスク15 の人数の変更で使う）。
   * 項目に帰せる断りは項目の直下に出るので、ここでは操作の直下の分だけを出す。
   */
  failure?: ApiFailure | null;
  /** まだ通知を許可していない客だけ true（要件22の基準 22.8・タスク19） */
  pushPromptDue?: boolean;
  /** この囲いの中に置く入口（通報ボタン・基準 26.1）。 */
  children?: ReactNode;
  /** 経路の出発地（探したときの起点）。分からなければ null＝`origin` を付けずに開く（マップが現在地から引く）。 */
  from?: SearchOrigin | null;
};

/** 新しいタブで開く（リンクと同じ振る舞い。`noopener` で開いた側からこの画面を触れなくする）。 */
const openRoute = (href: string) => {
  window.open(href, "_blank", "noopener,noreferrer");
};

export const ReservationView = ({ reservation, onSearchMore, onChanged, failure = null, pushPromptDue = false, children = null, from = null }: ReservationViewProps) => {
  const route = routeHref(reservation, from);
  return (
    <section className="claim-view" data-testid="view-active">
      <PushPrompt due={pushPromptDue} />

      {/* 店頭で見せる面。番号をいちばん大きく、そのまわりに店名と期限を置く（基準 9.1・9.2） */}
      <div className="claim-ticket">
        <p className="claim-ticket__eyebrow">確保できました</p>
        <h2 className="claim-ticket__title">席を確保しました</h2>
        <p className="reservation-code claim-ticket__code" data-testid="reservation-code">
          {reservation.code}
        </p>
        <p className="claim-ticket__hint">お店でこの番号を見せてください。</p>
        <h3 className="claim-ticket__store" data-testid="reservation-store">
          {reservation.storeName}
        </h3>
        <p className="claim-ticket__address" data-testid="reservation-address">
          {reservation.storeAddress}
        </p>
        <p className="claim-ticket__facts">
          <span data-testid="reservation-party">{reservation.party}名</span>
          <span aria-hidden>・</span>
          <span data-testid="reservation-expires">期限 {timeInJst(reservation.expiresAt)} まで</span>
        </p>
      </div>

      {/* 店へ向かう導線。半券の直下・操作の囲いより上（向かうのが主）。`data-href` は検査が開く先を読むため */}
      {route === null ? null : (
        <button type="button" className="claimed-route claim-route" data-testid="btn-route" data-href={route} onClick={() => openRoute(route)}>
          Googleマップで経路を開く
        </button>
      )}

      <div className="claim-coupons">
        <p className="claim-coupons__label">クーポン</p>
        {/* 受け取った時点の写しをそのまま出す。1つも無ければ中は空（基準 9.13）。
            「案内はありません」の文は**この欄の外**に置く（受け入れ検査が欄そのものの空を見ている）。 */}
        <ul className="coupon-list offer-coupons" data-testid="coupon-list">
          {reservation.coupons.map((coupon, index) => (
            <li className="offer-coupon" key={`${coupon.name}-${index}`}>
              <span aria-hidden className="offer-coupon__mark">
                🎟️
              </span>
              <span className="offer-coupon__body">
                <span className="offer-coupon__name">{coupon.name}</span>
                {coupon.note === "" ? null : <span className="offer-coupon__note">（{coupon.note}）</span>}
              </span>
            </li>
          ))}
        </ul>
        <CouponPickNote count={reservation.coupons.length} />
        {reservation.coupons.length === 0 ? <p className="claim-coupons__none">クーポンの案内はありません。</p> : null}
      </div>

      {reservation.storeUrl === null ? null : (
        <a className="claim-view__link" href={reservation.storeUrl} target="_blank" rel="noreferrer">
          お店のホームページを見る
        </a>
      )}

      <ReservationActions reservation={reservation} onChanged={onChanged} />

      <div className="claim-view__quiet">
        <button type="button" data-testid="btn-search-more" onClick={onSearchMore}>
          ほかの店を探す
        </button>
        {children}
      </div>

      <FormMessage failure={failure} fieldNames={["party"]} />
    </section>
  );
};

export default ReservationView;
