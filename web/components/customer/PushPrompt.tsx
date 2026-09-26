"use client";

// 通知の許可を求める説明（要件22の基準 22.8・22.9・22.10・22.11）。確保中の表示の中、**札・経路・クーポンの下**に出す
// （2026-09-25 監査の指摘 客-05——以前は確保番号より上に出て、店頭で番号を見せる前に店員がまず通知の案内を読んだ。
// 本人の指摘「受け取ったオファーを前面に。ほかのものが先に来ると飲食店に見せにくい」）。
//
// 出す条件は4つとも満たすとき: ①入口が「求めてよい」と言っている（`due`＝まだ購読をサーバーに預けていない客）
// ②この端末で「今はしない」を押していない（端末が覚えている・基準 22.11）③端末がまだ許可も拒否も答えていない
// ④この画面で答えていない。許可済みなのに購読が無い端末は、問わずに作り直す（`lib/client/push` の
// `restorePushSubscription`・不具合-11）——だから「許可した」ことは印に残さず、端末の許可の状態で見る。
//
// 説明は1行に縮め、届かない端末の注は畳む（客-05）。仕組みが無いブラウザ（iPhone の Safari でホーム画面に
// 追加していない場合など）には**ボタンを出さず**、届かないことと、今の確保をどこで見るかを伝え、「閉じる」を置く
// （以前は消す手段が無く、開くたびに番号の上に居座った）。
//
// 鍵の値はここに無い——`client/push` が入口 `GET /api/config/public` から受け取る。

import { useState } from "react";
import { permissionSettled, pushAnswered, pushSupported, rememberPushDecline, subscribeToPush } from "../../lib/client/push";
import { isIosBrowser } from "../../lib/client/homeScreen";

export type PushPromptProps = {
  /** 入口（客のホーム）の `pushPromptDue`。まだ購読を預けていない客だけ true */
  due: boolean;
};

/** 届かない端末の注（畳んで置く。基準 22.10 の「届かないことがある」と 22.9 の「開けば分かる」） */
const DeliveryNote = () => (
  <details className="push-prompt__more">
    <summary>届かない端末について</summary>
    <p>端末や設定によっては通知が届かないことがあります（iPhone は、ホーム画面に追加して開いた場合だけ届きます）。届かなくても、この画面を開けばキャンセルは分かります。</p>
  </details>
);

/** 通知の仕組みが無いブラウザでの1行（客-04 の案A: iPhone では、今の確保はこの画面で見てもらう） */
const unsupportedText = (): string =>
  isIosBrowser()
    ? "このブラウザには通知が届きません。今の確保はこの画面（Safari）で見てください。次から、ホーム画面に追加したアイコンで開くと通知が届きます（追加した側では登録をやり直します）。"
    : "このブラウザには通知が届きません。この画面を開けばキャンセルは分かります。";

export const PushPrompt = ({ due }: PushPromptProps) => {
  // 最初の描画で端末の覚えを読む（読み直さない。押した時にこの場で閉じる）。
  const [closed, setClosed] = useState<boolean>(() => pushAnswered() || permissionSettled());
  const [supported] = useState<boolean>(() => pushSupported());

  if (!due || closed) return null;

  const allow = () => {
    setClosed(true);
    // 断られても・公開鍵が取れなくても、画面には何も出さない（開けば取り消しは分かる）。
    void subscribeToPush();
  };
  const decline = () => {
    rememberPushDecline();
    setClosed(true);
  };

  return (
    <section className="push-prompt" data-testid="push-prompt" aria-label="キャンセルの通知">
      <p className="push-prompt__lead">お店の都合や、運営がお店の登録を取り消したことで確保がキャンセルされたときだけ、通知でお知らせします。</p>
      {supported ? (
        <p className="push-prompt__actions">
          <button type="button" data-testid="btn-push-allow" onClick={allow}>
            通知を受け取る
          </button>
          <button type="button" data-testid="btn-push-decline" onClick={decline}>
            今はしない
          </button>
        </p>
      ) : (
        <p className="push-prompt__actions">
          <span>{unsupportedText()}</span>
          <button type="button" data-testid="btn-push-dismiss" onClick={decline}>
            閉じる
          </button>
        </p>
      )}
      <DeliveryNote />
    </section>
  );
};

export default PushPrompt;
