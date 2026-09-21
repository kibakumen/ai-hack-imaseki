// 店の登録とログインの入力の形（要件12の基準 12.3・12.4・12.5／要件14の基準 14.1・14.8）。
// 数字と形の正本は schemas/limits.ts（lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
// 役割（role）の項目は持たない——登録の入口に role を送っても店として作る（基準 14.8）。

import { z } from "zod";
import { EMAIL_MAX, EMAIL_PATTERN, PASSWORD_MAX, PASSWORD_MIN, STORE_NAME_MAX, STORE_NAME_MIN } from "./limits";

/** メールアドレス: @ をちょうど1つ、その前後に1字以上、254字以内（基準 12.4）。 */
const emailSchema = z.string().max(EMAIL_MAX).regex(EMAIL_PATTERN);

/** パスワード: 8字以上128字以内。文字の種類は問わない（基準 12.3）。 */
const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const storeRegisterSchema = z.object({
  name: z.string().min(STORE_NAME_MIN).max(STORE_NAME_MAX),
  email: emailSchema,
  password: passwordSchema,
});

/**
 * ログインの入力。**ここでは形と範囲の規則（基準 12.3・12.4）を当てない**——規則を変えた後も
 * 前の値で入れなくなるだけで、断りの文は同じ login_failed に揃える（基準 14.2）。
 * 空と極端な長さだけを断る（D1 と PBKDF2 に無駄な仕事をさせないため）。
 */
export const loginSchema = z.object({
  email: z.string().min(1).max(EMAIL_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
});

export type StoreRegisterInput = z.infer<typeof storeRegisterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
