"use client";

// 客の画面（/me）の入れ物。ホームの入口を10秒ごとに取り直し、返ってきた**表示の種類をそのまま描く**
// （設計書「客の画面」の優先の順。どれを出すかの判断はサーバー側の `domain/customerHome` が持つ）。
// 識別子が無い・受け付けられない（見分けの断り）なら登録の入力を出し、取得の画面は出さない
// （基準 1.10・1.11）。登録が済んだ客には取得の画面を出す（基準 1.8）。
//
// 2026-09-25 監査の指摘 設計-16 で分けた（振る舞いは分ける前と同じ）:
//   useCustomerHome            … ホームの取り直し・端末に残した内容への倒れ方・操作の応答での作り直し
//   useFetchResults            … 取得の結果・人数・条件の開け閉め・受け取りの断り（表示の種類に含まれない、取得の画面の続き）
//   CustomerFetchScreen        … 取得の画面の描き方
//   CustomerReservationScreen  … 確保を持つ客の表示（種類ごとに部品が1つ）
// この入れ物に残したのは、表示のあいだを繋ぐ状態と、次の一手の行き先だけ:
//   - 確保を持ったまま「ほかの店を探す」を押したか（基準 8.10。サーバーは確保中のままを返す）
//   - 受け取りを送っている結果（二重送信の止め・横断-03）と、受け取った直後の演出
//   - 開いている脇の画面（最近行った店・基準 26.14）・通報が指している店（基準 26.1・26.17）・登録を消したばかりか（28.11）
//   - 取得の画面から前回の完了済みを開いているか（基準 9.4・不具合-18）
//   - 読み上げの領域へ入れる1文（客-08）と、済んだことの1文（横断-03）
//
// 端末の「戻る」は、上に重ねたもの（探している取得の画面・演出・脇の画面）を閉じる（`useBackLayer`・客-03）。
// 受け取り・受け取り直しの応答は、通っても断られても**新しいホームを連れてくる**ので、それで表示を作り直す
// （設計書「受け取りが断られたとき」の4）。確保への操作（取り消し・人数の変更）も同じで、応答の `home` をそのまま使う。
// 断りの文とボタンの文は `RefusalNotice` が `domain/texts` から引く。

