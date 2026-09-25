"use client";

// 人かどうかの確かめ（Turnstile）の部品（設計書「客の画面」の注）。3つのフォーム（客の登録・
// 店の登録・ログイン）と、客の画面の入口（GuestEntry）が使う。サイトキーは呼ぶ側が公開値の入口から
// 受け取って渡す——この部品は束縛の名前を知らない。値が取れたら onToken で渡し、reset で取り直す
// （確かめの値は使い切りで、断られたあとの送り直しには新しい値が要る）。
//
// 2026-09-25 監査の指摘 客-02 で足した2つ:
//   - 画面から外れたら、描いた部品を Turnstile から外す（開発時の StrictMode の「描く→片付け→描く」でも
//     部品が1つだけになる）
//   - 部品や読み込みの札が失敗したら onError で知らせる（呼ぶ側が待ち続けずに次の手へ移れるように）

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
};

type TurnstileApi = {
  render: (el: HTMLElement, opts: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove?: (widgetId: string) => void;
};

const turnstileApi = (): TurnstileApi | null => (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile ?? null;

/** 読み込みの札を1つだけ置く（同じ札が在れば足さない）。読み込めなければ onError。 */
const ensureScript = (onLoad: () => void, onError: () => void): (() => void) => {
  const found = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
  const script = found ?? document.createElement("script");
  if (!found) {
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.turnstile = "1";
    document.head.append(script);
  }
  script.addEventListener("load", onLoad);
  script.addEventListener("error", onError);
  return () => {
    script.removeEventListener("load", onLoad);
    script.removeEventListener("error", onError);
  };
};

/** 送って断られたあと、フォームがその場で確かめをやり直すための取っ手。 */
export type HumanCheckHandle = { reset: () => void };

type HumanCheckProps = {
  siteKey: string;
  onToken: (token: string) => void;
  /** 部品か読み込みの札が失敗したとき（呼ぶ側が待ち続けないため）。無ければ何もしない。 */
  onError?: () => void;
  ref?: Ref<HumanCheckHandle>;
};

const ignoreError = () => {};

export const HumanCheck = ({ siteKey, onToken, onError = ignoreError, ref }: HumanCheckProps) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | null>(null);
  // 受け皿は最新のものを呼ぶ（呼ぶ側が関数を作り直しても、部品を描き直して値を捨てない）
  const handlersRef = useRef({ onToken, onError });
  const [ready, setReady] = useState(() => turnstileApi() !== null);

  useEffect(() => {
    handlersRef.current = { onToken, onError };
  });

  useEffect(() => {
    if (ready) return;
    return ensureScript(
      () => setReady(turnstileApi() !== null),
      () => handlersRef.current.onError(),
    );
  }, [ready]);

  // 描いた部品は片付けで外す（外さずに描き直すと同じ要素に2つ重なる）。
  useEffect(() => {
    const api = turnstileApi();
    const box = boxRef.current;
    if (!api || !box) return;
    const widgetId =
      api.render(box, {
        sitekey: siteKey,
        callback: (token) => handlersRef.current.onToken(token),
        "error-callback": () => handlersRef.current.onError(),
      }) ?? null;
    widgetRef.current = widgetId;
    return () => {
      widgetRef.current = null;
      if (widgetId !== null) api.remove?.(widgetId);
    };
  }, [ready, siteKey]);

  // やり直しは、断りを受けたその場（フォームの中）で呼ぶ。次に描かれるまで待たないので、
  // 送り直しのときには新しい値が渡っている。
  useImperativeHandle(ref, () => ({ reset: () => turnstileApi()?.reset(widgetRef.current ?? undefined) }), []);

  return <div ref={boxRef} data-testid="human-check" data-sitekey={siteKey} />;
};
