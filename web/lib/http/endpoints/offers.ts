// オファーの入口（設計書「入口（API）の一覧」の店の入口）。公開と停止だけを持つ。
// ⚠️ 公開中の4つの操作（…/add・…/reduce・…/party-max・…/until）はタスク20 がこのまとまりへ足す。

import { offerPublishSchema } from "../../schemas/offer";
import { publishOffer } from "../../usecases/publishOffer";
import { stopOffer } from "../../usecases/stopOffer";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const publishOfferRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers",
  auth: "store",
  input: offerPublishSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await publishOffer(deps, ctx.storeId, input);
    if (!result.ok) {
      // 形・範囲の誤りは 400、今の状態との衝突は 409（設計書「入力の断りの応答の形」）。
      return { status: result.status, body: { ok: false, error: { kind: result.kind, ...(result.fields ? { fields: result.fields } : {}) } } };
    }
    return { status: 201, body: { ok: true, offer: result.offer } };
  },
});

const stopOfferRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers/current/stop",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const result = await stopOffer(deps, ctx.storeId);
    if (!result.ok) return { status: result.status, body: { ok: false, error: { kind: result.kind } } };
    return { status: 200, body: { ok: true } };
  },
});

export const offerRoutes: RouteDefinition[] = [publishOfferRoute, stopOfferRoute];
