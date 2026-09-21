// 運営の店の入口（設計書「入口（API）の一覧」の運営の行）。見分けはセッションで役割が運営
// （defineRoute の auth: "admin"）。承認を断る入口は置かない（基準 25.3）。
//
// ⚠️ `POST /api/admin/stores/:id/restore`（承認済みへ戻す・基準 25.9）と、止めたときの確保の
// 取り消し・プッシュ（基準 25.8・25.11・22.2）はタスク21がここへ足す。
// `GET /api/admin/stores/:id/license`（基準 24.11 の読み口）はタスク7の持ち場。

import { adminStoreQuerySchema } from "../../schemas/admin";
import { adminStoreDetail, adminStoreList } from "../../usecases/adminStores";
import { approveStore } from "../../usecases/approveStore";
import { banStore } from "../../usecases/banStore";
import { defineRoute, type RouteDefinition } from "../defineRoute";

/** 見つからない店（404）。運営にも店の有無より先の中身は返さない。 */
const notFound = { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };

/**
 * 状況が合わないので断る（承認済みの店を承認する・未承認の店を止める、など）。
 * 確保への操作と同じ「今の状態を返す」形（設計書「入力の断りの応答の形」の境界の②）。
 */
const stateConflict = (state: string) => ({ status: 409, body: { ok: false, current: { state } } });

const adminStoreListRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores",
  auth: "admin",
  input: adminStoreQuerySchema,
  handler: async ({ input, deps }) => ({ status: 200, body: await adminStoreList(deps, input) }),
});

const adminStoreDetailRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores/:id",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const store = await adminStoreDetail(deps, params.id);
    return store ? { status: 200, body: { store } } : notFound;
  },
});

const approveStoreRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/approve",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const result = await approveStore(deps, params.id);
    if (result.ok) return { status: 200, body: { ok: true } };
    if (result.kind === "not_found") return notFound;
    if (result.kind === "state") return stateConflict(result.state);
    // 足りないもの（許可書・カード）を項目として返す（基準 25.2・設計書「入力の誤りの出し方」の 25.2 の行）。
    return {
      status: 409,
      body: { ok: false, error: { kind: "approval_missing", fields: result.missing.map((name) => ({ name, reason: "required" })) } },
    };
  },
});

const banStoreRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/ban",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const result = await banStore(deps, params.id);
    if (result.ok) return { status: 200, body: { ok: true } };
    return result.kind === "not_found" ? notFound : stateConflict(result.state);
  },
});

export const adminStoreRoutes: RouteDefinition[] = [adminStoreListRoute, adminStoreDetailRoute, approveStoreRoute, banStoreRoute];
