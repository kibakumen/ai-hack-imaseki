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
import { ARRIVALS_REFRESH_MS } from "../../lib/schemas/limits";
import { ArrivalsList, type ArrivalsListRow } from "./ArrivalsList";
import { PublishForm, type PublishFormCoupon, type PublishFormPrefill } from "./PublishForm";
import { OfferPanel, type OfferPanelOffer } from "./OfferPanel";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";

/** 入口 `GET /api/store/home` の応答のうち、この画面が読む分（受け入れ検査の契約 `StoreHomeDto`）。 */
export type StoreHomeView = {
  id: string;
  status: StoreStatusValue;
  checklist: { license: boolean; card: boolean };
  missingProfile: string[];
  offer: OfferPanelOffer | null;
  publishPrefill: PublishFormPrefill;
  coupons: PublishFormCoupon[];
  arrivals: ArrivalsListRow[];
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

  // 確保の追加と状態の変化を30秒以内に一覧へ映す（基準 20.4）。開いている間だけ動き、
  // 取れなかった回は前の値のままにする（一覧が空に落ちて、向かっている客が消えないように）。
  useEffect(() => {
    let alive = true;
    const timer = setInterval(() => {
      void (async () => {
        const next = await loadHome();
        if (alive && next) setHome(next);
      })();
    }, ARRIVALS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
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

      {home.offer ? <OfferPanel offer={home.offer} onChanged={reload} /> : null}

      <ArrivalsList rows={home.arrivals ?? []} onChanged={reload} />

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
