// 取得の入口（設計書「入口（API）の一覧」の客の入口）。入力の検査・見分け・Origin は defineRoute が
// 済ませているので、ここは手続きを呼んで応答の形に直すだけ。

import { fetchOffers } from "../../usecases/fetchOffers";
import { fetchSchema } from "../../schemas/fetch";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const customerFetchRoute = defineRoute({
  method: "POST",
  path: "/api/customer/fetch",
  auth: "customer",
  input: fetchSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await fetchOffers(deps, ctx.customerId, input);
    // 起点が決まらなかったときは形の誤りと同じ 400（設計書「入力の断りの応答の形」）。
    if (!result.ok) return { status: 400, body: { ok: false, error: { kind: result.kind, fields: result.fields } } };
    // 合う店が1件も無くても誤りにしない（基準 4.3）。
    return { status: 200, body: { ok: true, fetchId: result.fetchId, items: result.items } };
  },
});

export const fetchRoutes: RouteDefinition[] = [customerFetchRoute];
