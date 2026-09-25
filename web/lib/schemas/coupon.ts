// クーポンの入口の入力の形（要件16の基準 16.3）。作るときも直すときも同じ形。
// 数字の正本は schemas/limits.ts。特記事項は無くてよいので、項目ごと無い要求も通す
// （手続きの側が空の文字列へ倒す）。

import { z } from "zod";
import { isPlainLine } from "../domain/plainText";
import { COUPON_NAME_MAX, COUPON_NAME_MIN, COUPON_NOTE_MAX } from "./limits";

export const couponSchema = z.object({
  // クーポン名と特記事項は紹介文の AI への指示に入る。改行・制御文字・書字方向の制御文字は断る（安全-11・domain/plainText）
  name: z.string().min(COUPON_NAME_MIN).max(COUPON_NAME_MAX).refine(isPlainLine),
  note: z.string().max(COUPON_NOTE_MAX).refine(isPlainLine).optional(),
});

export type CouponInput = z.infer<typeof couponSchema>;
