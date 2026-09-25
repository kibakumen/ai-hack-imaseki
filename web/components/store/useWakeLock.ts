"use client";

// 店のホームを開いている間、画面の消灯を防ぐ（2026-09-25 監査の指摘 店-07）。
//
// 店はホームを開いたままカウンターに置く。画面が消えると取り直しも止まり、新しい客の音も鳴らない。
// Screen Wake Lock を取り、画面が隠れて外された（ブラウザが自動で外す）あと、戻ったら取り直す。
// 持たない端末（古い Safari など）では何もしない——消灯の設定は端末の側で変えてもらう。

import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

export const useWakeLock = (): void => {
  useEffect(() => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let alive = true;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await wakeLock.request("screen");
        if (alive) sentinel = next;
        else void next.release();
      } catch {
        // 省電力の設定などで断られた（画面は普通に消える）
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
};
