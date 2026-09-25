// @vitest-environment jsdom
// 人かどうかの確かめ（Turnstile）の部品の片付けと失敗の知らせ（2026-09-25 監査の指摘 客-02）。
//
// 見るのは3つ:
//   1. 画面から外れたら、描いた部品を Turnstile から外す（外さないと、同じ要素へ描き直したときに2つ重なる・
//      開発時の StrictMode の「描く→片付け→描く」で1つ目が残る）
//   2. 部品が失敗を知らせたら（読み込めない・ホスト名が合わない等）、呼ぶ側へ onError で渡す
//   3. 読み込みの札そのものが読み込めなかったときも onError で渡す

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanCheck } from "./HumanCheck";

type TurnstileOptions = { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void };
type TurnstileWindow = Window & {
  turnstile?: { render: (el: HTMLElement, opts: TurnstileOptions) => string; reset: (id?: string) => void; remove?: (id: string) => void };
};

describe("人かどうかの確かめの部品", () => {
  afterEach(() => {
    cleanup();
    delete (window as TurnstileWindow).turnstile;
    document.head.querySelectorAll('script[data-turnstile="1"]').forEach((el) => el.remove());
  });

  it("画面から外れたら、描いた部品を Turnstile から外す", () => {
    const remove = vi.fn();
    (window as TurnstileWindow).turnstile = { render: () => "widget-7", reset: () => {}, remove };
    const { unmount } = render(<HumanCheck siteKey="s" onToken={() => {}} />);
    expect(remove).not.toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledWith("widget-7");
  });

  it("部品が失敗を知らせたら onError を呼ぶ", () => {
    const onError = vi.fn();
    (window as TurnstileWindow).turnstile = {
      render: (_el, opts) => {
        opts["error-callback"]?.();
        return "widget-1";
      },
      reset: () => {},
    };
    render(<HumanCheck siteKey="s" onToken={() => {}} onError={onError} />);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("読み込みの札が読み込めなかったら onError を呼ぶ", () => {
    const onError = vi.fn();
    render(<HumanCheck siteKey="s" onToken={() => {}} onError={onError} />);
    const script = document.head.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
    expect(script).toBeTruthy();
    script!.dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
