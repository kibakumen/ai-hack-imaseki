// 客の登録の変更の入口（要件1の基準 1.9【最終日】・設計書「入口（API）の一覧」の客の入口）。
// 見分けは Cookie の客の識別子で、変えられるのは自分の登録だけ（ctx.customerId 以外を指せない）。
//
// 入力の形は登録と同じ4項目なので `customerRegisterSchema` をそのまま使う（同じ範囲を2か所に
// 書かないため）。4項目を**まとめて**受け取って入れ替える——送られなかった項目だけを残す形には
// しない。呼ぶ画面は取得の画面の電話番号の欄（`components/customer/PhoneField`）だけで、入れた電話番号に
// 呼び名・ジャンル・予算の**登録の値**をそのまま添えて4項目とも送る。登録の4項目を変える画面は持たない
// （2026-09-25 監査の指摘 客-13 で、どこからも読み込まれていなかった `ProfileSettings` を消した・要件1の基準 1.9）。

import { customerRegisterSchema } from "../../schemas/customer";
import { updateCustomerProfile } from "../../usecases/updateCustomerProfile";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { unauthenticated } from "../refusals";

const updateCustomerProfileRoute = defineRoute({
  method: "PATCH",
  path: "/api/customer/profile",
  auth: "customer",
  input: customerRegisterSchema,
  handler: async ({ input, deps, ctx }) => {
    const profile = await updateCustomerProfile(deps, ctx.customerId, input);
    // 見分けの直後に登録が消えた場合だけ null。客のデータは返さない（基準 2.5）。
    if (!profile) return unauthenticated();
    return respond("PATCH /api/customer/profile", { ok: true, profile });
  },
});

export const customerProfileRoutes: RouteDefinition[] = [updateCustomerProfileRoute];
