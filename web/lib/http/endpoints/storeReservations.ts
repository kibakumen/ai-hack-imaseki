import { completeReservation } from "../../usecases/completeReservation";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { cancelByStore } from "../../usecases/cancelByStore";
// 店から確保を操作する入口（設計書「入口（API）の一覧」の店の入口）。
// 見分け（役割が店・自分の店の確保だけ）は defineRoute と手続きが済ませるので、ここは
// 手続きを呼んで応答の形に直すだけ。
//
// ⚠️ **完了済みにする操作はコードの入力を求めない**（基準 20.11）＝入力のスキーマを持たない。
//    本文なしの POST でも通る（`defineRoute` が空の本文を `{}` として扱う）。
//
// ⚠️ タスク18（店による確保の取り消し）はこのまとまりへ
//    `POST /api/store/reservations/:id/cancel` を足す（`routes.ts` は触らずに済む）。


const completeReservationRoute = defineRoute({
  method: "POST",
  path: "/api/store/reservations/:id/complete",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await completeReservation(deps, ctx.storeId, params.id);
    if (result.ok) return { status: 200, body: { ok: true } };
    // 404 は「その店の確保ではない」。409 は状態による断り（今の状態を返す・基準 20.20）
    if (result.status === 404) return { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };
    return { status: 409, body: { ok: false, current: result.current } };
  },
});

// 店が確保に対して行う操作の入口（設計書「入口（API）の一覧」の店の行）。
// 見分けはセッションで役割が店（`defineRoute` の `auth: "store"`）。
//
// ⚠️ 入口を客の側（`endpoints/reservations.ts`）と分けた理由（AI判断・2026-09-21 タスク18）:
//    同じ「確保」でも見分けが違い（客の Cookie／店のセッション）、断りの形も違う
//    （客の取り消しは基準 10.3、店の取り消しは基準 21.7）。並列の実装で同じファイルの末尾を
//    取り合わないようにもした。**タスク17 の `POST /api/store/reservations/:id/complete` は
//    このまとまりへ足す**（`routes.ts` は触らずに済む）。
//
// ⚠️ 確保の期限を延ばす入口・完了済みを戻す入口は置かない（基準 11.4・20.10・構造の検査が見張る）。


/**
 * 在らない番号・別の店の確保（404）。どちらなのかは返さない——別の店の確保の有無を教えないため
 * （受け入れ検査は 403 でも 404 でも通すが、存在を分けて見せない側に寄せた）。
 */
const notFound = { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };

/**
 * 店による確保の取り消し（要件21）。
 *
 * 入力は取らない——**理由の欄は無い**（基準 21.3）。本文なしの要求でも通る（画面は確かめだけを出す）。
 * 確保中でなければ、状態も残りも変えずに今の状態を返して断る（基準 21.5〜21.7）。
 */
const storeCancelReservationRoute = defineRoute({
  method: "POST",
  path: "/api/store/reservations/:id/cancel",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await cancelByStore(deps, ctx.storeId, params.id);
    if (result.ok) return { status: 200, body: { ok: true } };
    if (result.kind === "not_found") return notFound;
    // 確保への操作の断りは「今の状態を返す」形（設計書「入力の断りの応答の形」の境界の②）。
    return { status: 409, body: { ok: false, current: { state: result.state } } };
  },
});

export const storeReservationRoutes: RouteDefinition[] = [completeReservationRoute, storeCancelReservationRoute];
