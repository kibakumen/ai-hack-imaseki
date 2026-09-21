// 公開してよい設定の値（入口 GET /api/config/public）の応答の形（設計書「秘密情報と個人データの扱い」）。
// 秘密の値（Turnstile の秘密鍵・VAPID の秘密鍵・各 API キー）はこの形に入れない。
// 読む側は adapters/env.ts が作った AppConfig から、この3つだけを取り出す。

import { z } from "zod";

export const publicConfigSchema = z.object({
  turnstileSiteKey: z.string(),
  vapidPublicKey: z.string(),
  /** 【最終日】運営の連絡先（基準 14.17）。設定が無ければ null。 */
  contactEmail: z.string().nullable(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
