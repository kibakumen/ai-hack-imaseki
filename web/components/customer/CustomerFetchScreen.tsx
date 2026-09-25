"use client";

// 取得の画面（場所・人数・条件の入力と結果の一覧。2026-09-25 監査の指摘 設計-16 で CustomerApp から分けた。振る舞いは
// 分ける前と同じ）。状態は持たない——結果・人数・条件の開け閉めは useFetchResults、受け取りは入れ物（CustomerApp）が持つ。

import type { Ref } from "react";
import { FetchForm, type FetchResult } from "./FetchForm";
import type { HomeDto, ReservationDto } from "./home";
import { HomeScreenHint } from "./HomeScreenHint";
import { PreviousCompletedEntry } from "./PreviousCompleted";
import { ResultList, type ResultItem } from "./ResultList";
import type { RefusedReceive } from "./useFetchResults";

type CustomerFetchScreenProps = {
  home: HomeDto;
  /** 取得の画面の続き（useFetchResults が持つ値をそのまま渡す） */
  fetchResult: FetchResult | null;
  refused: RefusedReceive | null;
  party: string;
  conditionsOpen: boolean;
  /** 条件を開き直したときに戻す位置（取得の画面の囲い） */
  sectionRef: Ref<HTMLElement>;
  onPartyChange: (party: string) => void;
  onResults: (result: FetchResult | null) => void;
  onToggleConditions: () => void;
  /** 確保中の確保を持ったまま探しているか（基準 8.10。条件の上に戻る道を常に出す・客-03） */
  holding: boolean;
  /** 既定の幅を過ぎた完了済み（取得の画面のときだけ載る・基準 9.4） */
  previous: ReservationDto | undefined;
  /** 受け取りを送っている結果の番号（横断-03） */
  receiving: string | null;
  resultsHeadingRef: Ref<HTMLHeadingElement>;
  onReceive: (item: ResultItem) => void;
  onNextStep: () => void;
  onBackToReservation: () => void;
  onOpenPrevious: () => void;
};

export const CustomerFetchScreen = ({
  home,
  fetchResult,
  refused,
  party,
  conditionsOpen,
  sectionRef,
  onPartyChange,
  onResults,
  onToggleConditions,
  holding,
  previous,
  receiving,
  resultsHeadingRef,
  onReceive,
  onNextStep,
  onBackToReservation,
  onOpenPrevious,
}: CustomerFetchScreenProps) => {
  // 結果が1件以上あるときだけ条件を畳む（断られたとき・0件のときは畳まない——入れ直したい人が欄にたどり着けるように）
  const hasItems = fetchResult !== null && fetchResult.items.length > 0;
  const collapsed = hasItems && !conditionsOpen;
  return (
    <section ref={sectionRef} className={hasItems ? "fetch-screen fetch-screen--with-fab" : "fetch-screen"}>
      {previous !== undefined && fetchResult === null ? <PreviousCompletedEntry reservation={previous} onOpen={onOpenPrevious} /> : null}
      {/* ホーム画面への追加は、確保を持っていないときだけ勧める（客-04 の案A） */}
      {home.reservation === undefined ? <HomeScreenHint /> : null}
      {/* 確保を持ったまま探している間は、条件の上に戻る道を常に出す（客-03。条件を畳んでも隠れない位置） */}
      {holding ? (
        <p className="hold-banner" data-testid="hold-banner">
          <span>今の確保はそのままです。</span>
          <button type="button" data-testid="btn-back-to-reservation" onClick={onBackToReservation}>
            確保中の表示へ戻る
          </button>
        </p>
      ) : null}
      <FetchForm
        profile={home.profile}
        party={party}
        onPartyChange={onPartyChange}
        onResults={onResults}
        noResults={fetchResult !== null && fetchResult.items.length === 0}
        collapsed={collapsed}
      />
      {hasItems ? (
        <button type="button" className="conditions-fab" data-testid="btn-change-conditions" aria-expanded={!collapsed} onClick={onToggleConditions}>
          {collapsed ? "条件を変える" : "条件を閉じる"}
        </button>
      ) : null}
      {fetchResult === null ? null : (
        <ResultList
          items={fetchResult.items}
          onReceive={onReceive}
          refusal={refused !== null && refused.offerId !== null ? { offerId: refused.offerId, body: refused.body } : null}
          onNextStep={onNextStep}
          holding={home.kind === "active"}
          receiving={receiving}
          headingRef={resultsHeadingRef}
        />
      )}
    </section>
  );
};
