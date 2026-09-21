// 受け取り・受け取り直しの入口の入力の形（要件8の基準 8.1・要件11の基準 11.10）。
// 数字の正本は schemas/limits.ts（lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
//
// 1つの入口が2つの形を受ける（設計書「入口の一覧」の注）:
//   受け取り     … オファーの番号・人数・どの取得から選んだか
//   受け取り直し … 元の確保の番号だけ（人数は元の確保から取る・基準 11.10）
// どちらの形かを決めるのは手続き（`usecases/receiveOffer`）——項目ごとの断りの理由を出せるよう、
// ここでは「どの項目も任意」にして、足りない項目は手続きが `required` で返す（z.union にすると
// 落ちた項目の名前が消え、画面が項目の直下に文を出せない）。

import { z } from "zod";
import { ID_MAX_LENGTH, PARTY_MAX, PARTY_MIN } from "./limits";

const id = z.string().min(1).max(ID_MAX_LENGTH);

export const receiveSchema = z.object({
  offerId: id.optional(),
  party: z.int().min(PARTY_MIN).max(PARTY_MAX).optional(),
  fetchId: id.optional(),
  retryOf: id.optional(),
});

export type ReceiveInput = z.infer<typeof receiveSchema>;
