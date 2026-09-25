"use client";

// 読み込みの4つの状態（loading・failed・empty・ready）を描く部品（2026-09-25 監査の指摘 横断-01）。
// 状態を決めるのは lib/client/useLoad、文は domain/texts、断りの語の文は InputRefusal の LoadMessage。
// この部品は受け取った状態を描き分けるだけで、判断はしない。
//
//   loading → 「読み込んでいます…」
//   failed  → 断りの文と「もう一度読み込む」（**0件の文は出さない**）
//   empty   → 呼ぶ側が渡した0件の文
//   ready   → 中身。取り直しが失敗している間は「最終更新 HH:MM・更新できていません」の帯を上に出す
//
// ログインが切れた（401）ときの /login への道は、店と運営の画面の殻の SessionExpiredNotice が出す。

import type { ReactNode } from "react";
import type { LoadState } from "../../lib/client/useLoad";
import { LOAD_TEXTS } from "../../lib/domain/texts";
import { LoadMessage } from "./InputRefusal";
import { timeInJst } from "./jstTime";

type LoadViewProps<T> = {
  state: LoadState<T>;
  onRetry: () => void;
  /** 0件のときに出すもの。渡さなければ、0件でも中身を描く */
  empty?: ReactNode;
  children: (data: T) => ReactNode;
};

/** 取り直しが失敗している間の帯（「最終更新 HH:MM・更新できていません」）。取れていないときは出さない。 */
export const RefreshFailedBand = <T,>({ state }: { state: LoadState<T> }) => {
  if ((state.status !== "ready" && state.status !== "empty") || !state.refreshFailure) return null;
  return (
    <p className="msg load-state__stale" role="status" data-testid="refresh-failed">
      {LOAD_TEXTS.stale(timeInJst(new Date(state.updatedAt).toISOString()))}
    </p>
  );
};

export const LoadView = <T,>({ state, onRetry, empty, children }: LoadViewProps<T>) => {
  if (state.status === "loading") {
    return (
      <p className="load-state" aria-busy="true" data-testid="load-loading">
        {LOAD_TEXTS.loading}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="load-state" data-testid="load-failed">
        <LoadMessage failure={state.failure} />
        <button type="button" data-testid="btn-retry" onClick={onRetry}>
          {LOAD_TEXTS.retry}
        </button>
      </div>
    );
  }
  return (
    <>
      <RefreshFailedBand state={state} />
      {state.status === "empty" && empty !== undefined ? empty : children(state.data)}
    </>
  );
};
