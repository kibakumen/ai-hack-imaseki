// 公開してよい設定の値を返す入口（設計書「どの判断をどこに置くか」の公開値の行）。
// 無記名で通り、画面の3つのフォーム（人かどうかの確かめ）と client/push がここから値を受け取る。

import type { PublicConfig } from "../../schemas/config";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const publicConfigRoute = defineRoute({
  method: "GET",
  path: "/api/config/public",
  auth: "public",
  handler: async ({ deps }) => {
    // 秘密の値を持つ設定をそのまま返さず、公開してよい3つだけを組み立てる（基準 31.1）。
    const body: PublicConfig = {
      turnstileSiteKey: deps.config.turnstileSiteKey,
      vapidPublicKey: deps.config.vapidPublicKey,
      contactEmail: deps.config.contactEmail ?? null,
    };
    return { status: 200, body };
  },
});

export const configRoutes: RouteDefinition[] = [publicConfigRoute];
