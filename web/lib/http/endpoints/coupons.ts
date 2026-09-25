// クーポンの入口（要件16の基準 16.1〜16.5）。どれもセッションで役割が店の要求だけが通り、
// 触れるのは自分の店のクーポンだけ（店の番号は defineRoute が ctx に入れる）。
//
// 未承認の店でもクーポンは触れる（基準 12.10）ので、ここで承認の状況は見ない。

import { createCoupon, deleteCoupon, listCoupons, updateCoupon } from "../../usecases/coupons";
import { couponSchema } from "../../schemas/coupon";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
// 断りの語を応答へ直すのは http/refusals の表。見つからないもの（別の店のもの・もう無いもの）は
// 404・not_found で、在ることも知らせない（基準 16.4）。規則の断りは 409。
import { refusal } from "../refusals";

const listCouponsRoute = defineRoute({
  method: "GET",
  path: "/api/store/coupons",
  auth: "store",
  handler: async ({ deps, ctx }) => respond("GET /api/store/coupons", { ok: true, items: await listCoupons(deps, ctx.storeId) }),
});

const createCouponRoute = defineRoute({
  method: "POST",
  path: "/api/store/coupons",
  auth: "store",
  input: couponSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await createCoupon(deps, ctx.storeId, input);
    return result.ok ? respond("POST /api/store/coupons", { ok: true, coupon: result.coupon }, 201) : refusal(result.kind);
  },
});

const updateCouponRoute = defineRoute({
  method: "PUT",
  path: "/api/store/coupons/:id",
  auth: "store",
  input: couponSchema,
  handler: async ({ input, params, deps, ctx }) => {
    const result = await updateCoupon(deps, ctx.storeId, params.id, input);
    return result.ok ? respond("PUT /api/store/coupons/:id", { ok: true, coupon: result.coupon }) : refusal(result.kind);
  },
});

const deleteCouponRoute = defineRoute({
  method: "DELETE",
  path: "/api/store/coupons/:id",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await deleteCoupon(deps, ctx.storeId, params.id);
    return result.ok ? respond("DELETE /api/store/coupons/:id", { ok: true }) : refusal(result.kind);
  },
});

export const couponRoutes: RouteDefinition[] = [listCouponsRoute, createCouponRoute, updateCouponRoute, deleteCouponRoute];
