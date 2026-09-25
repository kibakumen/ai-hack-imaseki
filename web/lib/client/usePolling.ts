// 状態の変化を画面へ映すための取り直し（要件9の基準 9.8・9.9・要件20の基準 20.4）。
// 設計書「比べた案」で常時つなぐ仕組み（SSE・WebSocket）を採らず、**10秒ごとの取り直し**にした。
// 常時の接続へ替えるときに触るのはこのファイルだけ（設計書「撤退しやすさ」）。
//
// 決め:
//   - 開いた時に1回（基準 9.8）。以後 `intervalMs` ごと。
//   - 画面が隠れている間は止め、戻った時にすぐ1回取り直す（基準 9.8 の「開いた時」の実体）。
//     隠れている間に起きた変化を、戻ってから最大 `intervalMs` 待たせない。
//   - 30秒は上限で、10秒なら取り直しが1回失敗しても間に合う（基準 9.9）。
//   - **前の回の応答が来るまで次の回を送らない**。応答が返らないまま間隔の2回ぶん（`STUCK_INTERVALS`）を
//     過ぎた回だけは見切って次を送る（止まった1回のために、変化を映すのが止まらないように）。
//   - **回ごとに番号を持たせ、新しい回を送ったら古い回の応答は捨てる**（呼ぶ側が `ticket.isCurrent()` で見る）。
//     操作の応答で画面を作り直したときは `invalidate()` を呼び、それより前に送った回の応答を捨てる。
//     ⚠️ 2026-09-25 監査の指摘 不具合-17: 以前は前の回を待たずに次を送り、応答の順番も見ていなかった。
//     取り直しの通信中に「この店に行く」を押すと、受け取りの応答で確保中になったあとに、押す前に送った
//     古い応答（確保なし）が届いて、最大10秒取得の画面へ戻り、端末の控えも消えた。
//
// 呼ぶ側の関数は**毎回いちばん新しいものを使う**（ref に持つ）。呼ぶ側が state を見て組み立てた
// 関数でも、古い state を掴んだまま呼ばれない。

import { useCallback, useEffect, useRef } from "react";

/** 取り直しの間隔（10秒・AI判断。基準 9.9 の30秒は上限）。 */
export const POLL_INTERVAL_MS = 10_000;

/** 応答の無い回を見切るまでの、間隔の回数（AI判断。10秒なら20秒で見切り、基準 9.9 の30秒に収める） */
export const STUCK_INTERVALS = 2;

/** 1回ぶんの取り直しに渡す印。応答を画面に映す前に `isCurrent()` を見て、false なら捨てる */
export type PollTicket = { isCurrent: () => boolean };

export type PollControl = {
  /** それより前に送った回の応答を捨てる（操作の応答で画面を作り直したときに呼ぶ）。次の回はすぐ送れる */
  invalidate: () => void;
  /** それより前に送った回の応答を捨てて、すぐ1回取り直す（読み直しのボタン・操作のあとの取り直し） */
  refreshNow: () => void;
};

export const usePolling = (run: (ticket: PollTicket) => void | Promise<void>, intervalMs: number = POLL_INTERVAL_MS): PollControl => {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  }, [run]);

  /** 何回目の要求か。これと違う番号の回の応答は古い */
  const generation = useRef(0);
  /** 送って応答をまだ受け取っていない回を送った時刻（無ければ null） */
  const inFlightSince = useRef<number | null>(null);

  const send = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const mine = generation.current;
    inFlightSince.current = Date.now();
    try {
      await latest.current({ isCurrent: () => generation.current === mine });
    } finally {
      // 見切られた・捨てられた回は、今の回の「送っている最中」を解かない
      if (generation.current === mine) inFlightSince.current = null;
    }
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    inFlightSince.current = null;
  }, []);

  const refreshNow = useCallback(() => {
    void send();
  }, [send]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const since = inFlightSince.current;
      if (since !== null && Date.now() - since < intervalMs * STUCK_INTERVALS) return;
      void send();
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
  }, [intervalMs, send]);

  return { invalidate, refreshNow };
};
