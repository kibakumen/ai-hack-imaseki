// 止められている店を戻す（要件25の基準 25.9・25.10）。止められている店だけが戻せる。
//
// **戻した先は2つ**（2026-09-25 安全-20 のレビュー・基準 25.9 を変えた・AI判断）: 止めたときに営業許可書と承認の写しを
// 消した店は承認待ちへ（店が上げ直し、運営が確かめてから承認する）、写しが残っている店は承認済みへ。
// 運営の画面は、返した `status` で「承認済みに戻しました」と「承認待ちに戻しました」を出し分ける。
//
// **戻しても、終わったオファーと取り消された確保は戻らない**（基準 25.10）——この手続きが触るのは
// `stores.status` の1列だけで、`offers.ended_at` にも `reservations.status` にも1文字も書かない。
// 店は戻ったあと、新しく公開し直す（終わったオファーを再開する入口は無い・基準 17.15）。
//
// 断りの形は `banStore`・`approveStore` と同じ（`{ ok:false, current:{ state } }` の409）。

import type { Deps } from "../ports";
import { findStoreStatus, restoreBannedStore, type RestoredStatus } from "../repo/adminStoreActions";
import type { StoreStatus } from "../repo/stores";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { currentStateRefusal } from "./adminStoreConflict";

export type RestoreStoreResult =
  /** 戻った。`status` は戻した先（承認済み／承認待ち） */
  | { ok: true; status: RestoredStatus }
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
  const restored = await restoreBannedStore(deps.db, storeId, action);
  if (restored === null) return currentStateRefusal(deps, storeId);

  deps.logger.log({ event: "restore_store", id: storeId, actor: actor.accountId });
  return { ok: true, status: restored };
};
