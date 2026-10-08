// 店の情報の入口（要件15）。見分けは defineRoute が済ませているので、ここは手続きを呼んで
// 応答の形へ直すだけ。自分の店の情報しか読み書きできない——店の番号は本文ではなく
// セッション（ctx.storeId）から取る（要件14の基準 14.4）。
//
// ⚠️ タスク5だけのまとまりとして別のファイルに置いた（endpoints/store.ts は店の登録とホームのまま）。
// 統合のとき routes.ts の1行だけがぶつかる形にするため。

import { readStoreProfile, saveStoreProfile } from "../../usecases/saveStoreProfile";
import { readStoreStatus } from "../../usecases/storeStatus";
import { storeProfileSchema } from "../../schemas/store";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { refusal, unauthenticated } from "../refusals";

const getStoreProfileRoute = defineRoute({
  method: "GET",
  path: "/api/store/profile",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const profile = await readStoreProfile(deps, ctx.storeId);
    // 見分けの直後に店が消えた場合だけ null。店のデータは返さない。
    if (!profile) return unauthenticated();
    return respond("GET /api/store/profile", { ok: true, profile });
  },
});

const putStoreProfileRoute = defineRoute({
  method: "PUT",
  path: "/api/store/profile",
  auth: "store",
  input: storeProfileSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await saveStoreProfile(deps, ctx.storeId, input);
    // 住所が位置に直せなかったのは形の誤りではないので 409（設計書「入力の断りの応答の形」・対応は http/refusals の表）。
    if (!result.ok) return refusal(result.kind, { fields: result.fields });
    return respond("PUT /api/store/profile", { ok: true, profile: result.profile });
  },
});

/**
 * 承認の状態だけ（2026-10-08 本人選択・AI提示）。店舗情報の画面が承認の状態を出すために、店のホーム
 * （向かっている客の呼び名・電話番号まで入る）を丸ごと読んでいたのを、この軽い入口に分けた。
 * 返すのは状態の1語だけで、客の情報・店の番号は返さない。店の番号はセッション（ctx.storeId）から取るので、
 * ほかの店の状態は読めない。見分けと仮のパスワードの扱いは店のほかの入口と同じ（defineRoute の auth: "store"）。
 */
const getStoreStatusRoute = defineRoute({
  method: "GET",
  path: "/api/store/status",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const status = await readStoreStatus(deps, ctx.storeId);
    // 見分けの直後に店が消えた場合だけ null。店のデータは返さない。
    if (!status) return unauthenticated();
    return respond("GET /api/store/status", { ok: true, status });
  },
});

export const storeProfileRoutes: RouteDefinition[] = [getStoreProfileRoute, putStoreProfileRoute, getStoreStatusRoute];
