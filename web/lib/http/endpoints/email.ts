// ログインのメールアドレスの変更の入口（2026-09-22 追加・店と運営で1つずつ）。
// 手続きは1つ（usecases/changeEmail）で、役割ごとに見分けだけが違う。
// 確認メールは送らない設計なので、今のパスワードの再入力で本人を確かめる（合わなければ 403）。
// 重複は登録の入口（POST /api/register/store）と同じ 409・email_taken・項目 email で断る。

import { changeEmailSchema } from "../../schemas/account";
import { changeEmail, type ChangeEmailResult } from "../../usecases/changeEmail";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal } from "../refusals";

/** どの欄の断りか。状態コードは語から決まる（email_taken は 409・password_mismatch は 403）。 */
const refuse = (result: Extract<ChangeEmailResult, { ok: false }>) =>
  refusal(result.kind, { fields: [{ name: result.kind === "email_taken" ? "email" : "currentPassword", reason: "not_allowed" as const }] });

const changeStoreEmailRoute = defineRoute({
  method: "POST",
  path: "/api/store/email",
  auth: "store",
  input: changeEmailSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await changeEmail(deps, ctx.accountId, input);
    if (!result.ok) return refuse(result);
    return respond("POST /api/store/email", { ok: true });
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
    return respond("POST /api/admin/email", { ok: true });
  },
});

export const emailRoutes: RouteDefinition[] = [changeStoreEmailRoute, changeAdminEmailRoute];
