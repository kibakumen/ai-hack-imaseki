// 客の入口の入力の形（要件1の基準 1.2・1.3・1.4・1.6・1.7）。
// 数字の正本は schemas/limits.ts、ジャンルの選択肢の正本は domain/genres.ts（lib/schemas は
// lib/domain の定数を読んでよい・依存の向き）。パスワード・確認番号・ログインの項目は持たない（基準 2.7）。

import { z } from "zod";
import { GENRES } from "../domain/genres";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, CUSTOMER_GENRES_MAX, NICKNAME_MAX, NICKNAME_MIN, PHONE_PATTERN } from "./limits";

/** 好みのジャンル: 選択肢の中から0個以上12個以下。同じものを2度は選べない。 */
const genresSchema = z
  .array(z.enum(GENRES))
  .max(CUSTOMER_GENRES_MAX)
  .refine((values) => new Set(values).size === values.length);

/** 1人あたりの予算の上限。未指定（項目が無い・null）で通る（基準 1.6）。 */
const budgetMaxSchema = z.int().min(BUDGET_MAX_MIN).max(BUDGET_MAX_MAX).nullable().optional();

export const customerRegisterSchema = z.object({
  nickname: z.string().min(NICKNAME_MIN).max(NICKNAME_MAX),
  phone: z.string().regex(PHONE_PATTERN),
  genres: genresSchema,
  budgetMax: budgetMaxSchema,
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

/** 客の登録の内容（客のホームが返す形）。 */
export type CustomerProfile = { nickname: string; phone: string; genres: string[]; budgetMax: number | null };
