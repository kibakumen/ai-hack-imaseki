"use client";

// 店のホーム（要件12の基準 12.6〜12.9）。開いた時にホームの入口を1回呼び、承認の状況の帯と、
// 未承認なら足りないもののチェックリストを出す（設計書「店の画面」の1）。
// 部品は返された値を描くだけで、自分では判断しない。
//
// ⚠️ **この画面は3つのタスクが順に育てる**（2026-09-21 の並列の実装）。
//    タスク7（ここ）が帯とチェックリストと取り直しの骨を置き、
//    **タスク9 が公開中のオファーのカード（`offer`）**、**タスク17 が「向かっている客」（`arrivals`）**を
//    下の ⚠️ の場所へ足す。公開のフォームの中身もタスク9（`PublishForm`）。

import { useCallback, useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { PublishForm, type PublishCoupon, type PublishPrefill } from "./PublishForm";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";

/** 入口 `GET /api/store/home` の応答のうち、この画面が読む分（受け入れ検査の契約 `StoreHomeDto`）。 */
export type StoreHomeView = {
  id: string;
  status: StoreStatusValue;
  checklist: { license: boolean; card: boolean };
  missingProfile: string[];
  offer: { id: string } | null;
  publishPrefill: PublishPrefill;
  coupons: PublishCoupon[];
};

export const StoreHome = () => {
  const [home, setHome] = useState<StoreHomeView | null>(null);

  const loadHome = useCallback(async (): Promise<StoreHomeView | null> => {
    const result = await apiCall<StoreHomeView>("GET", "/api/store/home");
    return isFailure(result) ? null : result;
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadHome();
      if (alive) setHome(next);
    })();
    return () => {
      alive = false;
    };
  }, [loadHome]);

  const reload = () => {
    void (async () => setHome(await loadHome()))();
  };

  if (!home) return <main aria-busy="true" />;

  // 公開の操作を出すのは承認済みのときだけ（未承認・止められている間は入口も断る・基準 17.10）。
  const canPublish = home.status === "approved" && home.offer === null;

  return (
    <main>
      <StatusBanner status={home.status} />

      {home.status === "pending" && <SetupChecklist checklist={home.checklist} missingProfile={home.missingProfile} />}

      {canPublish && <PublishForm coupons={home.coupons} prefill={home.publishPrefill} onPublished={reload} />}

      {/* ⚠️ タスク9: 公開中のオファーのカード（`home.offer`）と、公開を止める操作 */}
      {/* ⚠️ タスク17: 「向かっている客」の一覧（`home.arrivals`） */}

      <nav>
        <a href="/store/profile">店の情報</a>
        <a href="/store/coupons">クーポン</a>
        <a href="/store/documents">書類</a>
        <a href="/store/results">実績</a>
      </nav>
    </main>
  );
};

export default StoreHome;
