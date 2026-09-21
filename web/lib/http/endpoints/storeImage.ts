// 客の入口（設計書「入口（API）の一覧」）。GET /api/customer/store-image。
// 店のホームページから雰囲気画像を取る（2026-09-22 本人の指摘「お店の画像もほしい」・
// 速成版 `sprint/app/api/store-image` の移植）。入力の検査・見分けは defineRoute が済ませているので、
// ここは手続きを呼んで応答の形に直すだけ。

import { storeImageQuerySchema } from "../../schemas/storeImage";
import { storeImage } from "../../usecases/storeImage";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const customerStoreImageRoute = defineRoute({
  method: "GET",
  path: "/api/customer/store-image",
  auth: "customer",
  input: storeImageQuerySchema,
  handler: async ({ input, deps }) => ({ status: 200, body: await storeImage(deps, input) }),
});

export const storeImageRoutes: RouteDefinition[] = [customerStoreImageRoute];
