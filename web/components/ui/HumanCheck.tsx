"use client";

// 人かどうかの確かめ（Turnstile）の部品（設計書「客の画面」の注）。3つのフォーム（客の登録・
// 店の登録・ログイン）が使う。サイトキーは呼ぶ側が公開値の入口から受け取って渡す——
// この部品は束縛の名前を知らない。値が取れたら onToken で渡し、resetKey が増えたら取り直す
// （確かめの値は使い切りで、断られたあとの送り直しには新しい値が要る）。
//
// 用途（action）は必ず名乗る（2026-09-25 監査の指摘 安全-23）。入口は答えの用途が自分の用途
// （schemas/limits の HUMAN_CHECK_ACTIONS）と合わなければ断るので、名乗らないと全部断られる。

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { HumanCheckAction } from "../../lib/schemas/limits";

/** Turnstile の読み込み先。応答の見出しの CSP（next.config.ts）がこの読み込み元を許しているかを検査が見る。 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: { sitekey: string; action: string; callback: (token: string) => void }) => string | undefined;
  reset: (widgetId?: string) => void;
};

const turnstileApi = (): TurnstileApi | null => (globalThis as unknown as { turnstile?: TurnstileApi }).turnstile ?? null;

/** 読み込みの札を1つだけ置く（同じ札が在れば足さない）。読み込めない端末では何も起きない。 */
const ensureScript = (onLoad: () => void): (() => void) => {
  const found = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
  const script = found ?? document.createElement("script");
  if (!found) {
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.dataset.turnstile = "1";
    document.head.append(script);
  }
  script.addEventListener("load", onLoad);
  return () => script.removeEventListener("load", onLoad);
};

/** 送って断られたあと、フォームがその場で確かめをやり直すための取っ手。 */
export type HumanCheckHandle = { reset: () => void };

type HumanCheckProps = {
  siteKey: string;
  /** この確かめの用途（入口の用途と同じ値） */
  action: HumanCheckAction;
  onToken: (token: string) => void;
  ref?: Ref<HumanCheckHandle>;
};

export const HumanCheck = ({ siteKey, action, onToken, ref }: HumanCheckProps) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | null>(null);
  const renderedRef = useRef(false);
  const [ready, setReady] = useState(() => turnstileApi() !== null);

  useEffect(() => {
    if (ready) return;
    return ensureScript(() => setReady(turnstileApi() !== null));
  }, [ready]);

  useEffect(() => {
    const api = turnstileApi();
    const box = boxRef.current;
    if (!api || !box || renderedRef.current) return;
    renderedRef.current = true;
    widgetRef.current = api.render(box, { sitekey: siteKey, action, callback: onToken }) ?? null;
  }, [ready, siteKey, action, onToken]);

  // やり直しは、断りを受けたその場（フォームの中）で呼ぶ。次に描かれるまで待たないので、
  // 送り直しのときには新しい値が渡っている。
  useImperativeHandle(ref, () => ({ reset: () => turnstileApi()?.reset(widgetRef.current ?? undefined) }), []);

  return <div ref={boxRef} data-testid="human-check" data-sitekey={siteKey} />;
};
