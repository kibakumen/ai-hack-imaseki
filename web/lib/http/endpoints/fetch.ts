// 取得の入口（設計書「入口（API）の一覧」の客の入口）。入力の検査・見分け・Origin は defineRoute が
// 済ませているので、ここは手続きを呼んで応答の形に直すだけ。

import { fetchOffers } from "../../usecases/fetchOffers";
import { buildOffersStream, NDJSON_CONTENT_TYPE } from "../../usecases/streamOffers";
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

/**
 * 取得を少しずつ届ける入口（NDJSON）。入力も断りも上の入口と同じで、違うのは**返し方**だけ——
 * 店のカードを先に出し、人格つきの紹介文を書けた順に後から差し込む（usecases/streamOffers）。
 *
 * 断り（起点が決まらない）のときは普通の JSON で返す。ストリームを開いてから断ると、
 * 客の側が「読み始めてから失敗を知る」形になり、画面の場合分けが増えるため。
 */
const customerFetchStreamRoute = defineRoute({
  method: "POST",
  path: "/api/customer/fetch/stream",
  auth: "customer",
  input: fetchSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await buildOffersStream(deps, ctx.customerId, input);
    if (!result.ok) return { status: 400, body: { ok: false, error: { kind: result.kind, fields: result.fields } } };
    return { status: 200, body: null, raw: { body: result.stream, headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store" } } };
  },
});

export const fetchRoutes: RouteDefinition[] = [customerFetchRoute, customerFetchStreamRoute];
