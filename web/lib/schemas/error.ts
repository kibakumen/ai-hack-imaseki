// 入力の断りの応答の形。全部の入口が共有する（設計書「入力の断りの応答の形」）。
// lib/schemas は lib/domain の定数を読んでよい（依存の向き）。

import { z } from "zod";
import { FIELD_REASONS, INPUT_REFUSAL_KINDS } from "../domain/inputRefusal";

export const fieldErrorSchema = z.object({
  name: z.string(),
  reason: z.enum(FIELD_REASONS),
});

export const errorSchema = z.object({
  kind: z.enum(INPUT_REFUSAL_KINDS),
  fields: z.array(fieldErrorSchema).optional(),
});

/** 400/409 `{ ok:false, error:{ kind, fields? } }` の全体。 */
export const inputRefusalResponseSchema = z.object({
  ok: z.literal(false),
  error: errorSchema,
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ErrorBody = z.infer<typeof errorSchema>;
