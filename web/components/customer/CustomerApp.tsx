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
//   4. 取り直しが通信の失敗に終わったか（端末に残した内容へ倒す・基準 9.10・9.11。何も残っていなければ
//      読めなかったことを出し、登録の入力は出さない——登録の入力は 401 のときだけ）
//   5. 開いている脇の画面（最近行った店・基準 26.14）と、登録を消したばかりか（基準 28.11 の知らせ）。
//      「この端末の登録を消す」は画面の下端に常に置く（基準 28.4・2026-09-25 監査の指摘 安全-15 で戻した）
//   6. 通報が指している店（基準 26.1・26.17。断られても元の表示のままにするため外に置く）
//
// 受け取り・受け取り直しの応答は、通っても断られても**新しいホームを連れてくる**ので、それで
// 表示を作り直す（設計書「受け取りが断られたとき」の4）。確保への操作（取り消し・人数の変更）も
// 同じで、応答の `home` をそのまま使う（`applyHome`）。次の一手をどこへ繋ぐかはここが決め、
// 断りの文とボタンの文は `RefusalNotice` が `domain/texts` から引く。

import { useRef, useState } from "react";
import { callApi, isFailure, isTransientFailure, type ApiFailure } from "../../lib/client/api";
import { clearHome as clearCachedHome, loadHome as loadCachedHome, saveHome as saveCachedHome } from "../../lib/client/reservationCache";
import { usePolling, type PollTicket } from "../../lib/client/usePolling";
import { useBackLayer } from "../../lib/client/useBackLayer";
import { AdminCancelledView } from "./AdminCancelledView";
import { recallOrigin } from "../../lib/client/lastOrigin";
import { ClaimedCelebration } from "./ClaimedCelebration";
import { EraseRegistration } from "./EraseRegistration";
import { CompletedView } from "./CompletedView";
import { ExpiredView } from "./ExpiredView";
import { FetchForm, type FetchResult } from "./FetchForm";
import { HomeScreenHint } from "./HomeScreenHint";
import type { HomeDto, ReceiveRefusal, ReservationDto } from "./home";
import { PreviousCompletedEntry } from "./PreviousCompleted";
import { RecentStores } from "./RecentStores";
import { RegisterForm } from "./RegisterForm";
import { ReportForm, type ReportTarget } from "./ReportForm";
import { ReservationView } from "./ReservationView";
import { ResultList, type ResultItem } from "./ResultList";
import { StoreCancelledView } from "./StoreCancelledView";
import { useMeServiceWorker } from "./useMeServiceWorker";
import { CustomerRefusals } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";

/** 断られた1件。`offerId` は結果のカードに出すため（受け取り直しは押した場所が1つなので null）。 */
type RefusedReceive = { offerId: string | null; body: ReceiveRefusal };

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

/** 開いている脇の画面（同時には1つだけ）。 */
type Panel = "none" | "recent";

