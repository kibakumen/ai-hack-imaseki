"use client";

// 店のホーム（要件12の基準 12.6〜12.9）。開いた時にホームの入口を1回呼び、承認の状況の帯と、
// 未承認なら足りないもののチェックリストを出す（設計書「店の画面」の1）。
// 部品は返された値を描くだけで、自分では判断しない。
//
// 並びは 2026-09-21 の本人の指摘で入れ替えた（速成版 sprint/app/store が基準）:
//   **向かっている客がいちばん上**——店が開きっぱなしにするのはこの画面で、いちばん急ぐのは
//   「来た客を完了にする」操作だから。公開の設定はその下（1日に何度も触るものではない）。
// 画面のあいだの行き来はタブに変えた（StoreNav）。新しい客が増えた時は音で知らせる。

import { useCallback, useRef, useState } from "react";
import { apiCall, type ApiFailure } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { ARRIVALS_REFRESH_MS } from "../../lib/schemas/limits";
import { LoadView } from "../ui/LoadState";
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
  /** 仮のパスワードで入っている（基準 14.14）。立っていれば新しいパスワードを決める画面へ案内する。 */
  mustChangePassword?: boolean;
};

const loadHome = (): Promise<StoreHomeView | ApiFailure> => apiCall<StoreHomeView>("GET", "/api/store/home");

type HomeBodyProps = { home: StoreHomeView; trend: TrendPoint[]; onChanged: () => void };

/** 取れたホームの中身（案内・状況の帯・向かっている客・公開の設定）。 */
const HomeBody = ({ home, trend, onChanged }: HomeBodyProps) => {
  // 公開の操作を出すのは承認済みのときだけ（未承認・止められている間は入口も断る・基準 17.10）。
  const canPublish = home.status === "approved" && home.offer === null;
  return (
    <>
      {/* 仮のパスワードで入った店への案内（基準 14.14）。`app/store/password` の注が「店のホームが
          ここへ案内する」と言いながら、この道が無かった（2026-09-22 に足した）。 */}
      {home.mustChangePassword && (
        <p className="msg" role="alert" data-testid="must-change-password">
          運営から受け取った仮のパスワードで入っています。<a href="/store/password">新しいパスワードを決めてください。</a>
        </p>
      )}

      <StatusBanner status={home.status} />

      {home.status === "pending" && <SetupChecklist checklist={home.checklist} missingProfile={home.missingProfile} />}

      <ArrivalsList rows={home.arrivals ?? []} onChanged={onChanged} />

      {canPublish && <PublishForm coupons={home.coupons} prefill={home.publishPrefill} onPublished={onChanged} />}

      {/* `key` はオファーの番号——クーポンを選び直して公開し直すと別のオファーになるので、
          ダイヤルと選択を新しいオファーの値から作り直す（同じオファーの取り直しでは残す） */}
      {home.offer ? <OfferPanel key={home.offer.id} offer={home.offer} coupons={home.coupons} trend={trend} onChanged={onChanged} /> : null}
    </>
  );
};

export const StoreHome = () => {
  /** 「今日の動き」の点。カードが作り直されても消えないように、ここで持つ */
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  /** 前に見た確保の番号。**初めの読み込みでは鳴らさない**（開いた瞬間に全員ぶん鳴るのを避ける） */
  const seenRef = useRef<Set<string> | null>(null);

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
  }, []);

  // 確保の追加と状態の変化を30秒以内に一覧へ映す（基準 20.4）。開いている間だけ動く。
  // 取れなかった回は前の値のまま残し（一覧が空に落ちて、向かっている客が消えないように）、
  // **失敗していることは帯で出す**（「最終更新 HH:MM・更新できていません」・2026-09-25 監査の指摘 横断-01。
  // それまでは失敗を黙って捨て、開きっぱなしのタブレットが古い一覧のまま音も鳴らなかった）。
  const { state, reload } = useLoad(loadHome, { onLoaded: absorb, pollMs: ARRIVALS_REFRESH_MS });
  const refresh = () => {
    void reload();
  };

  // 読めなかった・ログインが切れたときも、見出しとタブは出す（空の main で止めない・横断-01）。
  return (
    <main className="store-main" aria-busy={state.status === "loading"}>
      <div className="store-head">
        <div>
          <p className="store-eyebrow">店の画面</p>
          <h1>今日のオファー</h1>
        </div>
      </div>

      <StoreNav active="home" />

      <LoadView state={state} onRetry={refresh}>
        {(home) => <HomeBody home={home} trend={trend} onChanged={refresh} />}
      </LoadView>
    </main>
  );
};

export default StoreHome;
