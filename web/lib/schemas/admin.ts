// 運営の入口の入力の形（要件24の基準 24.3・24.5・24.6）。
// 一覧の問い合わせ文字列（?filter=…&q=…）だけを見る。字数の正本は schemas/limits.ts。

import { z } from "zod";
import { ADMIN_SEARCH_MAX } from "./limits";

/**
 * 一覧の絞り込みの閉じた語（基準 24.3）。「オファー公開中」だけは店の状況ではなく
 * 公開中のオファーの有無で決まる（基準 24.4）。
 * 入力の語なので lib/schemas に置く（lib/repo はここを読んでよい・依存の向き）。
 */
export const ADMIN_STORE_FILTERS = ["publishing", "approved", "pending", "banned"] as const;
export type AdminStoreFilter = (typeof ADMIN_STORE_FILTERS)[number];

/** 空の文字列は「指定なし」として扱う（`?filter=&q=` を送る画面のため）。 */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

/** 絞り込みと検索。どちらも無くてよく、重ねて使える（基準 24.6）。 */
export const adminStoreQuerySchema = z.object({
  filter: z.preprocess(emptyToUndefined, z.enum(ADMIN_STORE_FILTERS).optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(ADMIN_SEARCH_MAX).optional()),
});

export type AdminStoreQuery = z.infer<typeof adminStoreQuerySchema>;
