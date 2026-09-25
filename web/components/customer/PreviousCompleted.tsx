"use client";

// 前回の完了済みを開く1行（要件9の基準 9.4・2026-09-25 監査の指摘 不具合-18 の案A）。
//
// 完了済みの表示は既定の幅（`domain/customerHome` の `COMPLETED_VIEW_MS`）を過ぎると取得の画面に替わる。
// そのあとも次の確保を作るまでは、取得の画面の上のこの1行から完了済みの表示を開ける（設計書「客の画面」の
// 優先の順の5の注）。載せるかどうかはサーバーが決め（応答の `previousCompleted`）、ここは描くだけ。

import type { ReservationDto } from "./home";

type PreviousCompletedEntryProps = {
  reservation: ReservationDto;
  onOpen: () => void;
};

export const PreviousCompletedEntry = ({ reservation, onOpen }: PreviousCompletedEntryProps) => (
  <p className="previous-completed">
    <button type="button" className="previous-completed__open" data-testid="btn-open-previous" onClick={onOpen}>
      前回: {reservation.storeName}（完了済み）を開く
    </button>
  </p>
);

export default PreviousCompletedEntry;
