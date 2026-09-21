"use client";

// 完了済みの表示（要件9の基準 9.3・9.4）。店が来店を確定したあと、次の確保を作るまでは開ける。
// コードは役目を終えているので出さない（店頭での照合はもう済んでいる）。
//
// 通報の入口（要件26の基準 26.1）は入れ物（`CustomerApp`）が中身として渡す（`children`）
// ——「最近行った店」への入口は表示をまたいで出るので、入れ物の側に置いてある（基準 26.14）。

import type { ReactNode } from "react";
import type { ReservationDto } from "./home";

type CompletedViewProps = {
  reservation: ReservationDto;
  onSearchAgain: () => void;
  /** この囲いの中に置く入口（通報ボタン・基準 26.1）。 */
  children?: ReactNode;
};

export const CompletedView = ({ reservation, onSearchAgain, children = null }: CompletedViewProps) => (
  <section data-testid="view-completed">
    <h2>来店が完了しました</h2>
    <h3 data-testid="reservation-store">{reservation.storeName}</h3>
    <p>ご来店ありがとうございました。</p>
    <button type="button" data-testid="btn-search-again" onClick={onSearchAgain}>
      ほかの店を探す
    </button>
    {children}
  </section>
);

export default CompletedView;
