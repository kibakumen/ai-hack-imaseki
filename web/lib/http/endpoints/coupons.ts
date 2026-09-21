// クーポンの入口（要件16の基準 16.1〜16.5）。どれもセッションで役割が店の要求だけが通り、
// 触れるのは自分の店のクーポンだけ（店の番号は defineRoute が ctx に入れる）。
//
// 未承認の店でもクーポンは触れる（基準 12.10）ので、ここで承認の状況は見ない。

import { createCoupon, deleteCoupon, listCoupons, updateCoupon, type CouponRefusalKind } from "../../usecases/coupons";
import { couponSchema } from "../../schemas/coupon";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";

/**
 * 断りの語を応答へ直す。見つからないもの（別の店のもの・もう無いもの）は 404 で、
 * 在ることも知らせない（基準 16.4）。規則の断りは 409。
 */
const refusal = (kind: CouponRefusalKind): RouteHandlerResult =>
  kind === "not_found" ? { status: 404, body: { ok: false, error: { kind: "invalid_input" } } } : { status: 409, body: { ok: false, error: { kind } } };

const listCouponsRoute = defineRoute({
  method: "GET",
  path: "/api/store/coupons",
  auth: "store",
  handler: async ({ deps, ctx }) => ({ status: 200, body: { ok: true, items: await listCoupons(deps, ctx.storeId) } }),
});

const createCouponRoute = defineRoute({
  method: "POST",
  path: "/api/store/coupons",
  auth: "store",
  input: couponSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await createCoupon(deps, ctx.storeId, input);
    return result.ok ? { status: 201, body: { ok: true, coupon: result.coupon } } : refusal(result.kind);
  },
});

const updateCouponRoute = defineRoute({
  method: "PUT",
  path: "/api/store/coupons/:id",
  auth: "store",
  input: couponSchema,
  handler: async ({ input, params, deps, ctx }) => {
    const result = await updateCoupon(deps, ctx.storeId, params.id, input);
    return result.ok ? { status: 200, body: { ok: true, coupon: result.coupon } } : refusal(result.kind);
  },
});

const deleteCouponRoute = defineRoute({
  method: "DELETE",
  path: "/api/store/coupons/:id",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await deleteCoupon(deps, ctx.storeId, params.id);
    return result.ok ? { status: 200, body: { ok: true } } : refusal(result.kind);
  },
});

export const couponRoutes: RouteDefinition[] = [listCouponsRoute, createCouponRoute, updateCouponRoute, deleteCouponRoute];
