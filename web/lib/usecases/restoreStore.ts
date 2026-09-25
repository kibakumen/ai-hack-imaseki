// 承認済みへ戻す（要件25の基準 25.9・25.10）。止められている店だけが戻せる。
//
// **戻しても、終わったオファーと取り消された確保は戻らない**（基準 25.10）——この手続きが触るのは
// `stores.status` の1列だけで、`offers.ended_at` にも `reservations.status` にも1文字も書かない。
// 店は戻ったあと、新しく公開し直す（終わったオファーを再開する入口は無い・基準 17.15）。
//
// 断りの形は `banStore`・`approveStore` と同じ（`{ ok:false, current:{ state } }` の409）。

import type { Deps } from "../ports";
import { findStoreStatus, restoreBannedStore } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { currentStateRefusal } from "./adminStoreConflict";

export type RestoreStoreResult =
  | { ok: true }
  | { ok: false; kind: "not_found" }
  /** 止められていない（未承認・もう承認済み）。今の状況を返して断る（基準 25.9） */
  | { ok: false; kind: "state"; state: StoreStatus };

/**
 * 誰が・なぜ戻したかを、状況の書き換えと同じまとまりで記録する（2026-09-25 監査の指摘 運営-01）。
 * 理由は必須（運営-01 の案2・入口の形の検査が空白だけの理由も断る）。
 */
export const restoreStore = async (deps: Deps, storeId: string, actor: AdminActor, reason: string): Promise<RestoreStoreResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (status !== "banned") return { ok: false, kind: "state", state: status };

  // 読んでから書くまでの間に状況が動いた（同時に来た操作）なら、当たらない。変わった行の数が
  // 分からないときも「当たらなかった」側へ倒す（repo/d1 の changedRows・`approveStore` と同じ形）。
  // そのときは今の状況を読み直して返す（先に読んだ banned を返さない・運営-04 のレビュー）。
  const action = newAdminAction(deps, actor, "restore", storeId, { reason });
  if (!(await restoreBannedStore(deps.db, storeId, action))) return currentStateRefusal(deps, storeId);

  deps.logger.log({ event: "restore_store", id: storeId, actor: actor.accountId });
  return { ok: true };
};
