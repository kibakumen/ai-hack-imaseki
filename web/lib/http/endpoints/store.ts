// 店の入口（設計書「入口（API）の一覧」）。登録は無記名で人かどうかの確かめつき、
// ホームはセッションで役割が店の要求だけが通る。
// ⚠️ 店の情報・クーポン・許可書・カード・オファーの入口は、タスク5以降がこのまとまりへ足す。

import { registerStore } from "../../usecases/registerStore";
import { storeHome } from "../../usecases/storeHome";
import { storeRegisterSchema } from "../../schemas/account";
import { SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME, serializeCookie } from "../cookies";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const registerStoreRoute = defineRoute({
  method: "POST",
  path: "/api/register/store",
  auth: "public",
  human: true,
  input: storeRegisterSchema,
  handler: async ({ input, deps }) => {
    const result = await registerStore(deps, input);
    if (!result.ok) {
      // 重複は 409（設計書「入力の断りの応答の形」。どの項目かも返す）。
      return { status: 409, body: { ok: false, error: { kind: result.kind, fields: [{ name: "email", reason: "not_allowed" }] } } };
    }
    // 登録の直後にもう一度ログインさせないため、ここでセッションの Cookie も配る（AI判断・タスク表）。
    return {
      status: 201,
      body: { ok: true, role: "store" },
      cookies: [serializeCookie(SESSION_COOKIE_NAME, result.session.token, SESSION_COOKIE_MAX_AGE_SECONDS)],
    };
  },
});

const storeHomeRoute = defineRoute({
  method: "GET",
  path: "/api/store/home",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const home = await storeHome(deps, ctx.storeId);
    // 見分けの直後に店が消えた場合だけ null。店のデータは返さない。
    if (!home) return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    // 【最終日】仮のパスワードで入った店には、新しいパスワードを決めるよう画面が求める（基準 14.14）。
    return { status: 200, body: { ...home, mustChangePassword: ctx.mustChangePassword } };
  },
});

export const storeRoutes: RouteDefinition[] = [registerStoreRoute, storeHomeRoute];
