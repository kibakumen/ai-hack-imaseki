// @vitest-environment jsdom
// 取り直しの順番（2026-09-25 監査の指摘 不具合-17）。
//
// 取り直しは前の回の応答を待たずに次を送り、応答の順番も見ていなかった。客が取り直しの通信中に
// 「この店に行く」を押すと、受け取りの応答で確保中になったあとに、押す前に送った古い応答（確保なし）が届いて
// 最大10秒、取得の画面へ戻っていた。店のホームでも、「完了」のあとに押す前の取り直しが届いて行が確保中に戻り、
// 「新しい客」の音が鳴った。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, usePolling, type PollTicket } from "./usePolling";

type Pending = { ticket: PollTicket; resolve: () => void };

/** 呼ばれるたびに、答えを外から返せる取り直し */
const controllableRun = () => {
  const pending: Pending[] = [];
  const run = vi.fn(
    (ticket: PollTicket) =>
      new Promise<void>((resolve) => {
        pending.push({ ticket, resolve });
      }),
  );
  return { run, pending };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePolling の順番", () => {
  it("前の回の応答が来るまで、次の回を送らない", async () => {
    vi.useFakeTimers();
    const { run, pending } = controllableRun();
    renderHook(() => usePolling(run));
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 1);
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending[0].resolve();
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("応答が返らないまま止まった回は、間隔の2回ぶんを過ぎたら見切って次を送り、古い回の応答は捨てる", async () => {
    vi.useFakeTimers();
    const { run, pending } = controllableRun();
    renderHook(() => usePolling(run));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2 + 1);
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(pending[0].ticket.isCurrent()).toBe(false);
    expect(pending[1].ticket.isCurrent()).toBe(true);
  });

  it("invalidate() より前に送った回の応答は捨てる（操作の応答で画面を作り直したとき）。次の回はすぐ送れる", async () => {
    vi.useFakeTimers();
    const { run, pending } = controllableRun();
    const { result } = renderHook(() => usePolling(run));
    expect(pending[0].ticket.isCurrent()).toBe(true);
    act(() => result.current.invalidate());
    expect(pending[0].ticket.isCurrent()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(pending[1].ticket.isCurrent()).toBe(true);
  });

  it("refreshNow() はすぐ1回送り、それより前に送った回の応答を捨てる", () => {
    const { run, pending } = controllableRun();
    const { result } = renderHook(() => usePolling(run));
    act(() => result.current.refreshNow());
    expect(run).toHaveBeenCalledTimes(2);
    expect(pending[0].ticket.isCurrent()).toBe(false);
    expect(pending[1].ticket.isCurrent()).toBe(true);
  });
});
