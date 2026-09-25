"use client";

// 客の画面（/me）を開いたときの Service Worker と通知の購読（2026-09-25 監査の指摘 不具合-05・不具合-11）。
//
//   1. 開いたら、通知の許可に関わらず Service Worker を `/me` の範囲で登録する（電波の無い所で /me を開き直せる・基準 9.12）
//   2. 許可済みなのに端末に購読が無ければ、黙って作り直して入口へ預ける
//   3. サーバーが「購読が無い」と言ったら（ホームの `pushPromptDue`）、許可済みの端末なら黙って預け直す
// どれも失敗しても画面には何も出さない（通知が無くても、画面を開けば取り消しは分かる・基準 22.9）。

import { useEffect } from "react";
import { registerMeServiceWorker, restorePushSubscription } from "../../lib/client/push";

export const useMeServiceWorker = (serverMissingSubscription: boolean): void => {
  useEffect(() => {
    const start = async () => {
      await registerMeServiceWorker();
      await restorePushSubscription(false);
    };
    void start();
  }, []);

  useEffect(() => {
    if (serverMissingSubscription) void restorePushSubscription(true);
  }, [serverMissingSubscription]);
};
