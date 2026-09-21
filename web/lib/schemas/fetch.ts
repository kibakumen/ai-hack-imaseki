// 取得の入口の入力の形（要件3の基準 3.3・3.10・3.11）。数字の正本は schemas/limits.ts、
// ジャンルの選択肢の正本は domain/genres.ts（lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
//
// その回だけの好み（genres）と予算（budgetMax）はここで受け取るだけで、客の登録には書き戻さない
// （基準 3.14・手続き usecases/fetchOffers が登録の表に触れないことで守る）。起点も同じ（基準 3.15）。

import { z } from "zod";
import { GENRES } from "../domain/genres";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN, CUSTOMER_GENRES_MAX, PARTY_MAX, PARTY_MIN, PLACE_MAX } from "./limits";

/**
 * 取得の入力。
 *
 * 場所の文字（`place`）と現在地（`lat`/`lng`）は、どちらも「あれば使う」形にしてある——
 * 文字があれば現在地を使わない（基準 3.2）ので、両方載った要求も正しい入力として通し、
 * どちらを起点にするかは手続きが決める。両方とも無いときの断りも手続きの側（画面の側だけで作る
 * 語 `location_required` と紛れないよう、サーバーは項目の足りない断りとして返す）。
 */
export const fetchSchema = z.object({
  place: z.string().max(PLACE_MAX).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  party: z.int().min(PARTY_MIN).max(PARTY_MAX),
  genres: z.array(z.enum(GENRES)).max(CUSTOMER_GENRES_MAX).optional(),
  budgetMax: z.int().min(BUDGET_MAX_MIN).max(BUDGET_MAX_MAX).nullable().optional(),
});

export type FetchInput = z.infer<typeof fetchSchema>;
