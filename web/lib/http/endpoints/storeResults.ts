// 店の実績の入口（設計書「入口（API）の一覧」の店の行・要件23）。
// 見分けはセッションで役割が店（defineRoute の auth: "store"）。入力は持たない。
// 数え方は手続きの側（設計書「概要」の芯の1: 入口は手続きを呼んで応答の形に直すだけ）。
//
// ⚠️ 見る範囲は自分の店だけ。店の番号は要求の本文ではなく**セッションから**受ける
//    （`ctx.storeId`）ので、別の店の番号を送っても他店の実績は読めない（基準 2.5・14.5）。

import { storeResults } from "../../usecases/storeResults";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const storeResultsRoute = defineRoute({
  method: "GET",
  path: "/api/store/results",
  auth: "store",
  handler: async ({ deps, ctx }) => ({ status: 200, body: { items: await storeResults(deps, ctx.storeId) } }),
});

export const storeResultsRoutes: RouteDefinition[] = [storeResultsRoute];
