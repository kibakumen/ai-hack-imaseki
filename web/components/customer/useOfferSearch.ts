"use client";

// 取得を1回ずつ走らせる道具（`FetchForm` から切り出した・2026-09-25）。少しずつ届く入口を先に使い、
// その入口を持たないサーバーでは普通の入口へ倒す（少しずつ届くのは速さの工夫で、機能の前提ではない）。
//
// **1回の取得に AbortController を1つ持たせ、それを世代の印にする**（2026-09-25 監査の指摘 不具合-06）。
// ストリームは最初の行でボタンを押せる状態に戻したあとも最長25秒続く。前の取得を止める仕組みが無かったので、
//   ①紹介文が届くたびに一覧が前の検索の結果（前の人数・古い fetchId）へ戻り、そのまま押すと違う人数で確保できた
//   ②受け取りが通ったあとも前のストリームが結果を入れ直し、取り消すと古い一覧が出た
// 新しく探したとき・画面を離れたとき（受け取りが通って確保中の表示へ移るときもここ）に前の取得の合図を止め、
// 止めた取得の行・結果・失敗は画面へ渡さない。
//
// ストリームが途中で切れた・紹介文が揃わないまま終わったときは、まだ紹介文の届いていないカードを
// 「決まった文」（`fallback`）として確定させる（不具合-21。待機の見た目のまま固めない）。
// 普通の入口の結果も同じく確定させる（紹介文を後から差し込む道が無いので）。

import { useEffect, useRef, useState } from "react";
import { apiStream, callApi, isFailure, STREAM_UNAVAILABLE, type ApiFailure, type StreamLine, type StreamOutcome } from "../../lib/client/api";
import type { ResultItem } from "./ResultList";

/** 探した起点。座標か、客が打った場所の文字。地図の経路の出発地にそのまま渡せる（2026-09-22）。 */
export type FetchOrigin = { lat: number; lng: number } | { place: string };

/** 取得が通ったときに親へ渡すもの（受け取りの入口が `fetchId` と人数を要るため）。 */
export type FetchResult = { fetchId: string; items: ResultItem[]; party: number; from: FetchOrigin | null };

/** 探すのに要るもの（起点が決まったあとに `FetchForm` が組む）。`from` は経路の出発地（現在地で探したときは null・客-11）。 */
export type SearchRequest = { payload: Record<string, unknown>; party: number; from: FetchOrigin | null };

const STREAM_PATH = "/api/customer/fetch/stream";

/**
 * 少しずつ届く1行を、今の結果へ当てる。当たらない行（`done`・init より前の紹介文）は今の結果をそのまま返す。
 * 紹介文の行は `source` も一緒に取り込む（2026-09-22 本人の指摘「文言が完成されているのにずっと待機モーション」）。
 */
export const applyStreamLine = (current: FetchResult | null, line: StreamLine, request: Pick<SearchRequest, "party" | "from">): FetchResult | null => {
  if (line.type === "init") return { fetchId: line.fetchId, items: line.items as ResultItem[], party: request.party, from: request.from };
  if (line.type !== "pitch" || current === null) return current;
  const source = line.source === "persona" ? "persona" : "fallback";
  return { ...current, items: current.items.map((item) => (item.storeId === line.storeId ? { ...item, reason: line.reason, pitchSource: source } : item)) };
};

/** 紹介文がまだ届いていないカードを「決まった文」として確定させる。全部そろっていれば同じ値を返す。 */
export const settlePitches = (result: FetchResult): FetchResult =>
  result.items.every((item) => item.pitchSource !== undefined)
    ? result
    : { ...result, items: result.items.map((item) => (item.pitchSource === undefined ? { ...item, pitchSource: "fallback" as const } : item)) };

type StreamRun = {
  request: SearchRequest;
  signal: AbortSignal;
  onResults: (result: FetchResult) => void;
  /** 最初のカードが出たとき（「探しています…」を解く） */
  onCards: () => void;
};

/** 少しずつ届く入口で1回探す。1行も届かなければ `STREAM_UNAVAILABLE`（普通の入口へ倒す合図）。 */
const runStream = async ({ request, signal, onResults, onCards }: StreamRun): Promise<StreamOutcome> => {
  const shown: { current: FetchResult | null } = { current: null };
  const outcome = await apiStream(
    STREAM_PATH,
    request.payload,
    (line) => {
      const next = applyStreamLine(shown.current, line, request);
      if (next === null || next === shown.current) return;
      if (shown.current === null) onCards();
      shown.current = next;
      onResults(next);
    },
    signal,
  );
  if (signal.aborted) return outcome;
  if (shown.current === null) return outcome === null ? STREAM_UNAVAILABLE : outcome;
  // 途中で切れた・紹介文が揃わずに終わった: まだのカードを確定させる（不具合-21）
  const settled = settlePitches(shown.current);
  if (settled !== shown.current) onResults(settled);
  return outcome;
};

/**
 * 取得の状態（探している最中か・断り）と、探す操作。`search` に渡す `prepare` は起点を決めて要求を組む
 * （現在地を待つことがあるので、その間に探し直されたら結果を捨てる）。
 */
export const useOfferSearch = (onResults: (result: FetchResult | null) => void) => {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const runningRef = useRef<AbortController | null>(null);

  // 画面を離れたら走っている取得を止める（受け取りが通って確保中の表示へ移るときもここを通る）
  useEffect(() => () => runningRef.current?.abort(), []);

  const search = async (prepare: () => Promise<SearchRequest | ApiFailure>): Promise<void> => {
    runningRef.current?.abort();
    const controller = new AbortController();
    runningRef.current = controller;
    const live = () => !controller.signal.aborted;
    setFailure(null);
    setPending(true);
    onResults(null);
    try {
      const request = await prepare();
      if (!live()) return;
      if (isFailure(request)) {
        setFailure(request);
        return;
      }
      const streamed = await runStream({ request, signal: controller.signal, onResults, onCards: () => setPending(false) });
      if (!live()) return;
      if (streamed !== STREAM_UNAVAILABLE) {
        if (isFailure(streamed)) setFailure(streamed);
        return;
      }
      const result = await callApi("POST /api/customer/fetch", { body: request.payload });
      if (!live()) return;
      if (isFailure(result)) {
        setFailure(result);
        return;
      }
      onResults(settlePitches({ fetchId: result.fetchId, items: result.items, party: request.party, from: request.from }));
    } finally {
      // 新しい取得に替わっていれば、その取得が「探しています…」を持つ（ここでは解かない）
      if (live()) setPending(false);
    }
  };

  return { pending, failure, search };
};
