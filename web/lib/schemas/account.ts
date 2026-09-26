// 店の登録とログインの入力の形（要件12の基準 12.3・12.4・12.5／要件14の基準 14.1・14.8）。
// 数字と形の正本は schemas/limits.ts（lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
// 役割（role）の項目は持たない——登録の入口に role を送っても店として作る（基準 14.8）。

import { z } from "zod";
import { isPlainLine } from "../domain/plainText";
import { EMAIL_MAX, EMAIL_PATTERN, EMAIL_VERIFY_TOKEN_MAX_LENGTH, PASSWORD_MAX, PASSWORD_MIN, STORE_NAME_MAX, STORE_NAME_MIN, STORE_TERMS_VERSION } from "./limits";

/** メールアドレス: @ をちょうど1つ、その前後に1字以上、254字以内（基準 12.4）。 */
export const emailSchema = z.string().max(EMAIL_MAX).regex(EMAIL_PATTERN);

/** パスワード: 8字以上128字以内。文字の種類は問わない（基準 12.3）。 */
const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const storeRegisterSchema = z.object({
  // 店名は AI への指示に入る。改行・制御文字・書字方向の制御文字は断る（安全-11・domain/plainText）
  name: z.string().min(STORE_NAME_MIN).max(STORE_NAME_MAX).refine(isPlainLine),
  email: emailSchema,
  password: passwordSchema,
  // 同意した店向けの利用規約の版。**今の版と一致しなければ断る**（2026-09-25 監査の指摘 店-21 のレビュー。
  // 同意は画面の中だけで、入口は同意なしでも通り、版も残らなかった）。通った登録は版と時刻を残す（registerStore）。
  agreedTermsVersion: z.literal(STORE_TERMS_VERSION),
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

/**
 * 確かめのために入れさせる「今のパスワード」。ログインと同じく形と範囲の規則は当てない
 * （前の規則で決めた値でも確かめられるように）。空と極端な長さだけを断る。
 */
const currentPasswordSchema = z.string().min(1).max(PASSWORD_MAX);

/**
 * 【最終日】店が決め直す新しいパスワード（要件14の基準 14.15）。範囲は登録と同じ（基準 12.3）。
 *
 * 今のパスワード（currentPassword）は、形の上では省ける。省けるのは仮のパスワードで入った直後
 * （mustChangePassword）の店だけで、それ以外の店が省いたら入口が「欄が要る」で断る
 * （2026-09-25 監査の指摘 安全-07）。それまでは誰にも求めず、ログインの残った端末に触れた人が、
 * 今の値を知らないまま新しいパスワードを決められた。仮のパスワードで入った店は「今のパスワード」を
 * 覚えていない（基準 14.14 の場面）ので、そこだけは求めない。
 */
export const changePasswordSchema = z.object({ password: passwordSchema, currentPassword: currentPasswordSchema.optional() });

/**
 * メールアドレスの変更（2026-09-22 追加・店と運営の両方）。確認メールを送らない設計
 * （要件12の補足）なので、代わりに**今のパスワードの再入力**を求める——セッションを盗まれただけでは
 * ログインの ID を書き換えられないようにするため。
 */
export const changeEmailSchema = z.object({ email: emailSchema, currentPassword: currentPasswordSchema });

/**
 * 自分で決め直すパスワードの変更（2026-09-22 追加・運営の入口が使う）。仮のパスワードの場面と違い、
 * 今のパスワードを覚えている前提なので、その再入力を求める。
 */
export const changeOwnPasswordSchema = z.object({ currentPassword: currentPasswordSchema, password: passwordSchema });

/**
 * 確認メールの送り直し（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ）。今のアドレスをそのまま入れさせる——
 * 入口は保存と比べ、違えば 400 で断る（別のアドレスへ送る道にしない）。
 */
export const emailVerifySchema = z.object({ email: emailSchema });

/** 確認のリンクの token（問い合わせ文字列）。長すぎる値は早く切る（実際の値は16バイトの base64url＝22字）。 */
export const emailVerifyConfirmSchema = z.object({ token: z.string().min(1).max(EMAIL_VERIFY_TOKEN_MAX_LENGTH) });

/**
 * 店の退会（2026-09-26 本人発案・要件13の基準 13.14）。取り返しがつかないので、今のパスワードの再入力を求める
 * （メールアドレスの変更と同じ確かめ。セッションを盗まれただけでは店を消せないようにする）。
 */
export const storeWithdrawSchema = z.object({ currentPassword: currentPasswordSchema });

export type StoreRegisterInput = z.infer<typeof storeRegisterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
export type EmailVerifyInput = z.infer<typeof emailVerifySchema>;
export type StoreWithdrawInput = z.infer<typeof storeWithdrawSchema>;
