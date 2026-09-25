"use client";

// 客の画面のホーム（GET /api/customer/home）の取り直しと、取れなかったときの倒れ方（2026-09-25 監査の指摘 設計-16 で
// CustomerApp から分けた。振る舞いは分ける前と同じ）。
//
// 取り直しは `usePolling` が回し、操作の応答で作り直したとき（`adopt`）は、それより前に送った取り直しの応答（古い状態）を
// 捨てる（不具合-17）。通信の失敗とサーバーの不具合（500・internal）は端末に残した内容へ倒し（基準 9.10・9.11）、
// 見分けの断り（401）だけを登録の入力へ倒す（基準 1.10・1.11・設計-15）。

import { useState } from "react";
import { callApi, isFailure, isTransientFailure, type ApiFailure } from "../../lib/client/api";
import { clearHome as clearCachedHome, loadHome as loadCachedHome, saveHome as saveCachedHome } from "../../lib/client/reservationCache";
import { usePolling, type PollControl, type PollTicket } from "../../lib/client/usePolling";
import type { HomeDto } from "./home";

export type CustomerHome = {
  /** 今の表示の種類と中身。null は登録の入力（401）か、まだ1度も取れていない */
  home: HomeDto | null;
  /** 1度でも答えが返ったか */
  loaded: boolean;
  /** 取り直しが失敗し、端末に残した内容を出しているか */
  stale: boolean;
  /**
   * 1度も取れず端末にも残っていないまま、取り直しが通信の失敗・サーバーの不具合に終わった（2026-09-25 レビューの指摘）。
   * このときは登録の入力を出さない——出すと客が入れ直して登録し、新しい識別子の Cookie が今の Cookie
   * （確保を持つかもしれない）を上書きする。
   */
  unreachable: ApiFailure | null;
  polling: PollControl;
  /** 操作の応答が連れてきたホームで作り直す（それより前に送った取り直しの応答は映さない・不具合-17） */
  adopt: (next: HomeDto) => void;
};

/** 取れたホームを端末に残す（確保が無いホームは残すものが無いので消す）。 */
const keep = (next: HomeDto) => {
  if (next.reservation === undefined) clearCachedHome();
  else saveCachedHome(next);
};

/**
 * `onRefreshed` は、取り直しで新しいホームが取れたとき、表示を差し替える直前に前のホームと一緒に呼ばれる
 * （確保が確保中でなくなったことを、呼ぶ側が知らせに変えるため・客-03）。
 */
export const useCustomerHome = (onRefreshed: (previous: HomeDto | null, next: HomeDto) => void): CustomerHome => {
  const [home, setHome] = useState<HomeDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [unreachable, setUnreachable] = useState<ApiFailure | null>(null);

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
      onRefreshed(home, result);
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

  const adopt = (next: HomeDto) => {
    polling.invalidate();
    setHome(next);
    setLoaded(true);
    setStale(false);
    keep(next);
  };

  return { home, loaded, stale, unreachable, polling, adopt };
};
