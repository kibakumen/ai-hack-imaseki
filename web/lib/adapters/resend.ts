// メールを送る口（差し替え口 Mailer）の実物・Resend（2026-09-22 追加・メールアドレスの確認が使う）。
// 秘密の API キーを使うのはここだけで、画面には渡らない。SDK は入れず素の fetch で
// `https://api.resend.com/emails` へ POST する（外部パッケージを足さない・撤退しやすさ）。
// 打ち切りは呼ぶ側が AbortSignal で渡す。crypto・console はここでは呼ばない。

import type { Mailer } from "../ports";

const SEND_URL = "https://api.resend.com/emails";

export type ResendOptions = {
  /** Resend の API キー（秘密。束縛から読む） */
  apiKey: string;
  /** 送信元（`MAIL_FROM`）。Resend で認証済みのドメインのアドレスでなければ Resend が断る */
  from: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

export const createMailer = ({ apiKey, from, fetch: fetchImpl = globalThis.fetch }: ResendOptions): Mailer => ({
  send: async (message, opts) => {
    try {
      const res = await fetchImpl(SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        signal: opts.signal,
      });
      // 2xx 以外（鍵の誤り 401・送信元の未認証 403・連打 429）は「送れなかった」とだけ返す。
      // 本文は読まない——Resend の断りの文をそのまま持ち歩かない（記録にも画面にも出さない）。
      return res.ok ? { ok: true } : { ok: false };
    } catch {
      // 打ち切り・通信の失敗。送れなかったこと自体を返す（呼ぶ側が断る）。
      return { ok: false };
    }
  },
});
