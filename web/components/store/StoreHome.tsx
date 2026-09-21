"use client";

// 店のホーム（要件12の基準 12.6〜12.9）。開いた時にホームの入口を1回呼び、承認の状況の帯と、
// 未承認なら足りないもののチェックリストを出す（設計書「店の画面」の1）。
// 部品は返された値を描くだけで、自分では判断しない。
//
// 並びは 2026-09-21 の本人の指摘で入れ替えた（速成版 sprint/app/store が基準）:
//   **向かっている客がいちばん上**——店が開きっぱなしにするのはこの画面で、いちばん急ぐのは
//   「来た客を完了にする」操作だから。公開の設定はその下（1日に何度も触るものではない）。
// 画面のあいだの行き来はタブに変えた（StoreNav）。新しい客が増えた時は音で知らせる。

import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { ARRIVALS_REFRESH_MS } from "../../lib/schemas/limits";
import { ArrivalsList, type ArrivalsListRow } from "./ArrivalsList";
import { playNotifyBeep } from "./beep";
import { PublishForm, type PublishFormCoupon, type PublishFormPrefill } from "./PublishForm";
import { OfferPanel, type OfferPanelOffer } from "./OfferPanel";
import { appendTrend, type TrendPoint } from "./OfferTrend";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";
import { StoreNav } from "./StoreNav";

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
  /** 「今日の動き」の点。カードが作り直されても消えないように、ここで持つ */
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  /** 前に見た確保の番号。**初めの読み込みでは鳴らさない**（開いた瞬間に全員ぶん鳴るのを避ける） */
  const seenRef = useRef<Set<string> | null>(null);

  const loadHome = useCallback(async (): Promise<StoreHomeView | null> => {
    const result = await apiCall<StoreHomeView>("GET", "/api/store/home");
    return isFailure(result) ? null : result;
  }, []);

  /**
   * 取り直した中身を受け取ったときの1手ぶん——
   *   1. 新しく向かい始めた客がいれば音で知らせる（気づけないと客を待たせるため）
   *   2. 「今日の動き」に点を足す（値が変わった時だけ）
   * 描く途中ではなく**受け取った時**に済ませる（描き直しの連鎖を作らない）。
   */
  const absorb = useCallback((next: StoreHomeView) => {
    const ids = new Set((next.arrivals ?? []).filter((row) => row.kind === "active").map((row) => row.reservationId));
    const seen = seenRef.current;
    seenRef.current = ids;
    if (seen !== null && [...ids].some((id) => !seen.has(id))) playNotifyBeep();
    const at = Date.now();
    setTrend((prev) => appendTrend(prev, next.offer, at));
    setHome(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = await loadHome();
      if (!alive) return;
      if (next) absorb(next);
      else setHome(null);
    })();
    return () => {
      alive = false;
    };
  }, [loadHome, absorb]);

  // 確保の追加と状態の変化を30秒以内に一覧へ映す（基準 20.4）。開いている間だけ動き、
  // 取れなかった回は前の値のままにする（一覧が空に落ちて、向かっている客が消えないように）。
  useEffect(() => {
    let alive = true;
    const timer = setInterval(() => {
      void (async () => {
        const next = await loadHome();
        if (!alive || !next) return;
        absorb(next);
      })();
    }, ARRIVALS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loadHome, absorb]);

  const reload = () => {
    void (async () => {
      const next = await loadHome();
      if (next) absorb(next);
      else setHome(null);
    })();
  };

  if (!home) return <main aria-busy="true" />;

  // 公開の操作を出すのは承認済みのときだけ（未承認・止められている間は入口も断る・基準 17.10）。
  const canPublish = home.status === "approved" && home.offer === null;

  return (
    <main className="store-main">
      <div className="store-head">
        <div>
          <p className="store-eyebrow">店の画面</p>
          <h1>今日のオファー</h1>
        </div>
      </div>

      <StoreNav active="home" />

      <StatusBanner status={home.status} />

      {home.status === "pending" && <SetupChecklist checklist={home.checklist} missingProfile={home.missingProfile} />}

      <ArrivalsList rows={home.arrivals ?? []} onChanged={reload} />

      {canPublish && <PublishForm coupons={home.coupons} prefill={home.publishPrefill} onPublished={reload} />}

      {home.offer ? <OfferPanel offer={home.offer} trend={trend} onChanged={reload} /> : null}
    </main>
  );
};

export default StoreHome;
