// 束縛と秘密を読むただ1つの場所（設計書「秘密情報と個人データの扱い」）。
// 公開してよい値（Turnstile のサイトキー・VAPID の公開鍵・運営の連絡先）はここだけが読み、
// 入口 GET /api/config/public がここを通して画面へ返す。画面と部品はここを読めない（依存の向き）。
//
// 載せ方（OpenNext）を知っているのもここだけ（設計書「撤退しやすさ」）。app/api/**/route.ts は
// Cloudflare の API を直接は呼ばない。

import type { AppConfig } from "../ports";
import type { PermitBucket } from "./files";

/**
 * Worker が渡してくる束縛のひとまとまり。設定と秘密（文字列）と、D1・R2 の束縛（object）が
 * 同じ入れ物で届くので、値の型は `unknown` で受けてここで見分ける。
 */
export type RawEnv = Record<string, unknown>;

/** 秘密（`wrangler secret put`／手元は `web/.dev.vars`）。画面には1つも渡らない。 */
export type Secrets = {
  orcarouterApiKey: string;
  googleMapsApiKey: string;
  stripeSecretKey: string;
  vapidPrivateKey: string;
  turnstileSecretKey: string;
};

export type Env = { config: AppConfig; secrets: Secrets };

/** Worker の束縛（D1 と R2）。名前は `web/wrangler.jsonc` の `DB`・`PERMITS`。 */
export type Bindings = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1Database（束縛の型は repo と各アダプタが持つ。Deps.db と同じ扱い）
  db: any;
  permits: PermitBucket | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** 設定の値（公開してよいもの）と秘密を、束縛のひとまとまりから取り出す。 */
export const readEnv = (env: RawEnv): Env => ({
  config: {
    turnstileSiteKey: text(env.TURNSTILE_SITE_KEY) ?? "",
    vapidPublicKey: text(env.VAPID_PUBLIC_KEY) ?? "",
    contactEmail: text(env.ADMIN_CONTACT_EMAIL),
    orcarouterModel: text(env.ORCAROUTER_MODEL) ?? "orcarouter/auto",
  },
  secrets: {
    orcarouterApiKey: text(env.ORCAROUTER_API_KEY) ?? "",
    googleMapsApiKey: text(env.GOOGLE_MAPS_API_KEY) ?? "",
    stripeSecretKey: text(env.STRIPE_SECRET_KEY) ?? "",
    vapidPrivateKey: text(env.VAPID_PRIVATE_KEY) ?? "",
    turnstileSecretKey: text(env.TURNSTILE_SECRET_KEY) ?? "",
  },
});

/** D1 と R2 の束縛を取り出す（無ければ null。呼ぶ側が fail-loud に断る）。 */
export const readBindings = (env: RawEnv): Bindings => ({
  db: env.DB ?? null,
  permits: (env.PERMITS as PermitBucket | undefined) ?? null,
});

/**
 * 今の要求の束縛を OpenNext から受け取る。**載せ方を替えるときに触るのはこの関数だけ。**
 * 取り込みを呼ぶ時まで遅らせているのは、受け入れ検査がこのファイルの `readEnv` だけを読むため
 * （Cloudflare の部品を読み込ませない）。
 */
export const loadWorkerEnv = async (): Promise<RawEnv> => {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const context = await getCloudflareContext({ async: true });
  return context.env as unknown as RawEnv;
};
