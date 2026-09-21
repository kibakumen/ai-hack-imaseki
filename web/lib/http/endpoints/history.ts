// 過去の受け取りの見返しの入口（設計書「入口（API）の一覧」の客の行【最終日】・要件8の基準 8.11）。
// 見分けは Cookie の客の識別子（defineRoute の auth: "customer"）。入力は持たない。
//
// ⚠️ 見る範囲は自分の受け取りだけ。客の番号は要求の本文ではなく**見分けの結果**から受ける
//    （`ctx.customerId`）ので、別の客の番号を送っても他人の受け取りは読めない（基準 2.5・14.7）。

import { customerHistory } from "../../usecases/customerHistory";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const customerHistoryRoute = defineRoute({
  method: "GET",
  path: "/api/customer/history",
  auth: "customer",
  handler: async ({ deps, ctx }) => ({ status: 200, body: { items: await customerHistory(deps, ctx.customerId) } }),
});

export const historyRoutes: RouteDefinition[] = [customerHistoryRoute];
