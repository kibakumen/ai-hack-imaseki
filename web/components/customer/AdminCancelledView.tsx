"use client";

// 運営が店を止めて確保が取り消されたときの表示（要件9の基準 9.7）。止まったのは店の側で、
// 客に落ち度は無いことが分かる言い方にする。取得し直す入口を出す。

import type { ReservationDto } from "./home";

type AdminCancelledViewProps = {
  reservation: ReservationDto;
  onSearchAgain: () => void;
};

export const AdminCancelledView = ({ reservation, onSearchAgain }: AdminCancelledViewProps) => (
  <section data-testid="view-admin_cancelled">
    <h2>運営がこのお店を停止したため、確保が取り消されました</h2>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p>ほかのお店を探し直せます。</p>
    <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
      ほかの店を探す
    </button>
  </section>
);

export default AdminCancelledView;
