"use client";

// iPhone の Safari で、確保を持たない取得の画面に出す「ホーム画面に追加すると通知が届く」の1行
// （2026-09-25 監査の指摘 客-04 の案A）。
//
// 以前は確保中の画面で「ホーム画面に追加して開き直すと受け取れます」と案内していた。ホーム画面のアプリは
// Safari と Cookie を共有しないので、案内どおりに追加した客ほど今の確保が見えなくなり、その確保の通知も
// 届かなかった。だから追加を勧めるのは**確保を持っていないとき**だけにする（次の確保から通知が届く）。
// 閉じたら端末が覚え、二度と出さない。

import { useState } from "react";
import { isIosBrowser, isStandalone } from "../../lib/client/homeScreen";
import { pushSupported } from "../../lib/client/push";

const CLOSED_KEY = "imaseki:home-screen-hint-closed";

const readClosed = (): boolean => {
  try {
    return window.localStorage.getItem(CLOSED_KEY) !== null;
  } catch {
    return false;
  }
};

/** 出すか（iPhone のブラウザで、ホーム画面のアプリでなく、通知の仕組みが無く、閉じていない） */
const shouldShow = (): boolean => isIosBrowser() && !isStandalone() && !pushSupported() && !readClosed();

export const HomeScreenHint = () => {
  const [shown, setShown] = useState<boolean>(() => shouldShow());
  if (!shown) return null;

  const close = () => {
    try {
      window.localStorage.setItem(CLOSED_KEY, "1");
    } catch {
      // 覚えられない端末では、この画面の間だけ閉じる
    }
    setShown(false);
  };

  return (
    <p className="home-screen-hint" data-testid="home-screen-hint">
      <span>iPhone は、共有ボタンから「ホーム画面に追加」して開くと、確保が取り消されたときの通知を受け取れます（追加した側では登録をやり直します）。</span>
      <button type="button" data-testid="btn-home-hint-close" onClick={close}>
        閉じる
      </button>
    </p>
  );
};

export default HomeScreenHint;
