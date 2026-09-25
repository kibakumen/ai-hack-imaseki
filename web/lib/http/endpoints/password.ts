// 【最終日】パスワードの回復の2つの入口（要件14の基準 14.10〜14.16・設計書「入口（API）の一覧」）。
// 運営が仮のパスワードを発行し、店がそれで入って新しいパスワードを決める。
// システムは仮のパスワードをどこへも送らない——発行の応答に1回だけ載せ、運営が自分のメールで店へ伝える。
//
// 2026-09-22 追加: 運営が自分のパスワードを決め直す入口（POST /api/admin/password）。運営には仮の
// パスワードの場面が無いので、今のパスワードの再入力を求める（合わなければ 403・password_mismatch）。
//
// 2026-09-25（監査の指摘 安全-07）: 店の入口も、仮のパスワードで入った直後でなければ今のパスワードを求める。
// どちらの入口も、通ったら今の1本以外のセッションを切る（安全-08・手続きの側）。

import { changeOwnPasswordSchema, changePasswordSchema } from "../../schemas/account";
import { adminTempPasswordSchema } from "../../schemas/admin";
import { changeOwnPassword, changeStorePassword } from "../../usecases/changePassword";
import { issueTempPassword } from "../../usecases/issueTempPassword";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { notFound, refusal } from "../refusals";

/**
 * 仮のパスワードの発行。**運営自身の今のパスワード**の再入力を求める（2026-09-25 監査の指摘 運営-01 の案3）。
 * 合わなければ 403・password_mismatch（どの欄かも返す）。総当たりは rateLimits の「今のパスワードを確かめる操作」の
 * 規則が数える（落ちた回だけを数える）。
 */
const issueTempPasswordRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/temp-password",
  auth: "admin",
  input: adminTempPasswordSchema,
  handler: async ({ params, input, deps, ctx }) => {
    const issued = await issueTempPassword(deps, params.id, { accountId: ctx.accountId }, input.currentPassword);
    if (!issued.ok && issued.kind === "password_mismatch") return refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] });
    // 店が無い番号。運営にも在る無しを取り違えさせないよう、ほかの当たらない入口と同じ 404 に倒す。
    if (!issued.ok) return notFound();
    // ここが仮のパスワードを見せるただ1回（基準 14.13）。運営の画面の一覧・詳細はこの値を持たない。
    return respond("POST /api/admin/stores/:id/temp-password", { ok: true, tempPassword: issued.tempPassword });
  },
});

const changeStorePasswordRoute = defineRoute({
  method: "POST",
  path: "/api/store/password",
  auth: "store",
  input: changePasswordSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeStorePassword(deps, ctx, input);
    // 仮のパスワードの直後でない店が、今のパスワードを送らなかった。形の断り（欄が要る）として返す。
    if (!result.ok && result.kind === "current_password_required") return refusal("invalid_input", { fields: [{ name: "currentPassword", reason: "required" }] });
    if (!result.ok) return refusal(result.kind, { fields: [{ name: "currentPassword", reason: "not_allowed" }] });
    return respond("POST /api/store/password", { ok: true });
  },
});

const changeAdminPasswordRoute = defineRoute({
  method: "POST",
  path: "/api/admin/password",
  auth: "admin",
  input: changeOwnPasswordSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeOwnPassword(deps, ctx, input);
    // 今のパスワードが合わない。見分け（401）とは別の断りなので 403 にし、どの欄かも返す。
    if (!result.ok) return refusal(result.kind, { fields: [{ name: "currentPassword", reason: "not_allowed" }] });
    return respond("POST /api/admin/password", { ok: true });
  },
});

export const passwordRoutes: RouteDefinition[] = [issueTempPasswordRoute, changeStorePasswordRoute, changeAdminPasswordRoute];
