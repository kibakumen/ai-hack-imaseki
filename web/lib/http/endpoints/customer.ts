// 客の入口（設計書「入口（API）の一覧」）。登録の入口は無記名、ホームは Cookie の客の識別子で見分ける。
// 入力の検査・見分け・Origin・人かどうかの確かめは defineRoute が済ませているので、ここは
// 手続きを呼んで応答の形に直すだけ。

import { customerRegisterSchema } from "../../schemas/customer";
import { placeQuerySchema } from "../../schemas/place";
import { customerHome } from "../../usecases/customerHome";
import { placeLabel } from "../../usecases/placeLabel";
import { registerCustomer } from "../../usecases/registerCustomer";
import { CUSTOMER_COOKIE_MAX_AGE_SECONDS, CUSTOMER_COOKIE_NAME, serializeCookie } from "../cookies";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const registerCustomerRoute = defineRoute({
  method: "POST",
  path: "/api/register/customer",
  auth: "public",
  human: true,
  input: customerRegisterSchema,
  handler: async ({ input, deps }) => {
    const { token } = await registerCustomer(deps, input);
    // 識別子の値は本文にも Location にも載せない（基準 2.6）。端末へ渡すのは Set-Cookie だけ。
    return {
      status: 201,
      body: { ok: true },
      cookies: [serializeCookie(CUSTOMER_COOKIE_NAME, token, CUSTOMER_COOKIE_MAX_AGE_SECONDS)],
    };
  },
});

const customerHomeRoute = defineRoute({
  method: "GET",
  path: "/api/customer/home",
  auth: "customer",
  handler: async ({ deps, ctx }) => {
    const home = await customerHome(deps, ctx.customerId);
    // 見分けの直後に登録が消えた場合だけ null になる。客のデータは返さない（基準 2.5）。
    if (!home) return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    return { status: 200, body: home };
  },
});

/**
 * 現在地の座標を地名へ直す（読むだけ）。画面が開いた瞬間に場所の欄へ入れる文字を取る入口で、
 * 地図の鍵を画面へ渡さないために挟む（2026-09-22 の本人の指摘「開いた瞬間にここに現在地の
 * 文字に変換した場所が入っていて」）。直せなければ `label: null` を返す（断りにはしない——
 * 客は座標のまま探せる）。
 */
const customerPlaceRoute = defineRoute({
  method: "GET",
  path: "/api/customer/place",
  auth: "customer",
  input: placeQuerySchema,
  handler: async ({ input, deps }) => ({ status: 200, body: await placeLabel(deps, input) }),
});

export const customerRoutes: RouteDefinition[] = [registerCustomerRoute, customerHomeRoute, customerPlaceRoute];
