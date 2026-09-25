"use client";

// 取得の画面の結果・人数・条件の開け閉め・受け取りの断り（2026-09-25 監査の指摘 設計-16 で CustomerApp から分けた。
// 振る舞いは分ける前と同じ）。表示の種類（ホーム）に**含まれない**、取得の画面の続きだけを持つ。

import { useRef, useState, type RefObject } from "react";
import type { FetchResult } from "./FetchForm";
import type { ReceiveRefusal } from "./home";

/** 断られた1件。`offerId` は結果のカードに出すため（受け取り直しは押した場所が1つなので null）。 */
export type RefusedReceive = { offerId: string | null; body: ReceiveRefusal };

export type FetchResults = {
  fetchResult: FetchResult | null;
  /** 人数の欄（結果の側から入れ替わるので、取得の画面の外に置く） */
  party: string;
  setParty: (party: string) => void;
  /** 結果が出たあとに条件を開き直したか */
  conditionsOpen: boolean;
  fetchScreenRef: RefObject<HTMLElement | null>;
  refused: RefusedReceive | null;
  setRefused: (refused: RefusedReceive | null) => void;
  /** `FetchForm` が渡す結果（探し始めは null） */
  showResults: (result: FetchResult | null) => void;
  /** 出している結果を片づけ、その取得から後で届く結果も受け取らない */
  dismissResults: () => void;
  /** 右下の固定ボタン */
  toggleConditions: () => void;
};

type Handlers = {
  /** 探し始めた（前の知らせを消す） */
  onSearchStart: () => void;
  /** 新しい取得の結果が1件以上届いた（件数を読み上げる・客-08） */
  onNewResults: (count: number) => void;
};

export const useFetchResults = ({ onSearchStart, onNewResults }: Handlers): FetchResults => {
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

  /**
   * 受け取りが通ったときもここを通す——前の取得は `FetchForm` が外れたときに止まるが、止めるのは描き終えた
   * あとの後始末（effect の片づけ）なので、その間に届いた紹介文が一覧を入れ直しうる（全体の検査を重く回した
   * ときに、受け取りのあとの一覧が戻る検査が1度だけ落ちた。この隙間が原因というのは推測）。
   */
  const dismissResults = () => {
    dismissedFetchIdRef.current = shownFetchIdRef.current;
    shownFetchIdRef.current = null;
    setFetchResult(null);
  };

  const showResults = (result: FetchResult | null) => {
    // 片づけた取得の結果は戻さない。探し始めたら解く（前の取得は `useOfferSearch` が止めてから null を渡す）。
    if (result !== null && result.fetchId === dismissedFetchIdRef.current) return;
    if (result === null) {
      dismissedFetchIdRef.current = null;
      onSearchStart();
    }
    // 断りの知らせを消すのは、探し始めたとき（null）と取得が替わったときだけ（2026-09-25 監査の指摘 不具合-06）。
    // 紹介文が届くたびに同じ取得の結果が入れ直されるので、そのたびに消すと断りの文とボタンが読めないうちに消える。
    const nextFetchId = result?.fetchId ?? null;
    if (result === null || nextFetchId !== shownFetchIdRef.current) setRefused(null);
    // 新しい取得の結果が届いたら件数を読み上げる（同じ取得の紹介文の差し込みでは言い直さない・客-08）
    if (result !== null && nextFetchId !== shownFetchIdRef.current && result.items.length > 0) onNewResults(result.items.length);
    shownFetchIdRef.current = nextFetchId;
    setFetchResult(result);
    // 探し始め（`FetchForm` は探す前に必ず null を渡す）で閉じ直す。少しずつ届く結果の更新では触らない
    // ——客が紹介文の届く途中で条件を開いていても、勝手に畳まない。
    if (result === null) setConditionsOpen(false);
  };

  /** 開くときは条件が見える位置まで戻す（畳まれていた条件は画面の上に在る）。 */
  const toggleConditions = () => {
    const opening = !conditionsOpen;
    setConditionsOpen(opening);
    if (opening) fetchScreenRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return { fetchResult, party, setParty, conditionsOpen, fetchScreenRef, refused, setRefused, showResults, dismissResults, toggleConditions };
};
