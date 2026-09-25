"use client";

// 確保を持つ客の表示（設計書「客の画面」の優先の順の2〜5）。表示の種類ごとに部品が1つ（2026-09-25 監査の指摘 設計-16 で
// CustomerApp から分けた。振る舞いは分ける前と同じ）。どれを出すかはサーバーが返した種類で決まり、ここは描き分けるだけ。

import type { ReactNode } from "react";
import type { SearchOrigin } from "../../lib/client/lastOrigin";
import { AdminCancelledView } from "./AdminCancelledView";
import { CompletedView } from "./CompletedView";
import { ExpiredView } from "./ExpiredView";
import type { HomeDto, ReservationDto } from "./home";
import { ReservationView } from "./ReservationView";
import { StoreCancelledView } from "./StoreCancelledView";
import type { RefusedReceive } from "./useFetchResults";

type CustomerReservationScreenProps = {
  home: HomeDto;
  /** 取得の画面から開いた前回の完了済み（基準 9.4・不具合-18）。開いていなければ undefined */
  previous: ReservationDto | undefined;
  /** 経路の出発地（確保中の画面と確定の演出が同じ値を使う） */
  routeFrom: SearchOrigin | null;
  refused: RefusedReceive | null;
  /** 受け取り直しを送っている間 true */
  retrying: boolean;
  /** その表示の囲いの中に置く通報ボタン（基準 26.1）。置かない表示では null */
  reportFor: (reservation: ReservationDto) => ReactNode;
  reportEntry: ReactNode;
  onChanged: (home?: unknown, done?: string) => void;
  onSearchMore: () => void;
  onClosePrevious: () => void;
  onRetry: () => void;
  onNextStep: () => void;
  onSearchAgain: () => void;
};

export const CustomerReservationScreen = ({
  home,
  previous,
  routeFrom,
  refused,
  retrying,
  reportFor,
  reportEntry,
  onChanged,
  onSearchMore,
  onClosePrevious,
  onRetry,
  onNextStep,
  onSearchAgain,
}: CustomerReservationScreenProps) => {
  // 取得の画面から開いた前回の完了済み（基準 9.4）。「ほかの店を探す」で取得の画面へ戻る
  if (previous !== undefined) {
    return (
      <CompletedView reservation={previous} onSearchAgain={onClosePrevious}>
        {reportFor(previous)}
      </CompletedView>
    );
  }
  const reservation = home.reservation;
  if (reservation === undefined) return null;
  switch (home.kind) {
    case "active":
      return (
        <ReservationView pushPromptDue={home.pushPromptDue === true} reservation={reservation} from={routeFrom} onChanged={onChanged} onSearchMore={onSearchMore}>
          {reportEntry}
        </ReservationView>
      );
    case "expired":
      return (
        <ExpiredView
          reservation={reservation}
          expired={home.expired}
          refusal={refused === null ? null : refused.body}
          onRetry={onRetry}
          retrying={retrying}
          onNextStep={onNextStep}
          onSearchAgain={onSearchAgain}
          from={routeFrom}
        />
      );
    case "completed":
      return (
        <CompletedView reservation={reservation} onSearchAgain={onSearchAgain}>
          {reportEntry}
        </CompletedView>
      );
    case "store_cancelled":
      return (
        <StoreCancelledView reservation={reservation} onSearchAgain={onSearchAgain}>
          {reportEntry}
        </StoreCancelledView>
      );
    case "admin_cancelled":
      return <AdminCancelledView reservation={reservation} onSearchAgain={onSearchAgain} />;
    default:
      return null;
  }
};
