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
import type { EffectiveState } from "../domain/reservation";
import { ID_MAX_LENGTH, PARTY_MAX, PARTY_MIN } from "./limits";

const id = z.string().min(1).max(ID_MAX_LENGTH);

export const receiveSchema = z.object({
  offerId: id.optional(),
  party: z.int().min(PARTY_MIN).max(PARTY_MAX).optional(),
  fetchId: id.optional(),
  retryOf: id.optional(),
});

export type ReceiveInput = z.infer<typeof receiveSchema>;

// ---------- 人数の変更（要件10の基準 10.4・10.5・タスク15が足した） ----------

/**
 * `POST /api/customer/reservations/:id/party` の入力。人数は必須で1人以上10人以下（基準 10.5）。
 * 受け取りの `party` と同じ範囲を使う（同じ数を2度書かないため・正本は schemas/limits.ts）。
 */
export const partyChangeSchema = z.object({
  party: z.int().min(PARTY_MIN).max(PARTY_MAX),
});

export type PartyChangeInput = z.infer<typeof partyChangeSchema>;

/**
 * 確保への操作（取り消し・人数の変更・完了済み・店の取り消し）が、**今の状態と衝突して**断るときの
 * 応答（基準 10.3・20.19・21.5）。設計書「入口の一覧」の「この形を通らない断りは2つだけ」の②。
 *
 * ⚠️ 入力の断り（`{ error: { kind, fields } }`）とは別の形。画面は `current.state` を見て、
 * 確保の表示か一覧を取り直す（文は載せない——画面が `domain/texts` で文に直す）。
 */
export type ReservationStateRefusal = { ok: false; current: { state: EffectiveState } };
