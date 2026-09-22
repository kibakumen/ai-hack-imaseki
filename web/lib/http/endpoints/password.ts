// 【最終日】パスワードの回復の2つの入口（要件14の基準 14.10〜14.16・設計書「入口（API）の一覧」）。
// 運営が仮のパスワードを発行し、店がそれで入って新しいパスワードを決める。
// システムは仮のパスワードをどこへも送らない——発行の応答に1回だけ載せ、運営が自分のメールで店へ伝える。
//
// 2026-09-22 追加: 運営が自分のパスワードを決め直す入口（POST /api/admin/password）。運営には仮の
// パスワードの場面が無いので、今のパスワードの再入力を求める（合わなければ 403・password_mismatch）。

import { changeOwnPasswordSchema, changePasswordSchema } from "../../schemas/account";
import { changeOwnPassword, changePassword } from "../../usecases/changePassword";
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

const changeAdminPasswordRoute = defineRoute({
  method: "POST",
  path: "/api/admin/password",
  auth: "admin",
  input: changeOwnPasswordSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeOwnPassword(deps, ctx.accountId, input);
    // 今のパスワードが合わない。見分け（401）とは別の断りなので 403 にし、どの欄かも返す。
    if (!result.ok) return { status: 403, body: { ok: false, error: { kind: result.kind, fields: [{ name: "currentPassword", reason: "not_allowed" }] } } };
    return { status: 200, body: { ok: true } };
  },
});

export const passwordRoutes: RouteDefinition[] = [issueTempPasswordRoute, changeStorePasswordRoute, changeAdminPasswordRoute];
