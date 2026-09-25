// 店と運営のログインとログアウト（設計書「入口（API）の一覧」の登録の入口）。
// ログインは人かどうかの確かめつき（本人選択・3つの入口の1つ）。ログアウトは確かめを求めない
// （Cookie を配る入口ではなく、切るだけ）。入力の検査・Origin・確かめは defineRoute が済ませている。

import { login, logout } from "../../usecases/login";
import { loginSchema } from "../../schemas/account";
import { SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME, expireCookie, parseCookies, serializeCookie } from "../cookies";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal } from "../refusals";

const loginRoute = defineRoute({
  method: "POST",
  path: "/api/auth/login",
  auth: "public",
  human: true,
  input: loginSchema,
  handler: async ({ input, deps }) => {
    const result = await login(deps, input);
    // どちらが違うかは言わない（基準 14.2）。状態も本文も1通りだけ。
    if (!result.ok) return refusal(result.kind);
    return respond("POST /api/auth/login", { ok: true, role: result.role, mustChangePassword: result.mustChangePassword }, 200, [
      serializeCookie(SESSION_COOKIE_NAME, result.session.token, SESSION_COOKIE_MAX_AGE_SECONDS),
    ]);
  },
});

const logoutRoute = defineRoute({
  method: "POST",
  path: "/api/auth/logout",
  auth: "public",
  handler: async ({ req, deps }) => {
    // 見分けを求めない（切れた・でたらめな値でも同じ応答）。表に在れば消し、Cookie も失効させる。
    await logout(deps, parseCookies(req.headers.get("cookie"))[SESSION_COOKIE_NAME] ?? null);
    return respond("POST /api/auth/logout", { ok: true }, 200, [expireCookie(SESSION_COOKIE_NAME)]);
  },
});

export const authRoutes: RouteDefinition[] = [loginRoute, logoutRoute];
