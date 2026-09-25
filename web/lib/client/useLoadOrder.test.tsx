// @vitest-environment jsdom
// 店のホームの取り直しの順番（2026-09-25 監査の指摘 不具合-17 の店の側）。
//
// 店のホームは `useLoad` の定期の取り直しで動く。「完了」を押した直後の読み直しより先に送った取り直し
// （押す前の一覧）が後から届くと、完了にした行が確保中に戻り、「新しい客」の音まで鳴っていた。
// 読み直しを送ったら、それより前に送った回の答えは捨てる。
//
// 定期の取り直し同士では捨てない（不具合-17 のレビュー）。定期の回が前の回を待たずに送られ、どの回も次の回に
// 追い越されて捨てられていたので、応答が毎回間隔より遅い回線では一覧が黙って固まり、失敗の帯も出なかった。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoad } from "./useLoad";
import { STUCK_INTERVALS } from "./usePolling";

const POLL_MS = 30_000;

/** 呼ばれるたびに、答えを外から返せる読み込み（`useLoad` は関数が変わると読み直すので、描くたびに作らない） */
const controllableLoad = () => {
  const resolvers: Array<(value: string) => void> = [];
  const load = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)));
  return { load, resolvers };
};

/** 答えを返して、その答えが状態へ映るまで進める */
const answer = async (resolve: (value: string) => void, value: string) => {
  await act(async () => {
    resolve(value);
    await Promise.resolve();
  });
};

/** 偽の時計を進める（その間に来る定期の回も走る） */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  it("定期の取り直しの前の回がまだ返っていなければ、次の定期の回を送らない。間隔より遅れて届いた答えも映す", async () => {
    vi.useFakeTimers();
    const { load, resolvers } = controllableLoad();
    const { result } = renderHook(() => useLoad(load, { pollMs: POLL_MS }));
    await answer(resolvers[0], "開いた時");

    await advance(POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    // 前の定期の回（resolvers[1]）が返らないまま、次の間隔が来る
    await advance(POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);

    await answer(resolvers[1], "30秒より遅れて届いた");
    expect(result.current.state).toMatchObject({ status: "ready", data: "30秒より遅れて届いた" });
  });

  it("返らないまま止まった定期の回は間隔の2回ぶんで見切って次を送る。見切った回の答えも、新しい回より先に届けば映す", async () => {
    vi.useFakeTimers();
    const { load, resolvers } = controllableLoad();
    const { result } = renderHook(() => useLoad(load, { pollMs: POLL_MS }));
    await answer(resolvers[0], "開いた時");

    await advance(POLL_MS);
    await advance(POLL_MS * STUCK_INTERVALS);
    expect(load).toHaveBeenCalledTimes(3);

    await answer(resolvers[1], "見切った回");
    expect(result.current.state).toMatchObject({ status: "ready", data: "見切った回" });
    await answer(resolvers[2], "新しい回");
    expect(result.current.state).toMatchObject({ status: "ready", data: "新しい回" });
  });

  it("見切った定期の回の答えが、新しい回の答えより後に届いたら映さない（onLoaded も呼ばない）", async () => {
    vi.useFakeTimers();
    const { load, resolvers } = controllableLoad();
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useLoad(load, { pollMs: POLL_MS, onLoaded }));
    await answer(resolvers[0], "開いた時");

    await advance(POLL_MS);
    await advance(POLL_MS * STUCK_INTERVALS);
    await answer(resolvers[2], "新しい回");
    await answer(resolvers[1], "見切った回");

    expect(result.current.state).toMatchObject({ status: "ready", data: "新しい回" });
    expect(onLoaded.mock.calls.map((c) => c[0])).toEqual(["開いた時", "新しい回"]);
  });

  it("定期の回が返っていなくても、操作のあとの読み直しはすぐ送り、それより前に送った定期の回の答えは捨てる", async () => {
    vi.useFakeTimers();
    const { load, resolvers } = controllableLoad();
    const { result } = renderHook(() => useLoad(load, { pollMs: POLL_MS }));
    await answer(resolvers[0], "開いた時");

    await advance(POLL_MS);
    act(() => {
      void result.current.reload();
    });
    expect(load).toHaveBeenCalledTimes(3);

    await answer(resolvers[1], "押す前");
    expect(result.current.state).toMatchObject({ status: "ready", data: "開いた時" });
    await answer(resolvers[2], "完了のあと");
    expect(result.current.state).toMatchObject({ status: "ready", data: "完了のあと" });
  });
});
