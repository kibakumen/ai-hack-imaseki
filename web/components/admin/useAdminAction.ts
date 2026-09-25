"use client";

// 運営の1つの操作ぶんの送信と、その操作の断り（2026-09-25 監査の指摘 運営-04・運営-13）。
// **操作ごとに別に持つ**ので、ある操作の断りがほかの操作の欄に出ることはない（店の画面の OfferPanel の
// `useOfferChange` と同じ形）。送っている間は `busy` が立ち、同じ操作をもう1度は送らない（連打しても1回）。

import { useCallback, useRef, useState } from "react";
import { isFailure, type ApiFailure } from "../../lib/client/api";

export type AdminAction = {
  failure: ApiFailure | null;
  busy: boolean;
  /**
   * 送る。応答（通った本文か断り）をそのまま返す。断りは `failure` にも残す（欄の直下に出すため）。
   * 送っている途中にもう1度呼ばれたら、送らずに null を返す。
   */
  run: <T>(send: () => Promise<T | ApiFailure>) => Promise<T | ApiFailure | null>;
  /** 断りを消す（「やめる」を押したとき） */
  clear: () => void;
};

export const useAdminAction = (): AdminAction => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  // 状態の更新は次の描画まで見えないので、同じ瞬間の2度押しは ref で止める。
  const sending = useRef(false);

  const run = useCallback(async <T,>(send: () => Promise<T | ApiFailure>): Promise<T | ApiFailure | null> => {
    if (sending.current) return null;
    sending.current = true;
    setBusy(true);
    try {
      const result = await send();
      setFailure(isFailure(result) ? result : null);
      return result;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => setFailure(null), []);

  return { failure, busy, run, clear };
};
