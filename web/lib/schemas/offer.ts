// オファーの公開の入力の形（要件17の基準 17.3・17.4・17.5・17.6）。
// 数字と形の正本は schemas/limits.ts。時分を時点へ直す判断は domain/until.ts が持ち、
// ここでは形（"HH:MM"）だけを見る——「今より後か」「枠の内か」は入力の形では決まらないため。

import { z } from "zod";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_COUPONS_MAX, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN, TIME_OF_DAY_PATTERN } from "./limits";

export const offerPublishSchema = z.object({
  /** 見せるクーポン。0個でよい（基準 17.2・本人選択）。店のものでない番号は手続きが落とす */
  couponIds: z.array(z.string()).max(OFFER_COUPONS_MAX).default([]),
  capacity: z.int().min(OFFER_CAPACITY_MIN).max(OFFER_CAPACITY_MAX),
  partyMax: z.int().min(OFFER_PARTY_MAX_MIN).max(OFFER_PARTY_MAX_MAX),
  until: z.string().regex(TIME_OF_DAY_PATTERN),
});

export type OfferPublishInput = z.infer<typeof offerPublishSchema>;

/** 画面へ返す公開中のオファー（受け入れ検査の `OfferDto`）。 */
export type OfferView = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  /** 公開から12時間の時刻。画面が「何時まで」の上限の案内に使う */
  latestUntil: string;
};
