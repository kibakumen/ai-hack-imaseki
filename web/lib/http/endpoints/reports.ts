// 通報と「最近行った店」の入口（要件26。設計書「入口（API）の一覧」）。
// 入力の検査・見分け・Origin・連打の抑止は defineRoute が済ませているので、ここは手続きを呼んで
// 応答の形に直すだけ。
//
// ⚠️ 経路の綴りは**変えられない**: `POST /api/customer/reports` は `http/rateLimits.ts` の
//    経路の表（`RULES_BY_ROUTE`）の鍵になっており、1時間に5回の抑止が経路そのもので引かれる
//    （基準 30.3・タスク33）。字面を変えると、断りも警告も出ないまま抑止が外れる。

import { adminReports } from "../../usecases/adminReports";
import { recentStores } from "../../usecases/recentStores";
import { reportStore } from "../../usecases/reportStore";
import { reportSchema } from "../../schemas/report";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const createReportRoute = defineRoute({
  method: "POST",
  path: "/api/customer/reports",
  auth: "customer",
  input: reportSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await reportStore(deps, ctx.customerId, input);
    if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
    return { status: 201, body: { ok: true } };
  },
});

const recentStoresRoute = defineRoute({
  method: "GET",
  path: "/api/customer/recent",
  auth: "customer",
  handler: async ({ deps, ctx }) => ({ status: 200, body: await recentStores(deps, ctx.customerId) }),
});

const adminReportsRoute = defineRoute({
  method: "GET",
  path: "/api/admin/reports",
  auth: "admin",
  handler: async ({ deps }) => ({ status: 200, body: await adminReports(deps) }),
});

export const reportRoutes: RouteDefinition[] = [createReportRoute, recentStoresRoute, adminReportsRoute];
