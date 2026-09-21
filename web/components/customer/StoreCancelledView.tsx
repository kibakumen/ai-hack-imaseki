"use client";

// 店が確保を取り消したときの表示（要件9の基準 9.6）。理由（店の都合）と、取得し直す入口を出す。
// 客に落ち度は無いので、責める語は使わない（`domain/texts` と同じ決め）。

import type { ReservationDto } from "./home";

type StoreCancelledViewProps = {
  reservation: ReservationDto;
  onSearchAgain: () => void;
};

export const StoreCancelledView = ({ reservation, onSearchAgain }: StoreCancelledViewProps) => (
  <section data-testid="view-store_cancelled">
    <h2>店の都合で確保が取り消されました</h2>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p>ほかのお店を探し直せます。</p>
    <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
      ほかの店を探す
    </button>
  </section>
);

export default StoreCancelledView;
