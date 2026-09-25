// 束縛と秘密を読むただ1つの場所（設計書「秘密情報と個人データの扱い」）。
// 公開してよい値（Turnstile のサイトキー・VAPID の公開鍵・運営の連絡先）はここだけが読み、
// 入口 GET /api/config/public がここを通して画面へ返す。画面と部品はここを読めない（依存の向き）。
//
// 載せ方（OpenNext）を知っているのもここだけ（設計書「撤退しやすさ」）。app/api/**/route.ts は
// Cloudflare の API を直接は呼ばない。

import type { AppConfig, Deps } from "../ports";
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
  /** D1。形は確かめずに受ける（束縛は Worker が渡す実物で、名前だけが約束）。無ければ null */
  db: Deps["db"] | null;
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
  db: (env.DB as Deps["db"] | undefined) ?? null,
  permits: (env.PERMITS as PermitBucket | undefined) ?? null,
});

/** 今の要求の束縛と、応答のあとも仕事を生かしておく口（Worker の ctx.waitUntil）。 */
export type WorkerContext = { env: RawEnv; defer: ((task: Promise<unknown>) => void) | null };

/**
 * 今の要求の束縛を OpenNext から受け取る。**載せ方を替えるときに触るのはこの関数だけ。**
 * 取り込みを呼ぶ時まで遅らせているのは、受け入れ検査がこのファイルの `readEnv` だけを読むため
 * （Cloudflare の部品を読み込ませない）。
 *
 * `ctx.waitUntil` も一緒に渡す（2026-09-25 監査の指摘 設計-17）。以前は ctx を捨てていたので、応答を閉じたあとの
 * 仕事（紹介文の AI の呼び出しとその記録）を生かしておく口が無く、手元の workerd では応答を閉じた後の
 * D1 の行が書かれなかった（waitUntil に入れたときだけ残った）。
 */
export const loadWorkerContext = async (): Promise<WorkerContext> => {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const context = await getCloudflareContext({ async: true });
  const waitUntil = (context.ctx as { waitUntil?: (task: Promise<unknown>) => void } | undefined)?.waitUntil;
  return {
    env: context.env as unknown as RawEnv,
    // waitUntil は ctx の this を要る。取り出して渡すときに結び直す
    defer: typeof waitUntil === "function" ? (task) => waitUntil.call(context.ctx, task) : null,
  };
};
