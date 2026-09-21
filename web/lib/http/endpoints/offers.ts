// オファーの入口（設計書「入口（API）の一覧」の店の入口）。公開・停止と、公開中の4つの操作。
// 2026-09-21 タスク20 が公開中の4つ（…/add・…/reduce・…/party-max・…/until）を足した
// （`routes.ts` は触らずに済んだ）。
// 終わったオファーを再開する入口は無い（基準 17.15。入口の一覧そのものを構造の検査が見る）。

import { offerCountSchema, offerPartyMaxSchema, offerPublishSchema, offerUntilSchema } from "../../schemas/offer";
import { addOfferCount, changeOfferPartyMax, changeOfferUntil, reduceOfferCount, type ChangeOfferResult } from "../../usecases/changeOffer";
import { publishOffer } from "../../usecases/publishOffer";
import { stopOffer } from "../../usecases/stopOffer";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";

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

/**
 * 公開中の変更の結果を応答へ。手続きが決めた形をそのまま載せる（入口で組み直さない）。
 * 形・範囲の誤りは 400、今の状態との衝突は 409（設計書「入力の断りの応答の形」）。
 */
const changeOfferResponse = (result: ChangeOfferResult): RouteHandlerResult =>
  result.ok
    ? { status: 200, body: { ok: true, offer: result.offer } }
    : { status: result.status, body: { ok: false, error: { kind: result.kind, ...(result.fields ? { fields: result.fields } : {}) } } };

const addOfferRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers/current/add",
  auth: "store",
  input: offerCountSchema,
  handler: async ({ input, deps, ctx }) => changeOfferResponse(await addOfferCount(deps, ctx.storeId, input)),
});

const reduceOfferRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers/current/reduce",
  auth: "store",
  input: offerCountSchema,
  handler: async ({ input, deps, ctx }) => changeOfferResponse(await reduceOfferCount(deps, ctx.storeId, input)),
});

const offerPartyMaxRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers/current/party-max",
  auth: "store",
  input: offerPartyMaxSchema,
  handler: async ({ input, deps, ctx }) => changeOfferResponse(await changeOfferPartyMax(deps, ctx.storeId, input)),
});

const offerUntilRoute = defineRoute({
  method: "POST",
  path: "/api/store/offers/current/until",
  auth: "store",
  input: offerUntilSchema,
  handler: async ({ input, deps, ctx }) => changeOfferResponse(await changeOfferUntil(deps, ctx.storeId, input)),
});

export const offerRoutes: RouteDefinition[] = [publishOfferRoute, stopOfferRoute, addOfferRoute, reduceOfferRoute, offerPartyMaxRoute, offerUntilRoute];
