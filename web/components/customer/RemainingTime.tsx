"use client";

// 確保の残り時間（2026-09-25 監査の指摘 客-06）。「期限 HH:MM まで」だけでは、道に迷っている客が
// あと何分あるかを暗算することになる。「あと◯分」を出し、5分を切ったら目立たせる。
//
// 時計は端末のもの（サーバーの時計とずれうる）。表示の目安で、期限の判断はサーバーが持つ（`domain/reservation`）。
// 30秒ごとに描き直す（分の単位なので、それより細かく動かしても見た目は変わらない）。

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;
/** 描き直す間隔 */
const TICK_MS = 30_000;
/** これを切ったら目立たせる（AI判断・監査の指摘の「5分を切ったら」） */
export const SOON_MINUTES = 5;

/** 残りの分（切り上げ。0 以下は期限の時刻を過ぎた） */
export const minutesLeft = (expiresAt: string, now: number): number => Math.ceil((new Date(expiresAt).getTime() - now) / MINUTE_MS);

const remainingText = (minutes: number): string => {
  if (minutes <= 0) return "期限の時刻を過ぎました";
  if (minutes <= SOON_MINUTES) return `あと${minutes}分（まもなく期限です）`;
  return `あと${minutes}分`;
};

export const RemainingTime = ({ expiresAt }: { expiresAt: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = minutesLeft(expiresAt, now);
  const soon = minutes <= SOON_MINUTES;
  return (
    <span className={soon ? "remaining remaining--soon" : "remaining"} data-testid="reservation-remaining">
      {remainingText(minutes)}
    </span>
  );
};

export default RemainingTime;
