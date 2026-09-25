// @vitest-environment jsdom
// 店のホームの取り直しの順番（2026-09-25 監査の指摘 不具合-17 の店の側）。
//
// 店のホームは `useLoad` の定期の取り直しで動く。「完了」を押した直後の読み直しより先に送った取り直し
// （押す前の一覧）が後から届くと、完了にした行が確保中に戻り、「新しい客」の音まで鳴っていた。
// 読み直しを送ったら、それより前に送った回の答えは捨てる。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoad } from "./useLoad";

afterEach(() => cleanup());

describe("useLoad の答えの順番", () => {
  it("あとから送った読み直しの答えが先に届いたら、前に送った回の答えは後から届いても映さない（onLoaded も呼ばない）", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const load = () => new Promise<string>((resolve) => resolvers.push(resolve));
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useLoad(load, { onLoaded }));
    // 開いた時の1回（resolvers[0]）が返る前に、操作のあとの読み直し（resolvers[1]）を送る
    let reloading: Promise<void> = Promise.resolve();
    act(() => {
      reloading = result.current.reload();
    });
    await act(async () => {
      resolvers[1]("完了のあと");
      await reloading;
    });
    expect(result.current.state).toMatchObject({ status: "ready", data: "完了のあと" });
    await act(async () => {
      resolvers[0]("押す前");
      await Promise.resolve();
    });
    expect(result.current.state).toMatchObject({ status: "ready", data: "完了のあと" });
    expect(onLoaded.mock.calls.map((c) => c[0])).toEqual(["完了のあと"]);
  });
});
