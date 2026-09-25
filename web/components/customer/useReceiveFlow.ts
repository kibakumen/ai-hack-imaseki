"use client";

// 受け取り・受け取り直しの送信と、応答での作り直し（2026-09-25 監査の指摘 設計-16 で CustomerApp から分けた。
// 振る舞いは分ける前と同じ）。受け取った直後の演出を出すかどうかは、通って確保中になったとき（onClaimed）に入れ物が決める。
//
// 受け取りの応答は、通っても断られても**新しいホームを連れてくる**ので、それで表示を作り直す（設計書「受け取りが断られた
// とき」の4）。送っている間は、押したカードのボタンを「席を確保しています…」にし、ほかのカードも押せなくする
// （2026-09-25 監査の指摘 横断-03）。同じ瞬間の2度押しは ref で止める。

import { useRef, useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import type { FetchResult } from "./FetchForm";
import type { HomeDto, ReceiveRefusal } from "./home";
import type { RefusedReceive } from "./useFetchResults";

/**
 * 断りの表示を重ねる表示の種類（設計書「受け取りが断られたとき」の4）。
 * 取得の画面は押したカードの中、期限切れの表示は押した操作の場所に出す。
 * 確保中・取り消し・完了済みに変わったときは**重ねない**——新しい表示そのものが答えなので。
 */
const KEEPS_REFUSAL: ReadonlyArray<HomeDto["kind"]> = ["fetch", "expired"];

type ReceiveFlowInput = {
  home: HomeDto | null;
  fetchResult: FetchResult | null;
  /** 応答が連れてきたホームで作り直す */
  adoptResponded: (home: HomeDto) => void;
  setRefused: (refused: RefusedReceive | null) => void;
  /** 通ったときに結果の一覧を片づける（確保中の表示へ移る・基準 8.5） */
  dismissResults: () => void;
  /** 応答が返った（前の済んだ知らせを消す） */
  onResponse: () => void;
  /** 通って確保中になった（入れ物が演出を前面に出し、確保番号を読み上げる・客-08） */
  onClaimed: (code: string) => void;
};

export const useReceiveFlow = ({ home, fetchResult, adoptResponded, setRefused, dismissResults, onResponse, onClaimed }: ReceiveFlowInput) => {
  /** 受け取りを送っている結果の番号（受け取り直しは "retry"）。無ければ null */
  const [receiving, setReceiving] = useState<string | null>(null);
  const receivingRef = useRef(false);

  /** 受け取り・受け取り直しの応答（通った／断られた）で、表示を作り直す。 */
  const applyReceived = (result: unknown, offerId: string | null) => {
    onResponse();
    const failure = isFailure(result) ? result : null;
    const body = failure === null ? undefined : (failure.refusal as ReceiveRefusal | undefined);
    // 応答に `home` が無い形でも表示を消さない（今の表示のまま、断りだけを出す）
    const responded = (failure === null ? (result as { home?: HomeDto }).home : (failure.home as HomeDto | undefined)) ?? home;
    if (responded !== null) adoptResponded(responded);
    const keepsNotice = responded !== null && KEEPS_REFUSAL.includes(responded.kind);
    setRefused(body !== undefined && keepsNotice ? { offerId, body } : null);
    if (failure === null) dismissResults();
    // 通って確保中になったときだけ、受け取りの演出を前面に出す（断りでは出さない）
    if (failure === null && responded !== null && responded.reservation !== undefined && responded.kind === "active") onClaimed(responded.reservation.code);
  };

  /** 受け取りを1件だけ送る（送っている間の2度押し・ほかのカードの押下は送らない）。 */
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

  return {
    receiving,
    /** 結果から1件を受け取る（基準 8.1・8.5・8.6）。人数とどの取得から選んだかを一緒に送る。 */
    receive: async (offerId: string): Promise<void> => {
      if (fetchResult === null) return;
      await sendReceive(offerId, { offerId, party: fetchResult.party, fetchId: fetchResult.fetchId }, offerId);
    },
    /** 期限切れから同じ人数で受け取り直す（基準 11.8・11.10）。人数は元の確保から取るので送らない。 */
    retry: async (): Promise<void> => {
      const id = home?.reservation?.id;
      if (id === undefined) return;
      await sendReceive("retry", { retryOf: id }, null);
    },
  };
};
