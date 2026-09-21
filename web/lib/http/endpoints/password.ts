// 【最終日】パスワードの回復の2つの入口（要件14の基準 14.10〜14.16・設計書「入口（API）の一覧」）。
// 運営が仮のパスワードを発行し、店がそれで入って新しいパスワードを決める。
// システムは仮のパスワードをどこへも送らない——発行の応答に1回だけ載せ、運営が自分のメールで店へ伝える。

import { changePasswordSchema } from "../../schemas/account";
import { changePassword } from "../../usecases/changePassword";
import { issueTempPassword } from "../../usecases/issueTempPassword";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const issueTempPasswordRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/temp-password",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const issued = await issueTempPassword(deps, params.id);
    // 店が無い番号。運営にも在る無しを取り違えさせないよう、ほかの当たらない入口と同じ 404 に倒す。
    if (!issued) return { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };
    // ここが仮のパスワードを見せるただ1回（基準 14.13）。運営の画面の一覧・詳細はこの値を持たない。
    return { status: 200, body: { ok: true, tempPassword: issued.tempPassword } };
  },
});

const changeStorePasswordRoute = defineRoute({
  method: "POST",
  path: "/api/store/password",
  auth: "store",
  input: changePasswordSchema,
  handler: async ({ input, deps, ctx }) => {
    await changePassword(deps, ctx.accountId, input.password);
    return { status: 200, body: { ok: true } };
  },
});

export const passwordRoutes: RouteDefinition[] = [issueTempPasswordRoute, changeStorePasswordRoute];
