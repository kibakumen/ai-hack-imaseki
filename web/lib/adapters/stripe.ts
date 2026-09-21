// カードの登録（差し替え口 CardRegistrar）の実物。Stripe の Checkout を setup モードで開き、
// 店が戻ってきた時に結果を確かめるだけ（設計書「技術構成」のカードの行）。
//
// ⚠️ カードの番号・有効期限・確認の番号は Stripe の画面に入り、このシステムを通らない（基準 13.7）。
// ⚠️ 請求を行う口は持たない（基準 13.10）。ここに在るのは Checkout の作成と読み取りの2つだけで、
//    それを構造の検査が見張る（webSources のうち stripe.com を書いてよいのはこのファイルだけ）。

import type { CardRegistrar } from "../ports";

const API_BASE = "https://api.stripe.com/v1";

export type StripeOptions = {
  /** Stripe の秘密鍵（テスト用の鍵で提出してよい・本人選択）。束縛から読む */
  secretKey: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

type CheckoutSession = {
  id?: unknown;
  url?: unknown;
  status?: unknown;
  client_reference_id?: unknown;
};

const asString = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

export const createCardRegistrar = ({ secretKey, fetch: fetchImpl = globalThis.fetch }: StripeOptions): CardRegistrar => {
  const headers = { authorization: `Bearer ${secretKey}` };

  const readSession = async (path: string, init: RequestInit): Promise<CheckoutSession | null> => {
    try {
      const res = await fetchImpl(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
      if (!res.ok) return null;
      return (await res.json()) as CheckoutSession;
    } catch {
      // 通信の失敗・JSON でない応答。「確かめられなかった」を返し、呼ぶ側が登録済みにしない（基準 13.9）。
      return null;
    }
  };

  return {
    createSetupSession: async ({ storeId, returnUrl }) => {
      // setup モード＝カードを後で使うために預かるだけ。金額も品目も送らない。
      const body = new URLSearchParams({
        mode: "setup",
        currency: "jpy",
        "payment_method_types[0]": "card",
        // 戻ってきた要求が「どの店のものか」を Stripe 側に覚えさせ、確かめの時に突き合わせる（基準 13.6）。
        client_reference_id: storeId,
        success_url: returnUrl,
        cancel_url: returnUrl,
      });
      const session = await readSession("/checkout/sessions", { method: "POST", body });
      const url = asString(session?.url);
      const sessionId = asString(session?.id);
      if (!url || !sessionId) return { ok: false };
      return { ok: true, url, sessionId };
    },

    confirmSetup: async (sessionId) => {
      const session = await readSession(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
      if (!session || session.status !== "complete") return { ok: false };
      const clientReference = asString(session.client_reference_id);
      if (!clientReference) return { ok: false };
      return { ok: true, clientReference };
    },
  };
};
