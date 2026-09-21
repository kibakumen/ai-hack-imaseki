// 通知の入口2本（設計書「入口（API）の一覧」の客の入口）。
//   POST /api/customer/push-subscription … 端末が作った購読を預かる（客1人に1つ）
//   GET  /api/customer/push-message      … Service Worker が文面を取りに来る（中身を載せないプッシュのため）
// 見分け（Cookie の客の識別子）・Origin の確かめ・入力の検査は defineRoute が済ませている。

import { pushMessage } from "../../usecases/pushMessage";
import { savePushSubscription } from "../../repo/push";
import { pushSubscriptionSchema } from "../../schemas/push";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const pushSubscriptionRoute = defineRoute({
  method: "POST",
  path: "/api/customer/push-subscription",
  auth: "customer",
  input: pushSubscriptionSchema,
  handler: async ({ input, deps, ctx }) => {
    await savePushSubscription(deps.db, ctx.customerId, input.subscription);
    return { status: 200, body: { ok: true } };
  },
});

const pushMessageRoute = defineRoute({
  method: "GET",
  path: "/api/customer/push-message",
  auth: "customer",
  handler: async ({ deps, ctx }) => ({ status: 200, body: await pushMessage(deps, ctx.customerId) }),
});

export const pushRoutes: RouteDefinition[] = [pushSubscriptionRoute, pushMessageRoute];
