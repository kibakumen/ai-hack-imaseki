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

// ---------- 公開中の変更の入力（要件19・タスク20が足した） ----------

/**
 * 「追加で出す」と「残りの募集を減らす」の入力（基準 19.1・19.4）。範囲は募集する組数と同じ
 * （同じ数を2度書かないため・正本は schemas/limits.ts）。
 *
 * ここで見るのは形と範囲だけ——**足したあとの残りの上限**（基準 19.2）と**残り以下**（基準 19.5）は
 * その時のオファーの状態で決まるので、手続き（`usecases/changeOffer`）が断る。
 */
export const offerCountSchema = z.object({
  count: z.int().min(OFFER_CAPACITY_MIN).max(OFFER_CAPACITY_MAX),
});

export type OfferCountInput = z.infer<typeof offerCountSchema>;

/** 「何名まで」の変更（基準 19.6）。公開のときと同じ範囲。 */
export const offerPartyMaxSchema = z.object({
  partyMax: z.int().min(OFFER_PARTY_MAX_MIN).max(OFFER_PARTY_MAX_MAX),
});

export type OfferPartyMaxInput = z.infer<typeof offerPartyMaxSchema>;

/**
 * 「何時まで」の変更（基準 19.8）。形（"HH:MM"）だけを見る——今より後か・公開した時刻から
 * 12時間以内かは入力の形では決まらないので、`domain/until.ts` が判断する。
 */
export const offerUntilSchema = z.object({
  until: z.string().regex(TIME_OF_DAY_PATTERN),
});

export type OfferUntilInput = z.infer<typeof offerUntilSchema>;
