// ログインのメールアドレスの変更の入口（2026-09-22 追加・店と運営で1つずつ）。
// 手続きは1つ（usecases/changeEmail）で、役割ごとに見分けだけが違う。
// 確認メールは送らない設計なので、今のパスワードの再入力で本人を確かめる（合わなければ 403）。
// 重複は登録の入口（POST /api/register/store）と同じ 409・email_taken・項目 email で断る。

import { changeEmailSchema } from "../../schemas/account";
import { changeEmail, type ChangeEmailResult } from "../../usecases/changeEmail";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const refuse = (result: Extract<ChangeEmailResult, { ok: false }>) =>
  result.kind === "email_taken"
    ? { status: 409, body: { ok: false, error: { kind: result.kind, fields: [{ name: "email", reason: "not_allowed" as const }] } } }
    : { status: 403, body: { ok: false, error: { kind: result.kind, fields: [{ name: "currentPassword", reason: "not_allowed" as const }] } } };

const changeStoreEmailRoute = defineRoute({
  method: "POST",
  path: "/api/store/email",
  auth: "store",
  input: changeEmailSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeEmail(deps, ctx.accountId, input);
    if (!result.ok) return refuse(result);
    return { status: 200, body: { ok: true } };
  },
});

const changeAdminEmailRoute = defineRoute({
  method: "POST",
  path: "/api/admin/email",
  auth: "admin",
  input: changeEmailSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeEmail(deps, ctx.accountId, input);
    if (!result.ok) return refuse(result);
    return { status: 200, body: { ok: true } };
  },
});

export const emailRoutes: RouteDefinition[] = [changeStoreEmailRoute, changeAdminEmailRoute];
