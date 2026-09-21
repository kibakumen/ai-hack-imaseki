// 登録の消去の入口【最終日】（要件28の基準 28.4・28.5・28.8・28.9。設計書「入口（API）の一覧」）。
// 入力は持たない（消すのは Cookie が指す自分の登録だけ）ので、スキーマも指定しない。
//
// ⚠️ 消えたあとの Cookie を端末に残さない（基準 28.9）——応答で Max-Age=0 の Set-Cookie を返す。
//    端末に残した確保の中身を消すのは画面の側（`lib/client/reservationCache`）。

import { deleteCustomer } from "../../usecases/deleteCustomer";
import { CUSTOMER_COOKIE_NAME, expireCookie } from "../cookies";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const deleteCustomerRoute = defineRoute({
  method: "DELETE",
  path: "/api/customer",
  auth: "customer",
  handler: async ({ deps, ctx }) => {
    const result = await deleteCustomer(deps, ctx.customerId);
    // 見分けの直後に登録が消えた場合だけ（客のデータは返さない・基準 2.5）。
    if (!result.ok && result.kind === "not_found") return { status: 401, body: { ok: false, error: { kind: "invalid_input" } } };
    // 確保中・期限から20分以内の期限切れ（基準 28.5）。今の状態ではなく断りの語で返す
    // ——画面は `domain/texts` で文に直し、InputRefusal が「登録を消す」の直下に出す。
    if (!result.ok) return { status: 409, body: { ok: false, error: { kind: result.kind } } };
    return { status: 200, body: { ok: true }, cookies: [expireCookie(CUSTOMER_COOKIE_NAME)] };
  },
});

export const customerDeleteRoutes: RouteDefinition[] = [deleteCustomerRoute];
