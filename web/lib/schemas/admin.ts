// 運営の入口の入力の形（要件24の基準 24.3・24.5・24.6、2026-09-25 監査の指摘 運営-01・運営-02・運営-05・運営-07）。
// 字数の正本は schemas/limits.ts、ジャンルの選択肢の正本は domain/genres.ts（lib/schemas は
// lib/domain の定数を読んでよい・依存の向き）。

import { z } from "zod";
import { GENRES } from "../domain/genres";
import { ADMIN_NOTE_MAX, ADMIN_REASON_MAX, ADMIN_SEARCH_MAX, PASSWORD_MAX } from "./limits";

/**
 * 一覧の絞り込みの閉じた語（基準 24.3）。「オファー公開中」だけは店の状況ではなく
 * 公開中のオファーの有無で決まる（基準 24.4）。
 * 入力の語なので lib/schemas に置く（lib/repo はここを読んでよい・依存の向き）。
 */
export const ADMIN_STORE_FILTERS = ["publishing", "approved", "pending", "banned"] as const;
export type AdminStoreFilter = (typeof ADMIN_STORE_FILTERS)[number];

/** 空の文字列は「指定なし」として扱う（`?filter=&q=` を送る画面のため）。 */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

/** 絞り込み・ジャンル・検索。どれも無くてよく、重ねて使える（基準 24.6・運営-07）。 */
export const adminStoreQuerySchema = z.object({
  filter: z.preprocess(emptyToUndefined, z.enum(ADMIN_STORE_FILTERS).optional()),
  /** その店のジャンルに含まれるか（店の情報のジャンルと同じ閉じた語・運営-07） */
  genre: z.preprocess(emptyToUndefined, z.enum(GENRES).optional()),
  q: z.preprocess(emptyToUndefined, z.string().max(ADMIN_SEARCH_MAX).optional()),
});

export type AdminStoreQuery = z.infer<typeof adminStoreQuerySchema>;

/**
 * 取り消し・戻すの理由（運営-01）。**入口では任意**——画面は理由を入れるまで押せないが、
 * 本文を持たずに止める要求（場面づくりの道具など）は断らない（AI判断）。
 * 空白だけの理由は「無い」として扱う（手続きの側で落とす）。
 */
export const adminActionReasonSchema = z.object({ reason: z.string().max(ADMIN_REASON_MAX).optional() });

export type AdminActionReasonInput = z.infer<typeof adminActionReasonSchema>;

/**
 * 仮のパスワードの発行の再確認（運営-01 の案3）。**運営自身の今のパスワード**を入れさせる——
 * 運営のセッションを盗まれただけでは、店のパスワードを奪って客の電話番号を読めないようにする。
 * 形と範囲の規則は当てない（ログインと同じ・前の規則で決めた値でも確かめられるように）。
 */
export const adminTempPasswordSchema = z.object({ currentPassword: z.string().min(1).max(PASSWORD_MAX) });

export type AdminTempPasswordInput = z.infer<typeof adminTempPasswordSchema>;

/** 店ごとの運営のメモと「連絡済み」の印（運営-05 の A）。メモは空でよい。 */
export const adminStoreNoteSchema = z.object({ note: z.string().max(ADMIN_NOTE_MAX), contacted: z.boolean() });

export type AdminStoreNoteInput = z.infer<typeof adminStoreNoteSchema>;

/** 運営が開く許可書（運営-02）。`approved` は承認した時点の写し。既定は今の許可書。 */
export const adminLicenseQuerySchema = z.object({ version: z.preprocess(emptyToUndefined, z.enum(["current", "approved"]).optional()) });
