// 店の入口（設計書「入口（API）の一覧」）。登録は無記名で人かどうかの確かめつき、
// ホームはセッションで役割が店の要求だけが通る。
// ⚠️ 店の情報・クーポン・許可書・カード・オファーの入口は、タスク5以降がこのまとまりへ足す。

import { registerStore } from "../../usecases/registerStore";
import { storeHome } from "../../usecases/storeHome";
import { storeRegisterSchema } from "../../schemas/account";
import { HUMAN_CHECK_ACTIONS } from "../../schemas/limits";
import { SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME, serializeCookie } from "../cookies";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal, unauthenticated } from "../refusals";

const registerStoreRoute = defineRoute({
  method: "POST",
  path: "/api/register/store",
  auth: "public",
  human: HUMAN_CHECK_ACTIONS.registerStore,
  input: storeRegisterSchema,
  handler: async ({ input, deps }) => {
    const result = await registerStore(deps, input);
    // 重複は 409（設計書「入力の断りの応答の形」。どの項目かも返す）。
    if (!result.ok) return refusal(result.kind, { fields: [{ name: "email", reason: "not_allowed" }] });
    // 登録の直後にもう一度ログインさせないため、ここでセッションの Cookie も配る（AI判断・タスク表）。
    return respond("POST /api/register/store", { ok: true, role: "store" }, 201, [serializeCookie(SESSION_COOKIE_NAME, result.session.token, SESSION_COOKIE_MAX_AGE_SECONDS)]);
  },
});

const storeHomeRoute = defineRoute({
  method: "GET",
  path: "/api/store/home",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const home = await storeHome(deps, ctx.storeId);
    // 見分けの直後に店が消えた場合だけ null。店のデータは返さない。
    if (!home) return unauthenticated();
    // 【最終日】仮のパスワードで入った店には、新しいパスワードを決めるよう画面が求める（基準 14.14）。
    // 仮のパスワードの間は、向かっている客（呼び名・電話番号）を返さない（安全-21 のレビュー・2026-09-26）。
    // 仮のパスワードは運営からメールで平文のまま届くので、その値を知る人が決め直さずに客の電話番号を読めた。
    // 決め直せば次の取り直しで出る。
    const visible = ctx.mustChangePassword ? { ...home, arrivals: [] } : home;
    return respond("GET /api/store/home", { ...visible, mustChangePassword: ctx.mustChangePassword });
  },
});

export const storeRoutes: RouteDefinition[] = [registerStoreRoute, storeHomeRoute];
