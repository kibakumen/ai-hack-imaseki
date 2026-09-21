// 状態の変化を画面へ映すための取り直し（要件9の基準 9.8・9.9・要件20の基準 20.4）。
// 設計書「比べた案」で常時つなぐ仕組み（SSE・WebSocket）を採らず、**10秒ごとの取り直し**にした。
// 常時の接続へ替えるときに触るのはこのファイルだけ（設計書「撤退しやすさ」）。
//
// 決め:
//   - 開いた時に1回（基準 9.8）。以後 `intervalMs` ごと。
//   - 画面が隠れている間は止め、戻った時にすぐ1回取り直す（基準 9.8 の「開いた時」の実体）。
//     隠れている間に起きた変化を、戻ってから最大 `intervalMs` 待たせない。
//   - 30秒は上限で、10秒なら取り直しが1回失敗しても間に合う（基準 9.9）。
//
// 呼ぶ側の関数は**毎回いちばん新しいものを使う**（ref に持つ）。呼ぶ側が state を見て組み立てた
// 関数でも、古い state を掴んだまま呼ばれない。

import { useEffect, useRef } from "react";

/** 取り直しの間隔（10秒・AI判断。基準 9.9 の30秒は上限）。 */
export const POLL_INTERVAL_MS = 10_000;

export const usePolling = (run: () => void | Promise<void>, intervalMs: number = POLL_INTERVAL_MS): void => {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      void latest.current();
    };
    const start = () => {
      if (timer === null) timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      tick();
      start();
    };

    tick();
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
};
