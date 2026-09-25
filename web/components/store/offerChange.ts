"use client";

// 公開中のオファーへの1操作ぶんの送信と、その操作の断り（公開中のカード OfferPanel が使う）。
// **操作ごとに別に持つ**ので、ある操作の断りがほかの操作の欄に出ることはない（要件19の基準 19.2・19.5・19.9）。
// ホームを取り直すかは呼ぶ側が決める（一括で送るときは、全部済んでから1回だけ取り直す）。

import { useState } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";

/**
 * 公開したままできる操作（入口 `POST /api/store/offers/current/<action>`）。
 * `coupons` は見せるクーポンの選び直し（2026-09-25 監査の指摘 不具合-03 の案A・要件19.11 を改めた）。
 */
export type OfferAction = "stop" | "add" | "reduce" | "party-max" | "until" | "coupons";

/** 1回の送信の結果。`ended` は「オファーが終わっていた」（ホームを取り直す・基準 19.12）。 */
export type Outcome = "ok" | "refused" | "ended";

export const useOfferChange = (action: OfferAction) => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const send = async (body: Record<string, unknown>): Promise<Outcome> => {
    const result = await callApi(`POST /api/store/offers/current/${action}` as const, { body });
    if (!isFailure(result)) {
      setFailure(null);
      return "ok";
    }
    // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
    setFailure(result);
    return result.error?.kind === "offer_ended" ? "ended" : "refused";
  };

  return { failure, send };
};

export type OfferChange = ReturnType<typeof useOfferChange>;
