// 通知の購読を受け取る入口の入力の形（要件22）。ブラウザの PushSubscription を JSON にしたものを
// そのまま受ける（設計書「比べた案」: 鍵ごと丸ごと保存しておき、後から中身を載せる形へ替えられる）。
// 呼び名・電話番号のような客のデータはここに来ない（基準 22.5）。

import { z } from "zod";
import { PUSH_ENDPOINT_MAX, PUSH_KEY_MAX } from "./limits";

/** ブラウザが `subscription.toJSON()` で作る形。余分な項目は zod が落とす。 */
const subscriptionSchema = z.object({
  endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX).startsWith("https://"),
  /** 配信元が付ける失効の時刻（付かない配信元も在る） */
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(PUSH_KEY_MAX),
    auth: z.string().min(1).max(PUSH_KEY_MAX),
  }),
});

export const pushSubscriptionSchema = z.object({ subscription: subscriptionSchema });

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Service Worker が取りに来る文面（場面が無ければ3つとも null）。 */
export type PushMessage = { scene: string | null; title: string | null; body: string | null };
