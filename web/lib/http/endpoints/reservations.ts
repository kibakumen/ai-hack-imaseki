// 確保の入口（設計書「入口（API）の一覧」の客の入口）。受け取りと受け取り直しは同じ1つの入口。
// 入力の検査・見分け・Origin は defineRoute が済ませているので、ここは手続きを呼んで
// 応答の形に直すだけ。
//
// ⚠️ 応答の形は**2つに割れている**（設計書「入口の一覧」の注）:
//   受け取りの断り   … 409 `{ ok:false, refusal:{ kind, partyMax?, nextStep }, home }`（描くのは RefusalNotice）
//   入力の断り       … 400 `{ ok:false, error:{ kind, fields } }`（描くのは InputRefusal）
// どちらも手続きが決めた形をそのまま載せる（入口で組み直さない）。
//
// ⚠️ 応答の形の3つ目（タスク15 が足した）:
//   確保への操作の断り … 409 `{ ok:false, current:{ state } }`（基準 10.3。今の状態を返す形）
//
// 2026-09-21 タスク15 が `POST /api/customer/reservations/:id/cancel`・`…/party` を足した
// （`routes.ts` は触らずに済んだ）。

import { partyChangeSchema, receiveSchema } from "../../schemas/reservation";
import { cancelByCustomer, type CancelByCustomerResult } from "../../usecases/cancelByCustomer";
import { changeParty, type ChangePartyResult } from "../../usecases/changeParty";
import { receiveOffer } from "../../usecases/receiveOffer";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";
import { notFound, receiveRefused, refusal, stateConflict, unauthenticated } from "../refusals";

const receiveRoute = defineRoute({
  method: "POST",
  path: "/api/customer/reservations",
  auth: "customer",
  input: receiveSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await receiveOffer(deps, ctx.customerId, input);
    // 見分けの直後に登録が消えた場合だけ（客のデータは返さない・基準 2.5）
    if (!result) return unauthenticated();
    if (!result.ok) {
      // 受け取りの断りは 409 で、理由・次の一手・新しいホームを返す。入力の断りは表どおり（400）。
      if ("refusal" in result) return receiveRefused(result.refusal, result.home);
      return refusal(result.kind, { fields: result.fields });
    }
    return respond("POST /api/customer/reservations", { ok: true, reservation: result.reservation, home: result.home });
  },
});

/**
 * 確保への操作（取り消し・人数の変更）の結果を応答へ。手続きが決めた形をそのまま載せる
 * ——今の状態との衝突は `current`、入力の断りは `error`（設計書「入口の一覧」の注）。
 * 手続きが `null` を返すのは、見分けの直後に登録が消えた場合だけ（客のデータは返さない・基準 2.5）。
 */
const reservationOperationResponse = (
  route: "POST /api/customer/reservations/:id/cancel" | "POST /api/customer/reservations/:id/party",
  result: CancelByCustomerResult | ChangePartyResult | null,
): RouteHandlerResult => {
  if (!result) return unauthenticated();
  if (result.ok) return respond(route, { ok: true, home: result.home });
  if (result.kind === "not_found") return notFound();
  if (result.kind === "state") return stateConflict(result.state);
  return refusal(result.kind, { partyMax: result.partyMax });
};

const cancelReservationRoute = defineRoute({
  method: "POST",
  path: "/api/customer/reservations/:id/cancel",
  auth: "customer",
  handler: async ({ params, deps, ctx }) => reservationOperationResponse("POST /api/customer/reservations/:id/cancel", await cancelByCustomer(deps, ctx.customerId, params.id ?? "")),
});

const changePartyRoute = defineRoute({
  method: "POST",
  path: "/api/customer/reservations/:id/party",
  auth: "customer",
  input: partyChangeSchema,
  handler: async ({ input, params, deps, ctx }) => reservationOperationResponse("POST /api/customer/reservations/:id/party", await changeParty(deps, ctx.customerId, params.id ?? "", input)),
});

export const reservationRoutes: RouteDefinition[] = [receiveRoute, cancelReservationRoute, changePartyRoute];
