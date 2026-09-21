// 人かどうかの確かめ（Turnstile）の実物（差し替え口 HumanCheck）。秘密鍵を使うのはここだけで、
// 画面には渡らない（サイトキーだけが adapters/env.ts 経由で GET /api/config/public に出る）。
// 打ち切りは呼ぶ側（http/defineRoute）が AbortSignal で渡す。

import type { HumanCheck } from "../ports";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOptions = {
  /** Cloudflare の秘密鍵（秘密。束縛から読む） */
  secretKey: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

export const createHumanCheck = ({ secretKey, fetch: fetchImpl = globalThis.fetch }: TurnstileOptions): HumanCheck => ({
  verify: async (token, opts) => {
    // 値が無ければ、外へ聞かずに「人ではない」と答える（断るのは呼ぶ側）。
    if (!token) return { ok: true, human: false };
    try {
      const body = new URLSearchParams({ secret: secretKey, response: token });
      const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: opts.signal });
      if (!res.ok) return { ok: false };
      const json = (await res.json()) as { success?: unknown };
      return { ok: true, human: json.success === true };
    } catch {
      // 打ち切り・通信の失敗・JSON でない応答。確かめられなかったこと自体を返す（守りは外さない）。
      return { ok: false };
    }
  },
});