import { useEffect, useRef, useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { recallOrigin } from "../../lib/client/lastOrigin";
import { useBackLayer } from "../../lib/client/useBackLayer";
import { CustomerRefusals } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";
import { DoneNotice } from "../ui/Submit";
import { ClaimedCelebration } from "./ClaimedCelebration";
import { CustomerFetchScreen } from "./CustomerFetchScreen";
import { CustomerMain } from "./CustomerMain";
import { CustomerReservationScreen } from "./CustomerReservationScreen";
import { EraseRegistration } from "./EraseRegistration";
import { History } from "./History";
import type { HomeDto, ReceiveRefusal, ReservationDto } from "./home";
import { changedMessage, claimedMessage, resultsMessage } from "./liveMessages";
import { RecentStores } from "./RecentStores";
import { RegisterForm } from "./RegisterForm";
import { ReportForm, type ReportTarget } from "./ReportForm";
import { RESERVATION_CODE_ID } from "./ReservationView";
import type { ResultItem } from "./ResultList";
import { useCustomerHome } from "./useCustomerHome";
import { useFetchResults } from "./useFetchResults";
import { useMeServiceWorker } from "./useMeServiceWorker";

/**
 * 断りの表示を重ねる表示の種類（設計書「受け取りが断られたとき」の4）。
 * 取得の画面は押したカードの中、期限切れの表示は押した操作の場所に出す。
 * 確保中・取り消し・完了済みに変わったときは**重ねない**——新しい表示そのものが答えなので。
 */
const KEEPS_REFUSAL: ReadonlyArray<HomeDto["kind"]> = ["fetch", "expired"];

/**
 * 通報ボタンを置く表示（基準 26.1）。期限切れと運営が取り消した表示には置かない。
 * 店が取り消した表示には置く（2026-09-25 監査の指摘 横断-09 の案A。入口も7日間は受け付ける）。
 */
const REPORT_VIEW_KINDS: ReadonlyArray<HomeDto["kind"]> = ["active", "completed", "store_cancelled"];
/**
 * 「最近行った店」の入口を置く表示（基準 26.14）。客が画面を開いた
 * ときにまず出る3つで、期限切れと取り消しの表示には置かない（店へ向かう途中で出る表示・要件26の補足）。
 */
const RECENT_ENTRY_KINDS: ReadonlyArray<HomeDto["kind"]> = ["fetch", "active", "completed"];

/**
 * 経路の出発地（探したときの起点）。確保中の画面と確定の演出の**両方が同じ値**を使う。
 * 出どころは3段。上から順に、在るものを使う:
 *   1. **確保の応答に載る起点**（サーバーが `fetch_logs` から返す座標）。画面の状態にも端末の保存にも
 *      依らないので、これが正本——新しいタブ・別のタブ・読み直しのあとでも渡る。
 *   2. 探した結果に載る起点。⚠️ 受け取りが通った瞬間に結果の片づけと演出の表示が同じ描き直しにまとめられるため、
 *      **演出が出る時点ではもう null**——1回目の直しが効かなかった理由。
 *   3. そのタブで覚えた起点（`sessionStorage`）。新しいタブ・別のタブ・保存を止めた端末では空——
 *      2回目の直しがチームの環境で効かなかった理由。
 * どれも無ければ null＝渡さない（嘘の起点を付けるより、マップに現在地から引かせる方がまし）。
 * **現在地で探したときは3つとも空**（サーバーは出発地を返さず、画面も覚えない・2026-09-25 監査の指摘 客-11）。
 */
const routeFromOf = (reservation: ReservationDto | undefined, fetchFrom: ReturnType<typeof recallOrigin> | undefined) =>
  reservation === undefined ? null : (reservation.origin ?? fetchFrom ?? recallOrigin());

const CustomerScreens = () => {
  const [searching, setSearching] = useState(false);
  // 脇の画面（最近行った店）と、通報が指している店。どちらも表示の種類とは別に持つ
  // ——断られたときに元の表示のまま文を出す必要があるため（基準 26.19・28.5）。
  const [recentOpen, setRecentOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  /**
   * たった今受け取りが通ったか（2026-09-22 の本人の指摘「受け取った瞬間にファンファーレみたいな
   * エフェクト」「別画面に遷移してオファー承諾の楽しい演出」）。確保中の表示は消さずに、その上へ
   * `ClaimedCelebration` を重ねる。閉じれば下の確保中の表示がそのまま在る。
   */
  const [celebrating, setCelebrating] = useState(false);
  /** この端末の登録を消したばかりか（登録の入力の上に「消しました」を出す・基準 28.11） */
  const [erased, setErased] = useState(false);
  /** 取得の画面から、前回の完了済み（応答の `previousCompleted`）を開いているか（基準 9.4・不具合-18） */
  const [previousOpen, setPreviousOpen] = useState(false);
  /**
   * 読み上げの領域（main の先頭の role=status）へ入れる1文（2026-09-25 監査の指摘 客-08）。結果の件数・確保の成立と
   * 番号・確保の状態の変化を入れる。以前は aria-live がどこにも無く、画面を見られない客には何も伝わらなかった。
   */
  const [announcement, setAnnouncement] = useState("");
  /** 結果の一覧の見出し（結果が届いたら焦点を移す先。押した「今すぐ探す」は条件ごと畳まれて消えるため） */
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  /**
   * 済んだことの1文（確保の取り消し・人数の変更・2026-09-25 監査の指摘 横断-03）。取り消しは取得の画面へ切り替わる
   * だけで何も出なかったので、画面の上に role=status で出す。次に探し始めた・受け取った・操作したら消す。
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 受け取りを送っている結果の番号（受け取り直しは "retry"）。送っている間は、押したカードのボタンを
   * 「席を確保しています…」にし、ほかのカードも押せなくする（横断-03）。同じ瞬間の2度押しは ref で止める。
   */
  const [receiving, setReceiving] = useState<string | null>(null);
  const receivingRef = useRef(false);

  /**
   * 確保を持ったまま探している間に、その確保が確保中でなくなった（店・運営の取り消し・期限切れ・完了）ら、
   * 探すのをやめて変化の表示を出す（2026-09-25 監査の指摘 客-03——以前は取り直しが searching を戻さず、
   * 「今の確保を取り消すと受け取れます」の案内が黙って消えるだけで、取り消されたことが出なかった）。
   * 確保中でなくなった確保の演出も閉じる（あとで別の確保中が来ても、古い演出を出し直さない）。
   */
  const followReservationChange = (previous: HomeDto | null, next: HomeDto) => {
    if (previous?.kind !== "active" || next.kind === "active") return;
    setCelebrating(false);
    if (next.kind !== "fetch") setSearching(false);
    const message = changedMessage(next.kind);
    if (message !== null) setAnnouncement(message);
  };

  const { home, loaded, stale, unreachable, polling, adopt } = useCustomerHome(followReservationChange);
  const { fetchResult, party, setParty, conditionsOpen, fetchScreenRef, refused, setRefused, showResults, dismissResults, toggleConditions } = useFetchResults({
    onSearchStart: () => setNotice(null),
    onNewResults: (count) => setAnnouncement(resultsMessage(count)),
  });
  // 開いたら Service Worker を /me の範囲で登録し、許可済みの端末の購読を作り直す（不具合-05・不具合-11）
  useMeServiceWorker(home?.pushPromptDue === true);

  /** 受け取った直後の演出を閉じ、焦点を確保中の表示の確保番号へ移す（客-08。閉じたボタンと一緒に焦点が消えないように） */
  const closeCelebration = () => {
    setCelebrating(false);
    document.getElementById(RESERVATION_CODE_ID)?.focus();
  };

  // 結果が1件以上届いたら、焦点を結果の見出しへ移す（押した「今すぐ探す」は条件ごと畳まれて消える・客-08）
  const focusedFetchId = fetchResult !== null && fetchResult.items.length > 0 ? fetchResult.fetchId : null;
  useEffect(() => {
    if (focusedFetchId !== null) resultsHeadingRef.current?.focus();
  }, [focusedFetchId]);

  // 端末の「戻る」で、上に重ねたものを閉じる（客-03。客の画面は1つの URL なので、以前は /me の外へ出ていた）。
  // 確保を持ったまま探している取得の画面・受け取った直後の演出・前回の完了済み・最近行った店・通報の欄の5つ。
  useBackLayer(searching && home?.reservation !== undefined, () => setSearching(false));
  useBackLayer(celebrating && home?.kind === "active", closeCelebration);
  useBackLayer(previousOpen && home?.kind === "fetch" && home.previousCompleted !== undefined, () => setPreviousOpen(false));
  useBackLayer(recentOpen, () => setRecentOpen(false));
  useBackLayer(reportTarget !== null, () => setReportTarget(null));

  /** 応答が連れてきたホームで作り直す（受け取り・確保への操作）。確保に移ったら探すのをやめる。 */
  const adoptResponded = (responded: HomeDto) => {
    adopt(responded);
    if (responded.kind !== "fetch") setSearching(false);
  };

  /** 受け取り・受け取り直しの応答（通った／断られた）で、表示を作り直す。 */
  const applyReceived = (result: unknown, offerId: string | null) => {
    setNotice(null);
    const failure = isFailure(result) ? result : null;
    const body = failure === null ? undefined : (failure.refusal as ReceiveRefusal | undefined);
    // 応答に `home` が無い形でも表示を消さない（今の表示のまま、断りだけを出す）
    const responded = (failure === null ? (result as { home?: HomeDto }).home : (failure.home as HomeDto | undefined)) ?? home;
    if (responded !== null) adoptResponded(responded);
    const keepsNotice = responded !== null && KEEPS_REFUSAL.includes(responded.kind);
    setRefused(body !== undefined && keepsNotice ? { offerId, body } : null);
    // 通ったときは結果の一覧を片づける（確保中の表示へ移る・基準 8.5）
    if (failure === null) dismissResults();
    // 通って確保中になったときだけ、受け取りの演出を前面に出す（断りでは出さない）
    if (failure === null && responded !== null && responded.reservation !== undefined && responded.kind === "active") {
      setCelebrating(true);
      setAnnouncement(claimedMessage(responded.reservation.code));
    }
  };

  /**
   * 確保への操作（取り消し・人数の変更）の応答で表示を作り直す（`ReservationActions` の `onChanged`）。
   * 応答が新しいホームを連れてきたらそれで作り直し、連れてこない（今の状態と衝突した）なら取り直す
   * （基準 10.3・9.8）。済んだことの1文があれば画面の上に出す（横断-03）。
   */
  const applyHome = (next?: unknown, done?: string) => {
    setNotice(done ?? null);
    if (next === undefined || next === null) {
      polling.refreshNow();
      return;
    }
    adoptResponded(next as HomeDto);
  };

  /** 受け取りを1件だけ送る（送っている間の2度押し・ほかのカードの押下は送らない・横断-03）。 */
  const sendReceive = async (key: string, body: Record<string, unknown>, offerId: string | null): Promise<void> => {
    if (receivingRef.current) return;
    receivingRef.current = true;
    setReceiving(key);
    try {
      applyReceived(await callApi("POST /api/customer/reservations", { body }), offerId);
    } finally {
      receivingRef.current = false;
      setReceiving(null);
    }
  };

  /** 結果から1件を受け取る（基準 8.1・8.5・8.6）。人数とどの取得から選んだかを一緒に送る。 */
  const receive = async (item: ResultItem): Promise<void> => {
    if (fetchResult === null) return;
    await sendReceive(item.offerId, { offerId: item.offerId, party: fetchResult.party, fetchId: fetchResult.fetchId }, item.offerId);
  };

  /** 期限切れから同じ人数で受け取り直す（基準 11.8・11.10）。人数は元の確保から取るので送らない。 */
  const retry = async (): Promise<void> => {
    const id = home?.reservation?.id;
    if (id === undefined) return;
    await sendReceive("retry", { retryOf: id }, null);
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
    dismissResults();
    setSearching(true);
  };

  const searchAgain = () => {
    setRefused(null);
    dismissResults();
    // 期限切れで「何名まで」が下がっていたら、その人数で探す（同じ人数ではその店に入れない・客-06）
    const partyMax = home?.kind === "expired" ? home.expired?.partyMax : undefined;
    if (partyMax !== undefined) setParty(String(partyMax));
    setSearching(true);
  };

  if (!loaded) return <CustomerMain busy />;

  if (home === null && unreachable !== null) {
    return (
      <CustomerMain>
        <LoadView state={{ status: "failed", failure: unreachable }} onRetry={polling.refreshNow}>
          {() => null}
        </LoadView>
      </CustomerMain>
    );
  }

  if (home === null) {
    return (
      <CustomerMain>
        {erased ? (
          <p className="msg" role="status" data-testid="erased-notice">
            この端末の登録を消しました。
          </p>
        ) : null}
        <RegisterForm onRegistered={polling.refreshNow} />
      </CustomerMain>
    );
  }

  const reservation = home.reservation;
  /** 既定の幅を過ぎた完了済み（取得の画面のときだけ載る・基準 9.4）。開いていればその表示を出す */
  const previous = home.kind === "fetch" ? home.previousCompleted : undefined;
  const showingPrevious = previousOpen && previous !== undefined;
  // 確保が載っていない表示の種類（応答の形は検査していない）でも、取得の画面なら出せる
  const onFetchScreen = !showingPrevious && (home.kind === "fetch" || searching || reservation === undefined);
  const routeFrom = routeFromOf(reservation, fetchResult?.from);
  /**
   * 確保中・完了済みの表示に置く通報ボタン（基準 26.1）。**その表示の囲いの中**に置くので、部品
   * （`ReservationView`・`CompletedView`）の中身として渡す——囲い（`view-active`・`view-completed`）はその部品が持っている。
   */
  const reportFor = (target: ReservationDto) => (
    <button type="button" data-testid="btn-report" onClick={() => setReportTarget({ storeId: target.storeId, storeName: target.storeName })}>
      このお店を通報する
    </button>
  );

  return (
    <CustomerMain>
      {/* 読み上げの領域（目には見えない）。中身が変わると読み上げられる（客-08） */}
      <p className="visually-hidden" role="status" data-testid="live-status">
        {announcement}
      </p>
      <DoneNotice message={notice} />
      {/* 受け取った直後の演出（確保中の表示の上に重ねる）。閉じるか、確保が確保中でなくなったら消える。
          ⚠️ 探したときの起点を経路の出発地へ渡す（2026-09-22 本人の指摘・3回——渡さないとマップが現在地から引く） */}
      {celebrating && reservation !== undefined && home.kind === "active" ? <ClaimedCelebration reservation={reservation} from={routeFrom} onClose={closeCelebration} /> : null}
      {stale ? (
        <p className="msg" role="status" data-testid="stale-notice">
          最新の状態を確かめられていません。最後に確かめられた内容を出しています。
        </p>
      ) : null}

      {onFetchScreen ? (
        <CustomerFetchScreen
          home={home}
          fetchResult={fetchResult}
          refused={refused}
          party={party}
          conditionsOpen={conditionsOpen}
          sectionRef={fetchScreenRef}
          onPartyChange={setParty}
          onResults={showResults}
          onToggleConditions={toggleConditions}
          holding={searching && home.kind === "active"}
          previous={previous}
          receiving={receiving}
          resultsHeadingRef={resultsHeadingRef}
          onReceive={(item) => void receive(item)}
          onNextStep={takeNextStep}
          onBackToReservation={() => setSearching(false)}
          onOpenPrevious={() => setPreviousOpen(true)}
        />
      ) : (
        <CustomerReservationScreen
          home={home}
          previous={showingPrevious ? previous : undefined}
          routeFrom={routeFrom}
          refused={refused}
          retrying={receiving === "retry"}
          reportFor={reportFor}
          reportEntry={reservation !== undefined && REPORT_VIEW_KINDS.includes(home.kind) ? reportFor(reservation) : null}
          onChanged={applyHome}
          onSearchMore={() => setSearching(true)}
          onClosePrevious={() => setPreviousOpen(false)}
          onRetry={() => void retry()}
          onNextStep={takeNextStep}
          onSearchAgain={searchAgain}
        />
      )}

      {RECENT_ENTRY_KINDS.includes(home.kind) ? (
        <nav aria-label="そのほか">
          <button type="button" data-testid="btn-recent" onClick={() => setRecentOpen((open) => !open)}>
            最近行った店
          </button>
        </nav>
      ) : null}

      {/* 最近行った店（通報の入口）の下に、過去の受け取りの見返し（住所・ホームページ・もう一度探す・客-13 の案A） */}
      {recentOpen ? (
        <>
          <RecentStores onReport={setReportTarget} />
          <History
            onSearchAgain={() => {
              setRecentOpen(false);
              searchAgain();
            }}
          />
        </>
      ) : null}
      {reportTarget !== null ? <ReportForm storeId={reportTarget.storeId} storeName={reportTarget.storeName} onClose={() => setReportTarget(null)} /> : null}

      {/* 下端に1つだけ（基準 28.4）。どの表示でも置く——確保中なら入口が断り、先に取り消すよう出す（基準 28.5） */}
      <EraseRegistration
        onDeleted={() => {
          setErased(true);
          polling.refreshNow();
        }}
      />
    </CustomerMain>
  );
};

/**
 * 客の画面の入れ物。中で出る断りの文は、客に向けた文になる（2026-09-25 レビューの指摘）——客にはログインが無く、
 * 401・403 に「ログインが切れました」を出すと次の一手が分からない。囲むのはここ1か所（部品ごとに渡さない）。
 */
export const CustomerApp = () => (
  <CustomerRefusals>
    <CustomerScreens />
  </CustomerRefusals>
);

export default CustomerApp;