const CustomerScreens = () => {
  const [home, setHome] = useState<HomeDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  // 人数の初めの値は 1（2026-09-22 の本人の指摘「人数は最初からデフォルト値の1が埋まっている状態に」）。
  // 旧: 空（要件3の補足「前回の人数が残ると人数の変化を見落とす」）——「前回の値」ではなく固定の 1 なので、
  // その懸念（前回の人数の引きずり）とは別物。
  const [party, setParty] = useState("1");
  /**
   * 結果が出たあとに条件を開き直したか（2026-09-22 の本人の指摘「オファーを受け取った時に場所やこだわり
   * 条件のカードよりもオファーをみたいから…右下の方に条件を変えるボタンを設置」）。
   * 結果が1件以上あるときは条件を畳み、右下の固定ボタンで開く。探し直すたびに閉じ直す。
   */
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const fetchScreenRef = useRef<HTMLElement | null>(null);
  /** 今出している結果の取得の番号（`showResults` が、同じ取得の入れ直しか新しい取得かを見分ける）。 */
  const shownFetchIdRef = useRef<string | null>(null);
  /**
   * 客が片づけた取得の番号（2026-09-25 レビューの指摘・不具合-06 の残り）。断りの「探し直す」「◯名で探し直す」は
   * 一覧を片づけるだけで `FetchForm` を外さないので、その取得のストリームは走り続ける。後から届く紹介文が
   * 片づけた一覧（前の人数・古い fetchId）を戻し、押すと人数の欄と違う人数で席を押さえていた。
   * この番号の結果は、次に探し始める（`showResults(null)`）まで受け取らない。
   */
  const dismissedFetchIdRef = useRef<string | null>(null);
  const [refused, setRefused] = useState<RefusedReceive | null>(null);
  const [searching, setSearching] = useState(false);
  // 脇の画面（最近行った店）と、通報が指している店。どちらも表示の種類とは別に持つ
  // ——断られたときに元の表示のまま文を出す必要があるため（基準 26.19・28.5）。
  const [panel, setPanel] = useState<Panel>("none");
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  /**
   * たった今受け取りが通ったか（2026-09-22 の本人の指摘「受け取った瞬間にファンファーレみたいな
   * エフェクト」「別画面に遷移してオファー承諾の楽しい演出」）。確保中の表示は消さずに、その上へ
   * `ClaimedCelebration` を重ねる。閉じれば下の確保中の表示がそのまま在る。
   */
  const [celebrating, setCelebrating] = useState(false);
  /**
   * 1度も取れず端末にも残っていないまま、取り直しが通信の失敗・サーバーの不具合に終わった（2026-09-25 レビューの指摘）。
   * このときは登録の入力を出さない——登録の入力へ倒すのは 401 のときだけ（設計書「客の画面」の優先の順の1）で、
   * 出すと客が入れ直して登録し、新しい識別子の Cookie が今の Cookie（確保を持つかもしれない）を上書きする。
   */
  const [unreachable, setUnreachable] = useState<ApiFailure | null>(null);
  /** この端末の登録を消したばかりか（登録の入力の上に「消しました」を出す・基準 28.11） */
  const [erased, setErased] = useState(false);
  /** 取得の画面から、前回の完了済み（応答の `previousCompleted`）を開いているか（基準 9.4・不具合-18） */
  const [previousOpen, setPreviousOpen] = useState(false);

  /**
   * 確保を持ったまま探している間に、その確保が確保中でなくなった（店・運営の取り消し・期限切れ・完了）ら、
   * 探すのをやめて変化の表示を出す（2026-09-25 監査の指摘 客-03——以前は取り直しが searching を戻さず、
   * 「今の確保を取り消すと受け取れます」の案内が黙って消えるだけで、取り消されたことが出なかった）。
   * 確保中でなくなった確保の演出も閉じる（あとで別の確保中が来ても、古い演出を出し直さない）。
   */
  const followReservationChange = (next: HomeDto) => {
    if (home?.kind !== "active" || next.kind === "active") return;
    setCelebrating(false);
    if (next.kind !== "fetch") setSearching(false);
  };

  /** 取り直しが成功したホームを端末に残す（確保が無いホームは残すものが無いので消す）。 */
  const keep = (next: HomeDto) => {
    if (next.reservation === undefined) clearCachedHome();
    else saveCachedHome(next);
  };

  /**
   * ホームを取り直して表示を決める（開いた時と10秒ごと・基準 9.8・9.9）。呼ぶのは `usePolling` だけ——
   * 読み直しのボタンや操作のあとは `polling.refreshNow()` を通す。そうすると、それより前に送った取り直しの
   * 応答（古い状態）は `ticket.isCurrent()` が false になって捨てられる（2026-09-25 監査の指摘 不具合-17）。
   */
  const refresh = async (ticket: PollTicket): Promise<void> => {
    const result = await callApi("GET /api/customer/home");
    if (!ticket.isCurrent()) return;
    setLoaded(true);
    if (!isFailure(result)) {
      followReservationChange(result);
      setHome(result);
      setStale(false);
      setUnreachable(null);
      keep(result);
      return;
    }
    // 通信の失敗とサーバーの不具合（500・internal）は、端末に残した内容へ倒す（基準 9.10・9.11）。
    // サーバーの不具合を見分けの断りと取り違えて登録の入力へ倒さない（2026-09-25 監査の指摘 設計-15）。
    // 端末にも何も残っていなければ、読めなかったことと読み直す道を出す（登録の入力は出さない・レビューの指摘）。
    if (isTransientFailure(result)) {
      const kept = home ?? loadCachedHome<HomeDto>();
      setHome(kept);
      setStale(kept !== null);
      setUnreachable(kept === null ? result : null);
      return;
    }
    // 見分けの断り（401）は登録の入力へ（基準 1.10・1.11）
    setHome(null);
    setStale(false);
    setUnreachable(null);
  };

  const polling = usePolling(refresh);
  // 開いたら Service Worker を /me の範囲で登録し、許可済みの端末の購読を作り直す（不具合-05・不具合-11）
  useMeServiceWorker(home?.pushPromptDue === true);

  // 端末の「戻る」で、上に重ねたものを閉じる（客-03。客の画面は1つの URL なので、以前は /me の外へ出ていた）。
  // 確保を持ったまま探している取得の画面・受け取った直後の演出・前回の完了済み・最近行った店・通報の欄の5つ。
  useBackLayer(searching && home?.reservation !== undefined, () => setSearching(false));
  useBackLayer(celebrating && home?.kind === "active", () => setCelebrating(false));
  useBackLayer(previousOpen && home?.kind === "fetch" && home.previousCompleted !== undefined, () => setPreviousOpen(false));
  useBackLayer(panel !== "none", () => setPanel("none"));
  useBackLayer(reportTarget !== null, () => setReportTarget(null));

  /**
   * 出している結果を片づけ、その取得から後で届く結果も受け取らない（`dismissedFetchIdRef`）。
   * 受け取りが通ったときもここを通す——前の取得は `FetchForm` が外れたときに止まるが、止めるのは描き終えた
   * あとの後始末（effect の片づけ）なので、その間に届いた紹介文が一覧を入れ直しうる（全体の検査を重く回した
   * ときに、受け取りのあとの一覧が戻る検査が1度だけ落ちた。この隙間が原因というのは推測）。
   */
  const dismissResults = () => {
    dismissedFetchIdRef.current = shownFetchIdRef.current;
    shownFetchIdRef.current = null;
    setFetchResult(null);
  };

  /** 受け取り・受け取り直しの応答（通った／断られた）で、表示を作り直す。 */
  const applyReceived = (result: unknown, offerId: string | null) => {
    const failure = isFailure(result) ? result : null;
    const body = failure === null ? undefined : (failure.refusal as ReceiveRefusal | undefined);
    // 応答に `home` が無い形でも表示を消さない（今の表示のまま、断りだけを出す）
    const responded = (failure === null ? (result as { home?: HomeDto }).home : (failure.home as HomeDto | undefined)) ?? home;
    if (responded !== null) {
      // この応答より前に送った取り直し（押す前の状態）が後から届いても映さない（不具合-17）
      polling.invalidate();
      setHome(responded);
      setLoaded(true);
      setStale(false);
      keep(responded);
      if (responded.kind !== "fetch") setSearching(false);
    }
    const keepsNotice = responded !== null && KEEPS_REFUSAL.includes(responded.kind);
    setRefused(body !== undefined && keepsNotice ? { offerId, body } : null);
    // 通ったときは結果の一覧を片づける（確保中の表示へ移る・基準 8.5）
    if (failure === null) dismissResults();
    // 通って確保中になったときだけ、受け取りの演出を前面に出す（断りでは出さない）
    if (failure === null && responded !== null && responded.reservation !== undefined && responded.kind === "active") setCelebrating(true);
  };

  /**
   * 確保への操作（取り消し・人数の変更）の応答で表示を作り直す（`ReservationActions` の `onChanged`）。
   * 応答が新しいホームを連れてきたらそれで作り直し、連れてこない（今の状態と衝突した）なら取り直す
   * （基準 10.3・9.8）。
   */
  const applyHome = (next?: unknown) => {
    if (next === undefined || next === null) {
      polling.refreshNow();
      return;
    }
    const responded = next as HomeDto;
    // この応答より前に送った取り直し（操作の前の状態）が後から届いても映さない（不具合-17）
    polling.invalidate();
    setHome(responded);
    setLoaded(true);
    setStale(false);
    keep(responded);
    if (responded.kind !== "fetch") setSearching(false);
  };

  /** 結果から1件を受け取る（基準 8.1・8.5・8.6）。人数とどの取得から選んだかを一緒に送る。 */
  const receive = async (item: ResultItem): Promise<void> => {
    if (fetchResult === null) return;
    const result = await callApi("POST /api/customer/reservations", { body: { offerId: item.offerId, party: fetchResult.party, fetchId: fetchResult.fetchId } });
    applyReceived(result, item.offerId);
  };

  /** 期限切れから同じ人数で受け取り直す（基準 11.8・11.10）。人数は元の確保から取るので送らない。 */
  const retry = async (): Promise<void> => {
    const id = home?.reservation?.id;
    if (id === undefined) return;
    const result = await callApi("POST /api/customer/reservations", { body: { retryOf: id } });
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
    dismissResults();
    setSearching(true);
  };

  const showResults = (result: FetchResult | null) => {
    // 片づけた取得の結果は戻さない。探し始めたら解く（前の取得は `useOfferSearch` が止めてから null を渡す）。
    if (result !== null && result.fetchId === dismissedFetchIdRef.current) return;
    if (result === null) dismissedFetchIdRef.current = null;
    // 断りの知らせを消すのは、探し始めたとき（null）と取得が替わったときだけ（2026-09-25 監査の指摘 不具合-06）。
    // 紹介文が届くたびに同じ取得の結果が入れ直されるので、そのたびに消すと断りの文とボタンが読めないうちに消える。
    const nextFetchId = result?.fetchId ?? null;
    if (result === null || nextFetchId !== shownFetchIdRef.current) setRefused(null);
    shownFetchIdRef.current = nextFetchId;
    setFetchResult(result);
    // 探し始め（`FetchForm` は探す前に必ず null を渡す）で閉じ直す。少しずつ届く結果の更新では触らない
    // ——客が紹介文の届く途中で条件を開いていても、勝手に畳まない。
    if (result === null) setConditionsOpen(false);
  };
  /** 右下の固定ボタン。開くときは条件が見える位置まで戻す（畳まれていた条件は画面の上に在る）。 */
  const toggleConditions = () => {
    const opening = !conditionsOpen;
    setConditionsOpen(opening);
    if (opening) fetchScreenRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const searchAgain = () => {
    setRefused(null);
    dismissResults();
    // 期限切れで「何名まで」が下がっていたら、その人数で探す（同じ人数ではその店に入れない・客-06）
    const partyMax = home?.kind === "expired" ? home.expired?.partyMax : undefined;
    if (partyMax !== undefined) setParty(String(partyMax));
    setSearching(true);
  };
  const togglePanel = (next: Panel) => setPanel((current) => (current === next ? "none" : next));

  if (!loaded) return <main aria-busy="true" />;

  if (home === null && unreachable !== null) {
    return (
      <main>
        <LoadView state={{ status: "failed", failure: unreachable }} onRetry={polling.refreshNow}>
          {() => null}
        </LoadView>
      </main>
    );
  }

  if (home === null) {
    return (
      <main>
        {erased ? (
          <p className="msg" role="status" data-testid="erased-notice">
            この端末の登録を消しました。
          </p>
        ) : null}
        <RegisterForm onRegistered={polling.refreshNow} />
      </main>
    );
  }

  const reservation = home.reservation;
  /** 確保中の確保を持ったまま探しているか（基準 8.10。受け取りの操作を選べない形にし、戻る道を常に出す） */
  const holding = searching && home.kind === "active";
  /** 既定の幅を過ぎた完了済み（取得の画面のときだけ載る・基準 9.4）。開いていればその表示を出す */
  const previous = home.kind === "fetch" ? home.previousCompleted : undefined;
  const showingPrevious = previousOpen && previous !== undefined;
  // 確保が載っていない表示の種類（応答の形は検査していない）でも、取得の画面なら出せる
  const onFetchScreen = !showingPrevious && (home.kind === "fetch" || searching || reservation === undefined);
  // 結果が1件以上あるときだけ条件を畳む（断られたとき・0件のときは畳まない——入れ直したい人が欄にたどり着けるように）
  const hasItems = fetchResult !== null && fetchResult.items.length > 0;
  const collapsed = hasItems && !conditionsOpen;
  /**
   * 確保中・完了済みの表示に置く通報ボタン（基準 26.1）。**その表示の囲いの中**に置くので、
   * 部品（`ReservationView`・`CompletedView`）の中身として渡す——囲い（`view-active`・
   * `view-completed`）はその部品が持っている。
   */
  const reportButton = (target: ReservationDto) => (
    <button type="button" data-testid="btn-report" onClick={() => setReportTarget({ storeId: target.storeId, storeName: target.storeName })}>
      このお店を通報する
    </button>
  );
  const reportEntry = reservation !== undefined && REPORT_VIEW_KINDS.includes(home.kind) ? reportButton(reservation) : null;

  /**
   * 経路の出発地（探したときの起点）。確保中の画面と確定の演出の**両方が同じ値**を使う。
   * 出どころは3段。上から順に、在るものを使う:
   *   1. **確保の応答に載る起点**（サーバーが `fetch_logs` から返す座標）。画面の状態にも端末の保存にも
   *      依らないので、これが正本——新しいタブ・別のタブ・読み直しのあとでも渡る。
   *   2. 探した結果に載る起点。⚠️ 受け取りが通った瞬間に `setFetchResult(null)` と `setCelebrating(true)`
   *      が同じ描き直しにまとめられるため、**演出が出る時点ではもう null**——1回目の直しが効かなかった理由。
   *   3. そのタブで覚えた起点（`sessionStorage`）。新しいタブ・別のタブ・保存を止めた端末では空——
   *      2回目の直しがチームの環境で効かなかった理由。
   * どれも無ければ null＝渡さない（嘘の起点を付けるより、マップに現在地から引かせる方がまし）。
   */
  const routeFrom = reservation === undefined ? null : (reservation.origin ?? fetchResult?.from ?? recallOrigin());

  /** 確保を持つ客の表示（優先の順の2〜5）。種類ごとに部品が1つ。 */
  const reservationView = () => {
    // 取得の画面から開いた前回の完了済み（基準 9.4）。「ほかの店を探す」で取得の画面へ戻る
    if (showingPrevious) {
      return (
        <CompletedView reservation={previous} onSearchAgain={() => setPreviousOpen(false)}>
          {reportButton(previous)}
        </CompletedView>
      );
    }
    if (reservation === undefined) return null;
    if (home.kind === "active") {
      return (
        <ReservationView pushPromptDue={home.pushPromptDue === true} reservation={reservation} from={routeFrom} onChanged={applyHome} onSearchMore={() => setSearching(true)}>
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
          from={routeFrom}
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
    if (home.kind === "store_cancelled") {
      return (
        <StoreCancelledView reservation={reservation} onSearchAgain={searchAgain}>
          {reportEntry}
        </StoreCancelledView>
      );
    }
    if (home.kind === "admin_cancelled") return <AdminCancelledView reservation={reservation} onSearchAgain={searchAgain} />;
    return null;
  };

  /**
   * 受け取った直後の演出（確保中の表示の上に重ねる）。閉じるか、確保が確保中でなくなったら消える
   * ——期限切れ・取り消しに変わったあとまで「受け取りました」を出したままにしない。
   */
  const celebration =
    celebrating && reservation !== undefined && home.kind === "active" ? (
      // ⚠️ 探したときの起点を経路の出発地へ渡す（2026-09-22 本人の指摘・3回——現在地と違う場所で
      // 探したのに、マップの開始地点が現在地になり徒歩7時間と出た）。渡さないとマップが現在地から引く。
      // 出どころと順は上の `routeFrom` の注。
      <ClaimedCelebration reservation={reservation} from={routeFrom} onClose={() => setCelebrating(false)} />
    ) : null;

  return (
    <main>
      {celebration}
      {stale ? (
        <p className="msg" role="status" data-testid="stale-notice">
          最新の状態を確かめられていません。最後に確かめられた内容を出しています。
        </p>
      ) : null}

      {onFetchScreen ? (
        <section ref={fetchScreenRef} className={hasItems ? "fetch-screen fetch-screen--with-fab" : "fetch-screen"}>
          {previous !== undefined && fetchResult === null ? <PreviousCompletedEntry reservation={previous} onOpen={() => setPreviousOpen(true)} /> : null}
          {/* ホーム画面への追加は、確保を持っていないときだけ勧める（客-04 の案A） */}
          {reservation === undefined ? <HomeScreenHint /> : null}
          {/* 確保を持ったまま探している間は、条件の上に戻る道を常に出す（客-03。条件を畳んでも隠れない位置） */}
          {holding ? (
            <p className="hold-banner" data-testid="hold-banner">
              <span>今の確保はそのままです。</span>
              <button type="button" data-testid="btn-back-to-reservation" onClick={() => setSearching(false)}>
                確保中の表示へ戻る
              </button>
            </p>
          ) : null}
          <FetchForm
            profile={home.profile}
            party={party}
            onPartyChange={setParty}
            onResults={showResults}
            noResults={fetchResult !== null && fetchResult.items.length === 0}
            collapsed={collapsed}
          />
          {hasItems ? (
            <button type="button" className="conditions-fab" data-testid="btn-change-conditions" aria-expanded={!collapsed} onClick={toggleConditions}>
              {collapsed ? "条件を変える" : "条件を閉じる"}
            </button>
          ) : null}
          {fetchResult === null ? null : (
            <ResultList
              items={fetchResult.items}
              onReceive={(item) => void receive(item)}
              refusal={refused !== null && refused.offerId !== null ? { offerId: refused.offerId, body: refused.body } : null}
              onNextStep={takeNextStep}
              holding={home.kind === "active"}
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
        </nav>
      ) : null}

      {panel === "recent" ? <RecentStores onReport={setReportTarget} /> : null}
      {reportTarget !== null ? <ReportForm storeId={reportTarget.storeId} storeName={reportTarget.storeName} onClose={() => setReportTarget(null)} /> : null}

      {/* 下端に1つだけ（基準 28.4）。どの表示でも置く——確保中なら入口が断り、先に取り消すよう出す（基準 28.5） */}
      <EraseRegistration
        onDeleted={() => {
          setErased(true);
          polling.refreshNow();
        }}
      />
    </main>
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
