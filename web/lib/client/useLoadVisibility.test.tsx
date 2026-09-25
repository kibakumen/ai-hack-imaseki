// @vitest-environment jsdom
// 定期の取り直しと画面の表示（2026-09-25 監査の指摘 店-08）。
//
// 店のホームは画面が隠れている間も取り直しを止めない（隠れている間こそ新しい客の音が要る）。ただし、スリープから
// 戻ったタブレットが次の回まで古い一覧を見せないよう、**画面に戻ったらすぐ1回**取り直す。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoad } from "./useLoad";

const POLL_MS = 10_000;

const setVisibility = (value: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("画面に戻ったとき（店-08）", () => {
  it("定期の取り直しがある読み込みは、画面に戻るとすぐ1回取り直す。隠れても止めない", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => "x");
    renderHook(() => useLoad(load, { pollMs: POLL_MS }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      setVisibility("hidden");
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    // 隠れていても定期の回は送る
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      setVisibility("visible");
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("定期の取り直しの無い読み込みは、画面に戻っても取り直さない", async () => {
    const load = vi.fn(async () => "x");
    renderHook(() => useLoad(load));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      setVisibility("hidden");
      setVisibility("visible");
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
