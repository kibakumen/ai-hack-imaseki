// 店の情報の入力の形（要件15の基準 15.2・15.3・15.4・15.5・15.6・15.8）。
// 数字と形の正本は schemas/limits.ts、ジャンルの選択肢の正本は domain/genres.ts
// （lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
// 値段つきの提供メニュー・アレルゲン・1つの値の目安料金の項目は持たない（基準 15.12）。

import { z } from "zod";
import { GENRES } from "../domain/genres";
import {
  BUDGET_MAX_MAX,
  BUDGET_MAX_MIN,
  HTTP_URL_PATTERN,
  MENU_NAME_MAX,
  MENU_NAME_MIN,
  STORE_ADDRESS_MAX,
  STORE_ADDRESS_MIN,
  STORE_GENRES_MAX,
  STORE_GENRES_MIN,
  STORE_NAME_MAX,
  STORE_NAME_MIN,
  STORE_URL_MAX,
} from "./limits";

/**
 * ホームページの URL（基準 15.3・15.4）。任意の項目で、空・未指定・null のどれでも通る。
 * 入っているときだけ http か https で始まることを見る（ほかの scheme は断る）。
 */
const urlSchema = z
  .string()
  .max(STORE_URL_MAX)
  .refine((value) => value === "" || HTTP_URL_PATTERN.test(value))
  .nullable()
  .optional();

/** 店のジャンル（基準 15.5）。選択肢の中から1個以上3個以下。同じものを2度は選べない。 */
const genresSchema = z
  .array(z.enum(GENRES))
  .min(STORE_GENRES_MIN)
  .max(STORE_GENRES_MAX)
  .refine((values) => new Set(values).size === values.length);

/**
 * おすすめメニュー（基準 15.6）。**1件の長さだけ**をここで見る。
 * ⚠️ 件数の上限（基準 15.7）は usecases/saveStoreProfile が見る——zod の too_big は
 * defineRoute が「長すぎる（too_long）」へ直すので、「上限に達した（too_many）」を返せない。
 */
const menusSchema = z.array(z.string().min(MENU_NAME_MIN).max(MENU_NAME_MAX));

/** 1人あたりの予算（基準 15.8）。範囲は客の予算の上限と同じ。最低が最高以下かは手続きが見る。 */
const budgetSchema = z.int().min(BUDGET_MAX_MIN).max(BUDGET_MAX_MAX);

export const storeProfileSchema = z.object({
  name: z.string().min(STORE_NAME_MIN).max(STORE_NAME_MAX),
  address: z.string().min(STORE_ADDRESS_MIN).max(STORE_ADDRESS_MAX),
  url: urlSchema,
  genres: genresSchema,
  menus: menusSchema,
  budgetMin: budgetSchema,
  budgetMax: budgetSchema,
});

export type StoreProfileInput = z.infer<typeof storeProfileSchema>;

/** 店の情報の中身（GET /api/store/profile が返す形）。まだ入れていない項目は空か null。 */
export type StoreProfile = {
  name: string;
  address: string;
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number | null;
  budgetMax: number | null;
};
