// 店が確保に対して行う操作の入口（設計書「入口（API）の一覧」の店の行）——完了済みにする（要件20）と、店による取り消し（要件21）。
// 見分けはセッションで役割が店（`defineRoute` の `auth: "store"`）で、自分の店の確保だけを手続きが扱う。ここは手続きを呼んで
// 応答の形に直すだけ。
//
// 客の側の入口（`endpoints/reservations.ts`）と分けてある（AI判断・2026-09-21 タスク18）: 同じ「確保」でも見分けが違い
// （客の Cookie／店のセッション）、断りの形も違う（客の取り消しは基準 10.3、店の取り消しは基準 21.7）。
//
// ⚠️ **完了済みにする操作はコードの入力を求めない**（基準 20.11）＝入力のスキーマを持たない。本文なしの POST でも通る
//    （`defineRoute` が空の本文を `{}` として扱う）。
// ⚠️ 確保の期限を延ばす入口・完了済みを戻す入口は置かない（基準 11.4・20.10・構造の検査が見張る）。
// ⚠️ 在らない番号・別の店の確保は 404・not_found（http/refusals の notFound）。どちらなのかは返さない
//    ——別の店の確保の有無を教えないため。
//
// 2026-09-25 監査の指摘 設計-11: この頭の注は、並行したタスク（17・18）が「あとでここへ足す」と書いた予告のまま
// import の前後の2か所に分かれて残っていた（足し終えたあとも）。実態に合わせて1つにまとめた。

import { cancelByStore } from "../../usecases/cancelByStore";
import { completeReservation } from "../../usecases/completeReservation";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { notFound, refusal, stateConflict } from "../refusals";
import { respond } from "../respond";

/** 完了済みにする（要件20）。 */
const completeReservationRoute = defineRoute({
  method: "POST",
  path: "/api/store/reservations/:id/complete",
  auth: "store",
  handler: async ({ params, deps, ctx }) => {
    const result = await completeReservation(deps, ctx.storeId, params.id);
    if (result.ok) return respond("POST /api/store/reservations/:id/complete", { ok: true });
    // 404 は「その店の確保ではない」。409 は状態による断り（今の状態を返す・基準 20.20）と、
    // 止められている店の断り（store_banned・基準 20.25・店-10）
    if (result.kind === "not_found") return notFound();
    if (result.kind === "store_banned") return refusal("store_banned");
    return stateConflict(result.state, result.newerReservation ? { newerReservation: true } : {});
  },
});

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
    if (result.ok) return respond("POST /api/store/reservations/:id/cancel", { ok: true });
    if (result.kind === "not_found") return notFound();
    // 確保への操作の断りは「今の状態を返す」形（設計書「入力の断りの応答の形」の境界の②）。
    return stateConflict(result.state);
  },
});

export const storeReservationRoutes: RouteDefinition[] = [completeReservationRoute, storeCancelReservationRoute];
