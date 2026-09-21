// 店の情報の入口（要件15）。見分けは defineRoute が済ませているので、ここは手続きを呼んで
// 応答の形へ直すだけ。自分の店の情報しか読み書きできない——店の番号は本文ではなく
// セッション（ctx.storeId）から取る（要件14の基準 14.4）。
//
// ⚠️ タスク5だけのまとまりとして別のファイルに置いた（endpoints/store.ts は店の登録とホームのまま）。
// 統合のとき routes.ts の1行だけがぶつかる形にするため。

import { readStoreProfile, saveStoreProfile } from "../../usecases/saveStoreProfile";
import { storeProfileSchema } from "../../schemas/store";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const getStoreProfileRoute = defineRoute({
  method: "GET",
  path: "/api/store/profile",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const profile = await readStoreProfile(deps, ctx.storeId);
    // 見分けの直後に店が消えた場合だけ null。店のデータは返さない。
    if (!profile) return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    return { status: 200, body: { ok: true, profile } };
  },
});

const putStoreProfileRoute = defineRoute({
  method: "PUT",
  path: "/api/store/profile",
  auth: "store",
  input: storeProfileSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await saveStoreProfile(deps, ctx.storeId, input);
    if (!result.ok) {
      // 住所が位置に直せなかったのは形の誤りではないので 409（設計書「入力の断りの応答の形」）。
      const status = result.kind === "address_unresolved" ? 409 : 400;
      return { status, body: { ok: false, error: { kind: result.kind, fields: result.fields } } };
    }
    return { status: 200, body: { ok: true, profile: result.profile } };
  },
});

export const storeProfileRoutes: RouteDefinition[] = [getStoreProfileRoute, putStoreProfileRoute];
