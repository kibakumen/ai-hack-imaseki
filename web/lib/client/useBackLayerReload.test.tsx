// @vitest-environment jsdom
// 重ねた画面を開いたまま再読み込みしたあとの「戻る」（2026-09-25 監査の指摘 客-03 のレビュー）。
//
// 再読み込みでモジュールの番号は0に戻るが、履歴には前の番号（例: imasekiLayer: 1）が残る。以前は新しく開いた
// 重ねが同じ番号1で積まれ、最初の戻る操作が前の番号1の履歴に着地して何も閉じず、1回余計に押す必要があった。
// ⚠️ モジュールの状態（開いている重ね・番号・聞いているか）を持ち越さないため、ほかの検査と別のファイルに置く。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackLayer } from "./useBackLayer";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

afterEach(async () => {
  cleanup();
  await settle();
});

describe("useBackLayer（再読み込みのあと）", () => {
  it("前の番号の履歴の上で開き直した重ねは、最初の戻る操作で閉じる", async () => {
    // 再読み込みの前に積まれていた重ねの履歴（番号1と2）の上で、ページが読み込み直された状態を作る
    window.history.pushState({ imasekiLayer: 1 }, "");
    window.history.pushState({ imasekiLayer: 2 }, "");
    const close = vi.fn();
    renderHook(() => useBackLayer(true, close));
    await act(async () => {
      window.history.back();
      await settle();
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
