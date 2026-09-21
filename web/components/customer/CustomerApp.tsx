"use client";

// 客の画面（/me）の入れ物。ホームの入口を10秒ごとに取り直し、返ってきた**表示の種類をそのまま描く**
// （設計書「客の画面」の優先の順。どれを出すかの判断はサーバー側の `domain/customerHome` が持つ）。
// 識別子が無い・受け付けられない（見分けの断り）なら登録の入力を出し、取得の画面は出さない
// （基準 1.10・1.11）。登録が済んだ客には取得の画面を出す（基準 1.8）。
//
// この入れ物が持っているのは、表示の種類に**含まれない6つ**だけ:
//   1. 取得の結果と人数（取得の画面の続き。人数は結果の側から入れ替わるので外に置く）
//   2. 受け取り・受け取り直しが断られた1件（どのカードの中に出すか・基準 8.6）
//   3. 確保を持ったまま「ほかの店を探す」を押したか（基準 8.10。サーバーは確保中のままを返す）
//   4. 取り直しが通信の失敗に終わったか（端末に残した内容へ倒す・基準 9.10・9.11）
//   5. 開いている脇の画面（最近行った店・登録の確認と消去。同時には1つだけ・基準 26.14・28.4）
//   6. 通報が指している店（基準 26.1・26.17。断られても元の表示のままにするため外に置く）
//
// 受け取り・受け取り直しの応答は、通っても断られても**新しいホームを連れてくる**ので、それで
// 表示を作り直す（設計書「受け取りが断られたとき」の4）。確保への操作（取り消し・人数の変更）も
// 同じで、応答の `home` をそのまま使う（`applyHome`）。次の一手をどこへ繋ぐかはここが決め、
// 断りの文とボタンの文は `RefusalNotice` が `domain/texts` から引く。

import { useState } from "react";
import { apiCall, isFailure, isNetworkFailure } from "../../lib/client/api";
import { clearHome as clearCachedHome, loadHome as loadCachedHome, saveHome as saveCachedHome } from "../../lib/client/reservationCache";
import { usePolling } from "../../lib/client/usePolling";
import { AccountSettings } from "./AccountSettings";
import { AdminCancelledView } from "./AdminCancelledView";
import { CompletedView } from "./CompletedView";
import { ExpiredView } from "./ExpiredView";
import { FetchForm, type FetchResult } from "./FetchForm";
import type { HomeDto, ReceiveRefusal } from "./home";
import { RecentStores } from "./RecentStores";
import { RegisterForm } from "./RegisterForm";
import { ReportForm, type ReportTarget } from "./ReportForm";
import { ReservationView } from "./ReservationView";
import { ResultList, type ResultItem } from "./ResultList";
import { StoreCancelledView } from "./StoreCancelledView";

/** 断られた1件。`offerId` は結果のカードに出すため（受け取り直しは押した場所が1つなので null）。 */
type RefusedReceive = { offerId: string | null; body: ReceiveRefusal };

/**
 * 断りの表示を重ねる表示の種類（設計書「受け取りが断られたとき」の4）。
 * 取得の画面は押したカードの中、期限切れの表示は押した操作の場所に出す。
 * 確保中・取り消し・完了済みに変わったときは**重ねない**——新しい表示そのものが答えなので。
 */
const KEEPS_REFUSAL: ReadonlyArray<HomeDto["kind"]> = ["fetch", "expired"];

/** 通報ボタンを置く表示（基準 26.1）。期限切れと取り消しの表示には置かない。 */
const REPORT_VIEW_KINDS: ReadonlyArray<HomeDto["kind"]> = ["active", "completed"];
/**
 * 「最近行った店」と「登録の確認と消去」の入口を置く表示（基準 26.14・28.4）。客が画面を開いた
 * ときにまず出る3つで、期限切れと取り消しの表示には置かない（店へ向かう途中で出る表示・要件26の補足）。
 */
const RECENT_ENTRY_KINDS: ReadonlyArray<HomeDto["kind"]> = ["fetch", "active", "completed"];

/** 開いている脇の画面（同時には1つだけ）。 */
type Panel = "none" | "recent" | "settings";

