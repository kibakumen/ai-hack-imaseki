// 客の登録の変更の入口（要件1の基準 1.9【最終日】・設計書「入口（API）の一覧」の客の入口）。
// 見分けは Cookie の客の識別子で、変えられるのは自分の登録だけ（ctx.customerId 以外を指せない）。
//
// 入力の形は登録と同じ4項目なので `customerRegisterSchema` をそのまま使う（同じ範囲を2か所に
// 書かないため）。4項目を**まとめて**受け取って入れ替える——送られなかった項目だけを残す形には
// しない。画面（ProfileSettings）は今の値を初期値にして4項目とも送る。

import { customerRegisterSchema } from "../../schemas/customer";
import { updateCustomerProfile } from "../../usecases/updateCustomerProfile";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const updateCustomerProfileRoute = defineRoute({
  method: "PATCH",
  path: "/api/customer/profile",
  auth: "customer",
  input: customerRegisterSchema,
  handler: async ({ input, deps, ctx }) => {
    const profile = await updateCustomerProfile(deps, ctx.customerId, input);
    // 見分けの直後に登録が消えた場合だけ null。客のデータは返さない（基準 2.5）。
    if (!profile) return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    return { status: 200, body: { ok: true, profile } };
  },
});

export const customerProfileRoutes: RouteDefinition[] = [updateCustomerProfileRoute];
