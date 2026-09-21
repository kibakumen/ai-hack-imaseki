// 確保の入口（設計書「入口（API）の一覧」の客の入口）。受け取りと受け取り直しは同じ1つの入口。
// 入力の検査・見分け・Origin は defineRoute が済ませているので、ここは手続きを呼んで
// 応答の形に直すだけ。
//
// ⚠️ 応答の形は**2つに割れている**（設計書「入口の一覧」の注）:
//   受け取りの断り   … 409 `{ ok:false, refusal:{ kind, partyMax?, nextStep }, home }`（描くのは RefusalNotice）
//   入力の断り       … 400 `{ ok:false, error:{ kind, fields } }`（描くのは InputRefusal）
// どちらも手続きが決めた形をそのまま載せる（入口で組み直さない）。
//
// ⚠️ タスク15（客の取り消し・人数の変更）はこのまとまりへ
//   `POST /api/customer/reservations/:id/cancel`・`…/party` を足す（`routes.ts` は触らずに済む）。

import { receiveSchema } from "../../schemas/reservation";
import { receiveOffer } from "../../usecases/receiveOffer";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const receiveRoute = defineRoute({
  method: "POST",
  path: "/api/customer/reservations",
  auth: "customer",
  input: receiveSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await receiveOffer(deps, ctx.customerId, input);
    // 見分けの直後に登録が消えた場合だけ（客のデータは返さない・基準 2.5）
    if (!result) return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    if (!result.ok) {
      const body = "refusal" in result ? { ok: false, refusal: result.refusal, home: result.home } : { ok: false, error: result.error };
      return { status: result.status, body };
    }
    return { status: 200, body: { ok: true, reservation: result.reservation, home: result.home } };
  },
});

export const reservationRoutes: RouteDefinition[] = [receiveRoute];
