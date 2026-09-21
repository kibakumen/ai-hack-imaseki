// 運営の数字の入口（設計書「入口（API）の一覧」の運営の行・要件33の基準 33.4）。
// 見分けはセッションで役割が運営（defineRoute の auth: "admin"）。入力は持たない。
//
// ⚠️ 入口はこの1つだけ。第4周の追記（モデル別の表・タスク28）も**入口を増やさず**、
//    この応答に `byModel` と `fallbackCount` を足す形にしてある（設計書「OrcaRouter の使い方」の④）。

import { adminMetrics } from "../../usecases/adminMetrics";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const adminMetricsRoute = defineRoute({
  method: "GET",
  path: "/api/admin/metrics",
  auth: "admin",
  handler: async ({ deps }) => ({ status: 200, body: await adminMetrics(deps) }),
});

export const adminMetricsRoutes: RouteDefinition[] = [adminMetricsRoute];
