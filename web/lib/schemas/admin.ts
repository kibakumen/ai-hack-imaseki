// 運営の入口の入力の形（要件24の基準 24.3・24.5・24.6、2026-09-25 監査の指摘 運営-01・運営-02・運営-05・運営-07）。
// 字数の正本は schemas/limits.ts、ジャンルの選択肢の正本は domain/genres.ts（lib/schemas は
// lib/domain の定数を読んでよい・依存の向き）。

import { z } from "zod";
import { GENRES } from "../domain/genres";
import { ADMIN_NOTE_MAX, ADMIN_REASON_MAX, ADMIN_SEARCH_MAX, ADMIN_SEEN_TIME_MAX, PASSWORD_MAX, STORE_ADDRESS_MAX, STORE_NAME_MAX } from "./limits";

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
 * 取り消し・戻すの理由（運営-01 の案2「理由を必須で求める」）。**入口でも必須**——画面（ConfirmBox）が
 * 理由を入れるまで押せないだけでは、入口へ直に送られた停止が理由の無い記録になる（2026-09-25 のレビュー）。
 * 前後の空白は落としてから数え、空白だけなら「無い」として断る。
 */
export const adminActionReasonSchema = z.object({ reason: z.string().trim().min(1).max(ADMIN_REASON_MAX) });

export type AdminActionReasonInput = z.infer<typeof adminActionReasonSchema>;

/**
 * 運営が詳細の画面で見た店の内容（運営-02 のレビュー）。承認と「今の内容を確かめた」に載せる。
 * 手続きは今の値と突き合わせ、違えば承認せずに「見たあとで変わった」を返す——運営が見ていない店名・住所・
 * 許可書を承認の写しに入れないため。許可書は、上げるたびに変わる「上げた時刻」で見分ける（置き場の鍵は画面に出さない）。
 *
 * **入口では任意**（AI判断）: 載せない要求は、手続きが読んだ時点の内容をそのまま写す（前の振る舞い）。画面は必ず載せる。
 * 受け入れ検査と場面づくりの道具が本文なしで承認しており、並行する作業ツリーの検査も同じ形で呼ぶため。
 */
export const adminSeenStoreSchema = z.object({
  name: z.string().max(STORE_NAME_MAX),
  address: z.string().max(STORE_ADDRESS_MAX).nullable(),
  licenseUploadedAt: z.string().max(ADMIN_SEEN_TIME_MAX).nullable(),
});

export type AdminSeenStore = z.infer<typeof adminSeenStoreSchema>;

/** 承認・「今の内容を確かめた」の本文（運営-02 のレビュー）。 */
export const adminReviewSchema = z.object({ seen: adminSeenStoreSchema.optional() });

export type AdminReviewInput = z.infer<typeof adminReviewSchema>;

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
