// 店の退会の入口（2026-09-26 本人発案・監査の指摘 安全-20 の残り。要件13の基準 13.13〜13.18）。
// 手続きは usecases/withdrawStore。今のパスワードの再入力で本人を確かめ（合わなければ 403・欄は currentPassword）、
// 通ったら端末のセッションの Cookie も Max-Age=0 で消す（表のセッションは手続きが消している）。
//
// 断りの形:
//   password_mismatch … 403（メールアドレスの変更と同じ）
//   not_found         … 店かアカウントがもう無い（同時に退会した）。見分けの断り 401 に倒す（客の登録の消去と同じ考え）
//   store_banned      … 登録取り消し済みの店は運営への連絡で受ける（409）

import { storeWithdrawSchema } from "../../schemas/account";
import { withdrawStore } from "../../usecases/withdrawStore";
import { SESSION_COOKIE_NAME, expireCookie } from "../cookies";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal, unauthenticated } from "../refusals";

const withdrawStoreRoute = defineRoute({
  method: "POST",
  path: "/api/store/withdraw",
  auth: "store",
  input: storeWithdrawSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await withdrawStore(deps, { accountId: ctx.accountId, storeId: ctx.storeId }, input.currentPassword);
    if (!result.ok && result.kind === "password_mismatch") return refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] });
    if (!result.ok && result.kind === "not_found") return unauthenticated();
    if (!result.ok) return refusal(result.kind);
    return respond("POST /api/store/withdraw", { ok: true, cancelled: result.cancelled }, 200, [expireCookie(SESSION_COOKIE_NAME)]);
  },
});

export const storeWithdrawRoutes: RouteDefinition[] = [withdrawStoreRoute];
