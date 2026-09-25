// 運営の店の入口（設計書「入口（API）の一覧」の運営の行）。見分けはセッションで役割が運営
// （defineRoute の auth: "admin"）。承認を断る入口は置かない（基準 25.3）。
//
// ⚠️ 2026-09-21 タスク21 が `POST /api/admin/stores/:id/restore`（承認済みへ戻す・基準 25.9）を
// 足した。止めたときの確保の取り消しとプッシュ（基準 25.8・25.11・22.2）は `usecases/banStore` の側。
// `GET /api/admin/stores/:id/license`（基準 24.11 の読み口）はタスク7の持ち場。
//
// 2026-09-25 監査の指摘 運営-01: 操作した運営（ctx.accountId）を手続きへ渡し、取り消しと戻すは理由を受け取る。
// 運営-05・運営-02 で、メモと「連絡済み」の印（/note）と、承認後の変更の確かめ（/acknowledge）を足した。

import { adminActionReasonSchema, adminStoreNoteSchema, adminStoreQuerySchema } from "../../schemas/admin";
import { acknowledgeAdminStoreChanges, adminStoreDetail, adminStoreList, saveAdminStoreNote, type AdminStoreChangeResult } from "../../usecases/adminStores";
import { approveStore } from "../../usecases/approveStore";
import { banStore } from "../../usecases/banStore";
import { restoreStore } from "../../usecases/restoreStore";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";
// 見つからない店は 404・not_found（運営にも店の有無より先の中身は返さない）。状況が合わない
// （承認済みの店を承認する・未承認の店を止める、など）ときは、確保への操作と同じ「今の状態を返す」形
// （設計書「入力の断りの応答の形」の境界の②）。どちらも http/refusals の1つを使う。
import { notFound, refusal, stateConflict } from "../refusals";

const adminStoreListRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores",
  auth: "admin",
  input: adminStoreQuerySchema,
  handler: async ({ input, deps }) => respond("GET /api/admin/stores", await adminStoreList(deps, input)),
});

const adminStoreDetailRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores/:id",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const detail = await adminStoreDetail(deps, params.id);
    return detail ? respond("GET /api/admin/stores/:id", detail) : notFound();
  },
});

const approveStoreRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/approve",
  auth: "admin",
  handler: async ({ params, deps, ctx }) => {
    const result = await approveStore(deps, params.id, { accountId: ctx.accountId });
    if (result.ok) return respond("POST /api/admin/stores/:id/approve", { ok: true });
    if (result.kind === "not_found") return notFound();
    if (result.kind === "state") return stateConflict(result.state);
    // 足りないもの（許可書・カード）を項目として返す（基準 25.2・設計書「入力の誤りの出し方」の 25.2 の行）。
    return refusal("approval_missing", { fields: result.missing.map((name) => ({ name, reason: "required" as const })) });
  },
});

const banStoreRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/ban",
  auth: "admin",
  input: adminActionReasonSchema,
  handler: async ({ params, input, deps, ctx }) => {
    const result = await banStore(deps, params.id, { accountId: ctx.accountId }, input.reason ?? null);
    // 取り消した確保の数と通知を送った人数を返す（画面が「N 組を取り消し、M 人に通知しました」と出す・運営-03）。
    if (result.ok) return respond("POST /api/admin/stores/:id/ban", result);
    return result.kind === "not_found" ? notFound() : stateConflict(result.state);
  },
});

/**
 * 承認済みへ戻す（基準 25.9）。止められている店だけが戻り、終わったオファーと取り消された確保は
 * 戻らない（基準 25.10）。断りの形は停止・承認と同じ（`{ ok:false, current:{ state } }` の409）。
 */
const restoreStoreRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/restore",
  auth: "admin",
  input: adminActionReasonSchema,
  handler: async ({ params, input, deps, ctx }) => {
    const result = await restoreStore(deps, params.id, { accountId: ctx.accountId }, input.reason ?? null);
    if (result.ok) return respond("POST /api/admin/stores/:id/restore", { ok: true });
    return result.kind === "not_found" ? notFound() : stateConflict(result.state);
  },
});

/** 書き換えの断りを応答へ（見つからない 404・状況が合わない 409）。 */
const changeRefusal = (result: Exclude<AdminStoreChangeResult, { ok: true }>): RouteHandlerResult => (result.kind === "not_found" ? notFound() : stateConflict(result.state));

/** 運営のメモと「連絡済み」の印（運営-05 の A）。 */
const adminStoreNoteRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/note",
  auth: "admin",
  input: adminStoreNoteSchema,
  handler: async ({ params, input, deps, ctx }) => {
    const result = await saveAdminStoreNote(deps, params.id, { accountId: ctx.accountId }, input);
    return result.ok ? respond("POST /api/admin/stores/:id/note", { ok: true }) : changeRefusal(result);
  },
});

/** 承認後の変更を確かめた（運営-02）。今の店名・住所・許可書で承認の写しを取り直す。 */
const acknowledgeStoreChangesRoute = defineRoute({
  method: "POST",
  path: "/api/admin/stores/:id/acknowledge",
  auth: "admin",
  handler: async ({ params, deps, ctx }) => {
    const result = await acknowledgeAdminStoreChanges(deps, params.id, { accountId: ctx.accountId });
    return result.ok ? respond("POST /api/admin/stores/:id/acknowledge", { ok: true }) : changeRefusal(result);
  },
});

export const adminStoreRoutes: RouteDefinition[] = [
  adminStoreListRoute,
  adminStoreDetailRoute,
  approveStoreRoute,
  banStoreRoute,
  restoreStoreRoute,
  adminStoreNoteRoute,
  acknowledgeStoreChangesRoute,
];
