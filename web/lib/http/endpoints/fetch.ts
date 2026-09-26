// 取得の入口（設計書「入口（API）の一覧」の客の入口）。入力の検査・見分け・Origin は defineRoute が
// 済ませているので、ここは手続きを呼んで応答の形に直すだけ。

import { fetchOffers } from "../../usecases/fetchOffers";
import { aiLineMeter } from "../../usecases/aiLineShare";
import { buildOffersStream, NDJSON_CONTENT_TYPE } from "../../usecases/streamOffers";
import { fetchSchema } from "../../schemas/fetch";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal } from "../refusals";

const customerFetchRoute = defineRoute({
  method: "POST",
  path: "/api/customer/fetch",
  auth: "customer",
  input: fetchSchema,
  handler: async ({ input, deps, ctx, req }) => {
    // 選定の AI の1回を、その回線のその日の取り分に数える（2026-09-26 本人選択・usecases/aiLineShare）
    const result = await fetchOffers(deps, ctx.customerId, input, { aiLine: aiLineMeter(deps, req.headers.get("cf-connecting-ip")) });
    // 起点が決まらなかったときは形の誤りと同じ 400（設計書「入力の断りの応答の形」）。
    if (!result.ok) return refusal(result.kind, { fields: result.fields });
    // 合う店が1件も無くても誤りにしない（基準 4.3）。
    return respond("POST /api/customer/fetch", { ok: true, fetchId: result.fetchId, items: result.items });
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
  handler: async ({ input, deps, ctx, req }) => {
    // 要求の打ち切りの合図（客の切断）を渡す——鳴ったら書きかけの紹介文の AI を止める（設計-18）
    // 接続元は回線ごとの AI の取り分を数えるため（2026-09-26 本人選択・使い切った回線は紹介文を決まった文で返す）
    const result = await buildOffersStream(deps, ctx.customerId, input, { signal: req.signal, ip: req.headers.get("cf-connecting-ip") });
    if (!result.ok) return refusal(result.kind, { fields: result.fields });
    return { status: 200, body: null, raw: { body: result.stream, headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store" } } };
  },
});

export const fetchRoutes: RouteDefinition[] = [customerFetchRoute, customerFetchStreamRoute];
