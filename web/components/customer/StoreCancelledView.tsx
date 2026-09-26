"use client";

// 店が確保を取り消したときの表示（要件9の基準 9.6・9.14）。理由（店の都合か、来店なし）と、取得し直す入口を出す。
// 客に落ち度は無いので、責める語は使わない（`domain/texts` と同じ決め）。

//
// 2026-09-25 監査の指摘 横断-09: 店まで歩いて行って断られた客が運営へ知らせられるよう、通報の入口
// （呼ぶ側の CustomerApp が組む `children`）を置く。入口の側も、店に取り消された確保を7日間は受け付ける。

import type { ReactNode } from "react";
import type { ReservationDto } from "./home";

type StoreCancelledViewProps = {
  reservation: ReservationDto;
  onSearchAgain: () => void;
  /** 通報の入口（呼ぶ側が組む。完了済みの表示と同じ置き方） */
  children?: ReactNode;
};

/** 店が「来ない（枠を戻す）」で取り消した確保の見出し（基準 9.14・2026-09-26 本人選択）。責める語は使わない */
export const NO_SHOW_CANCELLED_TEXT = "お店が来店なしでキャンセルしました";
export const STORE_CANCELLED_TEXT = "店の都合で確保がキャンセルされました";

export const StoreCancelledView = ({ reservation, onSearchAgain, children = null }: StoreCancelledViewProps) => (
  <section data-testid="view-store_cancelled">
    <h2>{reservation.cancelReason === "no_show" ? NO_SHOW_CANCELLED_TEXT : STORE_CANCELLED_TEXT}</h2>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p>ほかのお店を探し直せます。</p>
    <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
      ほかの店を探す
    </button>
    {children}
  </section>
);

export default StoreCancelledView;
