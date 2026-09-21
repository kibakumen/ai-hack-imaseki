// 入力の断りの応答の形。全部の入口が共有する（設計書「入力の断りの応答の形」）。
// lib/schemas は lib/domain の定数を読んでよい（依存の向き）。

import { z } from "zod";
import { FIELD_REASONS, INPUT_REFUSAL_KINDS } from "../domain/inputRefusal";

export const fieldErrorSchema = z.object({
  name: z.string(),
  reason: z.enum(FIELD_REASONS),
});

/** 断りの中身（`error` の値）。 */
export const errorBodySchema = z.object({
  kind: z.enum(INPUT_REFUSAL_KINDS),
  fields: z.array(fieldErrorSchema).optional(),
});

/**
 * 400/409 の応答まるごと `{ ok:false, error:{ kind, fields? } }`。
 * ⚠️ 中身だけの形（`errorBodySchema`）と役割を分けてある——受け入れ検査（r29）は応答の本文を
 * そのまま `errorSchema` に渡すので、ここは封筒の形でなければならない（2026-09-21 の直し。
 * 前の版は中身の形で、封筒を渡すと `kind` が無く必ず落ちた。同じ形の
 * `inputRefusalResponseSchema` は役割が重なるので畳んだ）。
 */
export const errorSchema = z.object({
  ok: z.literal(false),
  error: errorBodySchema,
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorResponse = z.infer<typeof errorSchema>;
