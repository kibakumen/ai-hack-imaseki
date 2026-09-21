"use client";

// 完了済みの表示（要件9の基準 9.3・9.4）。店が来店を確定したあと、次の確保を作るまでは開ける。
// コードは役目を終えているので出さない（店頭での照合はもう済んでいる）。
//
// ⚠️ タスク23 が通報の入口と「最近行った店」への入口をここへ足す（要件26）。

import type { ReservationDto } from "./home";

type CompletedViewProps = {
  reservation: ReservationDto;
  onSearchAgain: () => void;
};

export const CompletedView = ({ reservation, onSearchAgain }: CompletedViewProps) => (
  <section data-testid="view-completed">
    <h2>来店が完了しました</h2>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p>ご来店ありがとうございました。</p>
    <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
      ほかの店を探す
    </button>
  </section>
);

export default CompletedView;
