// 店から確保を操作する入口（設計書「入口（API）の一覧」の店の入口）。
// 見分け（役割が店・自分の店の確保だけ）は defineRoute と手続きが済ませるので、ここは
// 手続きを呼んで応答の形に直すだけ。
//
// ⚠️ **完了済みにする操作はコードの入力を求めない**（基準 20.11）＝入力のスキーマを持たない。
//    本文なしの POST でも通る（`defineRoute` が空の本文を `{}` として扱う）。
//
// ⚠️ タスク18（店による確保の取り消し）はこのまとまりへ
//    `POST /api/store/reservations/:id/cancel` を足す（`routes.ts` は触らずに済む）。

import { completeReservation } from "../../usecases/completeReservation";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const completeReservationRoute = defineRoute({
  method: "POST",
  path: "/api/store/reservations/:id/complete",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await completeReservation(deps, ctx.storeId, params.id);
    if (result.ok) return { status: 200, body: { ok: true } };
    // 404 は「その店の確保ではない」。409 は状態による断り（今の状態を返す・基準 20.20）
    if (result.status === 404) return { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };
    return { status: 409, body: { ok: false, current: result.current } };
  },
});

export const storeReservationRoutes: RouteDefinition[] = [completeReservationRoute];