export const CustomerApp = () => {
  const [home, setHome] = useState<HomeDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  // 人数の初めの値は置かない（要件3の補足。前回の人数が残ると人数の変化を見落とす）。
  const [party, setParty] = useState("");
  const [refused, setRefused] = useState<RefusedReceive | null>(null);
  const [searching, setSearching] = useState(false);
  // 脇の画面（最近行った店・登録の確認と消去）と、通報が指している店。どちらも表示の種類とは別に持つ
  // ——断られたときに元の表示のまま文を出す必要があるため（基準 26.19・28.5）。
  const [panel, setPanel] = useState<Panel>("none");
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  /** 取り直しが成功したホームを端末に残す（確保が無いホームは残すものが無いので消す）。 */
  const keep = (next: HomeDto) => {
    if (next.reservation === undefined) clearCachedHome();
    else saveCachedHome(next);
  };

  /** ホームを取り直して表示を決める（開いた時と10秒ごと・基準 9.8・9.9）。 */
  const refresh = async (): Promise<void> => {
    const result = await apiCall<HomeDto>("GET", "/api/customer/home");
    setLoaded(true);
    if (!isFailure(result)) {
      setHome(result);
      setStale(false);
      keep(result);
      return;
    }
    // 通信の失敗だけ、端末に残した内容へ倒す（基準 9.10・9.11）
    if (isNetworkFailure(result)) {
      const kept = home ?? loadCachedHome<HomeDto>();
      setHome(kept);
      setStale(kept !== null);
      return;
    }
    // 見分けの断り（401）は登録の入力へ（基準 1.10・1.11）
    setHome(null);
    setStale(false);
  };

  usePolling(refresh);

  /** 受け取り・受け取り直しの応答（通った／断られた）で、表示を作り直す。 */
  const applyReceived = (result: unknown, offerId: string | null) => {
    const failure = isFailure(result) ? result : null;
    const body = failure === null ? undefined : (failure.refusal as ReceiveRefusal | undefined);
    // 応答に `home` が無い形でも表示を消さない（今の表示のまま、断りだけを出す）
    const responded = (failure === null ? (result as { home?: HomeDto }).home : (failure.home as HomeDto | undefined)) ?? home;
    if (responded !== null) {
      setHome(responded);
      setLoaded(true);
      setStale(false);
      keep(responded);
      if (responded.kind !== "fetch") setSearching(false);
    }
    const keepsNotice = responded !== null && KEEPS_REFUSAL.includes(responded.kind);
    setRefused(body !== undefined && keepsNotice ? { offerId, body } : null);
    // 通ったときは結果の一覧を片づける（確保中の表示へ移る・基準 8.5）
    if (failure === null) setFetchResult(null);
  };

  /**
   * 確保への操作（取り消し・人数の変更）の応答で表示を作り直す（`ReservationActions` の `onChanged`）。
   * 応答が新しいホームを連れてきたらそれで作り直し、連れてこない（今の状態と衝突した）なら取り直す
   * （基準 10.3・9.8）。
   */
  const applyHome = (next?: unknown) => {
    if (next === undefined || next === null) {
      void refresh();
      return;
    }
    const responded = next as HomeDto;
    setHome(responded);
    setLoaded(true);
    setStale(false);
    keep(responded);
    if (responded.kind !== "fetch") setSearching(false);
  };

  /** 結果から1件を受け取る（基準 8.1・8.5・8.6）。人数とどの取得から選んだかを一緒に送る。 */
  const receive = async (item: ResultItem): Promise<void> => {
    if (fetchResult === null) return;
    const result = await apiCall("POST", "/api/customer/reservations", { offerId: item.offerId, party: fetchResult.party, fetchId: fetchResult.fetchId });
    applyReceived(result, item.offerId);
  };

  /** 期限切れから同じ人数で受け取り直す（基準 11.8・11.10）。人数は元の確保から取るので送らない。 */
  const retry = async (): Promise<void> => {
    const id = home?.reservation?.id;
    if (id === undefined) return;
    const result = await apiCall("POST", "/api/customer/reservations", { retryOf: id });
    applyReceived(result, null);
  };

  /** 断りの「次の一手」の行き先（文は `RefusalNotice`、行き先はここ・設計書の3）。 */
  const takeNextStep = () => {
    if (refused === null) return;
    const step = refused.body.nextStep;
    setRefused(null);
    if (step === "back_to_reservation") {
      setSearching(false);
      return;
    }
    if (step === "retry_same_party") {
      void retry();
      return;
    }
    // 「◯名で探し直す」は、その人数を入れた取得の画面へ（人数を減らせば取れる客を振り出しに戻さない）
    if (step === "search_again_with_party" && refused.body.partyMax !== undefined) setParty(String(refused.body.partyMax));
    setFetchResult(null);
    setSearching(true);
  };

  const showResults = (result: FetchResult | null) => {
    setFetchResult(result);
    setRefused(null);
  };
  const searchAgain = () => {
    setRefused(null);
    setFetchResult(null);
    setSearching(true);
  };
  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? "none" : next));

  if (!loaded) return <main aria-busy="true" />;

  if (home === null) {
    return (
      <main>
        <RegisterForm onRegistered={() => void refresh()} />
      </main>
    );
  }

  const reservation = home.reservation;
  // 確保が載っていない表示の種類（応答の形は検査していない）でも、取得の画面なら出せる
  const onFetchScreen = home.kind === "fetch" || searching || reservation === undefined;
  /**
   * 確保中・完了済みの表示に置く通報ボタン（基準 26.1）。**その表示の囲いの中**に置くので、
   * 部品（`ReservationView`・`CompletedView`）の中身として渡す——囲い（`view-active`・
   * `view-completed`）はその部品が持っている。
   */
  const reportEntry =
    reservation !== undefined && REPORT_VIEW_KINDS.includes(home.kind) ? (
      <button type="button" data-testid="btn-report" onClick={() => setReportTarget({ storeId: reservation.storeId, storeName: reservation.storeName })}>
        このお店を通報する
      </button>
    ) : null;

  /** 確保を持つ客の表示（優先の順の2〜5）。種類ごとに部品が1つ。 */
  const reservationView = () => {
    if (reservation === undefined) return null;
    if (home.kind === "active") {
      return (
        <ReservationView pushPromptDue={home.pushPromptDue === true} reservation={reservation} onChanged={applyHome} onSearchMore={() => setSearching(true)}>
          {reportEntry}
        </ReservationView>
      );
    }
    if (home.kind === "expired") {
      return (
        <ExpiredView
          reservation={reservation}
          expired={home.expired}
          refusal={refused === null ? null : refused.body}
          onRetry={() => void retry()}
          onNextStep={takeNextStep}
          onSearchAgain={searchAgain}
        />
      );
    }
    if (home.kind === "completed") {
      return (
        <CompletedView reservation={reservation} onSearchAgain={searchAgain}>
          {reportEntry}
        </CompletedView>
      );
    }
    if (home.kind === "store_cancelled") return <StoreCancelledView reservation={reservation} onSearchAgain={searchAgain} />;
    if (home.kind === "admin_cancelled") return <AdminCancelledView reservation={reservation} onSearchAgain={searchAgain} />;
    return null;
  };

  return (
    <main>
      {stale ? (
        <p className="msg" role="status" data-testid="stale-notice">
          最新の状態を確かめられていません。最後に確かめられた内容を出しています。
        </p>
      ) : null}

      {onFetchScreen ? (
        <section>
          <FetchForm profile={home.profile} party={party} onPartyChange={setParty} onResults={showResults} />
          {fetchResult === null ? null : (
            <ResultList
              items={fetchResult.items}
              onReceive={(item) => void receive(item)}
              refusal={refused !== null && refused.offerId !== null ? { offerId: refused.offerId, body: refused.body } : null}
              onNextStep={takeNextStep}
              holding={home.kind === "active"}
              onBackToReservation={() => setSearching(false)}
            />
          )}
        </section>
      ) : (
        reservationView()
      )}

      {RECENT_ENTRY_KINDS.includes(home.kind) ? (
        <nav aria-label="そのほか">
          <button type="button" data-testid="btn-recent" onClick={() => togglePanel("recent")}>
            最近行った店
          </button>
          <button type="button" data-testid="btn-settings" onClick={() => togglePanel("settings")}>
            登録の確認と消去
          </button>
        </nav>
      ) : null}

      {panel === "recent" ? <RecentStores onReport={setReportTarget} /> : null}
      {panel === "settings" ? <AccountSettings onDeleted={() => void refresh()} /> : null}
      {reportTarget !== null ? <ReportForm storeId={reportTarget.storeId} storeName={reportTarget.storeName} onClose={() => setReportTarget(null)} /> : null}
    </main>
  );
};

export default CustomerApp;
