// 束縛と秘密を読むただ1つの場所（設計書「秘密情報と個人データの扱い」）。
// 公開してよい値（Turnstile のサイトキー・VAPID の公開鍵・運営の連絡先）はここだけが読み、
// 入口 GET /api/config/public がここを通して画面へ返す。画面と部品はここを読めない（依存の向き）。

import type { AppConfig } from "../ports";

export type RawEnv = Record<string, string | undefined>;

/** Cloudflare Workers の束縛（vars・secrets）から、公開してよい設定の値を取り出す。 */
export const readEnv = (env: RawEnv): AppConfig => ({
  turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "",
  vapidPublicKey: env.VAPID_PUBLIC_KEY ?? "",
  contactEmail: env.ADMIN_CONTACT_EMAIL ?? null,
  orcarouterModel: env.ORCAROUTER_MODEL ?? "orcarouter/auto",
});
