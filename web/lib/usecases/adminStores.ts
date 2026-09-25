// 運営の店の一覧と詳細（要件24）。手続きは Deps を引数で受け、判断は持たない
// （並べ替え・絞り込み・検索の条件は SQL の側・設計書「どの判断をどこに置くか」）。
//
// ⚠️ 応答に客のデータ（電話番号・呼び名）は入れない（基準 28.2・受け入れ検査 r28）。
// ここが読むのは stores と、その店のアカウントのメールアドレスと、数だけ（確保・通報）。
// 通報の理由は客が書いた文だが、運営に見せるためのもの（通報の一覧と同じ・基準 26.6）。
//
// 2026-09-25 監査の指摘で、詳細に「止める前に見るもの」（向かっている組数・その店への通報・運営-03）、
// 承認した時点の写しと違い（運営-02）、審査の手がかり（運営-05）、操作の履歴（運営-01）を足した。
// メモと「連絡済み」の印（運営-05 の A）と、承認後の変更の確かめ（運営-02）もここ。

import type { Deps } from "../ports";
import { listAdminActionsForStore, type AdminActionRow } from "../repo/adminActions";
import {
  acknowledgeStoreChanges,
  findStoreForAdmin,
  findStoreStatus,
  listStoresForAdmin,
  saveStoreNote,
  summarizeStoresForAdmin,
  type AdminStoreDetailRow,
  type AdminStoreListRow,
  type AdminStoreSummary,
} from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";
import type { AdminStoreNoteInput, AdminStoreQuery } from "../schemas/admin";
import { ADMIN_HISTORY_MAX } from "../schemas/limits";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { storeReportsForAdmin, type StoreReports } from "./adminReports";

export type AdminStoreListItem = AdminStoreListRow;

export type AdminStoreListResult = { items: AdminStoreListItem[]; summary: AdminStoreSummary };

export type AdminStoreDetail = AdminStoreDetailRow;

/** 詳細の応答（店・その店への通報・運営の操作の履歴）。 */
export type AdminStoreDetailResult = { store: AdminStoreDetail; reports: StoreReports; history: AdminActionRow[] };

/** 一覧と、いちばん上の集計（基準 24.1〜24.6・24.8・24.9）。集計は絞り込み・ジャンル・検索に左右されない。 */
export const adminStoreList = async (deps: Deps, input: AdminStoreQuery = {}): Promise<AdminStoreListResult> => {
  const nowIso = deps.clock.now().toISOString();
  const [items, summary] = await Promise.all([
    listStoresForAdmin(deps.db, { filter: input.filter, genre: input.genre, q: input.q, nowIso }),
    summarizeStoresForAdmin(deps.db, nowIso),
  ]);
  return { items, summary };
};

/** 店の詳細（基準 24.10・24.11）。無ければ null（入口が 404 に倒す）。 */
export const adminStoreDetail = async (deps: Deps, storeId: string): Promise<AdminStoreDetailResult | null> => {
  // ジャンルとおすすめメニューの JSON の並びは repo が読んで返す（repo/d1 の parseStringList）。
  const store = await findStoreForAdmin(deps.db, storeId, deps.clock.now().toISOString());
  if (!store) return null;
  const [reports, history] = await Promise.all([storeReportsForAdmin(deps, storeId), listAdminActionsForStore(deps.db, storeId, ADMIN_HISTORY_MAX)]);
  return { store, reports, history };
};

export type AdminStoreChangeResult = { ok: true } | { ok: false; kind: "not_found" } | { ok: false; kind: "state"; state: StoreStatus };

/** 運営のメモと「連絡済み」の印を書く（運営-05 の A）。空白だけのメモは「メモなし」。 */
export const saveAdminStoreNote = async (deps: Deps, storeId: string, actor: AdminActor, input: AdminStoreNoteInput): Promise<AdminStoreChangeResult> => {
  const note = input.note.trim() === "" ? null : input.note.trim();
  const action = newAdminAction(deps, actor, "note", storeId, { reason: note, detail: { contacted: input.contacted } });
  return (await saveStoreNote(deps.db, storeId, { note, contacted: input.contacted }, action)) ? { ok: true } : { ok: false, kind: "not_found" };
};

/**
 * 承認後の変更を確かめた（運営-02）。今の値で写しを取り直す。写しの無い店（未承認）は今の状況を返して断る。
 */
export const acknowledgeAdminStoreChanges = async (deps: Deps, storeId: string, actor: AdminActor): Promise<AdminStoreChangeResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (await acknowledgeStoreChanges(deps.db, storeId, newAdminAction(deps, actor, "acknowledge", storeId))) return { ok: true };
  return { ok: false, kind: "state", state: status };
};
