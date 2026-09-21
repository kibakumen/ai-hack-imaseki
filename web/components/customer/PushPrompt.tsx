"use client";

// 通知の許可を求める説明（要件22の基準 22.8・22.9・22.10・22.11）。確保中の表示の中に出す。
//
// 出す条件は3つとも満たすとき: ①入口が「求めてよい」と言っている（`due`＝まだ許可していない客）
// ②この端末でまだ答えていない（端末が覚えている・基準 22.11）③通知の仕組みが在る。
// 仕組みが無いブラウザ（iPhone の Safari でホーム画面に追加していない場合など）には**ボタンを出さず**、
// 届かないことと、開けば分かることだけを伝える（設計書「通知の説明の出し分け」）。
//
// 鍵の値はここに無い——`client/push` が入口 `GET /api/config/public` から受け取る。

import { useState } from "react";
import { pushAnswered, pushSupported, rememberPushAnswer, subscribeToPush } from "../../lib/client/push";

export type PushPromptProps = {
  /** 入口（客のホーム）の `pushPromptDue`。まだ通知を許可していない客だけ true */
  due: boolean;
};

export const PushPrompt = ({ due }: PushPromptProps) => {
  // 最初の描画で端末の覚えを読む（読み直さない。押した時にこの場で true にする）。
  const [answered, setAnswered] = useState<boolean>(() => pushAnswered());
  const [supported] = useState<boolean>(() => pushSupported());

  if (!due || answered) return null;

  const answer = (allow: boolean) => {
    rememberPushAnswer();
    setAnswered(true);
    // 断られても・公開鍵が取れなくても、画面には何も出さない（開けば取り消しは分かる）。
    if (allow) void subscribeToPush();
  };

  return (
    <section className="push-prompt" data-testid="push-prompt">
      <h3>取り消しの通知を受け取りますか</h3>
      <p>お店の都合で取り消されたとき、運営がお店を停止して取り消されたときだけ通知します。ほかの知らせは送りません。</p>
      <p>端末や設定によっては通知が届かないことがあります（iPhone は、ホーム画面に追加して開いた場合だけ届きます）。届かなくても、この画面を開けば取り消しは分かります。</p>
      {supported ? (
        <p>
          <button type="button" data-testid="btn-push-allow" onClick={() => answer(true)}>
            通知を受け取る
          </button>
          <button type="button" data-testid="btn-push-decline" onClick={() => answer(false)}>
            今はしない
          </button>
        </p>
      ) : (
        <p>このブラウザには通知が届きません。iPhone は、ホーム画面に追加して開き直すと受け取れます（追加した側では登録をやり直します）。</p>
      )}
    </section>
  );
};

export default PushPrompt;
