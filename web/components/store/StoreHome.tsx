"use client";

// 店のホーム（設計書「店の画面」）。開いた時に `GET /api/store/home` を1回呼び、返ってきた
// 「表示の種類」を描くだけ（判断はしない）。上から順に、承認の状況の帯 → 公開のフォームか
// 公開中のカード → 向かっている客。
//
// ⚠️ 持ち場の分かれ目: 帯とチェックリストはタスク7、公開のフォームと公開中のカードはタスク9、
// 向かっている客はタスク17、公開中の4つの操作はタスク20。このファイルは**並べるだけ**なので、
// あとのタスクは自分の部品を1行足す（重なったら並べる行だけを合わせる）。

import { useCallback, useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { OfferPanel, type OfferPanelOffer } from "./OfferPanel";
import { PublishForm, type PublishFormCoupon, type PublishFormPrefill } from "./PublishForm";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";

type StoreHomeData = {
  id: string;
  status: StoreStatusValue;
  checklist?: { license: boolean; card: boolean };
  missingProfile?: string[];
  offer: OfferPanelOffer | null;
  publishPrefill: PublishFormPrefill;
  coupons?: PublishFormCoupon[];
};

const EMPTY_CHECKLIST = { license: false, card: false };

export const StoreHome = () => {
  const [home, setHome] = useState<StoreHomeData | null>(null);

  const reload = useCallback(async () => {
    const result = await apiCall<StoreHomeData>("GET", "/api/store/home");
    // 取れなかったときは前の表示のまま（断りの描き方は帯の持ち場＝タスク7）。
    if (!isFailure(result)) setHome(result as StoreHomeData);
  }, []);

  useEffect(() => {
    // 開いた時に1回だけ取る（描き終わったあとに外へ聞きにいく形。同期に状態を変えない）。
    void (async () => {
      await reload();
    })();
  }, [reload]);

  if (!home) {
    return (
      <main>
        <p>読み込んでいます…</p>
      </main>
    );
  }

  return (
    <main>
      <StatusBanner status={home.status} />
      {home.status === "approved" ? null : <SetupChecklist checklist={home.checklist ?? EMPTY_CHECKLIST} missingProfile={home.missingProfile ?? []} />}

      {home.offer ? (
        <OfferPanel
          offer={home.offer}
          onChanged={() => {
            void reload();
          }}
        />
      ) : null}

      {!home.offer && home.status === "approved" ? (
        <PublishForm
          coupons={home.coupons ?? []}
          prefill={home.publishPrefill}
          onPublished={() => {
            void reload();
          }}
        />
      ) : null}
    </main>
  );
};

export default StoreHome;
