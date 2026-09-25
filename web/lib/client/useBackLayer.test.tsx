// @vitest-environment jsdom
// 端末の「戻る」で重ねた画面を閉じる道具（2026-09-25 監査の指摘 客-03）。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackLayer } from "./useBackLayer";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

afterEach(async () => {
  cleanup();
  await settle();
});

describe("useBackLayer", () => {
  it("開くと履歴を1つ積み、戻る操作で閉じる", async () => {
    const close = vi.fn();
    const before = window.history.length;
    renderHook(({ open }) => useBackLayer(open, close), { initialProps: { open: true } });
    expect(window.history.length).toBe(before + 1);
    await act(async () => {
      window.history.back();
      await settle();
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ボタンで閉じたら積んだ履歴を戻して消し、そのときの戻りでは何も閉じない", async () => {
    const other = vi.fn();
    const close = vi.fn();
    renderHook(() => useBackLayer(true, other));
    const { rerender } = renderHook(({ open }) => useBackLayer(open, close), { initialProps: { open: true } });
    // 描き直し（と、その後始末の effect）が済んでから、戻しの popstate が届くのを待つ
    act(() => rerender({ open: false }));
    await settle();
    expect(close).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    // 次の戻る操作は、下に残っている重ねを閉じる
    await act(async () => {
      window.history.back();
      await settle();
    });
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("閉じるのと開くのが同じ描き直しで起きても、開いた方は閉じない（閉じた方の履歴を使い回す）", async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const { rerender } = renderHook(({ a, b }) => {
      useBackLayer(a, closeA);
      useBackLayer(b, closeB);
    }, { initialProps: { a: true, b: false } });
    act(() => rerender({ a: false, b: true }));
    await settle();
    expect(closeB).not.toHaveBeenCalled();
    await act(async () => {
      window.history.back();
      await settle();
    });
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });
});
